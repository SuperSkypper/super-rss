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

function parsePubDate(date?: string): number | null {
    if (!date) return null;
    const ts = Date.parse(date);
    return Number.isFinite(ts) ? ts : null;
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

// ── Delete live articles for a feed ──────────────────────────────────────────

// deleteLiveArticlesForFeed is imported from feedDelete.ts

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

        // ── Early filter by lastUpdated ────────────────────────────────────────
        const lastUpdatedBoundary = typeof feed.lastUpdated === 'number' ? feed.lastUpdated : null;
        const filteredRawItems = lastUpdatedBoundary !== null
            ? raw.items.filter(item => {
                const itemPubTime = parsePubDate(item.pubDate);
                return itemPubTime === null || itemPubTime > lastUpdatedBoundary;
            })
            : raw.items;

        // ── Fetch YouTube durations only for filtered items ───────────────────
        if (isYoutubeFeed && filteredRawItems.length > 0) {
            // Limit concurrency to avoid overwhelming the network
            const BATCH_SIZE = 5;
            for (let i = 0; i < filteredRawItems.length; i += BATCH_SIZE) {
                const batch = filteredRawItems.slice(i, i + BATCH_SIZE);
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
        }

        // ── Upgrade YouTube thumbnails on filtered raw items ──────────────────
        if (isYoutubeFeed && filteredRawItems.length > 0) {
            await Promise.all(
                filteredRawItems.map(async rawItem => {
                    if (rawItem.imageUrl) {
                        rawItem.imageUrl = await upgradeYoutubeThumbnail(rawItem.imageUrl);
                    }
                })
            );
        }

        const items              = processItems(filteredRawItems);
        const absoluteFolderPath = resolveFeedPath(feed, plugin.settings);

        // ── Load userDb once per feed update ───────────────────────────────────
        const userDb = await loadUserDatabase(app);

        for (const item of items) {
            if (!isYoutubeFeed) {
                // Skip network-heavy steps for items already in the blacklist DB —
                // saveFeedItem will discard them anyway, so Defuddle/OG fetches
                // would be wasted I/O. Items not in the DB still need the vault
                // existence check, but that happens inside saveFeedItem.
                const isBlacklisted = !!item.link && isKnown(db, item.link);

                if (!isBlacklisted) {
                    // Skip network-heavy steps if the file already exists in the vault —
                    // saveFeedItem will block it anyway via the vault dedup check.
                    const fileNameTemplate = feed.titleTemplate || plugin.settings.fileNameTemplate || '{{title}}';
                    const rawFileName      = applyTemplate(fileNameTemplate, item, true, false, feed.name || '');
                    const fileName         = sanitizeFileName(rawFileName) + '.md';
                    const filePath         = normalizePath(`${absoluteFolderPath}/${fileName}`);
                    const fileExists       = await app.vault.adapter.exists(filePath);

                    if (!fileExists) {
                        // ── Fetch full content via Defuddle ───────────────────────────
                        // defuddle/full always returns clean Markdown — no HTML pipeline needed.
                        if (item.link) {
                            const full = await fetchFullContent(item.link);
                            if (full?.content) {
                                item.content = full.content;
                            }
                        }

                        // ── Fallback image extraction via OpenGraph ────────────────────
                        // If the feed XML had no image, fetch og:image / twitter:image from the page.
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
            if (isSaved) saved++;
        }

        feed.lastUpdated = Date.now();
        await plugin.saveSettingsSilent();
        if (saved > 0) {
            console.log(`RSS: Saved ${saved} new items for ${feed.name}`);
        }

        // ── Delete live articles ──────────────────────────────────────────────
        if (feed.deleteLives) {
            deleted += await deleteLiveArticlesForFeed(app, absoluteFolderPath, db);
            // Save immediately — deleteLiveArticlesForFeed mutates db in place
            // but doesn't save. If cleanupOldFiles throws below, these entries
            // would be lost without this save.
            if (deleted > 0) await saveAutoDatabase(app, db);
        }

        // ── Cleanup old files ─────────────────────────────────────────────────
        const cleanupValue     = feed.autoCleanupValue ?? plugin.settings.autoCleanupValue;
        const cleanupUnit      = feed.autoCleanupUnit  ?? plugin.settings.autoCleanupUnit;
        const feedDateField    = feed.autoCleanupDateField;
        const cleanupDateField = (!feedDateField || feedDateField === 'global')
            ? plugin.settings.autoCleanupDateField
            : feedDateField;

        if (feed.autoCleanupValue != null && feed.autoCleanupValue > 0) {
            deleted += await cleanupOldFiles(
                app.vault,
                app,
                absoluteFolderPath,
                cleanupValue,
                cleanupUnit,
                cleanupDateField,
                plugin.settings,
                db
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
        new Notice('Plugin is disabled. Enable it in General settings first.', 4000);
        return;
    }

    if (plugin.isUpdating) return;

    const lockAcquired = await acquireLock(app);
    if (!lockAcquired) {
        new Notice('RSS: Another instance is already updating. Skipping.', 4000);
        return;
    }

    plugin.isUpdating = true;

    try {
        const enabledFeeds = plugin.settings.feeds.filter(f => f.enabled && f.url && !f.deleted);

        if (enabledFeeds.length === 0) {
            new Notice('No active feeds to update.');
            return;
        }

        const total = enabledFeeds.length;

        if (plugin.settings.showProgressNotice) {
            new Notice(`Updating ${total} feed${total !== 1 ? 's' : ''}...`, 3000);
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

        // ── Global cleanup + orphan pass ─────────────────────────────────────
        if (plugin.isUpdating) {
            try {
                totalDeleted += await runAutoCleanup(app, plugin, db);
            } catch (cleanupError) {
                console.error('RSS: auto cleanup failed:', cleanupError);
            }
        }

        plugin.clearStatusBar();

        // ── Tag duplicates retroactively ──────────────────────────────────────
        if (plugin.isUpdating) {
            try {
                await tagDuplicatesInVault(app, plugin);
            } catch (e) {
                console.error('RSS: tagDuplicatesInVault failed:', e);
            }
        }

        if (plugin.isUpdating) plugin.showSummary(totalSaved, totalDeleted);

    } finally {
        plugin.isUpdating = false;
        await releaseLock(app);
    }
}