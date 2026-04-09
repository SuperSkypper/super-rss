import { App, Vault, TFile, normalizePath } from 'obsidian';
import RssPlugin, { resolveFeedPath, PluginSettings } from '../main';
import { loadAutoDatabase, saveAutoDatabase, loadUserDatabase, loadFeedDatabase, AutoDatabase, UserDatabase, FeedDatabase, registerOldArticle } from './feedDatabase';

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
 * Tries metadataCache first, falls back to raw content parse.
 */
export async function resolveLinkFromFile(app: App, vault: Vault, file: TFile): Promise<string | null> {
    const fm = app.metadataCache.getFileCache(file)?.frontmatter;
    if (fm) {
        const key = Object.keys(fm).find(k => k.toLowerCase() === 'link');
        if (key && fm[key]) return String(fm[key]).trim();
    }

    try {
        const content          = await vault.cachedRead(file);
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
    } catch { /* ignore unreadable files */ }

    return null;
}

// ─── Read date from frontmatter ───────────────────────────────────────────────

export async function readPubDateFromFrontmatter(app: App, vault: Vault, file: TFile): Promise<number | null> {
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

export async function isFileProtected(vault: Vault, file: TFile, propertyName: string): Promise<boolean> {
    try {
        const content          = await vault.cachedRead(file);
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (!frontmatterMatch) return true;

        const frontmatter = frontmatterMatch[1] ?? '';
        for (const line of frontmatter.split('\n')) {
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

// ─── Age-based cleanup ────────────────────────────────────────────────────────

/**
 * Deletes markdown files inside folderPath that are older than value/unit.
 *
 * Each deleted file is registered as:
 *   - 'mark_as_read' in the user DB  — when markAsRead feature is enabled
 *   - 'old_article'  in the auto DB  — otherwise
 *
 * Returns the number of files deleted.
 */
export async function cleanupOldFiles(
    vault:      Vault,
    app:        App,
    folderPath: string,
    value:      number,
    unit:       'minutes' | 'hours' | 'days' | 'months',
    dateField:  'datepub' | 'datesaved' = 'datesaved',
    settings?:  PluginSettings,
    autoDb?:    AutoDatabase
): Promise<number> {
    const cutoff           = Date.now() - toMilliseconds(value, unit);
    const normalizedFolder = normalizePath(folderPath);
    const folder           = vault.getAbstractFileByPath(normalizedFolder);

    if (!folder) return 0;

    const usePropertyCheck = settings?.autoCleanupCheckProperty ?? false;
    const propertyName     = settings?.autoCleanupCheckPropertyName?.trim()
                          || settings?.markAsReadCheckboxProperty?.trim()
                          || 'Checkbox';

    // Whether to route old-article deletions to the user DB as 'mark_as_read'
    const markAsReadMode = settings?.markAsReadEnabled ?? false;

    const ownAutoDb = !autoDb;
    autoDb          = autoDb ?? await loadAutoDatabase(app);

    // Always load the user DB — needed when markAsReadMode is active
    const userDb = await loadUserDatabase(app);

    let deletedCount = 0;

    const files = vault.getFiles().filter(f =>
        f.path.startsWith(normalizedFolder + '/') &&
        f.extension === 'md'
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

        const itemLink = await resolveLinkFromFile(app, vault, file);

        // Guard: without a resolvable link we cannot build a reliable DB key.
        // Skipping deletion is safer than registering under file.name — a key
        // mismatch would cause the article to be re-imported on the next update.
        if (!itemLink) {
            console.warn(`RSS Cleanup: skipping "${file.path}" — could not resolve link property for DB key.`);
            continue;
        }

        try {
            await vault.delete(file);
            deletedCount++;

            // Register deletion in the correct DB based on markAsRead setting
            await registerOldArticle(app, autoDb, userDb, itemLink, autoDb[itemLink]?.pubDate ?? '', markAsReadMode);

            // Persist the auto DB immediately after every deletion so an interrupted
            // run does not leave a file-less entry in a stale state.
            if (!markAsReadMode) {
                await saveAutoDatabase(app, autoDb);
            }
        } catch (e) {
            console.error(`RSS Cleanup: failed to delete ${file.path}`, e);
        }
    }

    if (ownAutoDb) {
        await saveAutoDatabase(app, autoDb);
    }

    return deletedCount;
}

// ─── Live article cleanup ─────────────────────────────────────────────────────

/**
 * Deletes files tagged #live inside feedPath.
 * Registers each deletion as 'skip_live' in the auto DB.
 * Returns the number of files deleted.
 */
export async function deleteLiveArticlesForFeed(
    app:      App,
    feedPath: string,
    db:       AutoDatabase
): Promise<number> {
    const { vault, metadataCache } = app;
    const folder = vault.getAbstractFileByPath(feedPath);
    if (!folder) return 0;

    const normalizedFeedPath = normalizePath(feedPath);
    const files = vault.getMarkdownFiles().filter(f => f.path.startsWith(normalizedFeedPath + '/'));
    let deletedCount = 0;

    for (const file of files) {
        const cache = metadataCache.getFileCache(file);
        const tags  = [
            ...(cache?.tags?.map(t => t.tag) ?? []),
            ...(cache?.frontmatter?.tags ?? []),
        ].map((t: string) => t.replace(/^#/, '').toLowerCase());

        if (!tags.includes('live')) continue;

        const itemLink = await resolveLinkFromFile(app, vault, file);

        // Guard: without a resolvable link we cannot build a reliable DB key.
        if (!itemLink) {
            console.warn(`RSS: skipping live deletion for "${file.path}" — could not resolve link property.`);
            continue;
        }

        try {
            await vault.delete(file);
            deletedCount++;

            if (!(itemLink in db)) {
                db[itemLink] = { link: itemLink, pubDate: db[itemLink]?.pubDate ?? '', status: 'skip_live', ts: Date.now() };
            }
        } catch (e) {
            console.error(`RSS: Failed to delete live article "${file.path}":`, e);
        }
    }

    return deletedCount;
}

// ─── Orphan cleanup ───────────────────────────────────────────────────────────

/**
 * Scans every markdown file inside rssFolderPath, reads its 'link' frontmatter
 * property, and deletes the file if the database marks that link as any
 * auto-managed status (skip_shorts, skip_live, old_article).
 *
 * 'mark_as_read' entries in the user DB are NOT deleted here — the user
 * explicitly chose to read/delete those and they are already gone.
 *
 * Returns the number of files deleted.
 */
export async function deleteOrphanedDbArticles(
    vault:         Vault,
    app:           App,
    rssFolderPath: string,
    _db?:          FeedDatabase
): Promise<number> {
    const normalizedFolder = normalizePath(rssFolderPath);
    const folder           = vault.getAbstractFileByPath(normalizedFolder);
    if (!folder) return 0;

    const db = await loadFeedDatabase(app);

    // Statuses that indicate the file should not exist in the vault
    const DELETE_STATUSES = new Set<string>(['skip_shorts', 'skip_live', 'old_article', 'mark_as_read']);

    const files = vault.getFiles().filter(f =>
        f.path.startsWith(normalizedFolder + '/') &&
        f.extension === 'md'
    );

    let deletedCount = 0;

    for (const file of files) {
        const itemLink = await resolveLinkFromFile(app, vault, file);
        if (!itemLink) continue;

        const entry = db[itemLink];

        // No DB entry = never processed — skip
        if (!entry || !DELETE_STATUSES.has(entry.status)) continue;

        try {
            await vault.delete(file);
            deletedCount++;
            console.log(`RSS Cleanup (orphan): deleted "${file.path}" (DB status: ${entry.status})`);
        } catch (e) {
            console.error(`RSS Cleanup (orphan): failed to delete "${file.path}"`, e);
        }
    }

    return deletedCount;
}

// ─── Auto cleanup runner ──────────────────────────────────────────────────────

/**
 * Runs the full post-update cleanup pipeline:
 *   1. Age-based cleanup for feeds without a per-feed override (global setting)
 *   2. Orphan pass — deletes any vault file whose link is already marked as
 *      skip_shorts, skip_live, old_article, or mark_as_read in the DB
 *
 * Called by updateAllFeeds after all feeds have been fetched and saved.
 * Returns the total number of files deleted.
 */
export async function runAutoCleanup(
    app:    App,
    plugin: RssPlugin,
    db:     AutoDatabase
): Promise<number> {
    const enabledFeeds = plugin.settings.feeds.filter(f => f.enabled && f.url && !f.deleted);
    let totalDeleted = 0;

    // 1. Global age-based cleanup for feeds without a per-feed override
    if (plugin.settings.autoCleanupValue > 0) {
        const feedsWithoutOverride = enabledFeeds.filter(
            f => f.autoCleanupValue == null || f.autoCleanupValue <= 0
        );
        for (const feed of feedsWithoutOverride) {
            const feedPath = resolveFeedPath(feed, plugin.settings);
            totalDeleted += await cleanupOldFiles(
                app.vault,
                app,
                feedPath,
                plugin.settings.autoCleanupValue,
                plugin.settings.autoCleanupUnit,
                plugin.settings.autoCleanupDateField,
                plugin.settings,
                db
            );
        }
    }

    // 2. Orphan pass — scan entire RSS folder.
    // deleteOrphanedDbArticles loads its own fresh combined DB internally.
    totalDeleted += await deleteOrphanedDbArticles(
        app.vault,
        app,
        plugin.settings.folderPath
    );

    return totalDeleted;
}
