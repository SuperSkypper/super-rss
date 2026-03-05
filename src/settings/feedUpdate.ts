import { App, Notice, Vault, normalizePath } from 'obsidian';
import RssPlugin, { FeedConfig, PluginSettings, resolveFeedPath } from '../main';
import { fetchAndExtract, fetchYoutubeDuration, fetchFullContent } from './feedExtractor';
import { processItems } from './feedProcessor';
import { saveFeedItem, cleanupOldFiles } from './feedSaver';
import { loadFeedDatabase, saveFeedDatabase, registerDeleted, FeedDatabase } from './feedDatabase';
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

async function releaseLock(app: App): Promise<void> {
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

async function deleteLiveArticlesForFeed(app: App, feedPath: string, db: FeedDatabase): Promise<number> {
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

        let itemLink: string | null = cache?.frontmatter?.['link'] ?? null;
        if (!itemLink) {
            try {
                const content          = await vault.cachedRead(file);
                const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
                if (frontmatterMatch) {
                    for (const line of (frontmatterMatch[1] ?? '').split('\n')) {
                        const ci = line.indexOf(':');
                        if (ci === -1) continue;
                        if (line.slice(0, ci).trim().toLowerCase() === 'link') {
                            itemLink = line.slice(ci + 1).trim().replace(/^["']|["']$/g, '');
                            break;
                        }
                    }
                }
            } catch { /* ignore */ }
        }

        try {
            await vault.delete(file);
            deletedCount++;

            if (itemLink) {
                db[itemLink] = { link: itemLink, pubDate: '', status: 'deleted_cleanup' };
            }
        } catch (e) {
            console.error(`RSS: Failed to delete live article "${file.path}":`, e);
        }
    }

    return deletedCount;
}

// ── Update a single feed ──────────────────────────────────────────────────────

export async function updateFeed(
    app:      App,
    plugin:   RssPlugin,
    feed:     FeedConfig,
    db:       FeedDatabase,
): Promise<{ saved: number; deleted: number }> {
    let saved   = 0;
    let deleted = 0;
    try {
        const raw = await fetchAndExtract(feed.url);
        if (!raw || !raw.items) return { saved, deleted };

        const isYoutubeFeed = /youtube\.com|youtu\.be/.test(feed.url);

        // ── Fetch YouTube durations ───────────────────────────────────────────
        if (isYoutubeFeed) {
            await Promise.all(
                raw.items.map(async rawItem => {
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

        const items              = processItems(raw.items);
        const absoluteFolderPath = resolveFeedPath(feed, plugin.settings);

        // ── Upgrade YouTube thumbnails to highest available resolution ─────────
        // item.imageUrl is populated from the feed XML at this point (hqdefault).
        // extractImageUrl is skipped for YouTube feeds, so we call the upgrade
        // directly here — applies whether images are downloaded or just linked.
        if (isYoutubeFeed) {
            await Promise.all(
                items.map(async item => {
                    if (item.imageUrl) {
                        item.imageUrl = await upgradeYoutubeThumbnail(item.imageUrl);
                    }
                })
            );
        }

        for (const item of items) {
            if (!isYoutubeFeed) {
                // ── Fetch full content via Defuddle ───────────────────────────
                if (item.link) {
                    const full = await fetchFullContent(item.link);
                    if (full?.content) {
                        item.content = full.content;
                    }
                }

                // ── Fallback image extraction via OpenGraph ────────────────────
                // If the feed didn't include an image in the XML (no media:thumbnail,
                // enclosure, or <img> in content), fetch the article page and look
                // for og:image / twitter:image meta tags.
                // We pass {} as the raw object to skip XML-field steps and go
                // straight to the OpenGraph fallback (step 6 of extractImageUrl).
                if (!item.imageUrl && item.link) {
                    item.imageUrl = await extractImageUrl({}, item.link);
                }
            }

            const isSaved = await saveFeedItem(
                app.vault,
                app,
                item,
                absoluteFolderPath,
                plugin.settings,
                feed,
                db
            );
            if (isSaved) saved++;
        }

        if (saved > 0) {
            feed.lastUpdated = Date.now();
            await plugin.saveSettingsSilent();
            console.log(`RSS: Saved ${saved} new items for ${feed.name}`);
        }

        // ── Delete live articles ──────────────────────────────────────────────
        if (feed.deleteLives) {
            deleted += await deleteLiveArticlesForFeed(app, absoluteFolderPath, db);
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

        await saveFeedDatabase(app, db);

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

        const db = await loadFeedDatabase(app);

        for (let i = 0; i < total; i++) {
            if (!plugin.isUpdating) break;

            const feed = enabledFeeds[i];
            if (!feed) continue;

            plugin.setStatusBar(i + 1, total, feed.name || feed.url);

            const { saved, deleted } = await updateFeed(app, plugin, feed, db);
            totalSaved   += saved;
            totalDeleted += deleted;
        }

        // ── Global cleanup for feeds without per-feed override ────────────────
        if (plugin.isUpdating && plugin.settings.autoCleanupValue > 0) {
            try {
                const feedsWithoutOverride = enabledFeeds.filter(
                    f => f.autoCleanupValue == null || f.autoCleanupValue <= 0
                );
                for (const feed of feedsWithoutOverride) {
                    if (!plugin.isUpdating) break;

                    const feedPath = resolveFeedPath(feed, plugin.settings);
                    totalDeleted  += await cleanupOldFiles(
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
                await saveFeedDatabase(app, db);
            } catch (cleanupError) {
                console.error('Cleanup failed:', cleanupError);
            }
        }

        plugin.clearStatusBar();
        if (plugin.isUpdating) plugin.showSummary(totalSaved, totalDeleted);

    } finally {
        plugin.isUpdating = false;
        await releaseLock(app);
    }
}