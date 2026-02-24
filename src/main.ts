import { Plugin, Notice } from 'obsidian';
import { fetchAndExtract } from './services/feedExtractor';
import { processItems } from './services/feedProcessor';
import { saveFeedItem, cleanupOldFiles } from './services/fileSaver';
import { RssSettingTab } from './settings';

// --- 1. INTERFACES & DEFAULTS ---

export interface FeedItem {
    title: string;
    link: string;
    content: string;
    description: string;
    descriptionShort: string;
    author: string;
    pubDate: string;
    imageUrl: string;
    categories: string[];
}

export interface FeedConfig {
    name: string;
    url: string;
    folder: string;
    enabled: boolean;
    lastUpdated?: number;
    archived?: boolean;
    deleted?: boolean;
    deletedAt?: number;
    groupId?: string;
    titleTemplate?: string;
    frontmatterTemplate?: string;
    contentTemplate?: string;
    updateIntervalValue?: number;
    updateIntervalUnit?: 'minutes' | 'hours' | 'days' | 'months';
    autoCleanupValue?: number;
    autoCleanupUnit?: 'minutes' | 'hours' | 'days' | 'months';
    autoCleanupDateField?: 'global' | 'datepub' | 'datesaved';
}

export interface FeedGroup {
    id: string;
    name: string;
    collapsed?: boolean;
}

export type ImageLocation = 'obsidian' | 'vault' | 'current' | 'subfolder' | 'specified';

export interface PluginSettings {
    folderPath: string;
    template: string;
    frontmatterTemplate: string;
    fileNameTemplate: string;
    updateIntervalValue: number;
    updateIntervalUnit: 'minutes' | 'hours' | 'days' | 'months';
    autoCleanupValue: number;
    autoCleanupUnit: 'minutes' | 'hours' | 'days' | 'months';
    autoCleanupDateField: 'datepub' | 'datesaved';
    autoCleanupCheckProperty: boolean;
    autoCleanupCheckPropertyName: string;
    feeds: FeedConfig[];
    groups: FeedGroup[];
    downloadImages: boolean;
    imageLocation: ImageLocation;
    imagesFolder: string;
    useFeedFolder: boolean;
}

export const DEFAULT_SETTINGS: PluginSettings = {
    folderPath: 'RSS',
    fileNameTemplate: '{{title}}',
    frontmatterTemplate: `Title: {{title}}
Created Date: {{datesaved}}
Upload Date: {{datepub}}
Image: {{image}}
Link: {{link}}
Author: {{author}}`,
    template: `# {{title}}

{{content}}`,
    updateIntervalValue: 30,
    updateIntervalUnit: 'minutes',
    autoCleanupValue: 0,
    autoCleanupUnit: 'days',
    autoCleanupDateField: 'datesaved',
    autoCleanupCheckProperty: false,
    autoCleanupCheckPropertyName: 'Mark as Read',
    feeds: [],
    groups: [],
    downloadImages: false,
    imageLocation: 'obsidian',
    imagesFolder: 'attachments',
    useFeedFolder: true,
};

// --- 2. HELPERS ---

export function sanitizeFolderPath(path: string): string {
    return (path || DEFAULT_SETTINGS.folderPath)
        .trim()
        .replace(/\/+/g, '/')
        .replace(/\/$/, '')
        || DEFAULT_SETTINGS.folderPath;
}

// Resolves the absolute vault path for a feed, taking group into account:
// - Feed in group, no custom folder   → RSS/GroupName/
// - Feed in group, with custom folder → RSS/GroupName/CustomFolder/
// - Feed loose, no custom folder      → RSS/FeedName/
// - Feed loose, with custom folder    → RSS/CustomFolder/
export function resolveFeedPath(feed: FeedConfig, settings: PluginSettings): string {
    const root    = sanitizeFolderPath(settings.folderPath);
    const group   = feed.groupId ? settings.groups.find(g => g.id === feed.groupId) : null;
    const feedSub = (feed.folder || feed.name || 'Untitled').trim();

    if (group) {
        const groupSub = group.name.trim();
        // Always creates a subfolder for the feed inside the group:
        // RSS/GroupName/FeedName/ or RSS/GroupName/CustomFolder/
        return `${root}/${groupSub}/${feedSub}`;
    }
    return `${root}/${feedSub}`;
}

// --- 3. MAIN PLUGIN CLASS ---

export default class RssPlugin extends Plugin {
    settings: PluginSettings;
    private intervalIds: number[] = [];
    private isUpdating: boolean = false;

    async onload() {
        await this.loadSettings();
        this.addSettingTab(new RssSettingTab(this.app, this));
        this.addCommand({
            id: 'update-rss-feeds',
            name: 'Update RSS feeds',
            callback: () => this.updateAllFeeds(),
        });
        this.addRibbonIcon('rss', 'Update RSS feeds', () => {
            this.updateAllFeeds();
        });
        this.setupAutoUpdate();
    }

    onunload() {
        this.intervalIds.forEach(id => window.clearInterval(id));
        this.intervalIds = [];
    }

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

        const intervalMs = this.getIntervalMs();
        if (intervalMs >= 60000) {
            const id = window.setInterval(() => this.updateAllFeeds(), intervalMs);
            this.intervalIds.push(id);
        }
    }

    private async saveSettingsSilent(): Promise<void> {
        this.settings.folderPath = sanitizeFolderPath(this.settings.folderPath);
        await this.saveData(this.settings);
    }

    async updateAllFeeds() {
        if (this.isUpdating) return;
        this.isUpdating = true;

        try {
            const enabledFeeds = this.settings.feeds.filter(f => f.enabled && f.url && !f.deleted);

            if (enabledFeeds.length === 0) {
                new Notice('No active feeds to update.');
                return;
            }

            new Notice('Updating RSS feeds...');

            for (const feed of enabledFeeds) {
                try {
                    const raw = await fetchAndExtract(feed.url);
                    if (!raw || !raw.items) continue;

                    const items              = await processItems(raw.items);
                    const absoluteFolderPath = resolveFeedPath(feed, this.settings);

                    let newItemsCount = 0;

                    for (const item of items) {
                        const isSaved = await saveFeedItem(
                            this.app.vault,
                            this.app,
                            item,
                            absoluteFolderPath,
                            this.settings,
                            feed
                        );
                        if (isSaved) newItemsCount++;
                    }

                    if (newItemsCount > 0) {
                        feed.lastUpdated = Date.now();
                        await this.saveSettingsSilent();
                        console.log(`RSS: Saved ${newItemsCount} new items for ${feed.name}`);
                    }

                    // Per-feed cleanup
                    const cleanupValue     = feed.autoCleanupValue ?? this.settings.autoCleanupValue;
                    const cleanupUnit      = feed.autoCleanupUnit  ?? this.settings.autoCleanupUnit;
                    const feedDateField    = feed.autoCleanupDateField;
                    const cleanupDateField = (!feedDateField || feedDateField === 'global')
                        ? this.settings.autoCleanupDateField
                        : feedDateField;

                    if (cleanupValue > 0) {
                        await cleanupOldFiles(
                            this.app.vault,
                            absoluteFolderPath,
                            cleanupValue,
                            cleanupUnit,
                            cleanupDateField,
                            this.settings
                        );
                    }

                } catch (error) {
                    console.error(`RSS Error [${feed.name || feed.url}]:`, error);
                }
            }

            // Global cleanup
            if (this.settings.autoCleanupValue > 0) {
                try {
                    await cleanupOldFiles(
                        this.app.vault,
                        sanitizeFolderPath(this.settings.folderPath),
                        this.settings.autoCleanupValue,
                        this.settings.autoCleanupUnit,
                        this.settings.autoCleanupDateField,
                        this.settings
                    );
                } catch (cleanupError) {
                    console.error('Cleanup failed:', cleanupError);
                }
            }

            new Notice('RSS Update complete!');

        } finally {
            this.isUpdating = false;
        }
    }

    async loadSettings() {
        const loadedData = await this.loadData();
        this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);
        this.settings.folderPath = sanitizeFolderPath(this.settings.folderPath);
        if (!this.settings.groups) this.settings.groups = [];
    }

    async saveSettings() {
        this.settings.folderPath = sanitizeFolderPath(this.settings.folderPath);
        await this.saveData(this.settings);
        this.setupAutoUpdate();
    }
}