import { App, Vault, TFile, normalizePath } from 'obsidian';
import { FeedItem, FeedConfig, PluginSettings } from '../main';
import { sanitizeFileName } from './feedProcessor';
import { downloadImageLocally, resolveObsidianAttachmentPath } from './imageHandler';
import { buildMarkAsReadLink } from './feedMarkAsRead';
import { loadFeedDatabase, saveFeedDatabase, registerSaved, registerDeleted, isKnown, getStatus, FeedDatabase } from './feedDatabase';

// ─── Date helpers ─────────────────────────────────────────────────────────────

function toLocalISOString(date: Date): string {
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().split('.')[0] ?? '';
}

// ─── Shorts detection & tag injection ────────────────────────────────────────

function isYoutubeShort(link: string): boolean {
    return /youtube\.com\/shorts\//i.test(link ?? '');
}

function injectShortsTag(frontmatter: string): string {
    const inlineMatch = frontmatter.match(/^(tags\s*:\s*\[)([^\]]*?)(\])/m);
    if (inlineMatch) {
        const existing = inlineMatch[2]?.trim() ?? '';
        const newTags  = existing ? `${existing}, shorts` : 'shorts';
        return frontmatter.replace(inlineMatch[0], `${inlineMatch[1]}${newTags}${inlineMatch[3]}`);
    }

    const blockMatch = frontmatter.match(/^(tags\s*:[ \t]*\n(?:[ \t]+-[ \t]+\S.*\n?)*)/m);
    if (blockMatch) {
        return frontmatter.replace(blockMatch[0], `${blockMatch[0]}  - shorts\n`);
    }

    const singleMatch = frontmatter.match(/^(tags\s*:\s*)(\S+.*)$/m);
    if (singleMatch) {
        return frontmatter.replace(
            singleMatch[0],
            `tags:\n  - ${(singleMatch[2] ?? '').trim()}\n  - shorts`
        );
    }

    return `${frontmatter.trimEnd()}\ntags:\n  - shorts`;
}

// ─── Live stream detection & tag injection ────────────────────────────────────

function isLiveStream(title: string, keywords: string): boolean {
    if (!title || !keywords) return false;
    const lowerTitle  = title.toLowerCase();
    const keywordList = keywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
    return keywordList.some(k => lowerTitle.includes(k));
}

function injectLiveTag(frontmatter: string): string {
    const inlineMatch = frontmatter.match(/^(tags\s*:\s*\[)([^\]]*?)(\])/m);
    if (inlineMatch) {
        const existing = inlineMatch[2]?.trim() ?? '';
        const newTags  = existing ? `${existing}, live` : 'live';
        return frontmatter.replace(inlineMatch[0], `${inlineMatch[1]}${newTags}${inlineMatch[3]}`);
    }

    const blockMatch = frontmatter.match(/^(tags\s*:[ \t]*\n(?:[ \t]+-[ \t]+\S.*\n?)*)/m);
    if (blockMatch) {
        return frontmatter.replace(blockMatch[0], `${blockMatch[0]}  - live\n`);
    }

    const singleMatch = frontmatter.match(/^(tags\s*:\s*)(\S+.*)$/m);
    if (singleMatch) {
        return frontmatter.replace(
            singleMatch[0],
            `tags:\n  - ${(singleMatch[2] ?? '').trim()}\n  - live`
        );
    }

    return `${frontmatter.trimEnd()}\ntags:\n  - live`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function saveFeedItem(
    vault:      Vault,
    app:        App,
    item:       FeedItem,
    folderPath: string,
    settings:   PluginSettings,
    feed:       FeedConfig,
    db?:        FeedDatabase
): Promise<boolean> {
    const feedName = feed.name || '';

    const fileNameTemplate = feed.titleTemplate || settings.fileNameTemplate || '{{title}}';
    const rawFileName      = applyTemplate(fileNameTemplate, item, true, false, feedName);
    const fileName         = sanitizeFileName(rawFileName) + '.md';

    const fullFolderPath = normalizePath(folderPath);
    const filePath       = normalizePath(`${fullFolderPath}/${fileName}`);

    await ensureFolder(vault, fullFolderPath);

    const ownDb    = !db;
    db             = db ?? await loadFeedDatabase(app);
    const itemLink = item.link || fileName;

    // ── Resolve skip_shorts setting ───────────────────────────────────────────
    const skipShortsEnabled =
        feed.skipShorts === true  ? true  :
        feed.skipShorts === false ? false :
        (settings.skipShortsGlobal ?? false);

    // ── Check db — source of truth ────────────────────────────────────────────
    if (isKnown(db, itemLink)) {
        const status = getStatus(db, itemLink);
        if (status === 'deleted_skip_shorts' && !skipShortsEnabled) {
            // User disabled skip_shorts — remove entry and allow re-import
            delete db[itemLink];
            if (ownDb) await saveFeedDatabase(app, db);
        } else if (status === 'deleted_manual') {
            // User manually deleted — always allow re-import, remove entry
            delete db[itemLink];
            if (ownDb) await saveFeedDatabase(app, db);
        } else if (status === 'saved') {
            // File may have been deleted outside the plugin (via OS or Obsidian UI).
            // If the file no longer exists on disk, clear the db entry and re-import.
            if (!(await vault.adapter.exists(filePath))) {
                delete db[itemLink];
                if (ownDb) await saveFeedDatabase(app, db);
            } else {
                return false;
            }
        } else {
            return false;
        }
    }

    // ── Pre-save date filter ──────────────────────────────────────────────────
    const cleanupValue     = feed.autoCleanupValue ?? settings.autoCleanupValue;
    const cleanupUnit      = feed.autoCleanupUnit  ?? settings.autoCleanupUnit;
    const feedDateField    = feed.autoCleanupDateField;
    const cleanupDateField = (!feedDateField || feedDateField === 'global')
        ? settings.autoCleanupDateField
        : feedDateField;

    if (cleanupValue > 0 && !settings.autoCleanupCheckProperty && item.pubDate) {
        if (cleanupDateField === 'datepub') {
            try {
                const pubTime = Date.parse(item.pubDate);
                const cutoff  = Date.now() - toMilliseconds(cleanupValue, cleanupUnit);
                if (!isNaN(pubTime) && pubTime < cutoff) {
                    registerDeleted(db, itemLink, item.pubDate, 'deleted_pre_filter');
                    if (ownDb) await saveFeedDatabase(app, db);
                    return false;
                }
            } catch { /* ignore */ }
        }
    }

    // ── Skip YouTube Shorts ───────────────────────────────────────────────────
    if (skipShortsEnabled && isYoutubeShort(item.link ?? '')) {
        registerDeleted(db, itemLink, item.pubDate, 'deleted_skip_shorts');
        if (ownDb) await saveFeedDatabase(app, db);
        return false;
    }

    // ── Skip live streams ─────────────────────────────────────────────────────
    const skipLiveEnabled = feed.tagLive === true ? false : (settings.tagLiveGlobal ?? false);
    if (skipLiveEnabled && isLiveStream(item.title ?? '', settings.tagLiveKeywords ?? '')) {
        registerDeleted(db, itemLink, item.pubDate, 'deleted_skip_live');
        if (ownDb) await saveFeedDatabase(app, db);
        return false;
    }

    // ── Filesystem fallback — handles DB being empty on first run ─────────────
    if (await vault.adapter.exists(filePath)) {
        registerSaved(db, itemLink, item.pubDate);
        if (ownDb) await saveFeedDatabase(app, db);
        return false;
    }

    if (settings.downloadImages && item.imageUrl) {
        const imageFolder = resolveImageFolder(app, settings, fullFolderPath);
        await ensureFolder(vault, imageFolder);
        const localImagePath = await downloadImageLocally(
            vault, item.imageUrl, imageFolder,
            sanitizeFileName(item.title || 'image')
        );
        item = { ...item, imageUrl: localImagePath };
    }

    // Download images embedded in the content body (e.g. from Defuddle markdown)
    if (settings.downloadImages && item.content) {
        const imageFolder = resolveImageFolder(app, settings, fullFolderPath);
        await ensureFolder(vault, imageFolder);
        item = { ...item, content: await downloadContentImages(vault, item.content, imageFolder) };
    }

    // ── Tag injections ────────────────────────────────────────────────────────
    const tagShortsEnabled   = feed.tagShorts === true ? true : feed.tagShorts === false ? false : (settings.tagShortsGlobal ?? false);
    const shouldInjectShorts = tagShortsEnabled && isYoutubeShort(item.link ?? '');
    const tagLiveEnabled     = settings.tagLiveGlobal ?? false;
    const shouldInjectLive   = tagLiveEnabled && isLiveStream(item.title ?? '', settings.tagLiveKeywords ?? '');

    // ── Build frontmatter ─────────────────────────────────────────────────────
    const frontmatterTemplate  = feed.frontmatterTemplate || settings.frontmatterTemplate;
    let   processedFrontmatter = applyTemplate(frontmatterTemplate, item, false, true, feedName);

    if (shouldInjectShorts) processedFrontmatter = injectShortsTag(processedFrontmatter);
    if (shouldInjectLive)   processedFrontmatter = injectLiveTag(processedFrontmatter);

    if (feed.extraFrontmatterRaw?.trim()) {
        processedFrontmatter = `${processedFrontmatter.trimEnd()}\n${feed.extraFrontmatterRaw.trim()}`;
    }

    const contentTemplate = feed.contentTemplate || settings.template;
    const processedBody   = applyTemplate(contentTemplate, item, false, false, feedName);

    // ── Mark as Read frontmatter property ───────────────────────────────────
    // Injects the obsidian:// link into the frontmatter as a quoted string.
    // If the property already exists (e.g. as a checkbox), its value is replaced
    // so the link renders correctly. If absent, a new line is appended.
    // The value is YAML-quoted to handle parentheses and special characters.
    const markAsReadLink = buildMarkAsReadLink(filePath, settings);
    if (markAsReadLink) {
        const propertyName  = settings.markAsReadLinkProperty?.trim() || 'Mark as Read';
        const yamlLine      = `${propertyName}: "${markAsReadLink.replace(/"/g, '\\"')}"`;
        const propertyRegex = new RegExp(`^${propertyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:.*$`, 'mi');
        if (propertyRegex.test(processedFrontmatter)) {
            processedFrontmatter = processedFrontmatter.replace(propertyRegex, yamlLine);
        } else {
            processedFrontmatter = `${processedFrontmatter.trimEnd()}\n${yamlLine}`;
        }
    }

    const finalContent = `---\n${processedFrontmatter}\n---\n\n${processedBody}`;
    await vault.create(filePath, finalContent);

    registerSaved(db, itemLink, item.pubDate);
    if (ownDb) await saveFeedDatabase(app, db);

    return true;
}

// ─── Image folder resolution ──────────────────────────────────────────────────

function resolveImageFolder(app: App, settings: PluginSettings, feedFolderPath: string): string {
    const baseRSSFolder = settings.folderPath || 'RSS';
    switch (settings.imageLocation) {
        case 'obsidian':
            return resolveObsidianAttachmentPath(app, feedFolderPath) || feedFolderPath;
        case 'vault':
            return '';
        case 'current':
            return feedFolderPath;
        case 'subfolder':
            const subName = settings.imagesFolder || 'attachments';
            if (settings.useFeedFolder) return normalizePath(`${feedFolderPath}/${subName}`);
            return normalizePath(`${baseRSSFolder}/${subName}`);
        case 'specified':
            return normalizePath(settings.imagesFolder || 'attachments');
        default:
            return feedFolderPath;
    }
}

// ─── Read date from frontmatter ───────────────────────────────────────────────

async function readPubDateFromFrontmatter(app: App, vault: Vault, file: TFile): Promise<number | null> {
    const pubDateKeys = ['upload date', 'date published', 'datepub'];

    const fm = app.metadataCache.getFileCache(file)?.frontmatter;
    if (fm) {
        const key = Object.keys(fm).find(k => pubDateKeys.includes(k.toLowerCase()));
        if (key && fm[key]) {
            const parsed = Date.parse(String(fm[key]));
            if (!isNaN(parsed)) return parsed;
        }
    }

    try {
        const content = await vault.cachedRead(file);
        const match   = content.match(/^---\n([\s\S]*?)\n---/);
        if (!match) return null;
        for (const line of (match[1] ?? '').split('\n')) {
            const ci = line.indexOf(':');
            if (ci === -1) continue;
            const key = line.slice(0, ci).trim().toLowerCase();
            if (pubDateKeys.includes(key)) {
                const val    = line.slice(ci + 1).trim().replace(/^["']|["']$/g, '');
                const parsed = Date.parse(val);
                if (!isNaN(parsed)) return parsed;
            }
        }
    } catch { /* ignore */ }
    return null;
}

// ─── Protected property check ─────────────────────────────────────────────────

async function isFileProtected(vault: Vault, file: TFile, propertyName: string): Promise<boolean> {
    try {
        const content          = await vault.cachedRead(file);
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (!frontmatterMatch) return true;

        const frontmatter = frontmatterMatch[1] ?? '';
        const lines       = frontmatter.split('\n');

        for (const line of lines) {
            const colonIndex = line.indexOf(':');
            if (colonIndex === -1) continue;
            const key   = line.slice(0, colonIndex).trim();
            const value = line.slice(colonIndex + 1).trim().toLowerCase();
            if (key.toLowerCase() === propertyName.toLowerCase()) {
                return value !== 'true';
            }
        }

        return true;
    } catch {
        return true;
    }
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

// Returns the number of files deleted.
export async function cleanupOldFiles(
    vault:      Vault,
    app:        App,
    folderPath: string,
    value:      number,
    unit:       'minutes' | 'hours' | 'days' | 'months',
    dateField:  'datepub' | 'datesaved' = 'datesaved',
    settings?:  PluginSettings,
    db?:        FeedDatabase
): Promise<number> {
    const cutoff           = Date.now() - toMilliseconds(value, unit);
    const normalizedFolder = normalizePath(folderPath);
    const folder           = vault.getAbstractFileByPath(normalizedFolder);

    if (!folder) return 0;

    const usePropertyCheck = settings?.autoCleanupCheckProperty ?? false;
    const propertyName     = settings?.autoCleanupCheckPropertyName?.trim()
                          || settings?.markAsReadCheckboxProperty?.trim()
                          || 'Checkbox';

    const ownDb   = !db;
    db            = db ?? await loadFeedDatabase(app);
    let dbChanged = false;
    let deletedCount = 0;

    const files = vault.getFiles().filter(f =>
        f.path.startsWith(normalizedFolder + '/') &&
        !f.path.endsWith('.feed-db.json')
    );

    for (const file of files) {
        let fileTime: number;
        if (dateField === 'datepub') {
            const pubDate = await readPubDateFromFrontmatter(app, vault, file);
            fileTime = pubDate ?? file.stat.ctime;
        } else {
            fileTime = file.stat.ctime;
        }

        if (fileTime >= cutoff) continue;

        if (usePropertyCheck) {
            const protected_ = await isFileProtected(vault, file, propertyName);
            if (protected_) continue;
        }

        // Case-insensitive link lookup
        let itemLink: string | null = null;
        const fm = app.metadataCache.getFileCache(file)?.frontmatter;
        if (fm) {
            const key = Object.keys(fm).find(k => k.toLowerCase() === 'link');
            if (key && fm[key]) itemLink = String(fm[key]).trim();
        }
        if (!itemLink) {
            try {
                const content          = await vault.cachedRead(file);
                const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
                if (frontmatterMatch) {
                    for (const line of (frontmatterMatch[1] ?? '').split('\n')) {
                        const ci = line.indexOf(':');
                        if (ci === -1) continue;
                        if (line.slice(0, ci).trim().toLowerCase() === 'link') {
                            itemLink = line.slice(ci + 1).trim().replace(/^["']|["']$/g, '') || null;
                            break;
                        }
                    }
                }
            } catch { /* ignore */ }
        }

        try {
            await vault.delete(file);
            deletedCount++;

            const dbKey = itemLink ?? file.name;
            db[dbKey] = { link: dbKey, pubDate: '', status: 'deleted_cleanup' }; // force-overwrite saved status
            dbChanged = true;
        } catch (e) {
            console.error(`RSS Cleanup: failed to delete ${file.path}`, e);
        }
    }

    if (dbChanged && ownDb) {
        await saveFeedDatabase(app, db);
    }

    return deletedCount;
}

// ─── Content image downloader ────────────────────────────────────────────────

/**
 * Finds all external image URLs in a markdown string (![alt](url) syntax),
 * downloads each one locally, and replaces the original URL with the local path.
 * Skips data URIs and already-local Obsidian links ([[...]]).
 */
async function downloadContentImages(
    vault:       Vault,
    content:     string,
    imageFolder: string
): Promise<string> {
    // Match ![alt](url) — capture index so we can replace without regex state issues
    const IMAGE_MD = /!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g;
    const matches  = [...content.matchAll(IMAGE_MD)];
    if (matches.length === 0) return content;

    let result = content;

    for (const match of matches) {
        const [full, alt, url] = match;
        if (!url) continue;

        try {
            // Use a hash of the URL as a stable filename to avoid duplicates
            const hash     = url.split('').reduce((a, c) => (Math.imul(31, a) + c.charCodeAt(0)) | 0, 0);
            const fileName = sanitizeFileName(`img-${Math.abs(hash)}`);
            const localPath = await downloadImageLocally(vault, url, imageFolder, fileName);

            // downloadImageLocally returns the original URL on failure — skip replacement
            if (localPath !== url) {
                const localMd = localPath.startsWith('[[')
                    ? `!${localPath}`
                    : `![${alt}](${localPath})`;
                result = result.replace(full, localMd);
            }
        } catch { /* keep original URL on any error */ }
    }

    return result;
}

// ─── Template Engine ──────────────────────────────────────────────────────────

function prepareTemplate(template: string, item: FeedItem): string {
    if (!item.imageUrl) return template.replace(/^.*{{image}}.*\n?/gm, '');
    return template;
}

function formatImageForFrontmatter(imageUrl: string): string {
    if (!imageUrl) return '';
    if (imageUrl.startsWith('[[')) return `"${imageUrl}"`;
    return imageUrl;
}

function formatImageForContent(imageUrl: string): string {
    if (!imageUrl) return '';
    if (imageUrl.startsWith('[[')) return `!${imageUrl}`;
    return `![](${imageUrl})`;
}

function escapeYamlValue(value: any): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'boolean' || typeof value === 'number') return String(value);
    return String(value).replace(/"/g, '\\"');
}

const KNOWN_PLACEHOLDERS = new Set([
    'title', 'link', 'snippet', 'image', 'datepub', 'datesaved',
    'content', 'feedname', 'tags', 'author',
]);

export function applyTemplate(
    template:   string | undefined,
    item:       FeedItem,
    isFileName: boolean = false,
    isYaml:     boolean = false,
    feedName:   string  = ''
): string {
    if (!template) return '';

    let result = prepareTemplate(template, item);

    const dateSaved = toLocalISOString(new Date());
    let datePub = '';
    try {
        if (item.pubDate) {
            const d = new Date(item.pubDate);
            if (!isNaN(d.getTime())) {
                datePub = toLocalISOString(d);
            } else {
                datePub = String(item.pubDate);
            }
        }
    } catch {
        datePub = String(item.pubDate ?? '');
    }

    const tags = Array.isArray(item.categories)
        ? item.categories.map(c => `#${String(c ?? '').replace(/\s+/g, '-')}`).join(' ')
        : '';

    const imageValue = isFileName
        ? String(item.imageUrl ?? '')
        : isYaml
            ? formatImageForFrontmatter(String(item.imageUrl ?? ''))
            : formatImageForContent(String(item.imageUrl ?? ''));

    const sanitize = (val: any): string => {
        if (val === null || val === undefined) return '';
        if (!isYaml) {
            if (typeof val === 'boolean') return val ? 'true' : 'false';
            if (typeof val === 'number') return String(val);
            return String(val);
        }
        return escapeYamlValue(val);
    };

    const renderContent = (): string => {
        const value = item.content;
        if (value === null || value === undefined) return '';
        if (typeof value === 'boolean') return value ? 'true' : 'false';
        if (typeof value === 'number') return String(value);
        return isYaml ? escapeYamlValue(value) : String(value);
    };

    // Author
    const authorValue = item.author ?? '';
    if (isYaml) {
        result = result.replace(/"{{author}}"/g,          `"${escapeYamlValue(authorValue)}"`);
        result = result.replace(/"\[\[{{author}}\]\]"/g,  `"[[${escapeYamlValue(authorValue)}]]"`);
        result = result.replace(/\[\[{{author}}\]\]/g,    `"[[${escapeYamlValue(authorValue)}]]"`);
        result = result.replace(/{{author}}/g,            `"${escapeYamlValue(authorValue)}"`);
    } else {
        result = result
            .replace(/"{{author}}"/g,       authorValue)
            .replace(/\[\[{{author}}\]\]/g, `[[${authorValue}]]`)
            .replace(/{{author}}/g,          authorValue);
    }

    // Feed name
    if (isYaml) {
        result = result.replace(/"{{feedname}}"/gi,         `"${escapeYamlValue(feedName)}"`);
        result = result.replace(/"\[\[{{feedname}}\]\]"/gi, `"[[${escapeYamlValue(feedName)}]]"`);
        result = result.replace(/\[\[{{feedname}}\]\]/gi,   `"[[${escapeYamlValue(feedName)}]]"`);
        result = result.replace(/{{feedname}}/gi,           `"${escapeYamlValue(feedName)}"`);
    } else {
        result = result
            .replace(/"{{feedname}}"/gi,       feedName)
            .replace(/\[\[{{feedname}}\]\]/gi, `[[${feedName}]]`)
            .replace(/{{feedname}}/gi,          feedName);
    }

    const titleValue = item.title ?? 'Untitled';
    result = result
        .replace(/{{title}}/g,      isYaml ? `"${escapeYamlValue(titleValue)}"` : sanitize(titleValue))
        .replace(/{{link}}/g,       isYaml ? `"${escapeYamlValue(item.link ?? '')}"` : String(item.link ?? ''))
        .replace(/{{snippet}}/g,    isYaml ? `"${escapeYamlValue(item.descriptionShort ?? item.description ?? '')}"` : String(item.descriptionShort ?? item.description ?? ''))
        .replace(/{{image}}/g,      imageValue)
        .replace(/{{datepub}}/g,    datePub)
        .replace(/{{datesaved}}/g,  dateSaved)
        .replace(/{{content}}/g,    renderContent())
        .replace(/{{#tags}}/g,      tags);

    result = result.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
        if (KNOWN_PLACEHOLDERS.has(key.toLowerCase())) return '';
        const value = (item as any)[key];
        if (value === null || value === undefined) return '';
        if (typeof value === 'boolean') return value ? 'true' : 'false';
        if (typeof value === 'number') return String(value);
        if (Array.isArray(value)) return value.map(x => escapeYamlValue(x)).join(', ');
        return isYaml ? escapeYamlValue(value) : String(value);
    });

    return result;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function toMilliseconds(value: number, unit: 'minutes' | 'hours' | 'days' | 'months'): number {
    const minute = 60 * 1000;
    const hour   = minute * 60;
    const day    = hour * 24;
    switch (unit) {
        case 'minutes': return value * minute;
        case 'hours':   return value * hour;
        case 'days':    return value * day;
        case 'months':  return value * day * 30;
    }
}