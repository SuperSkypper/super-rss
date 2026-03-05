import { App, Modal, Notice, setIcon, Vault, normalizePath } from 'obsidian';
import RssPlugin, { FeedConfig, FeedGroup, resolveFeedPath, sanitizeFolderPath } from '../main';

// ─── Sort helpers ─────────────────────────────────────────────────────────────

const COLLATOR = new Intl.Collator(undefined, { sensitivity: 'base' });

export function sortGroups(groups: FeedGroup[]): FeedGroup[] {
    return [...groups].sort((a, b) => COLLATOR.compare(a.name || '', b.name || ''));
}

// ─── Global loading overlay ───────────────────────────────────────────────────

export function showGlobalLoading(message = 'Saving...'): () => void {
    if (!document.getElementById('rss-spin-style')) {
        const style = document.createElement('style');
        style.id = 'rss-spin-style';
        style.textContent = '@keyframes rss-spin { to { transform: rotate(360deg); } }';
        document.head.appendChild(style);
    }

    const overlay = document.body.createDiv();
    overlay.id = 'rss-global-loading';
    overlay.style.cssText = `
        position: fixed; inset: 0; z-index: 99999;
        background: rgba(0, 0, 0, 0.55);
        display: flex; flex-direction: column;
        align-items: center; justify-content: center; gap: 14px;
    `;

    const spinner = overlay.createDiv();
    spinner.style.cssText = `
        width: 36px; height: 36px;
        border: 3px solid rgba(255,255,255,0.2);
        border-top-color: var(--interactive-accent);
        border-radius: 50%;
        animation: rss-spin 0.7s linear infinite;
    `;

    const label = overlay.createEl('span', { text: message });
    label.style.cssText = 'color: white; font-size: 0.9em; opacity: 0.9;';

    return () => overlay.remove();
}

/**
 * Changes a feed's groupId and physically moves its folder in the vault.
 * - oldGroupId: the groupId before the change (undefined = no folder)
 * - newGroupId: the groupId after the change (undefined = no folder)
 */
export async function moveFeedFolder(
    app: App,
    plugin: RssPlugin,
    feed: FeedConfig,
    newGroupId: string | undefined
): Promise<void> {
    const oldPath = normalizePath(resolveFeedPath(feed, plugin.settings));

    if (newGroupId === undefined) delete feed.groupId;
    else feed.groupId = newGroupId;

    const newPath = normalizePath(resolveFeedPath(feed, plugin.settings));

    if (oldPath === newPath) return;

    const existing = app.vault.getAbstractFileByPath(oldPath);
    if (existing) {
        try {
            // Ensure parent folder exists before renaming
            const parentPath = newPath.substring(0, newPath.lastIndexOf('/'));
            if (parentPath && !app.vault.getAbstractFileByPath(parentPath)) {
                await app.vault.createFolder(parentPath);
            }
            await app.vault.rename(existing, newPath);
        } catch (e) {
            console.error(`RSS: Failed to move folder "${oldPath}" → "${newPath}"`, e);
        }
    }
}

/**
 * Renames a group's folder in the vault by updating group.name and
 * renaming the group folder directly (all children move with it).
 * - group: the FeedGroup object to rename (mutated in place)
 * - newName: the new folder name
 */
export async function renameFeedGroupFolder(
    app: App,
    plugin: RssPlugin,
    group: FeedGroup,
    newName: string
): Promise<void> {
    const oldGroupName = group.name;

    // Update group name in settings object
    group.name = newName;

    // Rename the group folder directly -- all children move with it
    const root          = sanitizeFolderPath(plugin.settings.folderPath);
    const oldFolderPath = normalizePath(`${root}/${oldGroupName.trim()}`);
    const newFolderPath = normalizePath(`${root}/${newName.trim()}`);

    const existing = app.vault.getAbstractFileByPath(oldFolderPath);
    if (existing) {
        try {
            await app.vault.rename(existing, newFolderPath);
        } catch (e) {
            console.error(`RSS: Failed to rename group folder`, e);
        }
    }
}


export function openMoveToFolderModal(
    app: App,
    plugin: RssPlugin,
    selectedFeeds: Set<string>,
    onDone: () => void
): void {
    class MoveToFolderModal extends Modal {
        onOpen() {
            const { contentEl } = this;
            contentEl.createEl('h3', { text: `Move ${selectedFeeds.size} feed${selectedFeeds.size !== 1 ? 's' : ''} to folder` });

            const groups = sortGroups(plugin.settings.groups);

            if (groups.length === 0) {
                contentEl.createEl('p', { text: 'No folders exist yet. Create one first.' });
                const footer = contentEl.createDiv();
                footer.style.cssText = 'display: flex; justify-content: flex-end; margin-top: 16px;';
                const cancelBtn = footer.createEl('button', { text: 'Close' });
                cancelBtn.onclick = () => this.close();
                return;
            }

            const list = contentEl.createDiv();
            list.style.cssText = 'display: flex; flex-direction: column; gap: 6px; margin: 16px 0;';

            const noneBtn = list.createEl('button', { text: '— No folder —' });
            noneBtn.style.cssText = 'text-align: left; padding: 8px 12px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: transparent; cursor: pointer; color: var(--text-muted);';
            noneBtn.onclick = async () => {
                const hide = showGlobalLoading('Moving feeds...');
                try {
                    for (const f of plugin.settings.feeds) {
                        if (selectedFeeds.has(f.url)) await moveFeedFolder(app, plugin, f, undefined);
                    }
                    await plugin.saveSettings();
                } finally { hide(); }
                this.close();
                onDone();
            };

            for (const group of groups) {
                const btn = list.createEl('button', { text: group.name });
                btn.style.cssText = 'text-align: left; padding: 8px 12px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: transparent; cursor: pointer; color: var(--text-normal);';
                btn.onclick = async () => {
                    const hide = showGlobalLoading('Moving feeds...');
                    try {
                        for (const f of plugin.settings.feeds) {
                            if (selectedFeeds.has(f.url)) await moveFeedFolder(app, plugin, f, group.id);
                        }
                        await plugin.saveSettings();
                    } finally { hide(); }
                    this.close();
                    onDone();
                    new Notice(`Moved ${selectedFeeds.size} feed${selectedFeeds.size !== 1 ? 's' : ''} to "${group.name}"`);
                };
            }

            const footer = contentEl.createDiv();
            footer.style.cssText = 'display: flex; justify-content: flex-end; margin-top: 8px;';
            const cancelBtn = footer.createEl('button', { text: 'Cancel' });
            cancelBtn.onclick = () => this.close();
        }
    }

    new MoveToFolderModal(app).open();
}

// ─── Edit Folders Modal ───────────────────────────────────────────────────────

export function openEditFoldersModal(
    app: App,
    plugin: RssPlugin,
    onDone: () => void
): void {
    class EditFoldersModal extends Modal {

        private innerList: HTMLElement | null = null;
        private emptyMsg:  HTMLElement | null = null;

        onOpen() {
            this.modalEl.style.width         = '500px';
            this.modalEl.style.maxWidth      = '95vw';
            this.modalEl.style.height        = 'min(600px, 85vh)';
            this.modalEl.style.maxHeight     = 'none';
            this.modalEl.style.overflow      = 'hidden';
            this.modalEl.style.display       = 'flex';
            this.modalEl.style.flexDirection = 'column';

            const { contentEl } = this;
            contentEl.style.cssText = 'display: flex; flex-direction: column; flex: 1 1 0; min-height: 0; overflow: hidden; padding: 0;';

            this.render();
        }

        render() {
            const { contentEl } = this;
            contentEl.empty();
            this.innerList = null;
            this.emptyMsg  = null;

            // ── Fixed header ──────────────────────────────────────────────────
            const header = contentEl.createDiv();
            header.style.cssText = `
                display: flex; align-items: center; justify-content: space-between;
                padding: 18px 20px 12px;
                flex-shrink: 0;
                border-bottom: 1px solid var(--background-modifier-border);
            `;

            header.createEl('h2', { text: 'Edit Folders' }).style.cssText = 'margin: 0; font-size: 1.1em;';

            const addBtn = header.createEl('button');
            addBtn.style.cssText = 'display: flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 6px; cursor: pointer; font-size: 0.85em; border: 1px solid var(--background-modifier-border); background: transparent; color: var(--text-muted); transition: all 0.15s ease;';
            addBtn.addEventListener('mouseenter', () => { addBtn.style.borderColor = 'var(--interactive-accent)'; addBtn.style.color = 'var(--text-normal)'; });
            addBtn.addEventListener('mouseleave', () => { addBtn.style.borderColor = 'var(--background-modifier-border)'; addBtn.style.color = 'var(--text-muted)'; });
            const addIconEl = addBtn.createDiv();
            addIconEl.style.cssText = 'display: flex; align-items: center; width: 14px; height: 14px;';
            setIcon(addIconEl, 'folder-plus');
            addBtn.createSpan({ text: 'New Folder' });
            addBtn.addEventListener('click', async () => {
                const name = await promptFolderName(app);
                if (!name) return;
                const newGroup: FeedGroup = { id: `group-${Date.now()}`, name: name.trim() };
                plugin.settings.groups.push(newGroup);
                await plugin.saveSettings();
                onDone();
                this.appendRow(newGroup);
                new Notice(`Folder "${newGroup.name}" created`);
            });

            // ── Scrollable folder list ────────────────────────────────────────
            const listEl = contentEl.createDiv();
            listEl.style.cssText = 'flex: 1 1 0; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 12px 20px; -webkit-overflow-scrolling: touch;';

            const groups = sortGroups(plugin.settings.groups);

            if (groups.length === 0) {
                this.emptyMsg = listEl.createEl('p', { text: 'No folders yet. Click "New Folder" to create one.' });
                this.emptyMsg.style.cssText = 'color: var(--text-muted); text-align: center; margin: 32px 0;';
            }

            this.innerList = listEl.createDiv();
            this.innerList.style.cssText = 'display: flex; flex-direction: column; gap: 8px;';

            for (const group of groups) {
                this.buildRow(group, this.innerList);
            }

            // ── Fixed footer ──────────────────────────────────────────────────
            const footer = contentEl.createDiv();
            footer.style.cssText = `
                display: flex; justify-content: flex-end; align-items: center;
                padding: 12px 20px;
                flex-shrink: 0;
                border-top: 1px solid var(--background-modifier-border);
            `;

            const closeBtn = footer.createEl('button', { text: 'Close', cls: 'mod-cta' });
            closeBtn.onclick = () => this.close();
        }

        // ── Append a newly-created row without re-rendering ───────────────────
        private appendRow(group: FeedGroup) {
            if (!this.innerList) return;

            if (this.emptyMsg) {
                this.emptyMsg.remove();
                this.emptyMsg = null;
            }

            this.buildRow(group, this.innerList);
        }

        // ── Build a single folder row ─────────────────────────────────────────
        private buildRow(group: FeedGroup, container: HTMLElement) {
            const row = container.createDiv();
            row.style.cssText = `
                display: flex; align-items: center; gap: 8px;
                background: var(--background-secondary);
                border: 1px solid var(--background-modifier-border);
                border-radius: 8px; padding: 8px 12px;
                transition: border-color 0.15s ease;
            `;
            row.onmouseenter = () => { row.style.borderColor = 'var(--interactive-accent)'; };
            row.onmouseleave = () => { row.style.borderColor = 'var(--background-modifier-border)'; };

            const folderIconEl = row.createDiv();
            folderIconEl.style.cssText = 'display: flex; align-items: center; width: 16px; height: 16px; flex-shrink: 0; color: var(--text-muted);';
            setIcon(folderIconEl, 'folder');

            const nameEl = row.createEl('span', { text: group.name });
            nameEl.style.cssText = 'flex: 1; font-size: 0.9em; color: var(--text-normal);';

            const feedCount = plugin.settings.feeds.filter(f => f.groupId === group.id).length;
            const countBadge = row.createEl('span', { text: `${feedCount} feed${feedCount !== 1 ? 's' : ''}` });
            countBadge.style.cssText = 'font-size: 0.78em; color: var(--text-muted); background: var(--background-modifier-hover); border-radius: 4px; padding: 2px 6px; white-space: nowrap;';

            // ── Rename ────────────────────────────────────────────────────────
            const renameBtn = row.createEl('button');
            renameBtn.title = 'Rename folder';
            renameBtn.style.cssText = 'display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 5px; border: none; background: transparent; cursor: pointer; color: var(--text-muted); transition: background 0.12s ease; flex-shrink: 0;';
            renameBtn.addEventListener('mouseenter', () => { renameBtn.style.background = 'var(--background-modifier-hover)'; renameBtn.style.color = 'var(--text-normal)'; });
            renameBtn.addEventListener('mouseleave', () => { renameBtn.style.background = 'transparent'; renameBtn.style.color = 'var(--text-muted)'; });
            const renameIconEl = renameBtn.createDiv();
            renameIconEl.style.cssText = 'display: flex; align-items: center; width: 14px; height: 14px;';
            setIcon(renameIconEl, 'pencil');
            renameBtn.addEventListener('click', async () => {
                const newName = await promptFolderName(app, group.name);
                if (!newName || newName === group.name) return;

                await renameFeedGroupFolder(app, plugin, group, newName);
                await plugin.saveSettingsSilent();
                onDone();
                nameEl.setText(group.name);
                new Notice(`Renamed to "${group.name}"`);
            });

            // ── Delete ────────────────────────────────────────────────────────
            const deleteBtn = row.createEl('button');
            deleteBtn.title = 'Delete folder';
            deleteBtn.style.cssText = 'display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 5px; border: none; background: transparent; cursor: pointer; color: var(--text-muted); transition: background 0.12s ease; flex-shrink: 0;';
            deleteBtn.addEventListener('mouseenter', () => { deleteBtn.style.background = 'var(--background-modifier-hover)'; deleteBtn.style.color = 'var(--color-red)'; });
            deleteBtn.addEventListener('mouseleave', () => { deleteBtn.style.background = 'transparent'; deleteBtn.style.color = 'var(--text-muted)'; });
            const deleteIconEl = deleteBtn.createDiv();
            deleteIconEl.style.cssText = 'display: flex; align-items: center; width: 14px; height: 14px;';
            setIcon(deleteIconEl, 'trash');
            deleteBtn.addEventListener('click', async () => {
                const deletedName = group.name;
                const hide = showGlobalLoading('Moving feeds...');
                try {
                    for (const f of plugin.settings.feeds) {
                        if (f.groupId === group.id) await moveFeedFolder(app, plugin, f, undefined);
                    }
                    plugin.settings.groups = plugin.settings.groups.filter(g => g.id !== group.id);
                    await plugin.saveSettings();
                } finally { hide(); }
                onDone();

                // Remove just this row — no re-render, scroll position preserved
                row.remove();

                // Show empty state if the list is now empty
                if (this.innerList && this.innerList.childElementCount === 0) {
                    const parent = this.innerList.parentElement!;
                    this.emptyMsg = parent.createEl('p', { text: 'No folders yet. Click "New Folder" to create one.' });
                    this.emptyMsg.style.cssText = 'color: var(--text-muted); text-align: center; margin: 32px 0;';
                    parent.insertBefore(this.emptyMsg, this.innerList);
                }

                new Notice(`Deleted folder "${deletedName}"`);
            });
        }

        onClose() { this.contentEl.empty(); }
    }

    new EditFoldersModal(app).open();
}

// ─── Folder name prompt ───────────────────────────────────────────────────────

export function promptFolderName(app: App, existingName?: string): Promise<string | null> {
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

                input.addEventListener('input', (e: Event) => { this.value = (e.target as HTMLInputElement).value; });
                input.addEventListener('keydown', (e: KeyboardEvent) => {
                    if (e.key === 'Enter' && this.value.trim()) { this.resolved = true; this.close(); }
                    if (e.key === 'Escape') this.close();
                });

                const footer = contentEl.createDiv();
                footer.style.cssText = 'display: flex; justify-content: flex-end; gap: 8px;';

                const cancelBtn = footer.createEl('button', { text: 'Cancel' });
                cancelBtn.onclick = () => this.close();

                const confirmBtn = footer.createEl('button', { text: existingName ? 'Rename' : 'Create', cls: 'mod-cta' });
                confirmBtn.onclick = () => { if (this.value.trim()) { this.resolved = true; this.close(); } };
            }

            onClose() { resolve(this.resolved ? this.value.trim() : null); }
        }

        new FolderNameModal(app).open();
    });
}

// ─── Folder filter dropdown ───────────────────────────────────────────────────

type FolderFilter = string | null;

export function renderFolderDropdown(
    containerEl: HTMLElement,
    plugin: RssPlugin,
    getFilter: () => FolderFilter,
    onFilter: (folder: FolderFilter) => void
): void {
    const groups = sortGroups(plugin.settings.groups);
    if (groups.length === 0) return;

    const sep = containerEl.createDiv();
    sep.style.cssText = 'width: 1px; height: 18px; background: var(--background-modifier-border); margin: 0 8px 0 2px; flex-shrink: 0;';

    const trigger = containerEl.createEl('button');

    const updateTriggerLabel = () => {
        trigger.empty();
        const iconEl = trigger.createDiv();
        iconEl.style.cssText = 'display: flex; align-items: center; width: 14px; height: 14px; flex-shrink: 0;';
        setIcon(iconEl, 'folder');
        const current = getFilter();
        const label = current === null
            ? 'All Folders'
            : (groups.find(g => g.id === current)?.name ?? 'All Folders');
        trigger.createSpan({ text: label });
        const chevron = trigger.createDiv();
        chevron.style.cssText = 'display: flex; align-items: center; width: 14px; height: 14px; margin-left: 2px; opacity: 0.6;';
        setIcon(chevron, 'chevron-down');

        const isFiltered = current !== null;
        trigger.style.borderColor = isFiltered ? 'var(--interactive-accent)' : 'var(--background-modifier-border)';
        trigger.style.color       = isFiltered ? 'var(--text-normal)'        : 'var(--text-muted)';
    };

    trigger.style.cssText = `
        display: flex; align-items: center; gap: 5px;
        padding: 4px 10px; border-radius: 20px; font-size: 0.82em; cursor: pointer;
        border: 1px solid var(--background-modifier-border);
        background: transparent; color: var(--text-muted);
        transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
    `;

    updateTriggerLabel();

    let popover: HTMLElement | null = null;

    const closePopover = () => {
        if (!popover) return;
        popover.remove();
        popover = null;
        document.removeEventListener('click',     onOutsideClick);
        document.removeEventListener('touchstart', onOutsideTouch);
    };

    const onOutsideClick = (ev: MouseEvent) => {
        if (popover && !popover.contains(ev.target as Node) && !trigger.contains(ev.target as Node)) closePopover();
    };

    const onOutsideTouch = (ev: TouchEvent) => {
        const target = ev.touches[0]?.target as Node | null;
        if (popover && target && !popover.contains(target) && !trigger.contains(target)) closePopover();
    };

    const openPopover = () => {
        popover = document.body.createDiv();
        popover.style.cssText = `
            position: fixed; z-index: 9999;
            background: var(--background-primary);
            border: 1px solid var(--background-modifier-border);
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.35);
            padding: 4px;
            min-width: 180px;
        `;

        const addOption = (label: string, value: FolderFilter, icon: string) => {
            const item = popover!.createDiv();
            const isCurrent = getFilter() === value;
            item.style.cssText = `
                display: flex; align-items: center; gap: 8px;
                padding: 8px 12px; border-radius: 5px; cursor: pointer;
                font-size: 0.85em;
                background: ${isCurrent ? 'var(--background-modifier-hover)' : 'transparent'};
                color: ${isCurrent ? 'var(--text-normal)' : 'var(--text-muted)'};
                font-weight: ${isCurrent ? '500' : '400'};
            `;
            const iconEl = item.createDiv();
            iconEl.style.cssText = 'display: flex; align-items: center; width: 14px; height: 14px; flex-shrink: 0;';
            setIcon(iconEl, icon);
            item.createSpan({ text: label });
            item.onmouseenter = () => { item.style.background = 'var(--background-modifier-hover)'; item.style.color = 'var(--text-normal)'; };
            item.onmouseleave = () => {
                item.style.background = isCurrent ? 'var(--background-modifier-hover)' : 'transparent';
                item.style.color      = isCurrent ? 'var(--text-normal)'               : 'var(--text-muted)';
            };
            item.addEventListener('pointerdown', (ev) => {
                ev.preventDefault();
                onFilter(value);
                updateTriggerLabel();
                closePopover();
            });
        };

        addOption('All Folders', null, 'layers');
        const dividerEl = popover.createEl('hr');
        dividerEl.style.cssText = 'border: none; border-top: 1px solid var(--background-modifier-border); margin: 4px 0;';
        for (const group of groups) addOption(group.name, group.id, 'folder');

        popover.style.visibility = 'hidden';
        document.body.appendChild(popover);

        const rect   = trigger.getBoundingClientRect();
        const popW   = popover.offsetWidth;
        const popH   = popover.offsetHeight;
        const vw     = window.innerWidth;
        const vh     = window.innerHeight;
        const margin = 8;

        let left = rect.left;
        if (left + popW + margin > vw) left = Math.max(margin, rect.right - popW);
        let top = rect.bottom + 6;
        if (top + popH + margin > vh) top = Math.max(margin, rect.top - popH - 6);

        popover.style.top        = `${top}px`;
        popover.style.left       = `${left}px`;
        popover.style.visibility = 'visible';

        setTimeout(() => {
            document.addEventListener('click',     onOutsideClick);
            document.addEventListener('touchstart', onOutsideTouch, { passive: true });
        }, 0);
    };

    trigger.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (popover) { closePopover(); return; }
        openPopover();
    });
}