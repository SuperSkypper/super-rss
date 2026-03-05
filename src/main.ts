import { Plugin, Notice, normalizePath } from 'obsidian';
import { RssSettingTab } from './settings';
import { AddUrlModal }   from './settings/feedAdd';
import { addFeed }       from './settings/feedAdd';
import { updateFeed, updateAllFeeds } from './settings/feedUpdate';
import { handleMarkAsRead, MARK_AS_READ_PROTOCOL } from './settings/feedMarkAsRead';

// ─── Types & defaults (extracted to keep main.ts lean) ───────────────────────
import { FeedConfig, PluginSettings, DEFAULT_SETTINGS } from './settings/settingsDefault';
export type { FeedItem, FeedConfig, FeedGroup, ImageLocation, PluginSettings } from './settings/settingsDefault';
export { DEFAULT_SETTINGS } from './settings/settingsDefault';

// --- 2. HELPERS ---

export function sanitizeFolderPath(path: string): string {
    return (path || DEFAULT_SETTINGS.folderPath)
        .trim()
        .replace(/\/+/g, '/')
        .replace(/\/$/, '')
        || DEFAULT_SETTINGS.folderPath;
}

export function resolveFeedPath(feed: FeedConfig, settings: PluginSettings): string {
    const root    = sanitizeFolderPath(settings.folderPath);
    const group   = feed.groupId ? settings.groups.find(g => g.id === feed.groupId) : null;
    const feedSub = (feed.folder || feed.name || 'Untitled').trim();

    if (group) {
        const groupSub = group.name.trim();
        return `${root}/${groupSub}/${feedSub}`;
    }
    return `${root}/${feedSub}`;
}

// --- 3. MAIN PLUGIN CLASS ---

export default class RssPlugin extends Plugin {
    settings!: PluginSettings;
    isUpdating: boolean = false;
    private intervalIds: number[] = [];
    private statusBarItem: HTMLElement | null = null;

    // Keep references so we can show/hide ribbon icons after saveSettings
    private ribbonUpdateEl: HTMLElement | null = null;
    private ribbonAddEl:    HTMLElement | null = null;

    async onload() {
        await this.loadSettings();

        this.addSettingTab(new RssSettingTab(this.app, this));

        this.statusBarItem = this.addStatusBarItem();
        this.statusBarItem.style.display = 'none';

        this.addCommand({
            id: 'update-rss-feeds',
            name: 'Update RSS feeds',
            callback: () => updateAllFeeds(this.app, this),
        });

        this.addCommand({
            id: 'add-rss-feed',
            name: 'Add RSS feed',
            callback: () => {
                new AddUrlModal(this.app, async (url: string) => {
                    await addFeed(this.app, this, url);
                }).open();
            },
        });

        // ── Ribbon: update all feeds ──────────────────────────────────────────
        this.ribbonUpdateEl = this.addRibbonIcon('rss', 'Update RSS feeds', () => {
            updateAllFeeds(this.app, this);
        });
        this.ribbonUpdateEl.style.display = this.settings.ribbonUpdate ? '' : 'none';

        // ── Ribbon: add a new feed ────────────────────────────────────────────
        this.ribbonAddEl = this.addRibbonIcon('circle-plus', 'Add RSS feed', () => {
            new AddUrlModal(this.app, async (url: string) => {
                await addFeed(this.app, this, url);
            }).open();
        });
        this.ribbonAddEl.style.display = this.settings.ribbonAdd ? '' : 'none';

        // ── Mark as Read URI handler ──────────────────────────────────────────
        this.registerObsidianProtocolHandler(MARK_AS_READ_PROTOCOL, (params) =>
            handleMarkAsRead(this.app, params)
        );

        this.setupAutoUpdate();

        // ── Remove DB entry when user manually deletes an RSS file ────────────
        // This allows the item to be re-fetched on the next update.
        this.registerEvent(
            this.app.vault.on('delete', async (file) => {
                if (!file.path.endsWith('.md')) return;

                const rssFolderPath = normalizePath(this.settings.folderPath);
                if (!file.path.startsWith(rssFolderPath + '/')) return;

                // Try to get the link from metadataCache before it's cleared
                const fm = this.app.metadataCache.getFileCache(file as any)?.frontmatter;
                let link: string | null = null;
                if (fm) {
                    const key = Object.keys(fm).find(k => k.toLowerCase() === 'link');
                    if (key && fm[key]) link = String(fm[key]).trim();
                }

                if (!link) return;

                const { loadFeedDatabase, saveFeedDatabase } = await import('./settings/feedDatabase');
                const db = await loadFeedDatabase(this.app);
                // Force overwrite — article may already be in DB as 'saved'
                db[link] = { link, pubDate: db[link]?.pubDate ?? '', status: 'deleted_manual' };
                await saveFeedDatabase(this.app, db);
                console.log(`RSS: marked as deleted_manual (link: ${link})`);
            })
        );
    }

    onunload() {
        this.intervalIds.forEach(id => window.clearInterval(id));
        this.intervalIds = [];
    }

    // ── Status bar (public so feedUpdate.ts can call) ─────────────────────────

    setStatusBar(current: number, total: number, feedName: string): void {
        if (this.settings.showStatusBar && this.statusBarItem) {
            this.statusBarItem.style.display = '';
            this.statusBarItem.setText(`RSS ${current}/${total}`);
            this.statusBarItem.title = `Updating feeds ${current}/${total}: ${feedName}`;
        }
    }

    clearStatusBar(): void {
        if (this.statusBarItem) {
            this.statusBarItem.style.display = 'none';
        }
    }

    // ── Summary notice (public so feedUpdate.ts can call) ─────────────────────

    showSummary(savedCount: number, deletedCount: number): void {
        if (savedCount === 0 && deletedCount === 0) {
            new Notice('No New RSS Items', 4000);
            return;
        }
        if (savedCount > 0) {
            new Notice(`${savedCount} RSS Item${savedCount !== 1 ? 's' : ''} Saved`, 4000);
        }
        if (deletedCount > 0) {
            new Notice(`${deletedCount} RSS Item${deletedCount !== 1 ? 's' : ''} Deleted`, 4000);
        }
    }

    // ── Ribbon visibility (called automatically by saveSettings) ──────────────

    applyRibbonVisibility(): void {
        if (this.ribbonUpdateEl) {
            this.ribbonUpdateEl.style.display = this.settings.ribbonUpdate ? '' : 'none';
        }
        if (this.ribbonAddEl) {
            this.ribbonAddEl.style.display = this.settings.ribbonAdd ? '' : 'none';
        }
    }

    // ── Interval ──────────────────────────────────────────────────────────────

    private getIntervalMs(): number {
        const value  = this.settings.updateIntervalValue ?? 30;
        const unit   = this.settings.updateIntervalUnit ?? 'minutes';
        const minute = 60 * 1000;
        const hour   = minute * 60;
        const day    = hour * 24;
        const month  = day * 30;
        switch (unit) {
            case 'minutes': return value * minute;
            case 'hours':   return value * hour;
            case 'days':    return value * day;
            case 'months':  return value * month;
            default:        return value * minute;
        }
    }

    setupAutoUpdate() {
        this.intervalIds.forEach(id => window.clearInterval(id));
        this.intervalIds = [];

        if (!this.settings.pluginEnabled) return;

        const intervalMs = this.getIntervalMs();
        if (intervalMs >= 60000) {
            const id = window.setInterval(() => updateAllFeeds(this.app, this), intervalMs);
            this.intervalIds.push(id);
        }
    }

    // ── Silent save (public so feedUpdate.ts can call) ────────────────────────

    async saveSettingsSilent(): Promise<void> {
        this.settings.folderPath = sanitizeFolderPath(this.settings.folderPath);
        await this.saveData(this.settings);
    }

    // ── Public update delegates ───────────────────────────────────────────────

    async stopUpdate(): Promise<void> {
        if (!this.isUpdating) return;
        this.isUpdating = false;
        this.clearStatusBar();
        new Notice('RSS: Update stopped.', 3000);
    }

    async updateFeed(feed: FeedConfig) {
        const { loadFeedDatabase, saveFeedDatabase } = await import('./settings/feedDatabase');
        const db = await loadFeedDatabase(this.app);
        const result = await updateFeed(this.app, this, feed, db);
        await saveFeedDatabase(this.app, db);
        return result;
    }

    async updateAllFeeds() {
        return updateAllFeeds(this.app, this);
    }

    // ── Settings ──────────────────────────────────────────────────────────────

    async loadSettings() {
        const loadedData = await this.loadData();
        this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);
        this.settings.folderPath = sanitizeFolderPath(this.settings.folderPath);

        if (!this.settings.groups) this.settings.groups = [];

        this.settings.feeds.forEach(f => {
            if (!f.previousName) f.previousName = (f.name || '').trim();
        });
        if (this.settings.pluginEnabled === undefined)            this.settings.pluginEnabled = false;
        if (this.settings.tagShortsGlobal === undefined)          this.settings.tagShortsGlobal = false;
        if (this.settings.skipShortsGlobal === undefined)         this.settings.skipShortsGlobal = false;
        if (this.settings.tagLiveGlobal === undefined)            this.settings.tagLiveGlobal = false;
        if (this.settings.tagLiveKeywords === undefined)          this.settings.tagLiveKeywords = DEFAULT_SETTINGS.tagLiveKeywords;
        if (this.settings.devMode === undefined)                  this.settings.devMode = false;
        if (this.settings.fileNameTemplate === undefined)         this.settings.fileNameTemplate = DEFAULT_SETTINGS.fileNameTemplate;
        if (this.settings.autoCleanupCheckProperty === undefined) this.settings.autoCleanupCheckProperty = false;
        if (this.settings.showProgressNotice === undefined)       this.settings.showProgressNotice = true;
        if (this.settings.showStatusBar === undefined)            this.settings.showStatusBar = true;
        if (this.settings.ribbonUpdate === undefined)             this.settings.ribbonUpdate = true;
        if (this.settings.ribbonAdd === undefined)                this.settings.ribbonAdd = true;
        if (this.settings.markAsReadEnabled === undefined)            this.settings.markAsReadEnabled = true;
        if (this.settings.markAsReadLinkProperty === undefined)       this.settings.markAsReadLinkProperty = DEFAULT_SETTINGS.markAsReadLinkProperty;
        if (this.settings.markAsReadCheckboxProperty === undefined)   this.settings.markAsReadCheckboxProperty = DEFAULT_SETTINGS.markAsReadCheckboxProperty;
    }

    async saveSettings() {
        this.settings.folderPath = sanitizeFolderPath(this.settings.folderPath);
        await this.renameFeedFoldersIfNeeded();
        await this.saveData(this.settings);
        this.setupAutoUpdate();
        this.applyRibbonVisibility();
    }

    // ── Folder rename on feed name change ─────────────────────────────────────

    private async renameFeedFoldersIfNeeded(): Promise<void> {
        for (const feed of this.settings.feeds) {
            const oldName = (feed.previousName || '').trim();
            const newName = (feed.name || '').trim();

            if (!oldName || oldName === newName || feed.folder) {
                feed.previousName = newName;
                continue;
            }

            const group    = feed.groupId ? this.settings.groups.find(g => g.id === feed.groupId) : null;
            const root     = sanitizeFolderPath(this.settings.folderPath);
            const groupSub = group ? group.name.trim() : null;

            const oldPath = groupSub ? `${root}/${groupSub}/${oldName}` : `${root}/${oldName}`;
            const newPath = groupSub ? `${root}/${groupSub}/${newName}` : `${root}/${newName}`;

            const oldNorm = normalizePath(oldPath);
            const newNorm = normalizePath(newPath);

            const existingFolder = this.app.vault.getAbstractFileByPath(oldNorm);
            if (existingFolder) {
                try {
                    await this.app.vault.rename(existingFolder, newNorm);
                    console.log(`RSS: Renamed folder "${oldNorm}" → "${newNorm}"`);
                } catch (e) {
                    console.error(`RSS: Failed to rename folder "${oldNorm}" → "${newNorm}"`, e);
                }
            }

            feed.previousName = newName;
        }
    }
}