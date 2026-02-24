import { App, Vault, requestUrl } from 'obsidian';
import { sanitizeFileName } from './feedProcessor';

// ─── Folder helper (inline, no external dependency) ──────────────────────────

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

// Reads Obsidian's native attachment folder settings and resolves the target path
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

// ─── Extract image URL from feed item ────────────────────────────────────────

// Extracts the best image URL from a raw feed item, with OG/Twitter fallback
export async function extractImageUrl(item: any, itemUrl: string): Promise<string> {
    let url = '';

    // 1. YouTube specific: media:group thumbnail
    const mediaGroup = item?.['media:group'];
    if (mediaGroup) {
        const thumbnail = mediaGroup?.['media:thumbnail'];
        const thumbObj = Array.isArray(thumbnail) ? thumbnail[0] : thumbnail;
        if (thumbObj?.$?.url) url = String(thumbObj.$.url);
    }

    // 2. Standard media tags (media:content, enclosure)
    if (!url) {
        const media = item?.['media:content'] ?? item?.['media:thumbnail'] ?? item?.enclosure;
        if (media) {
            const mediaObj = Array.isArray(media) ? media[0] : media;
            url = String(mediaObj?.$?.url ?? (typeof mediaObj === 'string' ? mediaObj : '') ?? '');
        }
    }

    // 3. Search inside HTML content
    if (!url) {
        const content = item?.['content:encoded'] ?? item?.description ?? item?.content ?? '';
        const contentStr = typeof content === 'string' ? content : '';
        const match = /<img[^>]+(?:src|data-src|original-src)=["']([^"']+)["']/i.exec(contentStr);
        if (match?.[1]) url = String(match[1]);
    }

    // 4. Fallback: OpenGraph / Twitter meta tags from original page
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

    // 5. Cleanup and path resolution
    if (url) {
        url = url.replace(/&amp;/g, '&').replace(/&#038;/g, '&').trim();
        if (url.startsWith('//')) {
            url = 'https:' + url;
        } else if (!url.startsWith('http') && itemUrl) {
            try { url = new URL(url, itemUrl).href; } catch { /* Ignore */ }
        }
    }

    return url;
}

// ─── Download image to vault ──────────────────────────────────────────────────

// Downloads an image and saves it to the vault
// Returns the wikilink format: [[path/to/image.png]]
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

    const match = url.match(/\.(jpg|jpeg|png|webp|gif|svg)($|\?)/i);
    return match?.[1]?.toLowerCase() ?? 'png';
}