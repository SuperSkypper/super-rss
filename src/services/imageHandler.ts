import { App, Vault, requestUrl } from 'obsidian';
import { sanitizeFileName } from './feedProcessor';

// ─── Folder helper ────────────────────────────────────────────────────────────

async function ensureFolder(vault: Vault, folderPath: string): Promise<void> {
    if (!folderPath || folderPath === '/' || folderPath === '') return;

    const parts = folderPath.split('/').filter(p => p.length > 0);
    let currentPath = '';

    for (const part of parts) {
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        if (!vault.getAbstractFileByPath(currentPath)) {
            await vault.createFolder(currentPath);
        }
    }
}

// ─── Resolve attachment path ──────────────────────────────────────────────────

export function resolveObsidianAttachmentPath(app: App, currentFileFolderPath: string): string {
    const vaultConfig = (app.vault as any).getConfig?.bind(app.vault);
    if (!vaultConfig) return '';

    const rawPath: string = vaultConfig('attachmentFolderPath') || '';

    if (!rawPath || rawPath === '/' || rawPath === '') return '';
    if (rawPath === './') return currentFileFolderPath;
    if (rawPath.startsWith('./')) {
        const subfolderName = rawPath.slice(2);
        return `${currentFileFolderPath}/${subfolderName}`;
    }

    return rawPath;
}

// ─── YouTube thumbnail upgrade ────────────────────────────────────────────────

// Tries maxresdefault first (1280x720, no black bars), then sddefault, then keeps original.
// YouTube returns a tiny 120x90 placeholder (< 5KB) for missing thumbnails with status 200,
// so we validate by checking content-length.
async function upgradeYoutubeThumbnail(url: string): Promise<string> {
    if (!url.includes('img.youtube.com') && !url.includes('ytimg.com')) return url;

    const maxres = url.replace(
        /(hqdefault|mqdefault|sddefault|default|hq720|maxresdefault)(\.jpg)/i,
        'maxresdefault$2'
    );

    if (maxres !== url) {
        try {
            const res = await requestUrl({ url: maxres, method: 'GET' });
            const length = parseInt(res.headers?.['content-length'] ?? '99999', 10);
            if (res.status === 200 && length > 5000) return maxres;
        } catch { /* fall through */ }
    }

    // Try sddefault as middle ground (no black bars, reasonable resolution)
    const sd = url.replace(
        /(hqdefault|mqdefault|sddefault|default|hq720|maxresdefault)(\.jpg)/i,
        'sddefault$2'
    );

    if (sd !== url) {
        try {
            const res = await requestUrl({ url: sd, method: 'GET' });
            const length = parseInt(res.headers?.['content-length'] ?? '99999', 10);
            if (res.status === 200 && length > 5000) return sd;
        } catch { /* fall through */ }
    }

    return url;
}

// ─── Extract image URL from feed item ────────────────────────────────────────

// xml2js with stripPrefix transforms "media:group" → "group", "media:thumbnail" → "thumbnail"
// so we check both the prefixed and unprefixed versions for safety.

function getThumbnailFromMediaObj(media: any): string {
    if (!media) return '';
    const obj = Array.isArray(media) ? media[0] : media;
    if (obj?.$?.url)  return String(obj.$.url);
    if (typeof obj === 'string' && obj.startsWith('http')) return obj;
    return '';
}

export async function extractImageUrl(item: any, itemUrl: string): Promise<string> {
    let url = '';

    // 1. YouTube / media:group — xml2js strips prefix so key becomes "group"
    const mediaGroup = item?.['media:group'] ?? item?.group;
    if (mediaGroup) {
        const thumbnail = mediaGroup?.['media:thumbnail'] ?? mediaGroup?.thumbnail;
        url = getThumbnailFromMediaObj(thumbnail);
    }

    // 2. media:thumbnail at root level (with or without prefix)
    if (!url) {
        const thumb = item?.['media:thumbnail'] ?? item?.thumbnail;
        url = getThumbnailFromMediaObj(thumb);
    }

    // 3. media:content at root level — only if URL looks like an image
    if (!url) {
        const media = item?.['media:content'] ?? item?.content;
        if (media) {
            const obj = Array.isArray(media) ? media[0] : media;
            const candidate = obj?.$?.url ?? '';
            if (candidate && /\.(jpg|jpeg|png|webp|gif|svg|avif)/i.test(candidate)) {
                url = String(candidate);
            }
        }
    }

    // 4. enclosure (common in podcast/blog feeds like RPCS3)
    if (!url) {
        const enc = item?.enclosure;
        if (enc) {
            const obj = Array.isArray(enc) ? enc[0] : enc;
            const type = obj?.$?.type ?? '';
            const href = obj?.$?.url  ?? obj?.$?.href ?? '';
            if (href && type.startsWith('image/')) url = String(href);
        }
    }

    // 5. Search inside HTML content for first <img>
    if (!url) {
        const content =
            item?.['content:encoded'] ??
            item?.encoded ??
            item?.description ??
            item?.content ??
            item?.summary ??
            '';
        const contentStr = typeof content === 'string' ? content
            : (content?._ ? String(content._) : '');
        const match = /<img[^>]+(?:src|data-src|original-src)=["']([^"']+)["']/i.exec(contentStr);
        if (match?.[1]) url = String(match[1]);
    }

    // 6. Fallback: OpenGraph / Twitter meta tags from original page
    if (!url && itemUrl?.startsWith('http')) {
        try {
            const response = await requestUrl({ url: itemUrl, method: 'GET' });
            if (response?.status === 200) {
                const html = response.text;
                const metaMatch =
                    /<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]+content=["']([^"']+)["']/i.exec(html) ||
                    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image)["']/i.exec(html);
                if (metaMatch?.[1]) url = metaMatch[1];
            }
        } catch { /* Silent fail */ }
    }

    // 7. Cleanup and path resolution
    if (url) {
        url = url.replace(/&amp;/g, '&').replace(/&#038;/g, '&').trim();
        if (url.startsWith('//')) {
            url = 'https:' + url;
        } else if (!url.startsWith('http') && itemUrl) {
            try { url = new URL(url, itemUrl).href; } catch { /* Ignore */ }
        }
    }

    // 8. Upgrade YouTube thumbnail to highest available resolution
    if (url && (url.includes('img.youtube.com') || url.includes('ytimg.com'))) {
        url = await upgradeYoutubeThumbnail(url);
    }

    return url;
}

// ─── Download image to vault ──────────────────────────────────────────────────

export async function downloadImageLocally(
    vault: Vault,
    url: string,
    folderPath: string,
    fileName: string
): Promise<string> {
    try {
        if (!url || !url.startsWith('http')) return url;

        const response = await requestUrl({
            url,
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
            }
        });

        if (response.status !== 200) {
            console.error(`RSS: Download failed for ${url} with status ${response.status}`);
            return url;
        }

        await ensureFolder(vault, folderPath);

        const extension = resolveImageExtension(response.headers?.['content-type'] || '', url);

        const cleanFolderPath = folderPath.replace(/\/+$/, '');
        const prefix = cleanFolderPath ? `${cleanFolderPath}/` : '';
        const imagePath = `${prefix}${sanitizeFileName(fileName)}.${extension}`;

        const existingFile = vault.getAbstractFileByPath(imagePath);
        if (existingFile) return `[[${imagePath}]]`;

        await vault.createBinary(imagePath, response.arrayBuffer);
        return `[[${imagePath}]]`;
    } catch (e) {
        console.error('RSS: Error downloading image:', e);
        return url;
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveImageExtension(contentType: string, url: string): string {
    if (contentType.includes('image/jpeg')) return 'jpg';
    if (contentType.includes('image/webp')) return 'webp';
    if (contentType.includes('image/gif'))  return 'gif';
    if (contentType.includes('image/svg'))  return 'svg';
    if (contentType.includes('image/png'))  return 'png';
    if (contentType.includes('image/avif')) return 'avif';

    const match = url.match(/\.(jpg|jpeg|png|webp|gif|svg|avif)($|\?)/i);
    return match?.[1]?.toLowerCase() ?? 'png';
}