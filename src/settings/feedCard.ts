import { App, Setting, Notice } from 'obsidian';
import RssPlugin, { FeedConfig } from '../main';
import { attachDragDrop, DragDropContext } from './feedDragDrop';
import { FeedEditModal, ConfirmDeleteModal } from './feedModals';

export function renderFeedCard(
    app: App,
    plugin: RssPlugin,
    feedsContainer: HTMLElement,
    feeds: FeedConfig[],
    feed: FeedConfig,
    index: number,
    dragCtx: DragDropContext,
    applyCardStyle: (setting: Setting) => void,
    onRefresh: () => void
): void {
    const feedSetting = new Setting(feedsContainer)
        .setName(feed.name || 'Untitled Feed')
        .setDesc(feed.url || 'No URL provided');

    applyCardStyle(feedSetting);

    if (feed.archived ?? false) feedSetting.settingEl.style.opacity = '0.7';
    if (feed.deleted ?? false) feedSetting.settingEl.style.opacity = '0.4';

    const { settingEl } = feedSetting;

    feedSetting.infoEl.style.flex = '1 1 auto';
    feedSetting.descEl.style.cssText = `
        max-width: none; white-space: normal; word-break: break-all;
        display: block; margin-top: 5px; color: var(--text-muted);
        font-family: var(--font-monospace); font-size: 0.85em;
    `;

    // ── Drag & drop (only for non-deleted feeds) ──────────────────────────────
    if (!(feed.deleted ?? false)) {
        attachDragDrop(settingEl, index, dragCtx);
    }

    // ── Reorder arrows + enable toggle (only for non-deleted feeds) ───────────
    if (!(feed.deleted ?? false)) {
        feedSetting.addButton(btn => btn
            .setIcon('arrow-up')
            .setDisabled(index === 0)
            .onClick(async () => {
                const item = feeds[index];
                if (item) {
                    feeds.splice(index, 1);
                    feeds.splice(index - 1, 0, item);
                    await plugin.saveSettings();
                    onRefresh();
                }
            }));

        feedSetting.addButton(btn => btn
            .setIcon('arrow-down')
            .setDisabled(index === feeds.length - 1)
            .onClick(async () => {
                const item = feeds[index];
                if (item) {
                    feeds.splice(index, 1);
                    feeds.splice(index + 1, 0, item);
                    await plugin.saveSettings();
                    onRefresh();
                }
            }));

        feedSetting.addToggle(t => t
            .setValue(feed.enabled)
            .setDisabled(feed.archived ?? false)
            .onChange(async v => {
                feed.enabled = v;
                await plugin.saveSettings();
            }));
    }

    // ── Archive / unarchive / restore button ──────────────────────────────────
    feedSetting.addButton(btn => {
        if (feed.deleted ?? false) {
            btn.setIcon('undo').setTooltip('Restore feed');
            btn.onClick(async () => {
                feed.deleted = false;
                delete feed.deletedAt;
                await plugin.saveSettings();
                onRefresh();
            });
        } else if (feed.archived ?? false) {
            btn.setIcon('archive-restore').setTooltip('Unarchive feed');
            btn.onClick(async () => {
                feed.archived = false;
                await plugin.saveSettings();
                onRefresh();
            });
        } else {
            btn.setIcon('archive').setTooltip('Archive feed');
            btn.onClick(async () => {
                feed.archived = true;
                feed.enabled = false;
                await plugin.saveSettings();
                onRefresh();
            });
        }
    });

    // ── Edit button ───────────────────────────────────────────────────────────
    feedSetting.addButton(btn => {
        btn.setIcon('pencil');
        btn.onClick(() => {
            const currentFeed = feeds[index];
            if (currentFeed) {
                new FeedEditModal(app, plugin, currentFeed,
                    async () => { await plugin.saveSettings(); onRefresh(); },
                    () => { plugin.settings.feeds.splice(index, 1); plugin.saveSettings(); onRefresh(); }
                ).open();
            }
        });
    });

    // ── Delete / permanent delete button ─────────────────────────────────────
    feedSetting.addButton(btn => {
        if (feed.deleted ?? false) {
            btn.setIcon('trash').setClass('mod-error').setTooltip('Permanently delete feed');
            btn.onClick(async () => {
                new ConfirmDeleteModal(app,
                    async () => {
                        plugin.settings.feeds.splice(index, 1);
                        await plugin.saveSettings();
                        onRefresh();
                    },
                    async () => {
                        try {
                            const rssFolder = plugin.settings.folderPath || 'RSS';
                            const feedName = feed.name || feed.folder;
                            if (feedName) {
                                const feedPath = `${rssFolder}/${feedName}`;
                                const folder = app.vault.getAbstractFileByPath(feedPath);
                                if (folder) {
                                    await app.vault.delete(folder, true);
                                    new Notice(`Deleted folder: ${feedPath}`);
                                } else {
                                    new Notice(`Folder not found: ${feedPath}`);
                                }
                            }
                            plugin.settings.feeds.splice(index, 1);
                            await plugin.saveSettings();
                            onRefresh();
                            new Notice('Feed and content deleted successfully');
                        } catch (e) {
                            console.error('Error deleting feed content:', e);
                            new Notice('Error deleting feed content. Check console.');
                        }
                    }
                ).open();
            });
        } else {
            btn.setIcon('trash').setClass('mod-warning').setTooltip('Delete feed');
            btn.onClick(async () => {
                feed.deleted = true;
                feed.deletedAt = Date.now();
                feed.enabled = false;
                await plugin.saveSettings();
                onRefresh();
            });
        }
    });
}