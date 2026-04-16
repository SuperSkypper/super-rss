import { App, Vault, TFile, normalizePath } from 'obsidian';
import RssPlugin, { resolveFeedPath, PluginSettings } from '../main';
import { 
    loadAutoDatabase, 
    loadUserDatabase, 
    loadFeedDatabase, 
    AutoDatabase, 
    UserDatabase,
    registerOldArticle 
} from './feedDatabase';

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
 */
export async function isFileProtected(vault: Vault, file: TFile, propertyName: string): Promise<boolean> {
    try {
        const content = await vault.cachedRead(file);
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (!frontmatterMatch) return true;

        const frontmatter = frontmatterMatch[1] ?? '';
        for (const line of frontmatter.split('\n')) {
            const colonIndex = line.indexOf(':');
            if (colonIndex === -1) continue;
            const key = line.slice(0, colonIndex).trim().toLowerCase();
            const value = line.slice(colonIndex + 1).trim().toLowerCase();
            if (key === propertyName.toLowerCase()) {
                return value !== 'true';
            }
        }
        return true;
    } catch {
        return true;
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
    autoDb?:    AutoDatabase
): Promise<number> {
    const cutoff = Date.now() - toMilliseconds(value, unit);
    const normalizedFolder = normalizePath(folderPath);

    const usePropertyCheck = settings?.autoCleanupCheckProperty ?? false;
    const propertyName = settings?.autoCleanupCheckPropertyName?.trim()
                      || settings?.markAsReadCheckboxProperty?.trim()
                      || 'Checkbox';

    const markAsReadMode = settings?.markAsReadEnabled ?? false;

    // Load fresh databases
    const [diskAutoDb, userDb] = await Promise.all([
        loadAutoDatabase(app),
        loadUserDatabase(app)
    ]);

    // Merge with caller's in-memory db (caller wins)
    const mergedAutoDb: AutoDatabase = autoDb ? { ...diskAutoDb, ...autoDb } : diskAutoDb;
    if (autoDb) Object.assign(autoDb, diskAutoDb);

    let deletedCount = 0;

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
            const protectedFile = await isFileProtected(vault, file, propertyName);
            if (protectedFile) continue;
        }

        const itemLink = await resolveLinkFromFile(app, vault, file);
        if (!itemLink) {
            console.warn(`RSS Cleanup: skipping "${file.path}" — no link property found.`);
            continue;
        }

        try {
            await vault.delete(file);
            deletedCount++;

            // Use registerOldArticle — it handles append to JSONL automatically
            await registerOldArticle(
                app,
                mergedAutoDb,
                userDb,
                itemLink,
                mergedAutoDb[itemLink]?.pubDate ?? String(file.stat.ctime),
                markAsReadMode
            );

        } catch (e) {
            console.error(`RSS Cleanup: failed to delete ${file.path}`, e);
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
    db:       AutoDatabase
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
            ...(cache?.frontmatter?.tags ?? []),
        ].map((t: string) => t.replace(/^#/, '').toLowerCase());

        if (!tags.includes('live')) continue;

        const itemLink = await resolveLinkFromFile(app, vault, file);
        if (!itemLink) continue;

        try {
            await vault.delete(file);
            deletedCount++;

            if (!(itemLink in db)) {
                db[itemLink] = {
                    link: itemLink,
                    pubDate: '',
                    status: 'skip_live',
                    ts: Date.now()
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
    rssFolderPath: string
): Promise<number> {
    const normalizedFolder = normalizePath(rssFolderPath);
    const db = await loadFeedDatabase(app);

    const DELETE_STATUSES = new Set(['skip_shorts', 'skip_live', 'old_article', 'mark_as_read']);

    const files = vault.getFiles().filter(f =>
        f.path.startsWith(normalizedFolder + '/') && f.extension === 'md'
    );

    let deletedCount = 0;

    for (const file of files) {
        const itemLink = await resolveLinkFromFile(app, vault, file);
        if (!itemLink) continue;

        const entry = db[itemLink];
        if (!entry || !DELETE_STATUSES.has(entry.status)) continue;

        try {
            await vault.delete(file);
            deletedCount++;
            console.log(`RSS Cleanup (orphan): deleted "${file.path}" (status: ${entry.status})`);
        } catch (e) {
            console.error(`RSS Cleanup (orphan): failed to delete "${file.path}"`, e);
        }
    }

    return deletedCount;
}

// ─── Auto cleanup runner ──────────────────────────────────────────────────────

export async function runAutoCleanup(
    app:    App,
    plugin: RssPlugin,
    db:     AutoDatabase
): Promise<number> {
    const enabledFeeds = plugin.settings.feeds.filter(f => f.enabled && f.url && !f.deleted);
    let totalDeleted = 0;

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

    totalDeleted += await deleteOrphanedDbArticles(
        app.vault,
        app,
        plugin.settings.folderPath
    );

    return totalDeleted;
}