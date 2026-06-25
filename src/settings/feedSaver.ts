import { App, MetadataCache, Vault, normalizePath } from 'obsidian';
import { FeedItem, FeedConfig, FrontmatterPropertyTemplate, PluginSettings } from '../main';
import { sanitizeFileName } from './feedProcessor';
import { downloadImageLocally, resolveObsidianAttachmentPath } from './imageHandler';
import { injectDuplicateTag } from './feedDuplicate';
import { loadAutoDatabase, loadUserDatabase, saveAutoDatabase, saveUserDatabase, registerAuto, isKnown, getStatus, AutoDatabase, UserDatabase } from './feedDatabase';
export { cleanupOldFiles, deleteOrphanedDbArticles } from './feedDelete';

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
    db?:        AutoDatabase,
    userDb?:    UserDatabase
): Promise<boolean> {
    // Capture the save timestamp once here so every applyTemplate call in this
    // invocation uses exactly the same value — regardless of how long image
    // downloads or other async work takes between calls.
    const dateSaved = toLocalISOString(new Date());

    const feedName = feed.name || '';

    const fileNameTemplate = feed.titleTemplate || settings.fileNameTemplate || '{{title}}';
    const rawFileName      = applyTemplate(fileNameTemplate, item, true, false, feedName, dateSaved);
    const fileName         = sanitizeFileName(rawFileName) + '.md';

    const fullFolderPath = normalizePath(folderPath);
    const filePath       = normalizePath(`${fullFolderPath}/${fileName}`);

    await ensureFolder(vault, fullFolderPath);

    const ownDb    = !db;
    db             = db ?? await loadAutoDatabase(app);

    // Build a combined view (auto + user) for read-only blocking checks.
    // Writes always go to the auto DB — the user DB is written via registerManualRead.
    // When db was passed in by updateFeed it only contains auto entries, so we
    // merge in the user DB here to ensure manually deleted articles are also blocked.
    const ownUserDb = !userDb;
    userDb          = userDb ?? await loadUserDatabase(app);
    const combined  = { ...userDb, ...db };

    // Link is the canonical identifier — if absent, the item cannot be tracked reliably.
    if (!item.link) return false;
    const itemLink = item.link;

    // ── Resolve skip_shorts setting ───────────────────────────────────────────
    const skipShortsEnabled =
        feed.skipShorts === true  ? true  :
        feed.skipShorts === false ? false :
        (settings.skipShortsGlobal ?? false);

    // ── DB filter — blocks items that were auto-deleted by the plugin ───────────
    // The DB is a blacklist of links that should never be re-imported.
    // 'saved' no longer exists as a status — the vault is the source of truth
    // for whether an item was already saved. If the file exists, block; if not, save.
    let markedAsDuplicate = false;

    // Use combined DB (auto + user) for all blocking checks so that manually
    // deleted articles are also prevented from being re-imported.
    if (isKnown(combined, itemLink)) {
        const status = getStatus(combined, itemLink);

        if (status === 'skip_shorts' && !skipShortsEnabled) {
            // User disabled skip_shorts — remove from blacklist and allow re-import
            delete db[itemLink];
            if (ownDb) await saveAutoDatabase(app, db);
        } else {
            // All other statuses (old_article, skip_live, skip_shorts, mark_as_read)
            // are permanent blocks — do not re-import.
            return false;
        }
    }

    // ── Vault dedup — block if the file already exists ────────────────────────
    // The DB has no 'saved' entries anymore; the vault file is the source of truth.
    // If pubDate changed, the publisher updated the article — re-import as duplicate.
    if (await vault.adapter.exists(filePath)) {
        const storedPubDate = combined[itemLink]?.pubDate ?? '';
        if (storedPubDate && item.pubDate && storedPubDate !== item.pubDate) {
            markedAsDuplicate = true;
        } else {
            return false;
        }
    }

    // ── Skip YouTube Shorts ───────────────────────────────────────────────────
    if (skipShortsEnabled && isYoutubeShort(item.link ?? '')) {
        registerAuto(db, itemLink, item.pubDate, 'skip_shorts', item.title ?? '');
        if (ownDb) await saveAutoDatabase(app, db);
        return false;
    }

    // ── Skip live streams ─────────────────────────────────────────────────────
    // skipLiveGlobal is a separate concern from tagLiveGlobal:
    //   - tagLiveGlobal  → inject the #live tag (does NOT skip the article)
    //   - deleteLives    → per-feed flag; live articles are deleted after saving
    // There is no global "skip live" setting, so we only skip here when the
    // per-feed deleteLives flag is explicitly set AND the item looks like a live.
    const skipLiveEnabled = feed.deleteLives === true;
    if (skipLiveEnabled && isLiveStream(item.title ?? '', settings.tagLiveKeywords ?? '')) {
        registerAuto(db, itemLink, item.pubDate, 'skip_live', item.title ?? '');
        if (ownDb) await saveAutoDatabase(app, db);
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
    let processedFrontmatter = '';
    if (feed.frontmatterTemplate) {
        processedFrontmatter = applyTemplate(feed.frontmatterTemplate, item, false, true, feedName, dateSaved);
    } else if (settings.frontmatterMode !== 'source' && settings.frontmatterProperties?.length) {
        processedFrontmatter = renderFrontmatterProperties(app, settings.frontmatterProperties, item, feedName, dateSaved);
    } else {
        processedFrontmatter = applyTemplate(settings.frontmatterTemplate, item, false, true, feedName, dateSaved);
    }

    if (shouldInjectShorts)  processedFrontmatter = injectShortsTag(processedFrontmatter);
    if (shouldInjectLive)    processedFrontmatter = injectLiveTag(processedFrontmatter);
    if (markedAsDuplicate)   processedFrontmatter = injectDuplicateTag(processedFrontmatter);

    if (feed.extraFrontmatterRaw?.trim()) {
        processedFrontmatter = `${processedFrontmatter.trimEnd()}\n${feed.extraFrontmatterRaw.trim()}`;
    }

    const contentTemplate = feed.contentTemplate || settings.template;
    const processedBody   = applyTemplate(contentTemplate, item, false, false, feedName, dateSaved);

    const finalContent = `---\n${processedFrontmatter}\n---\n\n${processedBody}`;
    try {
        await vault.create(filePath, finalContent);
    } catch (e: unknown) {
        // Another concurrent update already created this file — treat as success.
        // Any other error is re-thrown so the caller knows the save failed.
        const message = e instanceof Error ? e.message : String(e);
        if (!message.toLowerCase().includes('already exists')) {
            throw e;
        }
    }

    if (ownDb) await saveAutoDatabase(app, db);
    if (ownUserDb) await saveUserDatabase(app, userDb);

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
        case 'subfolder': {
            const subName = settings.imagesFolder || 'attachments';
            if (settings.useFeedFolder) return normalizePath(`${feedFolderPath}/${subName}`);
            return normalizePath(`${baseRSSFolder}/${subName}`);
        }
        case 'specified':
            return normalizePath(settings.imagesFolder || 'attachments');
        default:
            return feedFolderPath;
    }
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
            const hash     = url.split('').reduce((a: number, c: string) => (Math.imul(31, a) + c.charCodeAt(0)) | 0, 0);
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

function escapeYamlValue(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'boolean' || typeof value === 'number') return String(value);
    if (typeof value === 'string') return value.replace(/"/g, '\\"');
    return '';
}

function quoteYamlString(value: string): string {
    return `"${escapeYamlValue(value)}"`;
}

interface PropertyInfo {
    type?: string;
}

interface MetadataCacheWithPropertyInfos extends MetadataCache {
    getAllPropertyInfos?: () => Record<string, PropertyInfo>;
}

function getKnownPropertyType(app: App, name: string): string | undefined {
    const propertyInfos = (app.metadataCache as MetadataCacheWithPropertyInfos).getAllPropertyInfos?.();
    if (!propertyInfos || typeof propertyInfos !== 'object') return undefined;

    const direct = propertyInfos[name]?.type;
    if (typeof direct === 'string') return direct;

    const lowerName = name.toLocaleLowerCase();
    const key = Object.keys(propertyInfos).find(k => k.toLocaleLowerCase() === lowerName);
    const type = key ? propertyInfos[key]?.type : undefined;
    return typeof type === 'string' ? type : undefined;
}

function normalizePropertyType(type: string | undefined): string | undefined {
    if (!type) return undefined;
    const normalized = type.toLocaleLowerCase().replace(/[\s_-]+/g, '');
    if (['checkbox', 'boolean', 'bool'].includes(normalized)) return 'checkbox';
    if (['number', 'numeric'].includes(normalized)) return 'number';
    if (['date'].includes(normalized)) return 'date';
    if (['datetime', 'dateandtime'].includes(normalized)) return 'datetime';
    if (['aliases', 'alias', 'multitext', 'list', 'tags', 'tag'].includes(normalized)) return 'list';
    if (['text', 'string'].includes(normalized)) return 'text';
    return normalized;
}

function formatKnownPropertyValue(name: string, value: string, type: string | undefined): string {
    const trimmed = value.trim();
    if (!trimmed) return `${name}:`;

    const normalizedType = normalizePropertyType(type);
    if (!normalizedType && /^(true|false)$/i.test(trimmed)) {
        return `${name}: ${trimmed.toLocaleLowerCase()}`;
    }
    if (!normalizedType && (
        /^\d{4}-\d{2}-\d{2}(?:[T ][0-9:.+-]+)?$/.test(trimmed)
        || /^\{\{(?:datepublished|datepub|datesaved)\}\}$/i.test(trimmed)
    )) {
        return `${name}: ${trimmed}`;
    }

    switch (normalizedType) {
        case 'checkbox':
            return `${name}: ${/^(true|yes|1|on)$/i.test(trimmed) ? 'true' : 'false'}`;
        case 'number':
            return `${name}: ${trimmed}`;
        case 'date':
        case 'datetime':
            return `${name}: ${trimmed}`;
        case 'aliases':
        case 'multitext':
        case 'tags': {
            const values = trimmed.includes('\n')
                ? trimmed.split(/\r?\n/).map(v => v.trim()).filter(Boolean)
                : trimmed.split(',').map(v => v.trim()).filter(Boolean);
            if (values.length === 0) return `${name}:`;
            return `${name}:\n${values.map(v => `  - ${quoteYamlString(v)}`).join('\n')}`;
        }
        case 'text':
        default:
            return `${name}: ${quoteYamlString(value)}`;
    }
}

function renderFrontmatterProperties(
    app: App,
    properties: FrontmatterPropertyTemplate[],
    item: FeedItem,
    feedName: string,
    dateSaved: string
): string {
    return properties
        .filter(property => property.name.trim())
        .map(property => {
            const name = property.name.trim();
            const rendered = applyTemplate(property.value, item, false, true, feedName, dateSaved);
            return formatKnownPropertyValue(name, rendered, getKnownPropertyType(app, name));
        })
        .join('\n');
}

const KNOWN_PLACEHOLDERS = new Set([
    'title', 'link', 'snippet', 'image', 'datepublished', 'datepub', 'datesaved',
    'content', 'feedname', 'tags', 'author', 'ytduration', 'duration',
]);

export function applyTemplate(
    template:   string | undefined,
    item:       FeedItem,
    isFileName: boolean = false,
    isYaml:     boolean = false,
    feedName:   string  = '',
    dateSaved?: string
): string {
    if (!template) return '';

    let result = prepareTemplate(template, item);

    // Use the timestamp provided by the caller (captured once in saveFeedItem)
    // so that all template calls within a single save operation share the exact
    // same value. Fall back to now() only when called outside of saveFeedItem
    // (e.g. preview rendering).
    const resolvedDateSaved = dateSaved ?? toLocalISOString(new Date());

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

    const sanitize = (val: unknown): string => {
        if (val === null || val === undefined) return '';
        if (!isYaml) {
            if (typeof val === 'boolean') return val ? 'true' : 'false';
            if (typeof val === 'number') return String(val);
            if (typeof val === 'string') return val;
            return '';
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
        result = result.replace(/{{author}}/g, escapeYamlValue(authorValue));
    } else {
        result = result
            .replace(/"{{author}}"/g,       authorValue)
            .replace(/\[\[{{author}}\]\]/g, `[[${authorValue}]]`)
            .replace(/{{author}}/g,          authorValue);
    }

    // Feed name
    if (isYaml) {
        result = result.replace(/{{feedname}}/gi, escapeYamlValue(feedName));
    } else {
        result = result
            .replace(/"{{feedname}}"/gi,       feedName)
            .replace(/\[\[{{feedname}}\]\]/gi, `[[${feedName}]]`)
            .replace(/{{feedname}}/gi,          feedName);
    }

    const titleValue = item.title ?? 'Untitled';
    result = result
        .replace(/{{title}}/g,      sanitize(titleValue))
        .replace(/{{link}}/g,       sanitize(item.link ?? ''))
        .replace(/{{snippet}}/g,    sanitize(item.descriptionShort ?? item.description ?? ''))
        .replace(/{{image}}/g,      imageValue)
        .replace(/{{datepublished}}/g, datePub)
        .replace(/{{datepub}}/g,       datePub)          // backward compat
        .replace(/{{datesaved}}/g,     resolvedDateSaved)
        .replace(/{{content}}/g,       renderContent())
        .replace(/{{ytduration}}/g,    sanitize(item.duration ?? ''))
        .replace(/{{duration}}/g,      sanitize(item.duration ?? ''))  // backward compat
        .replace(/{{tags}}/g,          tags)
        .replace(/{{#tags}}/g,         tags);             // backward compat

    const itemValues = item as unknown as Record<string, unknown>;
    result = result.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match: string, key: string) => {
        if (KNOWN_PLACEHOLDERS.has(key.toLowerCase())) return '';
        const value = itemValues[key];
        if (value === null || value === undefined) return '';
        if (typeof value === 'boolean') return value ? 'true' : 'false';
        if (typeof value === 'number') return String(value);
        if (Array.isArray(value)) return value.map(x => escapeYamlValue(x)).join(', ');
        if (typeof value === 'string') return isYaml ? escapeYamlValue(value) : value;
        return '';
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
            try {
                await vault.createFolder(currentPath);
            } catch {
                // Folder may have been created concurrently — ignore race condition.
            }
        }
    }
}
