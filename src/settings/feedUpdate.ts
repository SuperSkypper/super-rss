import { App, Notice, normalizePath } from 'obsidian';
import RssPlugin, { FeedConfig, resolveFeedPath } from '../main';
import { fetchAndExtract, fetchYoutubeDuration, fetchFullContent } from './feedExtractor';
import { processItems, sanitizeFileName } from './feedProcessor';
import { saveFeedItem, applyTemplate } from './feedSaver';
import { cleanupOldFiles, deleteLiveArticlesForFeed, runAutoCleanup } from './feedDelete';
import { loadAutoDatabase, saveAutoDatabase, loadUserDatabase, isKnown, AutoDatabase } from './feedDatabase';
import { tagDuplicatesInVault } from './feedDuplicate';
import { extractImageUrl, upgradeYoutubeThumbnail } from './imageHandler';

// ── Update lockfile ───────────────────────────────────────────────────────────

const PLUGIN_ID   = 'super-rss';
const LOCK_FILE   = 'update.lock';
const LOCK_TTL_MS = 5 * 60 * 1000;

interface LockData {
    instanceId: string;
    startedAt:  number;
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
                        const link =
                            typeof rawItem.link === 'string'
                                ? rawItem.link
                                : (rawItem.link as any)?.$?.href ?? '';
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
                        if (item.link) {
                            const full = await fetchFullContent(item.link);
                            if (full?.content) item.content = full.content;
                        }
                        if (!item.imageUrl && item.link) {
                            item.imageUrl = await extractImageUrl({}, item.link);
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
            console.log(`RSS: Saved ${saved} new items for ${feed.name}`);
        }

        if (feed.deleteLives) {
            deleted += await deleteLiveArticlesForFeed(app, absoluteFolderPath, db);
            if (deleted > 0) await saveAutoDatabase(app, db);
        }

        const cleanupValue     = feed.autoCleanupValue ?? plugin.settings.autoCleanupValue;
        const cleanupUnit      = feed.autoCleanupUnit  ?? plugin.settings.autoCleanupUnit;
        const feedDateField    = feed.autoCleanupDateField;
        const cleanupDateField = (!feedDateField || feedDateField === 'global')
            ? plugin.settings.autoCleanupDateField
            : feedDateField;

        if (cleanupValue != null && cleanupValue > 0) {
            deleted += await cleanupOldFiles(
                app.vault, app, absoluteFolderPath,
                cleanupValue, cleanupUnit, cleanupDateField,
                plugin.settings, db
            );
        }

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
    if (!plugin.settings.pluginEnabled) {
        new Notice('Plugin is disabled.', 4000);
        return;
    }

    if (plugin.isUpdating) return;

    const lockAcquired = await acquireLock(app);
    if (!lockAcquired) {
        new Notice('RSS: Update already in progress.', 4000);
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

        for (let i = 0; i < total; i++) {
            if (!plugin.isUpdating) break;
            const feed = enabledFeeds[i];
            if (!feed) continue;

            plugin.setStatusBar(i + 1, total, feed.name || feed.url);
            const { saved, deleted } = await updateFeed(app, plugin, feed, db);
            totalSaved   += saved;
            totalDeleted += deleted;
        }

        if (plugin.isUpdating) {
            try {
                totalDeleted += await runAutoCleanup(app, plugin, db);
            } catch (e) {
                console.error('RSS: cleanup failed:', e);
            }
            try {
                await tagDuplicatesInVault(app, plugin);
            } catch (e) {
                console.error('RSS: duplicate tagging failed:', e);
            }
            plugin.showSummary(totalSaved, totalDeleted);
        }

        plugin.clearStatusBar();

    } finally {
        plugin.isUpdating = false;
        await releaseLock(app);
    }
}