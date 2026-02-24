import { Plugin, Notice, App } from 'obsidian';
import { fetchAndExtract } from './services/feedExtractor';
import { processItems } from './services/feedProcessor';
import { saveFeedItem, cleanupOldFiles } from './services/FileSaver';
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
    titleTemplate?: string;
    frontmatterTemplate?: string;
    contentTemplate?: string;
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
    feeds: FeedConfig[];
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
    updateIntervalValue: 60,
    updateIntervalUnit: 'minutes',
    autoCleanupValue: 0,
    autoCleanupUnit: 'days',
    feeds: [],
    downloadImages: false,
    imageLocation: 'obsidian',
    imagesFolder: 'attachments',
    useFeedFolder: true,
};

// --- 2. MAIN PLUGIN CLASS ---

export default class RssPlugin extends Plugin {
    settings: PluginSettings;
    updateInterval: number | null = null;

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

    private getIntervalMs(): number {
        const value = this.settings.updateIntervalValue ?? 60;
        const unit = this.settings.updateIntervalUnit ?? 'minutes';
        
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
        if (this.updateInterval) {
            window.clearInterval(this.updateInterval);
        }

        const intervalMs = this.getIntervalMs();

        if (intervalMs >= 60000) {
            this.updateInterval = window.setInterval(
                () => this.updateAllFeeds(),
                intervalMs
            );
            this.registerInterval(this.updateInterval);
        }
    }

    async updateAllFeeds() {
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

                const items = await processItems(raw.items);

                const subFolderName      = (feed.folder || feed.name || 'Untitled').trim();
                const rootFolder         = this.settings.folderPath || 'RSS';
                const absoluteFolderPath = `${rootFolder}/${subFolderName}`.replace(/\/+$/g, '');

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
                    await this.saveSettings();
                    console.log(`RSS: Saved ${newItemsCount} new items for ${feed.name}`);
                }

            } catch (error) {
                console.error(`RSS Error [${feed.name || feed.url}]:`, error);
            }
        }

        if (this.settings.autoCleanupValue > 0) {
            try {
                await cleanupOldFiles(
                    this.app.vault,
                    this.settings.folderPath,
                    this.settings.autoCleanupValue,
                    this.settings.autoCleanupUnit
                );
            } catch (cleanupError) {
                console.error('Cleanup failed:', cleanupError);
            }
        }

        new Notice('RSS Update complete!');
    }

    async loadSettings() {
        const loadedData = await this.loadData();
        this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);
    }

    async saveSettings() {
        await this.saveData(this.settings);
        this.setupAutoUpdate();
    }
}