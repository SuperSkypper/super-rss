import { App, Setting, Notice, setIcon, Modal } from 'obsidian';
import RssPlugin, { FeedConfig, FeedGroup } from '../main';
import {
    sortGroups,
    openMoveToFolderModal,
    openEditFoldersModal,
    renderFolderDropdown,
    moveFeedFolder,
    showGlobalLoading,
} from './editFolders';
import { openBulkEditModal } from './editBulk';

// FeedEditModal and ConfirmDeleteModal are lazy-loaded on first use
// to avoid paying their parse/init cost when My Feeds tab opens.
let _FeedEditModal: typeof import('./feedEdit').FeedEditModal | undefined;
let _ConfirmDeleteModal: typeof import('./feedEdit').ConfirmDeleteModal | undefined;

async function getFeedEditModal() {
    if (!_FeedEditModal) ({ FeedEditModal: _FeedEditModal } = await import('./feedEdit'));
    return _FeedEditModal!;
}

async function getConfirmDeleteModal() {
    if (!_ConfirmDeleteModal) ({ ConfirmDeleteModal: _ConfirmDeleteModal } = await import('./feedEdit'));
    return _ConfirmDeleteModal!;
}

// ─── Shared CSS Constants for Alignment ───────────────────────────────────────
const CONTROL_WRAPPER_CSS = 'display: flex; align-items: center; justify-content: center; width: 44px; min-width: 44px; flex-shrink: 0; margin: 0; padding: 0;';
const CHECKBOX_CSS = 'cursor: pointer; width: 18px; height: 18px; min-width: 18px; margin: 0; padding: 0;';
const SEPARATOR_CSS = 'width: 1px; height: 18px; background: var(--background-modifier-border); margin: 0 12px; flex-shrink: 0; padding: 0;';

// ─── Sort helpers ─────────────────────────────────────────────────────────────
const COLLATOR = new Intl.Collator(undefined, { sensitivity: 'base' });

function sortFeeds(feeds: FeedConfig[]): FeedConfig[] {
    return [...feeds].sort((a, b) => COLLATOR.compare(a.name || '', b.name || ''));
}

// ─── Filter type ──────────────────────────────────────────────────────────────

type FeedFilter   = 'all' | 'active' | 'disabled' | 'archived' | 'trash';
type FolderFilter = string | null;

// ─── Main ─────────────────────────────────────────────────────────────────────

export function renderMyFeedsTab(
    containerEl: HTMLElement,
    app: App,
    plugin: RssPlugin,
    applyCardStyle: (setting: Setting) => void,
    onRefresh: () => void
): void {
    let activeFilter: FeedFilter = 'all';
    let folderFilter: FolderFilter = null;
    let searchQuery: string = '';
    const selectedFeeds = new Set<string>();

    const title = containerEl.createEl('div', { text: 'Manage Feeds' });
    title.style.cssText = 'font-size: 1.1em; font-weight: 600; color: var(--text-normal); margin-bottom: 10px;';

    // ── Tab filter bar ────────────────────────────────────────────────────────
    const filterRow = containerEl.createDiv();
    filterRow.style.cssText = 'display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-bottom: 10px;';

    // ── Controls card ─────────────────────────────────────────────────────────
    const controlsCard = containerEl.createDiv();
    controlsCard.style.cssText = `
        background: var(--background-secondary);
        border: 1px solid var(--background-modifier-border);
        border-radius: 10px;
        padding: 12px 18px;
        margin-bottom: 12px;
        display: flex;
        align-items: center;
        gap: 0;
        min-height: 52px;
        transition: border-color 0.15s ease;
    `;

    // ── Feed list ─────────────────────────────────────────────────────────────
    const listEl = containerEl.createDiv();

    // ── Helper: feeds visible in the current tab ──────────────────────────────
    const getVisibleFeeds = (): FeedConfig[] =>
        plugin.settings.feeds.filter(feed => {
            const st      = (feed.deleted ?? false) ? 'deleted' : (feed.archived ?? false) ? 'archived' : 'normal';
            const enabled = feed.enabled;
            let show = false;
            if (activeFilter === 'all')      show = st !== 'deleted';
            if (activeFilter === 'active')   show = st === 'normal' && enabled;
            if (activeFilter === 'disabled') show = st === 'normal' && !enabled;
            if (activeFilter === 'archived') show = st === 'archived';
            if (activeFilter === 'trash')    show = st === 'deleted';
            if (show && folderFilter !== null) show = (feed.groupId ?? '') === folderFilter;
            if (show && searchQuery) {
                const q = searchQuery.toLowerCase();
                show = (feed.name ?? '').toLowerCase().includes(q) ||
                       (feed.url  ?? '').toLowerCase().includes(q);
            }
            return show;
        });

    // ── One-time auto-purge on tab open ───────────────────────────────────────
    {
        const now = Date.now();
        const FIFTEEN = 15 * 24 * 60 * 60 * 1000;
        const before = plugin.settings.feeds.length;
        plugin.settings.feeds = plugin.settings.feeds.filter(
            (f: FeedConfig) => !(f.deleted && f.deletedAt && (now - f.deletedAt > FIFTEEN))
        );
        if (plugin.settings.feeds.length !== before) plugin.saveSettings();
    }

    // ── Rebuild the entire tab content (cards) ────────────────────────────────
    const rebuildList = () => {
        listEl.empty();

        const visible = getVisibleFeeds();

        if (visible.length === 0) {
            const empty = listEl.createEl('p', { text: 'No feeds in this category.' });
            empty.style.cssText = 'color: var(--text-muted); text-align: center; margin-top: 24px;';
            return;
        }

        const sortedGroups = sortGroups(plugin.settings.groups);

        const selectEls: HTMLSelectElement[] = [];
        const updateSelectVisibility = () => {
            const narrow = listEl.offsetWidth < 500;
            selectEls.forEach(s => { s.style.display = narrow ? 'none' : ''; });
        };
        const listRo = new ResizeObserver(updateSelectVisibility);
        listRo.observe(listEl);
        const listRoCleanup = new MutationObserver(() => { listRo.disconnect(); listRoCleanup.disconnect(); });
        listRoCleanup.observe(listEl, { childList: true });

        sortFeeds(visible).forEach(feed => {
            const globalIndex = plugin.settings.feeds.indexOf(feed);
            const st = (feed.deleted ?? false) ? 'deleted' : (feed.archived ?? false) ? 'archived' : 'normal';
            renderFeedCard(
                app, plugin, listEl, plugin.settings.feeds, feed, globalIndex,
                sortedGroups, selectedFeeds,
                () => { selectedFeeds.clear(); fullRefresh(); },
                () => { renderControlsCard(); },
                st,
                selectEls
            );
        });

        updateSelectVisibility();
    };

    const fullRefresh = () => {
        rebuildList();
        renderControlsCard();
    };

    // ── Controls card renderer ────────────────────────────────────────────────
    const renderControlsCard = () => {
        controlsCard.empty();
        controlsCard.style.removeProperty('border-color');

        // ── Trash tab ─────────────────────────────────────────────────────────
        if (activeFilter === 'trash') {
            const visibleFeeds = getVisibleFeeds();
            const hasSelection = selectedFeeds.size > 0;

            const cbWrap = controlsCard.createDiv();
            cbWrap.style.cssText = CONTROL_WRAPPER_CSS;
            const cb = cbWrap.createEl('input', { type: 'checkbox' });
            cb.style.cssText = CHECKBOX_CSS;
            cb.checked       = visibleFeeds.length > 0 && visibleFeeds.every((f: FeedConfig) => selectedFeeds.has(f.url));
            cb.indeterminate = hasSelection && !cb.checked;
            cb.title         = 'Select all';
            cb.addEventListener('change', () => {
                if (cb.checked) visibleFeeds.forEach((f: FeedConfig) => selectedFeeds.add(f.url));
                else            visibleFeeds.forEach((f: FeedConfig) => selectedFeeds.delete(f.url));
                renderControlsCard();
                listEl.querySelectorAll<HTMLInputElement>('[data-feed-url] input[type="checkbox"]').forEach(cardCb => {
                    const url = (cardCb.closest('[data-feed-url]') as HTMLElement)?.dataset.feedUrl ?? '';
                    cardCb.checked = selectedFeeds.has(url);
                });
            });

            const sep = controlsCard.createDiv();
            sep.style.cssText = SEPARATOR_CSS;

            if (hasSelection) {
                controlsCard.style.setProperty('border-color', 'var(--interactive-accent)');

                const countEl = controlsCard.createSpan({ text: `${hasSelection ? selectedFeeds.size : 0} selected` });
                countEl.style.cssText = 'font-size: 0.82em; font-weight: 600; color: var(--interactive-accent); padding: 0 4px;';

                const deselectBtn = controlsCard.createEl('button');
                deselectBtn.style.cssText = 'display: flex; align-items: center; gap: 4px; padding: 3px 8px; border-radius: 6px; border: none; cursor: pointer; font-size: 0.83em; background: transparent; color: var(--text-muted); transition: background 0.12s ease;';
                deselectBtn.addEventListener('mouseenter', () => { deselectBtn.style.background = 'var(--background-modifier-hover)'; });
                deselectBtn.addEventListener('mouseleave', () => { deselectBtn.style.background = 'transparent'; });
                const xIcon = deselectBtn.createDiv();
                xIcon.style.cssText = 'display: flex; align-items: center; width: 14px; height: 14px; flex-shrink: 0;';
                setIcon(xIcon, 'x');
                deselectBtn.createSpan({ text: 'Deselect' });
                deselectBtn.addEventListener('click', () => { selectedFeeds.clear(); renderControlsCard(); rebuildList(); });

                const sep2 = controlsCard.createDiv();
                sep2.style.cssText = 'width: 1px; height: 22px; background: var(--background-modifier-border); margin: 0 16px; flex-shrink: 0;';

                const restoreBtn = controlsCard.createEl('button');
                restoreBtn.style.cssText = 'display: flex; align-items: center; gap: 5px; padding: 5px 10px; border-radius: 6px; border: none; cursor: pointer; font-size: 0.83em; background: transparent; color: var(--text-normal); transition: background 0.12s ease;';
                restoreBtn.title = 'Restore selected';
                restoreBtn.addEventListener('mouseenter', () => { restoreBtn.style.background = 'var(--background-modifier-hover)'; });
                restoreBtn.addEventListener('mouseleave', () => { restoreBtn.style.background = 'transparent'; });
                const restoreIcon = restoreBtn.createDiv();
                restoreIcon.style.cssText = 'display: flex; align-items: center; width: 15px; height: 15px; flex-shrink: 0;';
                setIcon(restoreIcon, 'undo');
                const restoreLabel = restoreBtn.createSpan({ text: 'Restore' });
                const updateRestoreLabel = () => { restoreLabel.style.display = controlsCard.offsetWidth < 480 ? 'none' : ''; };
                updateRestoreLabel();
                const restoreRo = new ResizeObserver(updateRestoreLabel);
                restoreRo.observe(controlsCard);
                const restoreRoCleanup = new MutationObserver(() => { restoreRo.disconnect(); restoreRoCleanup.disconnect(); });
                restoreRoCleanup.observe(controlsCard, { childList: true });
                restoreBtn.addEventListener('click', async () => {
                    const count = selectedFeeds.size;
                    plugin.settings.feeds.forEach((f: FeedConfig) => {
                        if (!selectedFeeds.has(f.url)) return;
                        f.deleted = false;
                        delete f.deletedAt;
                    });
                    selectedFeeds.clear();
                    await plugin.saveSettings();
                    fullRefresh();
                    new Notice(`Restored ${count} feed${count !== 1 ? 's' : ''}`);
                });

                const sep3 = controlsCard.createDiv();
                sep3.style.cssText = 'width: 1px; height: 22px; background: var(--background-modifier-border); margin: 0 8px; flex-shrink: 0;';

                const delBtn = controlsCard.createEl('button');
                delBtn.style.cssText = 'display: flex; align-items: center; gap: 5px; padding: 5px 10px; border-radius: 6px; border: none; cursor: pointer; font-size: 0.83em; background: transparent; color: var(--color-red); transition: background 0.12s ease;';
                delBtn.title = 'Delete permanently';
                delBtn.addEventListener('mouseenter', () => { delBtn.style.background = 'var(--background-modifier-hover)'; });
                delBtn.addEventListener('mouseleave', () => { delBtn.style.background = 'transparent'; });
                const delIcon = delBtn.createDiv();
                delIcon.style.cssText = 'display: flex; align-items: center; width: 15px; height: 15px; flex-shrink: 0;';
                setIcon(delIcon, 'trash');
                const delLabel = delBtn.createSpan({ text: 'Delete permanently' });

                const updateDelLabel = () => { delLabel.style.display = controlsCard.offsetWidth < 480 ? 'none' : ''; };
                updateDelLabel();
                const delRo = new ResizeObserver(updateDelLabel);
                delRo.observe(controlsCard);
                const delRoCleanup = new MutationObserver(() => { delRo.disconnect(); delRoCleanup.disconnect(); });
                delRoCleanup.observe(controlsCard, { childList: true });

                delBtn.addEventListener('click', async () => {
                    const count = selectedFeeds.size;
                    const ConfirmDeleteModal = await getConfirmDeleteModal();
                    new ConfirmDeleteModal(app,
                        async () => {
                            plugin.settings.feeds = plugin.settings.feeds.filter((f: FeedConfig) => !selectedFeeds.has(f.url));
                            selectedFeeds.clear();
                            await plugin.saveSettings();
                            fullRefresh();
                            new Notice(`Permanently deleted ${count} feed${count !== 1 ? 's' : ''}`);
                        },
                        async () => {
                            plugin.settings.feeds = plugin.settings.feeds.filter((f: FeedConfig) => !selectedFeeds.has(f.url));
                            selectedFeeds.clear();
                            await plugin.saveSettings();
                            fullRefresh();
                            new Notice(`Permanently deleted ${count} feed${count !== 1 ? 's' : ''}`);
                        }
                    ).open();
                });

            } else {
                controlsCard.style.removeProperty('border-color');
                const label = controlsCard.createSpan({ text: 'Select all' });
                label.style.cssText = 'font-size: 0.82em; color: var(--text-muted);';
            }

            const spacer = controlsCard.createDiv();
            spacer.style.cssText = 'flex: 1;';
            const iconEl = controlsCard.createDiv();
            iconEl.style.cssText = 'display: flex; align-items: center; width: 14px; height: 14px; flex-shrink: 0; color: var(--color-orange);';
            setIcon(iconEl, 'clock');
            const msg = controlsCard.createSpan({ text: 'Auto-deleted after 15 days' });
            msg.style.cssText = 'font-size: 0.78em; color: var(--text-muted); white-space: nowrap;';
            return;
        }

        const visibleFeeds = getVisibleFeeds();
        const hasSelection = selectedFeeds.size > 0;

        const cbWrap = controlsCard.createDiv();
        cbWrap.style.cssText = CONTROL_WRAPPER_CSS;
        const cb = cbWrap.createEl('input', { type: 'checkbox' });
        cb.style.cssText = CHECKBOX_CSS;
        cb.checked       = visibleFeeds.length > 0 && visibleFeeds.every((f: FeedConfig) => selectedFeeds.has(f.url));
        cb.indeterminate = hasSelection && !cb.checked;
        cb.title         = 'Select all';
        cb.addEventListener('change', () => {
            if (cb.checked) visibleFeeds.forEach((f: FeedConfig) => selectedFeeds.add(f.url));
            else            visibleFeeds.forEach((f: FeedConfig) => selectedFeeds.delete(f.url));
            renderControlsCard();
            listEl.querySelectorAll<HTMLInputElement>('[data-feed-url] input[type="checkbox"]').forEach(cardCb => {
                const url = (cardCb.closest('[data-feed-url]') as HTMLElement)?.dataset.feedUrl ?? '';
                cardCb.checked = selectedFeeds.has(url);
            });
        });

        if (hasSelection) {
            const tgWrap = controlsCard.createDiv();
            tgWrap.style.cssText = CONTROL_WRAPPER_CSS;
            const toggleEl = tgWrap.createEl('div', { cls: 'checkbox-container' });
            toggleEl.style.margin = '0';
            const selList = plugin.settings.feeds.filter((f: FeedConfig) => selectedFeeds.has(f.url));
            const allOn   = selList.every((f: FeedConfig) => f.enabled);
            if (allOn) toggleEl.classList.add('is-enabled');
            toggleEl.title = allOn ? 'Disable selected' : 'Enable selected';
            toggleEl.addEventListener('click', async () => {
                const enabling = !toggleEl.classList.contains('is-enabled');
                selList.forEach((f: FeedConfig) => {
                    f.enabled = enabling;
                    if (enabling) {
                        if (f.archived) f.archived = false;
                        if (f.deleted)  { f.deleted = false; delete f.deletedAt; }
                    }
                });
                await plugin.saveSettings();
                fullRefresh();
            });
        }

        const sep = controlsCard.createDiv();
        sep.style.cssText = SEPARATOR_CSS;

        if (hasSelection) {
            controlsCard.style.setProperty('border-color', 'var(--interactive-accent)');

            const countEl = controlsCard.createSpan({ text: `${selectedFeeds.size} selected` });
            countEl.style.cssText = 'font-size: 0.82em; font-weight: 600; color: var(--interactive-accent); padding: 0 4px;';

            const deselectBtn = controlsCard.createEl('button');
            deselectBtn.style.cssText = 'display: flex; align-items: center; gap: 4px; padding: 3px 8px; border-radius: 6px; border: none; cursor: pointer; font-size: 0.83em; background: transparent; color: var(--text-muted); transition: background 0.12s ease;';
            deselectBtn.addEventListener('mouseenter', () => { deselectBtn.style.background = 'var(--background-modifier-hover)'; });
            deselectBtn.addEventListener('mouseleave', () => { deselectBtn.style.background = 'transparent'; });
            const xIcon = deselectBtn.createDiv();
            xIcon.style.cssText = 'display: flex; align-items: center; width: 14px; height: 14px; flex-shrink: 0;';
            setIcon(xIcon, 'x');
            deselectBtn.createSpan({ text: 'Deselect' });
            deselectBtn.addEventListener('click', () => { selectedFeeds.clear(); renderControlsCard(); rebuildList(); });

            const sep2 = controlsCard.createDiv();
            sep2.style.cssText = 'width: 1px; height: 22px; background: var(--background-modifier-border); margin: 0 16px; flex-shrink: 0;';

            const addActionBtn = (icon: string, label: string, onClick: () => void) => {
                const btn = controlsCard.createEl('button');
                btn.style.cssText = 'display: flex; align-items: center; gap: 5px; padding: 5px 10px; border-radius: 6px; border: none; cursor: pointer; font-size: 0.83em; background: transparent; color: var(--text-normal); transition: background 0.12s ease; margin-left: 4px;';
                btn.title = label;
                btn.addEventListener('mouseenter', () => { btn.style.background = 'var(--background-modifier-hover)'; });
                btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; });
                const iconEl = btn.createDiv();
                iconEl.style.cssText = 'display: flex; align-items: center; width: 15px; height: 15px; flex-shrink: 0;';
                setIcon(iconEl, icon);
                const labelEl = btn.createSpan({ text: label });

                const updateLabel = () => { labelEl.style.display = controlsCard.offsetWidth < 480 ? 'none' : ''; };
                updateLabel();

                const ro = new ResizeObserver(updateLabel);
                ro.observe(controlsCard);
                const roCleanup = new MutationObserver(() => { ro.disconnect(); roCleanup.disconnect(); });
                roCleanup.observe(controlsCard, { childList: true });

                btn.addEventListener('click', onClick);
                return btn;
            };

            if (activeFilter === 'archived') {
                addActionBtn('archive-restore', 'Unarchive', async () => {
                    plugin.settings.feeds.forEach((f: FeedConfig) => { if (selectedFeeds.has(f.url)) f.archived = false; });
                    selectedFeeds.clear();
                    await plugin.saveSettings();
                    fullRefresh();
                });

                addActionBtn('trash', 'Delete', async () => {
                    const now = Date.now();
                    plugin.settings.feeds.forEach((f: FeedConfig) => {
                        if (selectedFeeds.has(f.url)) { f.deleted = true; f.deletedAt = now; f.enabled = false; f.archived = false; }
                    });
                    selectedFeeds.clear();
                    await plugin.saveSettings();
                    fullRefresh();
                });
            } else {
                addActionBtn('folder-input', 'Move to Folder', () => {
                    openMoveToFolderModal(app, plugin, selectedFeeds, () => { selectedFeeds.clear(); fullRefresh(); });
                });

                addActionBtn('archive', 'Archive', async () => {
                    plugin.settings.feeds.forEach((f: FeedConfig) => { if (selectedFeeds.has(f.url)) { f.archived = true; f.enabled = false; } });
                    selectedFeeds.clear();
                    await plugin.saveSettings();
                    fullRefresh();
                });

                addActionBtn('trash', 'Delete', async () => {
                    const now = Date.now();
                    plugin.settings.feeds.forEach((f: FeedConfig) => {
                        if (selectedFeeds.has(f.url)) { f.deleted = true; f.deletedAt = now; f.enabled = false; }
                    });
                    selectedFeeds.clear();
                    await plugin.saveSettings();
                    fullRefresh();
                });
            }

            const spacer = controlsCard.createDiv();
            spacer.style.cssText = 'flex: 1;';

            addActionBtn('sliders-horizontal', 'Multi Edit', () => {
                openBulkEditModal(app, plugin, selectedFeeds, () => { selectedFeeds.clear(); fullRefresh(); });
            });

        } else {
            const label = controlsCard.createSpan({ text: 'Select all' });
            label.style.cssText = 'font-size: 0.82em; color: var(--text-muted);';

            const spacer = controlsCard.createDiv();
            spacer.style.cssText = 'flex: 1;';

            const editFoldersBtn = controlsCard.createEl('button');
            editFoldersBtn.style.cssText = 'display: flex; align-items: center; gap: 5px; padding: 5px 12px; border-radius: 6px; font-size: 0.85em; cursor: pointer; border: 1px solid var(--background-modifier-border); background: transparent; color: var(--text-muted); transition: all 0.15s ease;';
            const editFoldersIcon = editFoldersBtn.createDiv();
            editFoldersIcon.style.cssText = 'display: flex; align-items: center; width: 14px; height: 14px;';
            setIcon(editFoldersIcon, 'folder-edit');
            editFoldersBtn.createSpan({ text: 'Edit Folders' });
            editFoldersBtn.addEventListener('click', () => {
                openEditFoldersModal(app, plugin, () => { onRefresh(); fullRefresh(); });
            });
        }
    };

    renderStatusFilterBar(filterRow, () => activeFilter, (f) => {
        activeFilter = f;
        selectedFeeds.clear();
        fullRefresh();
    });

    renderFolderDropdown(filterRow, plugin, () => folderFilter, (f: FolderFilter) => {
        folderFilter = f;
        selectedFeeds.clear();
        fullRefresh();
    });

    // ── Search bar ────────────────────────────────────────────────────────────
    const searchWrap = filterRow.createDiv();
    searchWrap.style.cssText = 'display: flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 20px; border: 1px solid var(--background-modifier-border); background: transparent; transition: border-color 0.15s ease; margin-left: 2px; flex: 1;';
    const searchIcon = searchWrap.createDiv();
    searchIcon.style.cssText = 'display: flex; align-items: center; width: 13px; height: 13px; flex-shrink: 0; opacity: 0.5;';
    setIcon(searchIcon, 'search');
    const searchInput = searchWrap.createEl('input', { type: 'text' });
    searchInput.placeholder = 'Search feeds…';
    searchInput.style.cssText = 'border: none; background: transparent; outline: none; font-size: 0.82em; color: var(--text-normal); width: 100%; line-height: 1; height: 18px;';
    searchWrap.addEventListener('focusin', () => { searchWrap.style.borderColor = 'var(--interactive-accent)'; });
    searchWrap.addEventListener('focusout', () => {
        searchWrap.style.borderColor = searchQuery ? 'var(--interactive-accent)' : 'var(--background-modifier-border)';
    });
    searchInput.addEventListener('input', () => {
        searchQuery = searchInput.value;
        selectedFeeds.clear();
        fullRefresh();
    });

    containerEl.appendChild(listEl);
    renderControlsCard();
    rebuildList();
}

// ─── Filter bar ───────────────────────────────────────────────────────────────

function renderStatusFilterBar(
    containerEl: HTMLElement,
    getFilter: () => FeedFilter,
    onFilter: (filter: FeedFilter) => void
): void {
    const filters: { key: FeedFilter; label: string }[] = [
        { key: 'all',      label: 'All'      },
        { key: 'active',   label: 'Active'   },
        { key: 'disabled', label: 'Disabled' },
        { key: 'archived', label: 'Archived' },
        { key: 'trash',    label: 'Trash'    },
    ];

    const buttons: HTMLButtonElement[] = [];

    const BASE_TAB     = 'padding: 6px 16px; border-radius: 6px; cursor: pointer; font-size: 0.9em; border: 1px solid var(--background-modifier-border); transition: all 0.2s ease; margin-right: 4px;';
    const ACTIVE_TAB   = 'background-color: var(--interactive-accent); color: var(--text-on-accent); border-color: var(--interactive-accent);';
    const INACTIVE_TAB = 'background-color: var(--background-secondary-alt); color: var(--text-muted);';

    for (const { key, label } of filters) {
        const isActive = key === getFilter();
        const btn = containerEl.createEl('button');
        btn.setText(label);
        btn.style.cssText = `${BASE_TAB} ${isActive ? ACTIVE_TAB : INACTIVE_TAB}`;
        buttons.push(btn);
        btn.addEventListener('click', () => {
            buttons.forEach(b => { b.style.cssText = `${BASE_TAB} ${INACTIVE_TAB}`; });
            btn.style.cssText = `${BASE_TAB} ${ACTIVE_TAB}`;
            onFilter(key);
        });
    }
}

// ─── Feed Card ────────────────────────────────────────────────────────────────

function renderFeedCard(
    app: App,
    plugin: RssPlugin,
    feedsContainer: HTMLElement,
    feeds: FeedConfig[],
    feed: FeedConfig,
    index: number,
    groups: FeedGroup[],
    selectedFeeds: Set<string>,
    onRefresh: () => void,
    onSelectionChange: () => void,
    status: 'normal' | 'archived' | 'deleted' = 'normal',
    selectEls?: HTMLSelectElement[]
): void {
    const isArchived = status === 'archived';
    const isDeleted  = status === 'deleted';

    const cardEl = feedsContainer.createDiv();
    cardEl.style.cssText = `
        background: var(--background-secondary);
        border: 1px solid var(--background-modifier-border);
        border-radius: 10px;
        padding: 12px 18px;
        margin-bottom: 12px;
        transition: all 0.2s ease;
        display: flex;
        align-items: center;
        position: relative;
        overflow: visible;
        gap: 0;
        ${isArchived ? 'opacity: 0.7;' : ''}
        ${isDeleted  ? 'opacity: 0.5;' : ''}
    `;
    cardEl.classList.add('rss-card-setting');
    cardEl.onmouseenter = () => { cardEl.style.borderColor = 'var(--interactive-accent)'; };
    cardEl.onmouseleave = () => { cardEl.style.borderColor = 'var(--background-modifier-border)'; };

    cardEl.dataset.feedUrl     = feed.url;
    cardEl.dataset.feedStatus  = status;
    cardEl.dataset.feedGroupId = feed.groupId ?? '';
    cardEl.dataset.feedEnabled = String(feed.enabled);

    const checkboxWrapper = cardEl.createDiv();
    checkboxWrapper.style.cssText = CONTROL_WRAPPER_CSS;
    const checkbox = checkboxWrapper.createEl('input', { type: 'checkbox' });
    checkbox.checked = selectedFeeds.has(feed.url);
    checkbox.style.cssText = CHECKBOX_CSS;
    checkbox.addEventListener('change', () => {
        if (checkbox.checked) selectedFeeds.add(feed.url);
        else selectedFeeds.delete(feed.url);
        onSelectionChange();
    });

    const toggleWrapper = cardEl.createDiv();
    toggleWrapper.style.cssText = CONTROL_WRAPPER_CSS;
    const toggleEl = toggleWrapper.createEl('div', { cls: 'checkbox-container' });
    toggleEl.style.margin = '0';
    if (feed.enabled) toggleEl.classList.add('is-enabled');
    toggleEl.addEventListener('click', async () => {
        feed.enabled = !feed.enabled;
        toggleEl.classList.toggle('is-enabled', feed.enabled);
        if (feed.enabled) {
            if (feed.archived) feed.archived = false;
            if (feed.deleted)  { feed.deleted = false; delete feed.deletedAt; }
            await plugin.saveSettings();
            onRefresh();
            return;
        }
        await plugin.saveSettings();
        onSelectionChange();
    });

    const separator = cardEl.createDiv();
    separator.style.cssText = SEPARATOR_CSS;

    const infoEl = cardEl.createDiv();
    infoEl.style.cssText = 'flex: 1 1 auto; min-width: 0; margin: 0; padding: 0;';
    const nameEl = infoEl.createDiv({ text: feed.name || 'Untitled Feed' });
    nameEl.style.cssText = 'font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 0.95em;';

    const controlEl = cardEl.createDiv();
    controlEl.style.cssText = 'display: flex; align-items: center; gap: 6px; flex-shrink: 0; margin-left: 12px;';

    // ── Delete Lives badge ────────────────────────────────────────────────────
    if (!isDeleted && feed.deleteLives) {
        const livesBadge = controlEl.createDiv();
        livesBadge.title = 'Delete Lives: on';
        livesBadge.style.cssText = `
            position: relative;
            display: flex; align-items: center; justify-content: center;
            width: 24px; height: 24px; flex-shrink: 0;
            opacity: 0.85; transition: opacity 0.12s ease;
        `;
        livesBadge.onmouseenter = () => { livesBadge.style.opacity = '1'; };
        livesBadge.onmouseleave = () => { livesBadge.style.opacity = '0.85'; };

        const radioEl = livesBadge.createDiv();
        radioEl.style.cssText = 'display: flex; align-items: center; width: 18px; height: 18px; color: var(--text-muted);';
        setIcon(radioEl, 'radio');

        const banEl = livesBadge.createDiv();
        banEl.style.cssText = `
            position: absolute; bottom: 0; right: -2px;
            display: flex; align-items: center;
            width: 13px; height: 13px;
            color: var(--color-red);
            background: var(--background-secondary);
            border-radius: 50%;
        `;
        setIcon(banEl, 'ban');
    }

    // ── Skip Shorts badge ─────────────────────────────────────────────────────
    if (!isDeleted) {
        const skipActive =
            feed.skipShorts === true ||
            (feed.skipShorts == null && plugin.settings.skipShortsGlobal === true);

        if (skipActive) {
            const skipBadge = controlEl.createDiv();
            skipBadge.title = feed.skipShorts === true
                ? 'Skip Shorts: on (per-feed)'
                : 'Skip Shorts: on (global)';
            skipBadge.style.cssText = `
                position: relative;
                display: flex; align-items: center; justify-content: center;
                width: 24px; height: 24px; flex-shrink: 0;
                opacity: 0.85; transition: opacity 0.12s ease;
            `;
            skipBadge.onmouseenter = () => { skipBadge.style.opacity = '1'; };
            skipBadge.onmouseleave = () => { skipBadge.style.opacity = '0.85'; };

            const phoneEl = skipBadge.createDiv();
            phoneEl.style.cssText = 'display: flex; align-items: center; width: 18px; height: 18px; color: var(--text-muted);';
            setIcon(phoneEl, 'smartphone');

            const banEl = skipBadge.createDiv();
            banEl.style.cssText = `
                position: absolute; bottom: 0; right: -2px;
                display: flex; align-items: center;
                width: 13px; height: 13px;
                color: var(--color-red);
                background: var(--background-secondary);
                border-radius: 50%;
            `;
            setIcon(banEl, 'ban');
        }
    }

    // ── Folder badge ──────────────────────────────────────────────────────────
    if (!isDeleted && groups.length > 0) {
        const currentGroup = groups.find(g => g.id === feed.groupId);
        const badge = controlEl.createDiv({ text: currentGroup?.name ?? '— folder —' });
        badge.style.cssText = `
            font-size: 0.78em; color: var(--text-muted);
            background: var(--background-modifier-hover);
            border: 1px solid var(--background-modifier-border);
            border-radius: 4px; padding: 3px 8px;
            white-space: nowrap; flex-shrink: 0; cursor: pointer;
            transition: border-color 0.12s ease;
        `;
        badge.title = 'Change folder';
        badge.onmouseenter = () => { badge.style.borderColor = 'var(--interactive-accent)'; };
        badge.onmouseleave = () => { badge.style.borderColor = 'var(--background-modifier-border)'; };

        badge.addEventListener('click', (e) => {
            e.stopPropagation();
            const existing = document.querySelector('.rss-folder-popover');
            if (existing) { existing.remove(); return; }

            const pop = document.body.createDiv({ cls: 'rss-folder-popover' });
            pop.style.cssText = `
                position: fixed; z-index: 9999;
                background: var(--background-primary);
                border: 1px solid var(--background-modifier-border);
                border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,0.3);
                padding: 4px; min-width: 160px;
            `;

            const addOpt = (label: string, val: string) => {
                const item = pop.createDiv({ text: label });
                const isCur = val === (feed.groupId ?? '');
                item.style.cssText = `padding: 6px 10px; border-radius: 5px; cursor: pointer; font-size: 0.85em; color: ${isCur ? 'var(--text-normal)' : 'var(--text-muted)'}; font-weight: ${isCur ? '500' : '400'};`;
                item.onmouseenter = () => { item.style.background = 'var(--background-modifier-hover)'; item.style.color = 'var(--text-normal)'; };
                item.onmouseleave = () => { item.style.background = 'transparent'; };
                item.addEventListener('pointerdown', async (ev) => {
                    ev.preventDefault();
                    pop.remove();
                    const hide = showGlobalLoading('Moving feed...');
                    try {
                        await moveFeedFolder(app, plugin, feed, val === '' ? undefined : val);
                        await plugin.saveSettings();
                    } finally { hide(); }
                    badge.setText(groups.find(g => g.id === feed.groupId)?.name ?? '— folder —');
                });
            };

            addOpt('— No folder —', '');
            groups.forEach(g => addOpt(g.name, g.id));

            const rect = badge.getBoundingClientRect();
            document.body.appendChild(pop);
            const popH = pop.offsetHeight;
            const vh = window.innerHeight;
            let top = rect.bottom + 4;
            if (top + popH > vh - 8) top = rect.top - popH - 4;
            pop.style.top  = `${top}px`;
            pop.style.left = `${rect.left}px`;

            const close = (ev: MouseEvent) => {
                if (!pop.contains(ev.target as Node) && ev.target !== badge) {
                    pop.remove();
                    document.removeEventListener('click', close);
                }
            };
            setTimeout(() => document.addEventListener('click', close), 0);
        });

        selectEls?.push(badge as any);
    }

    if (!isDeleted && groups.length > 0) {
        const btnSep = controlEl.createDiv();
        btnSep.style.cssText = 'width: 1px; height: 20px; background: var(--background-modifier-border); flex-shrink: 0;';
    }

    // ── Button helper ─────────────────────────────────────────────────────────
    const addBtn = (icon: string, tooltip: string, color?: string): HTMLButtonElement => {
        const btn = controlEl.createEl('button');
        btn.title = tooltip;
        btn.style.cssText = `display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 6px; border: none; background: transparent; cursor: pointer; color: ${color ?? 'var(--text-normal)'}; transition: background 0.12s ease;`;
        btn.addEventListener('mouseenter', () => { btn.style.background = 'var(--background-modifier-hover)'; });
        btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; });
        const iconEl = btn.createDiv();
        iconEl.style.cssText = 'display: flex; align-items: center; width: 18px; height: 18px;';
        setIcon(iconEl, icon);
        return btn;
    };

    // ── Update button (only for non-deleted feeds) ────────────────────────────
    if (!isDeleted) {
        const updateBtn = addBtn('refresh-cw', 'Update this feed');
        updateBtn.addEventListener('click', async () => {
            if (plugin.isUpdating) {
                new Notice('An update is already running.');
                return;
            }

            // Spin the icon while updating
            const iconEl = updateBtn.querySelector('div') as HTMLElement;
            iconEl.style.transition = 'transform 0.6s linear';
            iconEl.style.transform  = 'rotate(360deg)';
            updateBtn.disabled = true;

            try {
                const { saved, deleted } = await plugin.updateFeed(feed);
                plugin.showSummary(saved, deleted);
            } catch (e) {
                console.error(`RSS: Manual update failed for "${feed.name}":`, e);
                new Notice(`Update failed for "${feed.name}".`);
            } finally {
                iconEl.style.transition = '';
                iconEl.style.transform  = '';
                updateBtn.disabled = false;
            }
        });
    }

    // ── Edit button ───────────────────────────────────────────────────────────
    const editBtn = addBtn('pencil', 'Edit feed');
    editBtn.addEventListener('click', async () => {
        const liveIndex = plugin.settings.feeds.indexOf(feed);
        if (liveIndex === -1) return;
        const FeedEditModal = await getFeedEditModal();
        new FeedEditModal(app, plugin, feed,
            async () => { await plugin.saveSettings(); onRefresh(); },
            () => { plugin.settings.feeds.splice(liveIndex, 1); plugin.saveSettings(); onRefresh(); }
        ).open();
    });

    if (isDeleted) {
        const btn = addBtn('undo', 'Restore feed');
        btn.addEventListener('click', async () => {
            feed.deleted = false; delete feed.deletedAt;
            await plugin.saveSettings(); onRefresh();
        });
    } else if (isArchived) {
        const btn = addBtn('archive-restore', 'Unarchive feed');
        btn.addEventListener('click', async () => {
            feed.archived = false;
            await plugin.saveSettings(); onRefresh();
        });
    } else {
        const btn = addBtn('archive', 'Archive feed');
        btn.addEventListener('click', async () => {
            feed.archived = true; feed.enabled = false;
            await plugin.saveSettings(); onRefresh();
        });
    }

    if (isDeleted) {
        const btn = addBtn('trash', 'Permanently delete', 'var(--color-red)');
        btn.addEventListener('click', async () => {
            const ConfirmDeleteModal = await getConfirmDeleteModal();
            new ConfirmDeleteModal(app,
                async () => {
                    const liveIdx = plugin.settings.feeds.indexOf(feed);
                    if (liveIdx !== -1) plugin.settings.feeds.splice(liveIdx, 1);
                    await plugin.saveSettings(); onRefresh();
                },
                async () => {
                    const liveIdx = plugin.settings.feeds.indexOf(feed);
                    if (liveIdx !== -1) plugin.settings.feeds.splice(liveIdx, 1);
                    await plugin.saveSettings(); onRefresh();
                }
            ).open();
        });
    } else {
        const btn = addBtn('trash', 'Move to trash');
        btn.addEventListener('click', async () => {
            feed.deleted = true; feed.deletedAt = Date.now(); feed.enabled = false;
            await plugin.saveSettings(); onRefresh();
        });
    }
}