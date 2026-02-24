import { App, Setting, Notice, setIcon, Modal } from 'obsidian';
import RssPlugin, { FeedConfig, FeedGroup } from '../main';
import { fetchAndExtract } from '../services/feedExtractor';
import { AddUrlModal, FeedEditModal, ConfirmDeleteModal } from './editFeed';

// ─── Drag & Drop (feed-to-feed reorder) ──────────────────────────────────────

export interface DragDropContext {
    dragSrcIndex: number | null;
    feeds: FeedConfig[];
    onDrop: (fromIndex: number, toIndex: number) => Promise<void>;
}

export function attachDragDrop(
    settingEl: HTMLElement,
    index: number,
    ctx: DragDropContext
): void {
    settingEl.draggable = true;

    const dragHandle = createDiv();
    dragHandle.style.cssText = 'cursor: grab; margin-right: 15px; color: var(--text-muted); display: flex; align-items: center;';
    setIcon(dragHandle, 'grip-vertical');
    settingEl.prepend(dragHandle);

    const dropIndicator = createDiv();
    dropIndicator.style.cssText = `
        position: absolute; left: 0; right: 0; top: -8px; height: 4px;
        background: var(--interactive-accent); display: none;
        pointer-events: none; z-index: 20; border-radius: 2px;
        box-shadow: 0 0 8px var(--interactive-accent);
    `;
    settingEl.appendChild(dropIndicator);

    let dragCounter = 0;

    settingEl.addEventListener('dragstart', (e: DragEvent) => {
        ctx.dragSrcIndex = index;
        settingEl.style.opacity = '0.4';
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    });

    settingEl.addEventListener('dragend', () => {
        settingEl.style.opacity = '1';
        ctx.dragSrcIndex = null;
        dropIndicator.style.display = 'none';
        dragCounter = 0;
    });

    settingEl.addEventListener('dragenter', (e: DragEvent) => {
        e.preventDefault();
        dragCounter++;
        if (ctx.dragSrcIndex !== null && ctx.dragSrcIndex !== index) {
            dropIndicator.style.display = 'block';
        }
    });

    settingEl.addEventListener('dragleave', () => {
        dragCounter--;
        if (dragCounter === 0) dropIndicator.style.display = 'none';
    });

    settingEl.addEventListener('dragover', (e: DragEvent) => { e.preventDefault(); return false; });

    settingEl.addEventListener('drop', async (e: DragEvent) => {
        e.preventDefault();
        if (ctx.dragSrcIndex !== null && ctx.dragSrcIndex !== index) {
            await ctx.onDrop(ctx.dragSrcIndex, index);
        }
    });
}

// ─── Group drop zone (header) — drag feed INTO group ─────────────────────────

function attachGroupDropZone(
    groupRow: HTMLElement,
    group: FeedGroup,
    dragCtx: DragDropContext,
    plugin: RssPlugin,
    onRefresh: () => void
): void {
    let dragCounter = 0;

    const highlight = () => {
        groupRow.style.borderColor = 'var(--interactive-accent)';
        groupRow.style.background  = 'var(--background-modifier-hover)';
    };
    const unhighlight = () => {
        groupRow.style.borderColor = 'var(--background-modifier-border)';
        groupRow.style.background  = 'var(--background-secondary)';
    };

    groupRow.addEventListener('dragover',  (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); });
    groupRow.addEventListener('dragenter', (e: DragEvent) => {
        e.preventDefault(); e.stopPropagation();
        dragCounter++;
        highlight();
    });
    groupRow.addEventListener('dragleave', (e: DragEvent) => {
        e.stopPropagation();
        dragCounter--;
        if (dragCounter <= 0) { dragCounter = 0; unhighlight(); }
    });
    groupRow.addEventListener('drop', async (e: DragEvent) => {
        e.preventDefault(); e.stopPropagation();
        dragCounter = 0;
        unhighlight();
        if (dragCtx.dragSrcIndex === null) return;
        const feed = dragCtx.feeds[dragCtx.dragSrcIndex];
        if (!feed) return;
        feed.groupId = group.id;
        dragCtx.dragSrcIndex = null;
        await plugin.saveSettings();
        onRefresh();
    });
}

// ─── Loose drop zone — drag feed OUT of group ─────────────────────────────────

function attachLooseDropZone(
    el: HTMLElement,
    dragCtx: DragDropContext,
    plugin: RssPlugin,
    onRefresh: () => void
): void {
    let dragCounter = 0;

    const highlight = () => {
        el.style.borderColor = 'var(--interactive-accent)';
        el.style.opacity     = '1';
    };
    const unhighlight = () => {
        el.style.borderColor = 'var(--background-modifier-border)';
        el.style.opacity     = '0.35';
    };

    el.addEventListener('dragover',  (e: DragEvent) => { e.preventDefault(); });
    el.addEventListener('dragenter', (e: DragEvent) => {
        e.preventDefault();
        dragCounter++;
        highlight();
    });
    el.addEventListener('dragleave', () => {
        dragCounter--;
        if (dragCounter <= 0) { dragCounter = 0; unhighlight(); }
    });
    el.addEventListener('drop', async (e: DragEvent) => {
        e.preventDefault();
        dragCounter = 0;
        unhighlight();
        if (dragCtx.dragSrcIndex === null) return;
        const feed = dragCtx.feeds[dragCtx.dragSrcIndex];
        if (!feed) return;
        delete feed.groupId;
        dragCtx.dragSrcIndex = null;
        await plugin.saveSettings();
        onRefresh();
    });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

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

// ─── Header ───────────────────────────────────────────────────────────────────

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
        .addOption('active-first', 'Active first')
        .setValue('default')
        .onChange(async (val) => {
            if (val === 'default') return;
            const feeds = plugin.settings.feeds;
            if (val === 'alpha-asc')         feeds.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            else if (val === 'alpha-desc')   feeds.sort((a, b) => (b.name || '').localeCompare(a.name || ''));
            else if (val === 'recent')       feeds.sort((a, b) => (b.lastUpdated || 0) - (a.lastUpdated || 0));
            else if (val === 'active-first') feeds.sort((a, b) => {
                const aActive = a.enabled && !(a.archived ?? false) && !(a.deleted ?? false);
                const bActive = b.enabled && !(b.archived ?? false) && !(b.deleted ?? false);
                return (bActive ? 1 : 0) - (aActive ? 1 : 0);
            });
            await plugin.saveSettings();
            onRefresh();
            new Notice('Sorted successfully');
        }));

    headerSetting.addButton(btn => btn
        .setButtonText('+ Add Folder')
        .onClick(async () => {
            const name = await promptFolderName(app);
            if (!name) return;
            const newGroup: FeedGroup = {
                id:   `group-${Date.now()}`,
                name: name.trim(),
            };
            plugin.settings.groups.push(newGroup);
            await plugin.saveSettings();
            onRefresh();
            new Notice(`Folder "${newGroup.name}" created`);
        }));

    headerSetting.addButton(btn => btn
        .setButtonText('⟳ Update All Feeds')
        .onClick(async () => {
            const activeFeeds = plugin.settings.feeds.filter(
                f => f.enabled && !(f.archived ?? false) && !(f.deleted ?? false)
            );
            if (activeFeeds.length === 0) { new Notice('No active feeds to update'); return; }
            new Notice(`Updating ${activeFeeds.length} feeds...`);
            await plugin.updateAllFeeds();
        }));

    headerSetting.addButton(btn => btn
        .setButtonText('+ Add Feed')
        .setCta()
        .onClick(() => {
            new AddUrlModal(app, async (url) => {
                try {
                    if (plugin.settings.feeds.some(f => f.url === url)) {
                        new Notice('This feed URL already exists!');
                        return;
                    }
                    new Notice('Fetching feed info...');
                    const data = await fetchAndExtract(url);

                    const newFeed: FeedConfig = {
                        name: data.title || 'New Feed',
                        url,
                        folder: '',
                        enabled: true,
                        lastUpdated: Date.now(),
                    };

                    plugin.settings.feeds.push(newFeed);
                    await plugin.saveSettings();

                    const addedFeed  = plugin.settings.feeds[plugin.settings.feeds.length - 1];
                    const addedIndex = plugin.settings.feeds.length - 1;

                    if (addedFeed) {
                        new FeedEditModal(app, plugin, addedFeed,
                            async () => { await plugin.saveSettings(); onRefresh(); },
                            () => { plugin.settings.feeds.splice(addedIndex, 1); plugin.saveSettings(); onRefresh(); }
                        ).open();
                    }
                    onRefresh();
                } catch (e) {
                    new Notice('Failed to fetch feed. Check the URL.');
                }
            }).open();
        }));
}

// ─── Folder name prompt ───────────────────────────────────────────────────────

function promptFolderName(app: App, existingName?: string): Promise<string | null> {
    return new Promise<string | null>((resolve) => {

        class FolderNameModal extends Modal {
            private value: string = existingName ?? '';
            private resolved: boolean = false;

            onOpen() {
                const { contentEl } = this;
                contentEl.createEl('h3', { text: existingName ? 'Rename Folder' : 'New Folder' });

                const input = contentEl.createEl('input', { type: 'text' });
                input.placeholder = 'Folder name (e.g. News)';
                input.value = this.value;
                input.style.cssText = 'width: 100%; margin: 12px 0; padding: 6px 10px; box-sizing: border-box;';
                input.focus();

                input.addEventListener('input', (e: Event) => {
                    this.value = (e.target as HTMLInputElement).value;
                });
                input.addEventListener('keydown', (e: KeyboardEvent) => {
                    if (e.key === 'Enter' && this.value.trim()) { this.resolved = true; this.close(); }
                    if (e.key === 'Escape') this.close();
                });

                const footer = contentEl.createDiv();
                footer.style.cssText = 'display: flex; justify-content: flex-end; gap: 8px;';

                const cancelBtn = footer.createEl('button', { text: 'Cancel' });
                cancelBtn.onclick = () => this.close();

                const confirmBtn = footer.createEl('button', {
                    text: existingName ? 'Rename' : 'Create',
                    cls: 'mod-cta'
                });
                confirmBtn.onclick = () => {
                    if (this.value.trim()) { this.resolved = true; this.close(); }
                };
            }

            onClose() {
                resolve(this.resolved ? this.value.trim() : null);
            }
        }

        new FolderNameModal(app).open();
    });
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
            const activeFeeds = plugin.settings.feeds.filter(f => !(f.archived ?? false) && !(f.deleted ?? false));
            const allEnabled  = activeFeeds.length > 0 && activeFeeds.every(f => f.enabled);
            toggle.setValue(allEnabled);
            toggle.onChange(async (value) => {
                activeFeeds.forEach(f => f.enabled = value);
                await plugin.saveSettings();
                onRefresh();
            });
        });
    applyCardStyle(allToggleSetting);
}

// ─── Feed list ────────────────────────────────────────────────────────────────

function renderFeedsList(
    containerEl: HTMLElement,
    app: App,
    plugin: RssPlugin,
    applyCardStyle: (setting: Setting) => void,
    onRefresh: () => void
): void {
    const feedsContainer = containerEl.createDiv();
    feedsContainer.style.marginTop = '20px';

    const now             = Date.now();
    const FIFTEEN_DAYS_MS = 15 * 24 * 60 * 60 * 1000;

    const beforeCount = plugin.settings.feeds.length;
    plugin.settings.feeds = plugin.settings.feeds.filter(
        f => !(f.deleted && f.deletedAt && (now - f.deletedAt > FIFTEEN_DAYS_MS))
    );
    if (plugin.settings.feeds.length !== beforeCount) {
        plugin.saveData(plugin.settings);
    }

    const feeds  = plugin.settings.feeds;
    const groups = plugin.settings.groups;

    const normalFeeds   = feeds.filter(f => !(f.archived ?? false) && !(f.deleted ?? false));
    const archivedFeeds = feeds.filter(f =>  (f.archived ?? false) && !(f.deleted ?? false));
    const deletedFeeds  = feeds.filter(f =>   f.deleted ?? false);

    const dragCtx: DragDropContext = {
        dragSrcIndex: null,
        feeds,
        onDrop: async (fromIndex, toIndex) => {
            const item = feeds[fromIndex];
            if (item) {
                const targetFeed = feeds[toIndex];
                if (targetFeed && item.groupId !== targetFeed.groupId) {
                    item.groupId = targetFeed.groupId;
                }
                feeds.splice(fromIndex, 1);
                feeds.splice(toIndex, 0, item);
                await plugin.saveSettings();
                onRefresh();
            }
        },
    };

    // ── Groups ────────────────────────────────────────────────────────────────
    for (const group of groups) {
        const groupFeeds = normalFeeds.filter(f => f.groupId === group.id);
        renderGroupBlock(app, plugin, feedsContainer, feeds, group, groupFeeds, dragCtx, applyCardStyle, onRefresh);
    }

    // ── Loose feeds ───────────────────────────────────────────────────────────
    const looseFeeds = normalFeeds.filter(f => !f.groupId || !groups.find(g => g.id === f.groupId));
    looseFeeds.forEach((feed) => {
        const globalIndex = feeds.indexOf(feed);
        renderFeedCard(app, plugin, feedsContainer, feeds, feed, globalIndex, dragCtx, applyCardStyle, onRefresh);
    });

    // ── Archived section ──────────────────────────────────────────────────────
    if (archivedFeeds.length > 0) {
        addSectionDivider(feedsContainer, 'Archived Feeds');
        archivedFeeds.forEach((feed) => {
            const globalIndex = feeds.indexOf(feed);
            const noDragCtx: DragDropContext = { dragSrcIndex: null, feeds, onDrop: async () => {} };
            renderFeedCard(app, plugin, feedsContainer, feeds, feed, globalIndex, noDragCtx, applyCardStyle, onRefresh);
        });
    }

    // ── Deleted section ───────────────────────────────────────────────────────
    if (deletedFeeds.length > 0) {
        addSectionDivider(feedsContainer, 'Deleted Feeds (auto-delete after 15 days)');
        deletedFeeds.forEach((feed) => {
            const globalIndex = feeds.indexOf(feed);
            const noDragCtx: DragDropContext = { dragSrcIndex: null, feeds, onDrop: async () => {} };
            renderFeedCard(app, plugin, feedsContainer, feeds, feed, globalIndex, noDragCtx, applyCardStyle, onRefresh);
        });
    }
}

// ─── Group block ──────────────────────────────────────────────────────────────

function renderGroupBlock(
    app: App,
    plugin: RssPlugin,
    container: HTMLElement,
    feeds: FeedConfig[],
    group: FeedGroup,
    groupFeeds: FeedConfig[],
    dragCtx: DragDropContext,
    applyCardStyle: (setting: Setting) => void,
    onRefresh: () => void
): void {
    const groupRow = container.createDiv();
    groupRow.style.cssText = `
        display: flex; align-items: center; gap: 8px;
        padding: 8px 12px; margin-bottom: 4px; margin-top: 12px;
        background: var(--background-secondary);
        border: 1px solid var(--background-modifier-border);
        border-radius: 10px; cursor: pointer;
        transition: border-color 0.2s ease, background 0.2s ease;
    `;
    groupRow.onmouseenter = () => { groupRow.style.borderColor = 'var(--interactive-accent)'; };
    groupRow.onmouseleave = () => { groupRow.style.borderColor = 'var(--background-modifier-border)'; };

    attachGroupDropZone(groupRow, group, dragCtx, plugin, onRefresh);

    const collapseIcon = groupRow.createDiv();
    collapseIcon.style.cssText = 'color: var(--text-muted); display: flex; align-items: center; flex-shrink: 0; pointer-events: none;';
    setIcon(collapseIcon, group.collapsed ? 'chevron-right' : 'chevron-down');

    const folderIcon = groupRow.createDiv();
    folderIcon.style.cssText = 'color: var(--text-accent); display: flex; align-items: center; flex-shrink: 0; pointer-events: none;';
    setIcon(folderIcon, 'folder');

    const groupNameEl = groupRow.createEl('span', { text: group.name });
    groupNameEl.style.cssText = 'font-weight: 600; flex: 1; color: var(--text-normal); pointer-events: none;';

    const feedCountEl = groupRow.createEl('span', { text: `${groupFeeds.length} feed${groupFeeds.length !== 1 ? 's' : ''}` });
    feedCountEl.style.cssText = 'color: var(--text-muted); font-size: 0.85em; flex-shrink: 0; pointer-events: none;';

    const renameBtn = groupRow.createEl('button');
    renameBtn.style.cssText = 'background: none; border: none; cursor: pointer; color: var(--text-muted); padding: 2px 6px; border-radius: 4px;';
    setIcon(renameBtn, 'pencil');
    renameBtn.title = 'Rename folder';
    renameBtn.onclick = async (e: MouseEvent) => {
        e.stopPropagation();
        const newName = await promptFolderName(app, group.name);
        if (newName && newName !== group.name) {
            group.name = newName;
            await plugin.saveSettings();
            onRefresh();
        }
    };

    const deleteGroupBtn = groupRow.createEl('button');
    deleteGroupBtn.style.cssText = 'background: none; border: none; cursor: pointer; color: var(--text-muted); padding: 2px 6px; border-radius: 4px;';
    setIcon(deleteGroupBtn, 'trash');
    deleteGroupBtn.title = 'Remove folder';
    deleteGroupBtn.onclick = async (e: MouseEvent) => {
        e.stopPropagation();
        await handleDeleteGroup(app, plugin, group, groupFeeds, onRefresh);
    };

    // Feeds wrapper (collapsible)
    const feedsWrapper = container.createDiv();
    feedsWrapper.style.cssText = `
        padding-left: 20px;
        border-left: 2px solid var(--interactive-accent);
        margin-left: 12px;
        margin-bottom: 4px;
        display: ${group.collapsed ? 'none' : 'block'};
    `;

    if (groupFeeds.length === 0) {
        const empty = feedsWrapper.createEl('div', { text: 'Drop a feed here or edit a feed to assign it to this folder.' });
        empty.style.cssText = 'color: var(--text-muted); font-size: 0.85em; padding: 8px 0;';
    } else {
        groupFeeds.forEach((feed) => {
            const globalIndex = feeds.indexOf(feed);
            renderFeedCard(app, plugin, feedsWrapper, feeds, feed, globalIndex, dragCtx, applyCardStyle, onRefresh);
        });
    }

    // Drop zone below the group — drag feed OUT to make it loose
    const removeDropZone = container.createDiv();
    removeDropZone.style.cssText = `
        border: 2px dashed var(--background-modifier-border);
        border-radius: 8px; padding: 6px 14px; margin-bottom: 16px;
        margin-left: 12px; color: var(--text-muted); font-size: 0.8em;
        opacity: 0.35; transition: all 0.2s ease; text-align: center;
        display: ${group.collapsed ? 'none' : 'block'};
    `;
    removeDropZone.setText('↑ Drop here to remove from folder');
    attachLooseDropZone(removeDropZone, dragCtx, plugin, onRefresh);

    // Toggle collapse
    groupRow.onclick = async () => {
        group.collapsed = !group.collapsed;
        setIcon(collapseIcon, group.collapsed ? 'chevron-right' : 'chevron-down');
        feedsWrapper.style.display   = group.collapsed ? 'none' : 'block';
        removeDropZone.style.display = group.collapsed ? 'none' : 'block';
        await plugin.saveSettings();
    };
}

// ─── Delete group handler ─────────────────────────────────────────────────────

async function handleDeleteGroup(
    app: App,
    plugin: RssPlugin,
    group: FeedGroup,
    groupFeeds: FeedConfig[],
    onRefresh: () => void
): Promise<void> {
    return new Promise<void>((resolve) => {

        class DeleteGroupModal extends Modal {
            onOpen() {
                const { contentEl } = this;
                contentEl.createEl('h3', { text: `Remove folder "${group.name}"?` });
                contentEl.createEl('p', {
                    text: groupFeeds.length > 0
                        ? `This folder has ${groupFeeds.length} feed(s). What should happen to them?`
                        : 'This folder is empty.'
                });

                const footer = contentEl.createDiv();
                footer.style.cssText = 'display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; flex-wrap: wrap;';

                const cancelBtn = footer.createEl('button', { text: 'Cancel' });
                cancelBtn.onclick = () => { this.close(); resolve(); };

                if (groupFeeds.length > 0) {
                    const releaseBtn = footer.createEl('button', { text: 'Keep feeds loose' });
                    releaseBtn.onclick = async () => {
                        groupFeeds.forEach(f => { delete f.groupId; });
                        plugin.settings.groups = plugin.settings.groups.filter(g => g.id !== group.id);
                        await plugin.saveSettings();
                        onRefresh();
                        this.close(); resolve();
                    };
                }

                const deleteBtn = footer.createEl('button', {
                    text: groupFeeds.length > 0 ? 'Delete folder & feeds' : 'Remove folder',
                    cls: 'mod-warning'
                });
                deleteBtn.onclick = async () => {
                    groupFeeds.forEach(f => {
                        f.deleted   = true;
                        f.deletedAt = Date.now();
                        f.enabled   = false;
                    });
                    plugin.settings.groups = plugin.settings.groups.filter(g => g.id !== group.id);
                    await plugin.saveSettings();
                    onRefresh();
                    this.close(); resolve();
                };
            }

            onClose() { resolve(); }
        }

        new DeleteGroupModal(app).open();
    });
}

// ─── Feed Card ────────────────────────────────────────────────────────────────

function renderFeedCard(
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
    const isArchived = feed.archived ?? false;
    const isDeleted  = feed.deleted  ?? false;
    const isNormal   = !isArchived && !isDeleted;

    const feedSetting = new Setting(feedsContainer)
        .setName(feed.name || 'Untitled Feed')
        .setDesc(feed.url || 'No URL provided');

    applyCardStyle(feedSetting);

    if (isArchived) feedSetting.settingEl.style.opacity = '0.7';
    if (isDeleted)  feedSetting.settingEl.style.opacity = '0.4';

    feedSetting.infoEl.style.flex = '1 1 auto';
    feedSetting.descEl.style.cssText = `
        max-width: none; white-space: normal; word-break: break-all;
        display: block; margin-top: 5px; color: var(--text-muted);
        font-family: var(--font-monospace); font-size: 0.85em;
    `;

    if (isNormal) {
        attachDragDrop(feedSetting.settingEl, index, dragCtx);

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
            .onChange(async v => {
                feed.enabled = v;
                await plugin.saveSettings();
            }));
    }

    // Edit button
    feedSetting.addButton(btn => {
        btn.setIcon('pencil');
        btn.onClick(() => {
            const currentFeed = plugin.settings.feeds[index];
            if (currentFeed) {
                new FeedEditModal(app, plugin, currentFeed,
                    async () => { await plugin.saveSettings(); onRefresh(); },
                    () => { plugin.settings.feeds.splice(index, 1); plugin.saveSettings(); onRefresh(); }
                ).open();
            }
        });
    });

    // Archive/restore button
    feedSetting.addButton(btn => {
        if (isDeleted) {
            btn.setIcon('undo').setTooltip('Restore feed');
            btn.onClick(async () => {
                feed.deleted = false;
                delete feed.deletedAt;
                await plugin.saveSettings();
                onRefresh();
            });
        } else if (isArchived) {
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
                feed.enabled  = false;
                await plugin.saveSettings();
                onRefresh();
            });
        }
    });

    // Trash button
    feedSetting.addButton(btn => {
        if (isDeleted) {
            btn.setIcon('trash').setTooltip('Permanently delete feed');
            btn.buttonEl.style.color = 'var(--color-red)';
            btn.onClick(async () => {
                new ConfirmDeleteModal(app,
                    async () => {
                        plugin.settings.feeds.splice(index, 1);
                        await plugin.saveSettings();
                        onRefresh();
                    },
                    async () => {
                        plugin.settings.feeds.splice(index, 1);
                        await plugin.saveSettings();
                        onRefresh();
                    }
                ).open();
            });
        } else {
            btn.setIcon('trash').setTooltip('Delete feed');
            btn.buttonEl.style.color = 'var(--text-muted)';
            btn.onClick(async () => {
                feed.deleted   = true;
                feed.deletedAt = Date.now();
                feed.enabled   = false;
                await plugin.saveSettings();
                onRefresh();
            });
        }
    });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function addSectionDivider(container: HTMLElement, label: string): void {
    const divider = container.createEl('hr');
    divider.style.cssText = 'margin: 20px 0; border: none; border-top: 1px solid var(--background-modifier-border);';
    const heading = container.createEl('h4', { text: label });
    heading.style.cssText = 'margin: 10px 0; color: var(--text-muted);';
}