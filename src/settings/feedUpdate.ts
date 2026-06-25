import { App, Notice, normalizePath } from 'obsidian';
import RssPlugin, { FeedConfig, resolveFeedPath } from '../main';
import { RawFeedItem, fetchAndExtract, fetchYoutubeDuration, fetchFullContent } from './feedExtractor';
import { processItems, sanitizeFileName } from './feedProcessor';
import { saveFeedItem, applyTemplate } from './feedSaver';
import { deleteLiveArticlesForFeed, runAutoCleanup, FileMeta, resolveLinkFromFile, readPubDateFromFrontmatter } from './feedDelete';
import { loadAutoDatabase, saveAutoDatabase, loadUserDatabase, isKnown, AutoDatabase } from './feedDatabase';
import { tagDuplicatesInVault } from './feedDuplicate';
import { extractImageUrl, upgradeYoutubeThumbnail } from './imageHandler';

// ── Update lockfile ───────────────────────────────────────────────────────────

const PLUGIN_ID   = 'super-rss';
const LOCK_FILE   = 'update-lock.json';
const LOCK_TTL_MS = 5 * 60 * 1000;

interface LockData {
    instanceId: string;
    startedAt:  number;
}

interface AtomLink {
    $?: {
        href?: string;
    };
}

function isAtomLink(value: unknown): value is AtomLink {
    return typeof value === 'object' && value !== null;
}

function getRawItemLink(rawItem: RawFeedItem): string {
    if (typeof rawItem.link === 'string') return rawItem.link;
    if (isAtomLink(rawItem.link) && typeof rawItem.link.$?.href === 'string') return rawItem.link.$.href;
    return '';
}

function getLockPath(app: App): string {
    return normalizePath(`${app.vault.configDir}/plugins/${PLUGIN_ID}/${LOCK_FILE}`);
}

function generateInstanceId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const INSTANCE_ID = generateInstanceId();

async function acquireLock(app: App): Promise<boolean> {
    const path    = getLockPath(app);
    const adapter = app.vault.adapter;

    try {
        if (await adapter.exists(path)) {
            const raw  = await adapter.read(path);
            const data = JSON.parse(raw) as LockData;
            const age  = Date.now() - data.startedAt;

            if (age < LOCK_TTL_MS) return false;

            await adapter.remove(path);
        }
    } catch {
        // Unreadable lock — treat as stale and proceed
    }

    const lockData: LockData = { instanceId: INSTANCE_ID, startedAt: Date.now() };
    await adapter.write(path, JSON.stringify(lockData));
    return true;
}

export async function releaseLock(app: App): Promise<void> {
    const path    = getLockPath(app);
    const adapter = app.vault.adapter;

    try {
        if (await adapter.exists(path)) {
            const raw  = await adapter.read(path);
            const data = JSON.parse(raw) as LockData;
            if (data.instanceId === INSTANCE_ID) {
                await adapter.remove(path);
            }
        }
    } catch {
        // Best-effort — ignore errors on release
    }
}

// ── Update a single feed ──────────────────────────────────────────────────────

async function collectRssFileCache(app: App, plugin: RssPlugin): Promise<FileMeta[]> {
    const rssFolderPath = normalizePath(plugin.settings.folderPath);
    const allMdFiles = app.vault.getMarkdownFiles().filter(f => f.path.startsWith(rssFolderPath + '/'));
    const totalFiles = allMdFiles.length;
    const fileCache: FileMeta[] = [];

    for (let i = 0; i < totalFiles; i++) {
        if (plugin.stopRequested) break;
        const f = allMdFiles[i]!;
        plugin.setStatusBarText(`Saving: ${i + 1}/${totalFiles}`, `Processing ${f.path}`);

        const link = await resolveLinkFromFile(app, app.vault, f);
        const pubDate = await readPubDateFromFrontmatter(app, app.vault, f);
        fileCache.push({ file: f, link, pubDate, deleted: false });
    }

    return fileCache;
}

export async function cleanupBeforeUpdate(
    app: App,
    plugin: RssPlugin,
    db: AutoDatabase,
): Promise<number> {
    const fileCache = await collectRssFileCache(app, plugin);
    if (plugin.stopRequested) return 0;

    return runAutoCleanup(app, plugin, db, fileCache);
}

export async function updateFeed(
    app:      App,
    plugin:   RssPlugin,
    feed:     FeedConfig,
    db:       AutoDatabase,
): Promise<{ saved: number; deleted: number }> {
    let saved   = 0;
    let deleted = 0;

    try {
        const raw = await fetchAndExtract(feed.url);
        if (!raw || !raw.items) return { saved, deleted };

        const isYoutubeFeed = /youtube\.com|youtu\.be/.test(feed.url);

        // YouTube-specific metadata enrichment
        if (isYoutubeFeed && raw.items.length > 0) {
            const BATCH_SIZE = 5;
            for (let i = 0; i < raw.items.length; i += BATCH_SIZE) {
                const batch = raw.items.slice(i, i + BATCH_SIZE);
                await Promise.all(
                    batch.map(async rawItem => {
                        const link = getRawItemLink(rawItem);
                        if (link) {
                            rawItem.duration = await fetchYoutubeDuration(link);
                        }
                    })
                );
            }
            await Promise.all(
                raw.items.map(async rawItem => {
                    if (rawItem.imageUrl) {
                        rawItem.imageUrl = await upgradeYoutubeThumbnail(rawItem.imageUrl);
                    }
                })
            );
        }

        const items              = processItems(raw.items);
        const absoluteFolderPath = resolveFeedPath(feed, plugin.settings);
        const userDb             = await loadUserDatabase(app);

        for (const item of items) {
            // Non-YouTube (standard blog/RSS) logic
            if (!isYoutubeFeed) {
                const isBlacklisted = !!item.link && isKnown(db, item.link);

                if (!isBlacklisted) {
                    const fileNameTemplate = feed.titleTemplate || plugin.settings.fileNameTemplate || '{{title}}';
                    const rawFileName      = applyTemplate(fileNameTemplate, item, true, false, feed.name || '');
                    const fileName         = sanitizeFileName(rawFileName) + '.md';
                    const filePath         = normalizePath(`${absoluteFolderPath}/${fileName}`);
                    const fileExists       = await app.vault.adapter.exists(filePath);

                    if (!fileExists) {
                        let htmlContent: string | undefined;
                        if (item.link) {
                            const full = await fetchFullContent(item.link);
                            if (full?.content) item.content = full.content;
                            htmlContent = full?.html;
                        }
                        if (!item.imageUrl && item.link) {
                            item.imageUrl = await extractImageUrl({}, item.link, htmlContent);
                        }
                    }
                }
            }

            const isSaved = await saveFeedItem(
                app.vault,
                app,
                item,
                absoluteFolderPath,
                plugin.settings,
                feed,
                db,
                userDb
            );

            if (isSaved) {
                saved++;
            }
        }

        if (saved > 0) {
            console.debug(`RSS: Saved ${saved} new items for ${feed.name}`);
        }

        if (feed.deleteLives) {
            deleted += await deleteLiveArticlesForFeed(app, absoluteFolderPath, db, plugin.settings);
            if (deleted > 0) await saveAutoDatabase(app, db);
        }

        // (cleanupOldFiles has been moved to runAutoCleanup for the single-pass optmization)

        await saveAutoDatabase(app, db);

    } catch (error) {
        console.error(`RSS Error [${feed.name || feed.url}]:`, error);
    }

    return { saved, deleted };
}

// ── Update all feeds ──────────────────────────────────────────────────────────

export async function updateAllFeeds(
    app:    App,
    plugin: RssPlugin,
): Promise<void> {
    // Auto-update will be blocked in `main.ts` but manual updates are allowed.

    if (plugin.isUpdating) return;

    const lockAcquired = await acquireLock(app);
    if (!lockAcquired) {
        new Notice('RSS: update already in progress.', 4000);
        return;
    }

    if (plugin.stopRequested) {
        await releaseLock(app);
        return;
    }

    plugin.isUpdating = true;

    try {
        const enabledFeeds = plugin.settings.feeds.filter(f => f.enabled && f.url && !f.deleted);
        if (enabledFeeds.length === 0) return;

        const total = enabledFeeds.length;
        if (plugin.settings.showProgressNotice) {
            new Notice(`Updating ${total} feeds...`, 3000);
        }

        let totalSaved   = 0;
        let totalDeleted = 0;
        const db = await loadAutoDatabase(app);

        try {
            totalDeleted += await cleanupBeforeUpdate(app, plugin, db);
        } catch (e) {
            console.error('RSS: pre-update cleanup failed:', e);
        }

        for (let i = 0; i < total; i++) {
            if (!plugin.isUpdating || plugin.stopRequested) break;
            const feed = enabledFeeds[i];
            if (!feed) continue;

            plugin.setStatusBar(i + 1, total, feed.name || feed.url);
            const { saved, deleted } = await updateFeed(app, plugin, feed, db);
            totalSaved   += saved;
            totalDeleted += deleted;
        }

        if (plugin.isUpdating && !plugin.stopRequested) {
            const rssFolderPath = normalizePath(plugin.settings.folderPath);
            const allMdFiles = app.vault.getMarkdownFiles().filter(f => f.path.startsWith(rssFolderPath + '/'));
            const totalFiles = allMdFiles.length;
            const fileCache: FileMeta[] = [];

            for (let i = 0; i < totalFiles; i++) {
                if (!plugin.isUpdating || plugin.stopRequested) break;
                const f = allMdFiles[i]!;
                plugin.setStatusBarText(`⏳ Saving: ${i + 1}/${totalFiles}`, `Processing ${f.path}`);
                
                const link = await resolveLinkFromFile(app, app.vault, f);
                const pubDate = await readPubDateFromFrontmatter(app, app.vault, f);
                fileCache.push({ file: f, link, pubDate, deleted: false });
            }

            if (plugin.isUpdating && !plugin.stopRequested) {
                try {
                    plugin.setStatusBarText('⏳ Checking duplicates...');
                    totalDeleted += await tagDuplicatesInVault(app, plugin, fileCache);
                } catch (e) {
                    console.error('RSS: duplicate tagging failed:', e);
                }
                plugin.showSummary(totalSaved, totalDeleted);
            }
        }

        plugin.clearStatusBar();

    } finally {
        plugin.isUpdating = false;
        await releaseLock(app);
    }
}
