import { App, Setting, Notice } from 'obsidian';
import RssPlugin, { FeedConfig } from '../main';
import { fetchAndParse } from '../services/feedExtractor';
import { AddUrlModal, FeedEditModal } from './feedModals';
import { renderFeedCard } from './feedCard';
import { DragDropContext } from './feedDragDrop';

export function renderMyFeedsTab(
    containerEl: HTMLElement,
    app: App,
    plugin: RssPlugin,
    applyCardStyle: (setting: Setting) => void,
    onRefresh: () => void
): void {
    renderFeedsHeader(containerEl, app, plugin, onRefresh);
    renderAllFeedsToggle(containerEl, plugin, applyCardStyle, onRefresh);
    renderFeedsList(containerEl, app, plugin, applyCardStyle, onRefresh);
}

// ─── Header: sort dropdown + action buttons ───────────────────────────────────

function renderFeedsHeader(
    containerEl: HTMLElement,
    app: App,
    plugin: RssPlugin,
    onRefresh: () => void
): void {
    const headerSetting = new Setting(containerEl)
        .setName('Manage Feeds')
        .setDesc('Add a URL to automatically fetch the feed name.');

    headerSetting.addDropdown(dropdown => dropdown
        .addOption('default', 'Sort feeds...')
        .addOption('alpha-asc', 'A-Z')
        .addOption('alpha-desc', 'Z-A')
        .addOption('recent', 'Recent Activity')
        .setValue('default')
        .onChange(async (val) => {
            if (val === 'default') return;
            const feeds = plugin.settings.feeds;
            if (val === 'alpha-asc') feeds.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            else if (val === 'alpha-desc') feeds.sort((a, b) => (b.name || '').localeCompare(a.name || ''));
            else if (val === 'recent') feeds.sort((a, b) => (b.lastUpdated || 0) - (a.lastUpdated || 0));
            await plugin.saveSettings();
            onRefresh();
            new Notice('Sorted successfully');
        }));

    headerSetting.addButton(btn => btn
        .setButtonText('⟳ Update All Feeds')
        .onClick(async () => {
            const activeFeeds = plugin.settings.feeds.filter(
                f => f.enabled && !(f.archived ?? false) && !(f.deleted ?? false)
            );
            if (activeFeeds.length === 0) { new Notice('No active feeds to update'); return; }
            new Notice(`Updating ${activeFeeds.length} feed${activeFeeds.length !== 1 ? 's' : ''}...`);
            await plugin.updateAllFeeds();
        }));

    headerSetting.addButton(btn => btn
        .setButtonText('+ Add Feed')
        .setCta()
        .onClick(() => {
            new AddUrlModal(app, async (url) => {
                try {
                    new Notice('Fetching feed info...');
                    const data = await fetchAndParse(url);
                    const newFeed: FeedConfig = {
                        name: data.title || 'New Feed',
                        url,
                        folder: '',
                        enabled: true,
                        lastUpdated: Date.now(),
                    };
                    new FeedEditModal(app, plugin, newFeed, async () => {
                        plugin.settings.feeds.push(newFeed);
                        await plugin.saveSettings();
                        onRefresh();
                        new Notice(`Added: ${newFeed.name}`);
                    }).open();
                } catch (e) {
                    new Notice('Failed to fetch feed. Check the URL.');
                }
            }).open();
        }));
}

// ─── Enable/disable all toggle ────────────────────────────────────────────────

function renderAllFeedsToggle(
    containerEl: HTMLElement,
    plugin: RssPlugin,
    applyCardStyle: (setting: Setting) => void,
    onRefresh: () => void
): void {
    const allToggleSetting = new Setting(containerEl)
        .setName('Enable/Disable All Active Feeds')
        .addToggle(toggle => {
            const activeFeeds = plugin.settings.feeds.filter(f => !(f.archived ?? false));
            const allEnabled = activeFeeds.length > 0 && activeFeeds.every(f => f.enabled);
            toggle.setValue(allEnabled);
            toggle.onChange(async (value) => {
                activeFeeds.forEach(f => f.enabled = value);
                await plugin.saveSettings();
                onRefresh();
            });
        });
    applyCardStyle(allToggleSetting);
}

// ─── Feed list: cleanup + sort + section dividers + cards ─────────────────────

function renderFeedsList(
    containerEl: HTMLElement,
    app: App,
    plugin: RssPlugin,
    applyCardStyle: (setting: Setting) => void,
    onRefresh: () => void
): void {
    const feedsContainer = containerEl.createDiv();
    feedsContainer.style.marginTop = '20px';

    // Remove feeds deleted more than 15 days ago
    const now = Date.now();
    const FIFTEEN_DAYS_MS = 15 * 24 * 60 * 60 * 1000;
    plugin.settings.feeds = plugin.settings.feeds.filter(
        f => !(f.deleted && f.deletedAt && (now - f.deletedAt > FIFTEEN_DAYS_MS))
    );

    const feeds = plugin.settings.feeds;

    // Active → archived → deleted
    feeds.sort((a, b) => {
        const aDeleted = a.deleted ?? false;
        const bDeleted = b.deleted ?? false;
        const aArchived = a.archived ?? false;
        const bArchived = b.archived ?? false;
        if (!aDeleted && bDeleted) return -1;
        if (aDeleted && !bDeleted) return 1;
        if (!aArchived && bArchived) return -1;
        if (aArchived && !bArchived) return 1;
        return 0;
    });

    // Shared drag context — dragSrcIndex mutated by attachDragDrop
    const dragCtx: DragDropContext = {
        dragSrcIndex: null,
        feeds,
        onDrop: async (fromIndex, toIndex) => {
            const sourceItem = feeds[fromIndex];
            if (sourceItem) {
                feeds.splice(fromIndex, 1);
                feeds.splice(toIndex, 0, sourceItem);
                await plugin.saveSettings();
                onRefresh();
            }
        },
    };

    let addedArchivedDivider = false;
    let addedDeletedDivider = false;

    feeds.forEach((feed: FeedConfig, index: number) => {
        if ((feed.archived ?? false) && !addedArchivedDivider) {
            addSectionDivider(feedsContainer, 'Archived Feeds');
            addedArchivedDivider = true;
        }
        if ((feed.deleted ?? false) && !addedDeletedDivider) {
            addSectionDivider(feedsContainer, 'Deleted Feeds (auto-delete after 15 days)');
            addedDeletedDivider = true;
        }

        renderFeedCard(app, plugin, feedsContainer, feeds, feed, index, dragCtx, applyCardStyle, onRefresh);
    });
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function addSectionDivider(container: HTMLElement, label: string): void {
    const divider = container.createEl('hr');
    divider.style.cssText = 'margin: 20px 0; border: none; border-top: 1px solid var(--background-modifier-border);';
    const heading = container.createEl('h4', { text: label });
    heading.style.cssText = 'margin: 10px 0; color: var(--text-muted);';
}