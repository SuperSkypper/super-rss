import { App, Vault, requestUrl } from 'obsidian';
import { sanitizeFileName } from './feedProcessor';

type DataRecord = Record<string, unknown>;

interface VaultWithConfig extends Vault {
    getConfig?(key: string): unknown;
}

function asRecord(value: unknown): DataRecord | null {
    return typeof value === 'object' && value !== null ? value as DataRecord : null;
}

function firstRecord(value: unknown): DataRecord | null {
    return asRecord(Array.isArray(value) ? value[0] : value);
}

function field(record: DataRecord | null, key: string): unknown {
    return record?.[key];
}

// ─── Folder helper ────────────────────────────────────────────────────────────

async function ensureFolder(vault: Vault, folderPath: string): Promise<void> {
    if (!folderPath || folderPath === '/' || folderPath === '') return;

    const parts = folderPath.split('/').filter(p => p.length > 0);
    let currentPath = '';

    for (const part of parts) {
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        if (!vault.getAbstractFileByPath(currentPath)) {
            try {
                await vault.createFolder(currentPath);
            } catch {
                // FIX: folder may have been created concurrently — ignore race condition
            }
        }
    }
}

// ─── Resolve attachment path ──────────────────────────────────────────────────

export function resolveObsidianAttachmentPath(app: App, currentFileFolderPath: string): string {
    const rawValue = (app.vault as VaultWithConfig).getConfig?.('attachmentFolderPath');
    const rawPath = typeof rawValue === 'string' ? rawValue : '';

    if (!rawPath || rawPath === '/' || rawPath === '') return '';
    if (rawPath === './') return currentFileFolderPath;
    if (rawPath.startsWith('./')) {
        const subfolderName = rawPath.slice(2);
        return `${currentFileFolderPath}/${subfolderName}`;
    }

    return rawPath;
}

// ─── YouTube thumbnail upgrade ────────────────────────────────────────────────

// FIX: requestUrl (Obsidian) throws on 4xx/5xx instead of returning the response,
// so checking res.status === 200 inside the try block is redundant — reaching that
// line already implies a 200. Removing it prevents the check from silently blocking
// valid upgrades when content-length is absent (chunked/gzip responses).
// hq720 added as an intermediate fallback: covers videos that lack maxresdefault
// (small channels, older uploads) but still have a 720p thumbnail.

async function tryThumbnailUrl(url: string): Promise<boolean> {
    try {
        const res = await requestUrl({ url, method: 'GET' });
        const lengthHeader = res.headers?.['content-length'];
        const length = lengthHeader ? parseInt(lengthHeader, 10) : 99999;
        console.debug(`RSS thumb probe: status=${res.status} content-length=${lengthHeader ?? 'absent'} length=${length} url=${url}`);
        return length > 5000;
    } catch (e) {
        console.debug(`RSS thumb probe: THREW url=${url} error=${String(e)}`);
        return false;
    }
}

export async function upgradeYoutubeThumbnail(url: string): Promise<string> {
    if (!url.includes('img.youtube.com') && !url.includes('ytimg.com')) return url;

    // Covers .jpg and .webp variants (including vi_webp/ paths)
    const thumbnailPattern = /(hqdefault|mqdefault|sddefault|default|hq720|maxresdefault)(\.jpg|\.webp)/i;

    console.debug(`RSS thumb upgrade: input="${url}" patternMatches=${thumbnailPattern.test(url)}`);

    const maxres = url.replace(thumbnailPattern, 'maxresdefault$2');
    console.debug(`RSS thumb upgrade: maxres="${maxres}" changed=${maxres !== url}`);
    if (maxres !== url && await tryThumbnailUrl(maxres)) { console.debug('RSS thumb upgrade: → maxresdefault'); return maxres; }

    const hq720 = url.replace(thumbnailPattern, 'hq720$2');
    console.debug(`RSS thumb upgrade: hq720="${hq720}" changed=${hq720 !== url}`);
    if (hq720 !== url && await tryThumbnailUrl(hq720)) { console.debug('RSS thumb upgrade: → hq720'); return hq720; }

    const sd = url.replace(thumbnailPattern, 'sddefault$2');
    console.debug(`RSS thumb upgrade: sd="${sd}" changed=${sd !== url}`);
    if (sd !== url && await tryThumbnailUrl(sd)) { console.debug('RSS thumb upgrade: → sddefault'); return sd; }

    console.debug('RSS thumb upgrade: all failed, returning original');
    return url;
}

// ─── Extract image URL from feed item ────────────────────────────────────────

function getThumbnailFromMediaObj(media: unknown): string {
    if (!media) return '';
    if (typeof media === 'string' && media.startsWith('http')) return media;
    if (Array.isArray(media) && typeof media[0] === 'string' && media[0].startsWith('http')) return media[0];
    const obj = firstRecord(media);
    const attributes = asRecord(field(obj, '$'));
    if (typeof attributes?.url === 'string') return attributes.url;
    return '';
}

export async function extractImageUrl(itemValue: unknown, itemUrl: string, providedHtml?: string): Promise<string> {
    const item = asRecord(itemValue);
    let url = '';

    // 1. YouTube / media:group
    const mediaGroup = field(item, 'media:group') ?? field(item, 'group');
    if (mediaGroup) {
        const group = firstRecord(mediaGroup);
        const thumbnail = field(group, 'media:thumbnail') ?? field(group, 'thumbnail');
        url = getThumbnailFromMediaObj(thumbnail);
    }

    // 2. media:thumbnail at root level
    if (!url) {
        const thumb = field(item, 'media:thumbnail') ?? field(item, 'thumbnail');
        url = getThumbnailFromMediaObj(thumb);
    }

    // 3. media:content — only the prefixed key to avoid colliding with item.content (Atom body)
    // FIX: removed `?? item?.content` fallback — item.content is often article body text, not an image
    if (!url) {
        const media = field(item, 'media:content');
        if (media) {
            const obj = firstRecord(media);
            const candidate = field(asRecord(field(obj, '$')), 'url');
            if (typeof candidate === 'string' && /\.(jpg|jpeg|png|webp|gif|svg|avif)/i.test(candidate)) {
                url = candidate;
            }
        }
    }

    // 4. enclosure
    if (!url) {
        const enc = field(item, 'enclosure');
        if (enc) {
            const obj = firstRecord(enc);
            const attributes = asRecord(field(obj, '$'));
            const type = field(attributes, 'type');
            const href = field(attributes, 'url') ?? field(attributes, 'href');
            if (typeof href === 'string' && typeof type === 'string' && type.startsWith('image/')) url = href;
        }
    }

    // 5. Search inside HTML content for first <img>
    if (!url) {
        const content =
            field(item, 'content:encoded') ??
            field(item, 'encoded') ??
            field(item, 'description') ??
            field(item, 'content') ??
            field(item, 'summary') ??
            '';
        const nestedContent = field(asRecord(content), '_');
        const contentStr = typeof content === 'string'
            ? content
            : typeof nestedContent === 'string' ? nestedContent : '';
        const match = /<img[^>]+(?:src|data-src|original-src)=["']([^"']+)["']/i.exec(contentStr);
        if (match?.[1]) url = String(match[1]);
    }

    // 6. Fallback: OpenGraph / Twitter meta tags from original page.
    // requestUrl (Obsidian API) does not support a timeout parameter, so we race
    // the request against a manual 5-second rejection to avoid hanging on slow pages.
    if (!url && itemUrl?.startsWith('http')) {
        if (providedHtml) {
            console.debug(`RSS: extractImageUrl reusing provided HTML for ${itemUrl}`);
            const metaMatch =
                /<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]+content=["']([^"']+)["']/i.exec(providedHtml) ||
                /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image)["']/i.exec(providedHtml);
            if (metaMatch?.[1]) url = metaMatch[1];
        } else {
            try {
                const timeoutPromise = new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error('timeout')), 5000)
                );
                const response = await Promise.race([
                    requestUrl({ url: itemUrl, method: 'GET' }),
                    timeoutPromise,
                ]);
                if (response?.status === 200) {
                    const html = response.text;
                    const metaMatch =
                        /<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]+content=["']([^"']+)["']/i.exec(html) ||
                        /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image)["']/i.exec(html);
                    if (metaMatch?.[1]) url = metaMatch[1];
                }
            } catch { /* Silent fail — includes timeout */ }
        }
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

        // FIX: validate arrayBuffer before writing to avoid silent failures
        if (!response.arrayBuffer || response.arrayBuffer.byteLength === 0) {
            console.error(`RSS: Empty response body for ${url}`);
            return url;
        }

        await ensureFolder(vault, folderPath);

        const extension = resolveImageExtension(response.headers?.['content-type'] || '', url);

        // FIX: guard against sanitizeFileName returning an empty string
        const cleanName = sanitizeFileName(fileName);
        if (!cleanName) {
            console.error(`RSS: sanitizeFileName returned empty string for "${fileName}"`);
            return url;
        }

        const cleanFolderPath = folderPath.replace(/\/+$/, '');
        const prefix = cleanFolderPath ? `${cleanFolderPath}/` : '';
        const imagePath = `${prefix}${cleanName}.${extension}`;

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
    // FIX: normalise "jpeg" → "jpg" to be consistent with the content-type branch above
    return match?.[1]?.toLowerCase().replace('jpeg', 'jpg') ?? 'png';
}
