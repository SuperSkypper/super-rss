import { App, Vault, TFile, normalizePath } from 'obsidian';
import { FeedItem, FeedConfig, PluginSettings } from '../main';
import { sanitizeFileName } from './feedProcessor';
import { downloadImageLocally, resolveObsidianAttachmentPath } from './imageHandler';

// ─── Feed DB ──────────────────────────────────────────────────────────────────

interface FeedDbEntry {
    savedAt: number;
    deletedAt?: number;
    deleted: boolean;
}

interface FeedDb {
    [link: string]: FeedDbEntry;
}

const DB_FILE_NAME = '.feed-db.json';
const DB_TTL_MS    = 90 * 24 * 60 * 60 * 1000; // 90 days

async function loadFeedDb(vault: Vault, folderPath: string): Promise<FeedDb> {
    const dbPath = normalizePath(`${folderPath}/${DB_FILE_NAME}`);
    try {
        if (await vault.adapter.exists(dbPath)) {
            const raw = await vault.adapter.read(dbPath);
            return JSON.parse(raw) as FeedDb;
        }
    } catch {
        // Corrupted db — start fresh
    }
    return {};
}

async function saveFeedDb(vault: Vault, folderPath: string, db: FeedDb): Promise<void> {
    const dbPath = normalizePath(`${folderPath}/${DB_FILE_NAME}`);

    const now = Date.now();
    for (const link of Object.keys(db)) {
        const entry = db[link];
        if (entry && entry.deleted && entry.deletedAt && (now - entry.deletedAt > DB_TTL_MS)) {
            delete db[link];
        }
    }

    try {
        const content = JSON.stringify(db, null, 2);
        if (await vault.adapter.exists(dbPath)) {
            await vault.adapter.write(dbPath, content);
        } else {
            await vault.create(dbPath, content);
        }
    } catch (e) {
        console.error('RSS DB: failed to save db', e);
    }
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

// Formats a Date object to local time ISO string (without timezone suffix)
// Works on all platforms: Windows, Android, iOS
function toLocalISOString(date: Date): string {
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().split('.')[0] ?? '';
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function saveFeedItem(
    vault: Vault,
    app: App,
    item: FeedItem,
    folderPath: string,
    settings: PluginSettings,
    feed: FeedConfig
): Promise<boolean> {
    const feedName = feed.name || '';

    const fileNameTemplate = feed.titleTemplate || settings.fileNameTemplate || '{{title}}';
    const rawFileName      = applyTemplate(fileNameTemplate, item, true, false, feedName);
    const fileName         = sanitizeFileName(rawFileName) + '.md';

    const fullFolderPath = normalizePath(folderPath);
    const filePath       = normalizePath(`${fullFolderPath}/${fileName}`);

    await ensureFolder(vault, fullFolderPath);

    // Check db first — skip if already deleted
    const db       = await loadFeedDb(vault, fullFolderPath);
    const itemLink = item.link || item.title || fileName;

    const existingEntry = db[itemLink];
    if (existingEntry?.deleted) return false;

    // Pre-save date filter — when auto-delete is on WITHOUT check property,
    // skip saving articles that are already older than the threshold.
    // When check property IS enabled, save normally so the user can mark articles.
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
                    // Register in db as deleted so it won't be retried on next update
                    db[itemLink] = { savedAt: 0, deleted: true, deletedAt: Date.now() };
                    await saveFeedDb(vault, fullFolderPath, db);
                    return false;
                }
            } catch { /* ignore */ }
        }
    }

    // Skip if file already exists
    if (await vault.adapter.exists(filePath)) return false;

    if (settings.downloadImages && item.imageUrl) {
        const imageFolder = resolveImageFolder(app, settings, fullFolderPath);
        await ensureFolder(vault, imageFolder);
        const localImagePath = await downloadImageLocally(
            vault, item.imageUrl, imageFolder,
            sanitizeFileName(item.title || 'image')
        );
        item = { ...item, imageUrl: localImagePath };
    }

    const frontmatterTemplate  = feed.frontmatterTemplate || settings.frontmatterTemplate;
    const processedFrontmatter = applyTemplate(frontmatterTemplate, item, false, true, feedName);

    const contentTemplate = feed.contentTemplate || settings.template;
    const processedBody   = applyTemplate(contentTemplate, item, false, false, feedName);

    const finalContent = `---\n${processedFrontmatter}\n---\n\n${processedBody}`;
    await vault.create(filePath, finalContent);

    // Register in db
    db[itemLink] = { savedAt: Date.now(), deleted: false };
    await saveFeedDb(vault, fullFolderPath, db);

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

async function readPubDateFromFrontmatter(vault: Vault, file: TFile): Promise<number | null> {
    try {
        const content = await vault.cachedRead(file);
        const match   = content.match(/^---\n([\s\S]*?)\n---/);
        if (!match) return null;

        const lines       = (match[1] ?? '').split('\n');
        const pubDateKeys = ['upload date', 'date published', 'datepub'];

        for (const line of lines) {
            const ci = line.indexOf(':');
            if (ci === -1) continue;
            const key = line.slice(0, ci).trim().toLowerCase();
            if (pubDateKeys.includes(key)) {
                const val    = line.slice(ci + 1).trim();
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
                // true  → marked as read → can delete (not protected)
                // false → not read       → protected
                return value !== 'true';
            }
        }

        return true;
    } catch {
        return true;
    }
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

export async function cleanupOldFiles(
    vault: Vault,
    folderPath: string,
    value: number,
    unit: 'minutes' | 'hours' | 'days' | 'months',
    dateField: 'datepub' | 'datesaved' = 'datesaved',
    settings?: PluginSettings
): Promise<void> {
    const cutoff           = Date.now() - toMilliseconds(value, unit);
    const normalizedFolder = normalizePath(folderPath);
    const folder           = vault.getAbstractFileByPath(normalizedFolder);

    if (!folder) return;

    const usePropertyCheck = settings?.autoCleanupCheckProperty ?? false;
    const propertyName     = settings?.autoCleanupCheckPropertyName?.trim() || 'Mark as Read';

    const db = await loadFeedDb(vault, normalizedFolder);
    let dbChanged = false;

    const files = vault.getFiles().filter(f =>
        f.path.startsWith(normalizedFolder + '/') &&
        !f.path.endsWith(DB_FILE_NAME)
    );

    for (const file of files) {
        let fileTime: number;
        if (dateField === 'datepub') {
            const pubDate = await readPubDateFromFrontmatter(vault, file);
            fileTime = pubDate ?? file.stat.ctime;
        } else {
            fileTime = file.stat.mtime;
        }

        if (fileTime >= cutoff) continue;

        if (usePropertyCheck) {
            const protected_ = await isFileProtected(vault, file, propertyName);
            if (protected_) continue;
        }

        // Read link from frontmatter to update db
        let itemLink: string | null = null;
        try {
            const content          = await vault.cachedRead(file);
            const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
            if (frontmatterMatch) {
                const lines = (frontmatterMatch[1] ?? '').split('\n');
                for (const line of lines) {
                    const colonIndex = line.indexOf(':');
                    if (colonIndex === -1) continue;
                    const key   = line.slice(0, colonIndex).trim().toLowerCase();
                    const value = line.slice(colonIndex + 1).trim();
                    if (key === 'link') { itemLink = value; break; }
                }
            }
        } catch { /* ignore */ }

        try {
            await vault.delete(file);

            if (itemLink && db[itemLink] !== undefined) {
                const existing = db[itemLink];
                if (existing) {
                    existing.deleted   = true;
                    existing.deletedAt = Date.now();
                }
                dbChanged = true;
            } else if (itemLink) {
                db[itemLink] = { savedAt: 0, deleted: true, deletedAt: Date.now() };
                dbChanged = true;
            }
        } catch (e) {
            console.error(`RSS Cleanup: failed to delete ${file.path}`, e);
        }
    }

    if (dbChanged) {
        await saveFeedDb(vault, normalizedFolder, db);
    }
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
    template: string | undefined,
    item: FeedItem,
    isFileName: boolean = false,
    isYaml: boolean = false,
    feedName: string = ''
): string {
    if (!template) return '';

    let result = prepareTemplate(template, item);

    // Use local time for both datesaved and datepub
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