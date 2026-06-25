import { App, Vault, TFile, normalizePath } from 'obsidian';
import RssPlugin, { resolveFeedPath, PluginSettings } from '../main';
import { 
    loadAutoDatabase, 
    loadUserDatabase, 
    loadFeedDatabase, 
    AutoDatabase, 
    registerOldArticle 
} from './feedDatabase';

export interface FileMeta {
    file: TFile;
    link: string | null;
    pubDate: number | null;
    deleted: boolean;
}

interface VaultWithConfig extends Vault {
    getConfig?: (key: string) => unknown;
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(item => typeof item === 'string');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function toMilliseconds(value: number, unit: 'minutes' | 'hours' | 'days' | 'months'): number {
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

/**
 * Reads the link frontmatter property from a file.
 */
export async function resolveLinkFromFile(app: App, vault: Vault, file: TFile): Promise<string | null> {
    const fm = app.metadataCache.getFileCache(file)?.frontmatter;
    if (fm) {
        const key = Object.keys(fm).find(k => k.toLowerCase() === 'link');
        if (key && fm[key]) return String(fm[key]).trim();
    }

    try {
        const content = await vault.cachedRead(file);
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (frontmatterMatch) {
            for (const line of (frontmatterMatch[1] ?? '').split('\n')) {
                const ci = line.indexOf(':');
                if (ci === -1) continue;
                if (line.slice(0, ci).trim().toLowerCase() === 'link') {
                    return line.slice(ci + 1).trim().replace(/^["']|["']$/g, '') || null;
                }
            }
        }
    } catch { /* ignore */ }

    return null;
}

/**
 * Reads publication date from frontmatter.
 */
export async function readPubDateFromFrontmatter(app: App, vault: Vault, file: TFile): Promise<number | null> {
    const pubDateKeys = ['upload date', 'date published', 'datepub', 'pubdate'];

    const fm = app.metadataCache.getFileCache(file)?.frontmatter;
    if (fm) {
        for (const key of Object.keys(fm)) {
            if (pubDateKeys.includes(key.toLowerCase())) {
                const parsed = Date.parse(String(fm[key]));
                if (!isNaN(parsed)) return parsed;
            }
        }
    }

    try {
        const content = await vault.cachedRead(file);
        const match = content.match(/^---\n([\s\S]*?)\n---/);
        if (!match) return null;
        for (const line of (match[1] ?? '').split('\n')) {
            const ci = line.indexOf(':');
            if (ci === -1) continue;
            const key = line.slice(0, ci).trim().toLowerCase();
            if (pubDateKeys.includes(key)) {
                const val = line.slice(ci + 1).trim().replace(/^["']|["']$/g, '');
                const parsed = Date.parse(val);
                if (!isNaN(parsed)) return parsed;
            }
        }
    } catch { /* ignore */ }

    return null;
}

/**
 * Checks if file is protected by a checkbox property.
 * Uses Metadata Cache for speed and reliability.
 */
export function isFileProtected(app: App, file: TFile, propertyName: string): boolean {
    const fm = app.metadataCache.getFileCache(file)?.frontmatter;
    if (!fm) return true;

    // Case-insensitive key lookup
    const foundKey = Object.keys(fm).find(k => k.toLowerCase() === propertyName.toLowerCase());
    if (!foundKey) return true;

    const frontmatter = fm as Record<string, unknown>;
    const val = frontmatter[foundKey];
    // Property is 'protected' (locked) IF it is NOT explicitly true.
    // This allows undefined/false to act as protected.
    return val !== true && String(val).toLowerCase() !== 'true';
}

function getObsidianTrashUsesSystem(app: App): boolean {
    const getConfig = (app.vault as VaultWithConfig).getConfig?.bind(app.vault);
    return getConfig?.('trashOption') !== 'local';
}

export async function discardVaultFile(app: App, file: TFile, settings?: PluginSettings): Promise<void> {
    const behavior = settings?.deleteBehavior ?? 'obsidian';

    if (behavior === 'direct') {
        await app.vault.delete(file);
        return;
    }

    const useSystem = behavior === 'system-trash'
        ? true
        : behavior === 'obsidian-trash'
            ? false
            : getObsidianTrashUsesSystem(app);

    try {
        await app.vault.trash(file, useSystem);
    } catch (e) {
        if (useSystem) {
            await app.vault.trash(file, false);
            return;
        }
        throw e;
    }
}

// ─── Age-based cleanup ────────────────────────────────────────────────────────

export async function cleanupOldFiles(
    vault:      Vault,
    app:        App,
    folderPath: string,
    value:      number,
    unit:       'minutes' | 'hours' | 'days' | 'months',
    dateField:  'datepub' | 'datesaved' = 'datesaved',
    settings?:  PluginSettings,
    autoDb?:    AutoDatabase,
    fileCache?: FileMeta[]
): Promise<number> {
    const cutoff = Date.now() - toMilliseconds(value, unit);
    const normalizedFolder = normalizePath(folderPath);

    const usePropertyCheck = settings?.autoCleanupCheckProperty ?? false;
    const propertyName = settings?.autoCleanupCheckPropertyName?.trim()
                      || settings?.markAsReadCheckboxProperty?.trim()
                      || 'Checkbox';

    // Load fresh databases
    const [diskAutoDb, userDb] = await Promise.all([
        loadAutoDatabase(app),
        loadUserDatabase(app)
    ]);

    // Merge with caller's in-memory db (caller wins)
    const mergedAutoDb: AutoDatabase = autoDb ? { ...diskAutoDb, ...autoDb } : diskAutoDb;
    if (autoDb) Object.assign(autoDb, diskAutoDb);

    let deletedCount = 0;

    // If fileCache is provided, skip the expensive disk/regex reads
    if (fileCache) {
        for (const meta of fileCache) {
            if (meta.deleted) continue;
            if (!meta.file.path.startsWith(normalizedFolder + '/')) continue;

            let fileTime: number;
            if (dateField === 'datepub') {
                fileTime = meta.pubDate ?? meta.file.stat.ctime;
            } else {
                fileTime = meta.file.stat.ctime;
            }

            if (fileTime >= cutoff) continue;

            if (usePropertyCheck) {
                const protectedFile = isFileProtected(app, meta.file, propertyName);
                if (protectedFile) continue;
            }

            if (!meta.link) {
                console.warn(`RSS Cleanup: skipping "${meta.file.path}" — no link property found.`);
                continue;
            }

            try {
                await discardVaultFile(app, meta.file, settings);
                meta.deleted = true;
                deletedCount++;

                await registerOldArticle(
                    app,
                    mergedAutoDb,
                    userDb,
                    meta.link,
                    mergedAutoDb[meta.link]?.pubDate ?? String(meta.file.stat.ctime),
                    false, // Deleted by age, not explicitly marked as read
                    meta.file.basename,
                );

            } catch (e) {
                console.error(`RSS Cleanup: failed to delete ${meta.file.path}`, e);
            }
        }
    } else {
        // Fallback for isolated calls
        const files = vault.getFiles().filter(f =>
            f.path.startsWith(normalizedFolder + '/') && f.extension === 'md'
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
            const protectedFile = isFileProtected(app, file, propertyName);
            if (protectedFile) continue;
        }

        const itemLink = await resolveLinkFromFile(app, vault, file);
        if (!itemLink) {
            console.warn(`RSS Cleanup: skipping "${file.path}" — no link property found.`);
            continue;
        }

        try {
            await discardVaultFile(app, file, settings);
            deletedCount++;

            await registerOldArticle(
                app,
                mergedAutoDb,
                userDb,
                itemLink,
                mergedAutoDb[itemLink]?.pubDate ?? String(file.stat.ctime),
                false, // Deleted by age, not explicitly marked as read
                file.basename,
            );

        } catch (e) {
            console.error(`RSS Cleanup: failed to delete ${file.path}`, e);
        }
    }
    }

    // Sync back to caller's db reference
    if (autoDb) Object.assign(autoDb, mergedAutoDb);

    return deletedCount;
}

// ─── Live article cleanup ─────────────────────────────────────────────────────

export async function deleteLiveArticlesForFeed(
    app:      App,
    feedPath: string,
    db:       AutoDatabase,
    settings?: PluginSettings
): Promise<number> {
    const { vault, metadataCache } = app;
    const normalizedFeedPath = normalizePath(feedPath);

    const files = vault.getMarkdownFiles().filter(f => 
        f.path.startsWith(normalizedFeedPath + '/')
    );

    let deletedCount = 0;

    for (const file of files) {
        const cache = metadataCache.getFileCache(file);
        const tags = [
            ...(cache?.tags?.map(t => t.tag) ?? []),
            ...(isStringArray((cache?.frontmatter as Record<string, unknown> | undefined)?.tags)
                ? (cache?.frontmatter as Record<string, unknown>).tags as string[]
                : []),
        ].map((t: string) => t.replace(/^#/, '').toLowerCase());

        if (!tags.includes('live')) continue;

        const itemLink = await resolveLinkFromFile(app, vault, file);
        if (!itemLink) continue;

        try {
            await discardVaultFile(app, file, settings);
            deletedCount++;

            if (!(itemLink in db)) {
                db[itemLink] = {
                    ts:      String(Date.now()),
                    pubDate: '0000000000000',
                    status:  'skip_live',
                    link:    itemLink,
                    title:   file.basename,
                };
            }
        } catch (e) {
            console.error(`RSS: Failed to delete live article "${file.path}":`, e);
        }
    }

    return deletedCount;
}

// ─── Orphan cleanup ───────────────────────────────────────────────────────────

export async function deleteOrphanedDbArticles(
    vault:         Vault,
    app:           App,
    rssFolderPath: string,
    fileCache?:    FileMeta[],
    settings?:     PluginSettings
): Promise<number> {
    const normalizedFolder = normalizePath(rssFolderPath);
    const db = await loadFeedDatabase(app);

    const DELETE_STATUSES = new Set(['skip_shorts', 'skip_live', 'old_article', 'mark_as_read']);

    let deletedCount = 0;

    if (fileCache) {
        for (const meta of fileCache) {
            if (meta.deleted || !meta.link) continue;
            if (!meta.file.path.startsWith(normalizedFolder + '/')) continue;

            const entry = db[meta.link];
            if (!entry || !DELETE_STATUSES.has(entry.status)) continue;

            try {
                await discardVaultFile(app, meta.file, settings);
                meta.deleted = true;
                deletedCount++;
                console.debug(`RSS Cleanup (orphan): deleted "${meta.file.path}" (status: ${entry.status})`);
            } catch (e) {
                console.error(`RSS Cleanup (orphan): failed to delete "${meta.file.path}"`, e);
            }
        }
    } else {
        // Fallback for isolated calls
        const files = vault.getFiles().filter(f =>
            f.path.startsWith(normalizedFolder + '/') && f.extension === 'md'
        );

    for (const file of files) {
        const itemLink = await resolveLinkFromFile(app, vault, file);
        if (!itemLink) continue;

        const entry = db[itemLink];
        if (!entry || !DELETE_STATUSES.has(entry.status)) continue;

        try {
            await discardVaultFile(app, file, settings);
            deletedCount++;
            console.debug(`RSS Cleanup (orphan): deleted "${file.path}" (status: ${entry.status})`);
        } catch (e) {
            console.error(`RSS Cleanup (orphan): failed to delete "${file.path}"`, e);
        }
    }
    }

    return deletedCount;
}

// ─── Mark as Read cleanup ─────────────────────────────────────────────────────

export async function cleanupReadFiles(
    vault:      Vault,
    app:        App,
    folderPath: string,
    settings:   PluginSettings,
    autoDb?:    AutoDatabase,
    fileCache?: FileMeta[]
): Promise<number> {
    const normalizedFolder = normalizePath(folderPath);
    const propertyName = settings.markAsReadCheckboxProperty?.trim() || 'Checkbox';
    let deletedCount = 0;

    const [diskAutoDb, userDb] = await Promise.all([
        loadAutoDatabase(app),
        loadUserDatabase(app)
    ]);

    const mergedAutoDb: AutoDatabase = autoDb ? { ...diskAutoDb, ...autoDb } : diskAutoDb;
    if (autoDb) Object.assign(autoDb, diskAutoDb);

    if (fileCache) {
        for (const meta of fileCache) {
            if (meta.deleted) continue;
            if (!meta.file.path.startsWith(normalizedFolder + '/')) continue;

            const isProtected = isFileProtected(app, meta.file, propertyName);
            if (isProtected) continue; // Property is NOT true

            if (!meta.link) {
                console.warn(`RSS Cleanup (Read): skipping "${meta.file.path}" — no link property found.`);
                continue;
            }

            try {
                await discardVaultFile(app, meta.file, settings);
                meta.deleted = true;
                deletedCount++;

                await registerOldArticle(
                    app,
                    mergedAutoDb,
                    userDb,
                    meta.link,
                    mergedAutoDb[meta.link]?.pubDate ?? String(meta.file.stat.ctime),
                    true, // Always save as mark_as_read
                    meta.file.basename,
                );
            } catch (e) {
                console.error(`RSS Cleanup (Read): failed to delete ${meta.file.path}`, e);
            }
        }
    } else {
        const files = vault.getFiles().filter(f =>
            f.path.startsWith(normalizedFolder + '/') && f.extension === 'md'
        );

        for (const file of files) {
            const isProtected = isFileProtected(app, file, propertyName);
            if (isProtected) continue;

            const itemLink = await resolveLinkFromFile(app, vault, file);
            if (!itemLink) {
                console.warn(`RSS Cleanup (Read): skipping "${file.path}" — no link property found.`);
                continue;
            }

            try {
                await discardVaultFile(app, file, settings);
                deletedCount++;

                await registerOldArticle(
                    app,
                    mergedAutoDb,
                    userDb,
                    itemLink,
                    mergedAutoDb[itemLink]?.pubDate ?? String(file.stat.ctime),
                    true, // Always save as mark_as_read
                    file.basename,
                );
            } catch (e) {
                console.error(`RSS Cleanup (Read): failed to delete ${file.path}`, e);
            }
        }
    }

    if (autoDb) Object.assign(autoDb, mergedAutoDb);

    return deletedCount;
}

// ─── Auto cleanup runner ──────────────────────────────────────────────────────

export async function runAutoCleanup(
    app:    App,
    plugin: RssPlugin,
    db:     AutoDatabase,
    fileCache?: FileMeta[]
): Promise<number> {
    const enabledFeeds = plugin.settings.feeds.filter(f => f.enabled && f.url && !f.deleted);
    let totalDeleted = 0;

    for (let i = 0; i < enabledFeeds.length; i++) {
        const feed = enabledFeeds[i]!;
        const feedPath = resolveFeedPath(feed, plugin.settings);
        const feedCleanupValue = feed.autoCleanupValue ?? plugin.settings.autoCleanupValue;
        const feedCleanupUnit = feed.autoCleanupUnit ?? plugin.settings.autoCleanupUnit;
        const feedDateField = (!feed.autoCleanupDateField || feed.autoCleanupDateField === 'global')
             ? plugin.settings.autoCleanupDateField 
             : feed.autoCleanupDateField;

        plugin.setStatusBarText(`⏳ Cleaning Feeds: ${i + 1}/${enabledFeeds.length}`, `Cleaning ${feed.name || feed.url}`);

        if (feedCleanupValue != null && feedCleanupValue > 0) {
            totalDeleted += await cleanupOldFiles(
                app.vault,
                app,
                feedPath,
                feedCleanupValue,
                feedCleanupUnit,
                feedDateField,
                plugin.settings,
                db,
                fileCache
            );
        }
    }

    totalDeleted += await deleteOrphanedDbArticles(
        app.vault,
        app,
        plugin.settings.folderPath,
        fileCache,
        plugin.settings
    );

    if (plugin.settings.markAsReadEnabled && plugin.settings.markAsReadDeleteArticles) {
        totalDeleted += await cleanupReadFiles(
            app.vault,
            app,
            plugin.settings.folderPath,
            plugin.settings,
            db,
            fileCache
        );
    }

    return totalDeleted;
}
