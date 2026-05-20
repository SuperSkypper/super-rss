import { Plugin, Notice, normalizePath } from 'obsidian';

// ─── Types & defaults (extracted to keep main.ts lean) ───────────────────────
import { DEFAULT_SETTINGS } from './settings/settingsDefault';
import type { FeedConfig, PluginSettings } from './settings/settingsDefault';
import { migrateLegacyFrontmatterTemplate } from './settings/frontmatterMigration';
export type { FeedItem, FeedConfig, FeedGroup, FrontmatterMode, FrontmatterPropertyTemplate, FrontmatterPropertyType, ImageLocation, DeleteBehavior, PluginSettings } from './settings/settingsDefault';
export { DEFAULT_SETTINGS } from './settings/settingsDefault';

const MARK_AS_READ_PROTOCOL = 'rss-mark-as-read';

// --- 2. HELPERS ---

export function sanitizeFolderPath(path: string): string {
    return (path || DEFAULT_SETTINGS.folderPath)
        .trim()
        .replace(/\/+/g, '/')
        .replace(/\/$/, '')
        || DEFAULT_SETTINGS.folderPath;
}

export function resolveFeedPath(feed: FeedConfig, settings: PluginSettings): string {
    const root = sanitizeFolderPath(settings.folderPath);
    const group = feed.groupId ? settings.groups.find(g => g.id === feed.groupId) : null;
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
    stopRequested: boolean = false;
    private intervalIds: number[] = [];
    private statusBarItem: HTMLElement | null = null;
    private currentUpdatePromise: Promise<void> | null = null;

    // Keep references so we can show/hide ribbon icons after saveSettings
    private ribbonUpdateEl: HTMLElement | null = null;
    private ribbonAddEl: HTMLElement | null = null;

    async onload() {
        await this.loadSettings();

        this.statusBarItem = this.addStatusBarItem();
        this.statusBarItem.style.display = 'none';

        this.addCommand({
            id: 'update-rss-feeds',
            name: 'Update RSS feeds',
            callback: () => {
                void this.updateAllFeeds();
            },
        });

        this.addCommand({
            id: 'add-rss-feed',
            name: 'Add RSS feed',
            callback: () => {
                void this.openAddFeedModal();
            },
        });

        // ── Ribbon: update all feeds ──────────────────────────────────────────
        this.ribbonUpdateEl = this.addRibbonIcon('rss', 'Update RSS feeds', () => {
            void this.updateAllFeeds();
        });
        this.ribbonUpdateEl.style.display = this.settings.ribbonUpdate ? '' : 'none';

        // ── Ribbon: add a new feed ────────────────────────────────────────────
        this.ribbonAddEl = this.addRibbonIcon('circle-plus', 'Add RSS feed', () => {
            void this.openAddFeedModal();
        });
        this.ribbonAddEl.style.display = this.settings.ribbonAdd ? '' : 'none';

        // ── Mark as Read URI handler ──────────────────────────────────────────
        this.registerObsidianProtocolHandler(MARK_AS_READ_PROTOCOL, (params) => {
            void this.handleMarkAsRead(params);
        });

        this.setupAutoUpdate();
        this.app.workspace.onLayoutReady(() => {
            void this.loadDeferredStartup();
        });


    }

    onunload() {
        this.intervalIds.forEach(id => window.clearInterval(id));
        this.intervalIds = [];
    }

    // ── Status bar (public so feedUpdate.ts can call) ─────────────────────────

    setStatusBar(current: number, total: number, feedName: string): void {
        if (this.settings.showStatusBar && this.statusBarItem) {
            this.statusBarItem.style.display = '';
            this.statusBarItem.setText(`Saving RSS: ${current}/${total}`);
            this.statusBarItem.title = `Updating feeds ${current}/${total}: ${feedName}`;
        }
    }

    clearStatusBar(): void {
        if (this.statusBarItem) {
            this.statusBarItem.style.display = 'none';
        }
    }

    setStatusBarText(text: string, tooltip?: string): void {
        if (this.settings.showStatusBar && this.statusBarItem) {
            this.statusBarItem.style.display = '';
            this.statusBarItem.setText(text);
            this.statusBarItem.title = tooltip ?? text;
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
        const value = this.settings.updateIntervalValue ?? 30;
        const unit = this.settings.updateIntervalUnit ?? 'minutes';
        const minute = 60 * 1000;
        const hour = minute * 60;
        const day = hour * 24;
        const month = day * 30;
        switch (unit) {
            case 'minutes': return value * minute;
            case 'hours': return value * hour;
            case 'days': return value * day;
            case 'months': return value * month;
            default: return value * minute;
        }
    }

    setupAutoUpdate() {
        this.intervalIds.forEach(id => window.clearInterval(id));
        this.intervalIds = [];

        if (!this.settings.pluginEnabled) return;

        const intervalMs = this.getIntervalMs();
        if (intervalMs >= 60000) {
            const id = window.setInterval(() => {
                void this.updateAllFeeds();
            }, intervalMs);
            this.intervalIds.push(id);
        }
    }

    // ── Silent save (public so feedUpdate.ts can call) ────────────────────────

    async saveSettingsSilent(): Promise<void> {
        this.settings.folderPath = sanitizeFolderPath(this.settings.folderPath);
        await this.saveData(this.settings);
    }

    // ── Public update delegates ───────────────────────────────────────────────

    private async loadDeferredStartup(): Promise<void> {
        try {
            const [{ RssSettingTab }, { migrateAndPurgeDatabase }] = await Promise.all([
                import('./settings'),
                import('./settings/feedDatabase'),
            ]);

            this.addSettingTab(new RssSettingTab(this.app, this));
            await migrateAndPurgeDatabase(this.app);
        } catch (e) {
            console.error('RSS: Failed to finish deferred startup work', e);
        }
    }

    private async openAddFeedModal(): Promise<void> {
        const { AddUrlModal, addFeed } = await import('./settings/feedAdd');
        new AddUrlModal(this.app, async (url: string) => {
            await addFeed(this.app, this, url);
        }).open();
    }

    private async handleMarkAsRead(params: Record<string, string>): Promise<void> {
        try {
            const { handleMarkAsRead } = await import('./settings/feedMarkAsRead');
            await handleMarkAsRead(this.app, params);
        } catch (e) {
            console.error('RSS: Failed to mark item as read', e);
            new Notice('RSS: Failed to mark item as read.', 4000);
        }
    }

    async stopUpdate(): Promise<void> {
        if (!this.currentUpdatePromise) return;
        this.stopRequested = true;
        this.isUpdating = false;
        this.setStatusBarText('Stopping RSS update...', 'Waiting for the current network or file operation to finish.');

        try {
            await this.currentUpdatePromise;
        } finally {
            this.clearStatusBar();
        }

        new Notice('RSS: Update stopped.', 3000);
    }

    private runTrackedUpdate(): Promise<void> {
        if (this.currentUpdatePromise) return this.currentUpdatePromise;

        this.stopRequested = false;
        const promise = (async () => {
            const { updateAllFeeds } = await import('./settings/feedUpdate');
            await updateAllFeeds(this.app, this);
        })().finally(() => {
            if (this.currentUpdatePromise === promise) {
                this.currentUpdatePromise = null;
            }
            this.stopRequested = false;
        });

        this.currentUpdatePromise = promise;
        return promise;
    }

    async updateFeed(feed: FeedConfig) {
        const [{ loadAutoDatabase, saveAutoDatabase }, { updateFeed }] = await Promise.all([
            import('./settings/feedDatabase'),
            import('./settings/feedUpdate'),
        ]);
        const db = await loadAutoDatabase(this.app);
        const result = await updateFeed(this.app, this, feed, db);
        await saveAutoDatabase(this.app, db);
        return result;
    }

    async updateAllFeeds() {
        return this.runTrackedUpdate();
    }

    // ── Settings ──────────────────────────────────────────────────────────────

    async loadSettings() {
        const loadedData = await this.loadData();
        this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);
        this.settings.folderPath = sanitizeFolderPath(this.settings.folderPath);
        const loadedSettings = (loadedData ?? {}) as Partial<PluginSettings>;

        if (!this.settings.groups) this.settings.groups = [];

        this.settings.feeds.forEach(f => {
            if (!f.previousName) f.previousName = (f.name || '').trim();
        });
        if (this.settings.pluginEnabled === undefined) this.settings.pluginEnabled = false;
        if (this.settings.tagShortsGlobal === undefined) this.settings.tagShortsGlobal = false;
        if (this.settings.skipShortsGlobal === undefined) this.settings.skipShortsGlobal = false;
        if (this.settings.tagLiveGlobal === undefined) this.settings.tagLiveGlobal = false;
        if (this.settings.tagLiveKeywords === undefined) this.settings.tagLiveKeywords = DEFAULT_SETTINGS.tagLiveKeywords;
        if (this.settings.devMode === undefined) this.settings.devMode = false;
        if (this.settings.fileNameTemplate === undefined) this.settings.fileNameTemplate = DEFAULT_SETTINGS.fileNameTemplate;
        if (this.settings.frontmatterMode !== 'source' && this.settings.frontmatterMode !== 'properties') {
            this.settings.frontmatterMode = 'properties';
        }
        if (Array.isArray(loadedSettings.frontmatterProperties)) {
            this.settings.frontmatterProperties = loadedSettings.frontmatterProperties.map(p => ({ ...p }));
        } else if (typeof loadedSettings.frontmatterTemplate === 'string' && loadedSettings.frontmatterTemplate.trim()) {
            this.settings.frontmatterProperties = migrateLegacyFrontmatterTemplate(loadedSettings.frontmatterTemplate) ?? [];
            if (this.settings.frontmatterProperties.length === 0) {
                this.settings.frontmatterMode = 'source';
            }
        } else {
            this.settings.frontmatterProperties = DEFAULT_SETTINGS.frontmatterProperties.map(p => ({ ...p }));
        }
        if (this.settings.autoCleanupCheckProperty === undefined) this.settings.autoCleanupCheckProperty = false;
        if (this.settings.showProgressNotice === undefined) this.settings.showProgressNotice = true;
        if (this.settings.showStatusBar === undefined) this.settings.showStatusBar = true;
        if (this.settings.ribbonUpdate === undefined) this.settings.ribbonUpdate = true;
        if (this.settings.ribbonAdd === undefined) this.settings.ribbonAdd = true;
        if (this.settings.markAsReadEnabled === undefined) this.settings.markAsReadEnabled = true;
        if (this.settings.markAsReadLinkProperty === undefined) this.settings.markAsReadLinkProperty = DEFAULT_SETTINGS.markAsReadLinkProperty;
        if (this.settings.markAsReadCheckboxProperty === undefined) this.settings.markAsReadCheckboxProperty = DEFAULT_SETTINGS.markAsReadCheckboxProperty;
        if (this.settings.markAsReadDeleteArticles === undefined) this.settings.markAsReadDeleteArticles = false;
        if (this.settings.deleteBehavior === undefined) this.settings.deleteBehavior = DEFAULT_SETTINGS.deleteBehavior;
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

            const group = feed.groupId ? this.settings.groups.find(g => g.id === feed.groupId) : null;
            const root = sanitizeFolderPath(this.settings.folderPath);
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
