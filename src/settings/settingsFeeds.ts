import { App, Setting, Notice, setIcon } from 'obsidian';
import RssPlugin, { FeedConfig, FeedGroup } from '../main';
import { setDynamicCss } from "../utils/css";
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
    return _FeedEditModal;
}

async function getConfirmDeleteModal() {
    if (!_ConfirmDeleteModal) ({ ConfirmDeleteModal: _ConfirmDeleteModal } = await import('./feedEdit'));
    return _ConfirmDeleteModal;
}

// ─── Shared CSS Constants for Alignment ───────────────────────────────────────
const CONTROL_WRAPPER_CSS = 'display: flex; align-items: center; justify-content: center; width: 44px; min-width: 44px; flex-shrink: 0; margin: 0; padding: 0;';
const CHECKBOX_CSS = 'cursor: pointer; width: 18px; height: 18px; min-width: 18px; margin: 0; padding: 0;';
const SEPARATOR_CSS = 'width: 1px; height: 18px; background: var(--background-modifier-border); margin: 0 12px; flex-shrink: 0; padding: 0;';

// ─── Sort helpers ─────────────────────────────────────────────────────────────
const COLLATOR = new Intl.Collator(undefined, { sensitivity: 'base' });

// ─── Helpers ──────────────────────────────────────────────────────────────────

function debounce<T extends (...args: unknown[]) => void>(fn: T, ms: number): T {
    let timer: number;
    return ((...args: unknown[]) => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => fn(...args), ms);
    }) as T;
}

// ─── Virtual scroll ───────────────────────────────────────────────────────────
//
// Renders only the cards visible in the scroll viewport plus a small overscan
// buffer above and below. With 400 feeds at ~68px each, the full list would be
// ~27,200px tall and require ~6,000 DOM nodes. Virtual scroll keeps that down
// to ~20-25 nodes at any time, eliminating the RAM spike on tab open.
//
// Architecture:
//   scrollEl  — the scrollable container (fixed height, overflow-y: auto)
//   spacerTop — invisible div whose height = rows above the visible window
//   itemsEl   — contains only the currently rendered cards
//   spacerBot — invisible div whose height = rows below the visible window
//
// On every scroll event, we recalculate which indices are visible and
// add/remove cards as needed. Cards are keyed by feed URL to allow reuse.

const DESKTOP_CARD_HEIGHT = 68;   // px - measured from the actual rendered card
const MOBILE_CARD_HEIGHT  = 124;  // px - cards wrap actions below the feed name
const OVERSCAN    = 5;    // extra cards to render above and below viewport

function getFeedCardHeight(): number {
    if (typeof window === 'undefined') return DESKTOP_CARD_HEIGHT;
    return window.matchMedia('(max-width: 560px), (hover: none) and (pointer: coarse)').matches
        ? MOBILE_CARD_HEIGHT
        : DESKTOP_CARD_HEIGHT;
}

function applyCssText(element: HTMLElement, cssText: string): void {
    const properties: Record<string, string> = {};
    for (const declaration of cssText.split(';')) {
        const separator = declaration.indexOf(':');
        if (separator < 0) continue;
        const property = declaration.slice(0, separator).trim();
        const value = declaration.slice(separator + 1).trim();
        if (property && value) properties[property] = value;
    }
    element.setCssProps(properties);
}

interface VirtualList {
    /** Call when the dataset or filters change — rebuilds from scratch */
    setItems: (items: FeedConfig[]) => void;
    /** Call when a single card's visual state may have changed (e.g. toggle) */
    invalidate: () => void;
    /** Disconnect observers and clean up */
    destroy: () => void;
}

function createVirtualList(
    container:    HTMLElement,
    renderCard:   (feed: FeedConfig, el: HTMLElement) => void,
    getGroups:    () => ReturnType<typeof sortGroups>,
): VirtualList {
    // ── DOM structure ─────────────────────────────────────────────────────────
    const scrollEl = container.createDiv();
    applyCssText(scrollEl, `
        height: 520px;
        overflow-y: auto;
        position: relative;
    `);

    const innerEl = scrollEl.createDiv();
    applyCssText(innerEl, 'position: relative;');

    const spacerTop = innerEl.createDiv();
    applyCssText(spacerTop, 'position: absolute; top: 0; left: 0; right: 0; pointer-events: none;');

    const itemsEl = innerEl.createDiv();
    applyCssText(itemsEl, 'position: absolute; left: 0; right: 0;');

    const spacerBot = innerEl.createDiv();
    applyCssText(spacerBot, 'position: absolute; left: 0; right: 0; pointer-events: none;');

    // ── State ─────────────────────────────────────────────────────────────────
    let items:        FeedConfig[] = [];
    let renderedStart = -1;
    let renderedEnd   = -1;
    let cardHeight    = getFeedCardHeight();

    // ── Layout ────────────────────────────────────────────────────────────────
    // No card cache — cards are created on entry and destroyed on exit.
    // Caching kept all 400 elements in memory as you scrolled; without it,
    // only OVERSCAN*2 + viewport cards (~20) ever exist at once.
    const updateLayout = () => {
        cardHeight = getFeedCardHeight();
        const totalHeight = items.length * cardHeight;
        setDynamicCss(innerEl, { height: totalHeight + 'px' });

        const scrollTop    = scrollEl.scrollTop;
        const viewHeight   = scrollEl.clientHeight || 520;
        const firstVisible = Math.floor(scrollTop / cardHeight);
        const lastVisible  = Math.ceil((scrollTop + viewHeight) / cardHeight);

        const newStart = Math.max(0, firstVisible - OVERSCAN);
        const newEnd   = Math.min(items.length, lastVisible + OVERSCAN);

        // Nothing changed — skip work
        if (newStart === renderedStart && newEnd === renderedEnd) return;

        // Remove all currently rendered cards and re-render only the new window.
        // This is simpler and cheaper than diffing — the window is small (~20 items)
        // so the cost of re-creating a few cards on each scroll event is negligible
        // compared to keeping 400 cached elements in memory.
        itemsEl.innerHTML = '';

        for (let i = newStart; i < newEnd; i++) {
            const feed = items[i];
            if (!feed) continue;

            const el = document.createElement('div');
            applyCssText(el, `position:absolute;top:${i * cardHeight}px;left:0;right:0;`);
            renderCard(feed, el);
            itemsEl.appendChild(el);
        }

        renderedStart = newStart;
        renderedEnd   = newEnd;

        setDynamicCss(spacerTop, { height: (newStart * cardHeight) + 'px' });
        setDynamicCss(spacerBot, { top: (newEnd * cardHeight) + 'px' });
        setDynamicCss(spacerBot, { height: Math.max(0, (items.length - newEnd) * cardHeight) + 'px' });
    };

    // ── Throttled scroll handler ──────────────────────────────────────────────
    // rAF-throttle prevents layout thrashing when the user scrolls fast —
    // at most one updateLayout() per animation frame regardless of scroll speed.
    let rafPending = false;
    const onScroll = () => {
        if (rafPending) return;
        rafPending = true;
        window.requestAnimationFrame(() => {
            rafPending = false;
            updateLayout();
        });
    };
    scrollEl.addEventListener('scroll', onScroll, { passive: true });

    const ro = new ResizeObserver(() => { updateLayout(); });
    ro.observe(scrollEl);

    const mobileQuery = window.matchMedia('(max-width: 560px), (hover: none) and (pointer: coarse)');
    const onMediaChange = () => {
        renderedStart = -1;
        renderedEnd   = -1;
        updateLayout();
    };
    mobileQuery.addEventListener('change', onMediaChange);

    // ── Public API ────────────────────────────────────────────────────────────
    const setItems = (newItems: FeedConfig[]) => {
        itemsEl.innerHTML = '';
        renderedStart = -1;
        renderedEnd   = -1;
        scrollEl.scrollTop = 0;
        items = newItems;
        updateLayout();
    };

    const invalidate = () => {
        // Force re-render of the current window (e.g. after a toggle changes state)
        renderedStart = -1;
        renderedEnd   = -1;
        itemsEl.innerHTML = '';
        updateLayout();
    };

    const destroy = () => {
        scrollEl.removeEventListener('scroll', onScroll);
        mobileQuery.removeEventListener('change', onMediaChange);
        ro.disconnect();
    };

    return { setItems, invalidate, destroy };
}

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

    const title = containerEl.createEl('div', { text: 'Manage feeds' });
    applyCssText(title, 'font-size: 1.1em; font-weight: 600; color: var(--text-normal); margin-bottom: 10px;');

    // ── Tab filter bar ────────────────────────────────────────────────────────
    const filterRow = containerEl.createDiv();
    applyCssText(filterRow, 'display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-bottom: 10px;');

    // ── Controls card ─────────────────────────────────────────────────────────
    const controlsCard = containerEl.createDiv();
    applyCssText(controlsCard, `
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
    `);

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
        if (plugin.settings.feeds.length !== before) void plugin.saveSettings();
    }

    // ── Virtual list ──────────────────────────────────────────────────────────
    let emptyEl: HTMLElement | null = null;

    const vlist = createVirtualList(
        listEl,
        (feed, el) => {
            const sortedGroups = sortGroups(plugin.settings.groups);
            const globalIndex  = plugin.settings.feeds.indexOf(feed);
            const st = (feed.deleted ?? false) ? 'deleted' : (feed.archived ?? false) ? 'archived' : 'normal';
            renderFeedCard(
                app, plugin, el, plugin.settings.feeds, feed, globalIndex,
                sortedGroups, selectedFeeds,
                () => { selectedFeeds.clear(); fullRefresh(); },
                () => { renderControlsCard(); },
                st,
            );
        },
        () => sortGroups(plugin.settings.groups),
    );

    // ── Rebuild the list when filters / search change ─────────────────────────
    const rebuildList = () => {
        // Remove empty-state message if present
        if (emptyEl) { emptyEl.remove(); emptyEl = null; }

        const visible = sortFeeds(getVisibleFeeds());

        if (visible.length === 0) {
            vlist.setItems([]);
            emptyEl = listEl.createEl('p', { text: 'No feeds in this category.' });
            applyCssText(emptyEl, 'color: var(--text-muted); text-align: center; margin-top: 24px;');
            return;
        }

        vlist.setItems(visible);
    };

    const fullRefresh = () => {
        rebuildList();
        renderControlsCard();
    };

    // ── Controls card renderer ────────────────────────────────────────────────
    const renderControlsCard = () => {
        controlsCard.empty();
        setDynamicCss(controlsCard, { 'border-color': '' });

        // ── Trash tab ─────────────────────────────────────────────────────────
        if (activeFilter === 'trash') {
            const visibleFeeds = getVisibleFeeds();
            const hasSelection = selectedFeeds.size > 0;

            const cbWrap = controlsCard.createDiv();
            applyCssText(cbWrap, CONTROL_WRAPPER_CSS);
            const cb = cbWrap.createEl('input', { type: 'checkbox' });
            applyCssText(cb, CHECKBOX_CSS);
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
            applyCssText(sep, SEPARATOR_CSS);

            if (hasSelection) {
                setDynamicCss(controlsCard, { 'border-color': 'var(--interactive-accent)' });

                const countEl = controlsCard.createSpan({ text: `${hasSelection ? selectedFeeds.size : 0} selected` });
                applyCssText(countEl, 'font-size: 0.82em; font-weight: 600; color: var(--interactive-accent); padding: 0 4px;');

                const deselectBtn = controlsCard.createEl('button');
                applyCssText(deselectBtn, 'display: flex; align-items: center; gap: 4px; padding: 3px 8px; border-radius: 6px; border: none; cursor: pointer; font-size: 0.83em; background: transparent; color: var(--text-muted); transition: background 0.12s ease;');
                deselectBtn.addEventListener('mouseenter', () => { setDynamicCss(deselectBtn, { background: 'var(--background-modifier-hover)' }); });
                deselectBtn.addEventListener('mouseleave', () => { setDynamicCss(deselectBtn, { background: 'transparent' }); });
                const xIcon = deselectBtn.createDiv();
                applyCssText(xIcon, 'display: flex; align-items: center; width: 14px; height: 14px; flex-shrink: 0;');
                setIcon(xIcon, 'x');
                deselectBtn.createSpan({ text: 'Deselect' });
                deselectBtn.addEventListener('click', () => { selectedFeeds.clear(); renderControlsCard(); rebuildList(); });

                const sep2 = controlsCard.createDiv();
                applyCssText(sep2, 'width: 1px; height: 22px; background: var(--background-modifier-border); margin: 0 16px; flex-shrink: 0;');

                const restoreBtn = controlsCard.createEl('button');
                applyCssText(restoreBtn, 'display: flex; align-items: center; gap: 5px; padding: 5px 10px; border-radius: 6px; border: none; cursor: pointer; font-size: 0.83em; background: transparent; color: var(--text-normal); transition: background 0.12s ease;');
                restoreBtn.title = 'Restore selected';
                restoreBtn.addEventListener('mouseenter', () => { setDynamicCss(restoreBtn, { background: 'var(--background-modifier-hover)' }); });
                restoreBtn.addEventListener('mouseleave', () => { setDynamicCss(restoreBtn, { background: 'transparent' }); });
                const restoreIcon = restoreBtn.createDiv();
                applyCssText(restoreIcon, 'display: flex; align-items: center; width: 15px; height: 15px; flex-shrink: 0;');
                setIcon(restoreIcon, 'undo');
                const restoreLabel = restoreBtn.createSpan({ text: 'Restore' });
                const updateRestoreLabel = () => { setDynamicCss(restoreLabel, { display: controlsCard.offsetWidth < 480 ? 'none' : '' }); };
                updateRestoreLabel();
                const restoreRo = new ResizeObserver(updateRestoreLabel);
                restoreRo.observe(controlsCard);
                const restoreRoCleanup = new MutationObserver(() => { restoreRo.disconnect(); restoreRoCleanup.disconnect(); });
                restoreRoCleanup.observe(controlsCard, { childList: true });
                restoreBtn.addEventListener('click', () => {
                    void (async () => {
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
                    })();
                });

                const sep3 = controlsCard.createDiv();
                applyCssText(sep3, 'width: 1px; height: 22px; background: var(--background-modifier-border); margin: 0 8px; flex-shrink: 0;');

                const delBtn = controlsCard.createEl('button');
                applyCssText(delBtn, 'display: flex; align-items: center; gap: 5px; padding: 5px 10px; border-radius: 6px; border: none; cursor: pointer; font-size: 0.83em; background: transparent; color: var(--color-red); transition: background 0.12s ease;');
                delBtn.title = 'Delete permanently';
                delBtn.addEventListener('mouseenter', () => { setDynamicCss(delBtn, { background: 'var(--background-modifier-hover)' }); });
                delBtn.addEventListener('mouseleave', () => { setDynamicCss(delBtn, { background: 'transparent' }); });
                const delIcon = delBtn.createDiv();
                applyCssText(delIcon, 'display: flex; align-items: center; width: 15px; height: 15px; flex-shrink: 0;');
                setIcon(delIcon, 'trash');
                const delLabel = delBtn.createSpan({ text: 'Delete permanently' });

                const updateDelLabel = () => { setDynamicCss(delLabel, { display: controlsCard.offsetWidth < 480 ? 'none' : '' }); };
                updateDelLabel();
                const delRo = new ResizeObserver(updateDelLabel);
                delRo.observe(controlsCard);
                const delRoCleanup = new MutationObserver(() => { delRo.disconnect(); delRoCleanup.disconnect(); });
                delRoCleanup.observe(controlsCard, { childList: true });

                delBtn.addEventListener('click', () => {
                    void (async () => {
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
                    ).open();
                    })();
                });

            } else {
                setDynamicCss(controlsCard, { 'border-color': '' });
                const label = controlsCard.createSpan({ text: 'Select all' });
                applyCssText(label, 'font-size: 0.82em; color: var(--text-muted);');
            }

            const spacer = controlsCard.createDiv();
            applyCssText(spacer, 'flex: 1;');
            const iconEl = controlsCard.createDiv();
            applyCssText(iconEl, 'display: flex; align-items: center; width: 14px; height: 14px; flex-shrink: 0; color: var(--color-orange);');
            setIcon(iconEl, 'clock');
            const msg = controlsCard.createSpan({ text: 'Auto-deleted after 15 days' });
            applyCssText(msg, 'font-size: 0.78em; color: var(--text-muted); white-space: nowrap;');
            return;
        }

        const visibleFeeds = getVisibleFeeds();
        const hasSelection = selectedFeeds.size > 0;

        const cbWrap = controlsCard.createDiv();
        applyCssText(cbWrap, CONTROL_WRAPPER_CSS);
        const cb = cbWrap.createEl('input', { type: 'checkbox' });
        applyCssText(cb, CHECKBOX_CSS);
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
            applyCssText(tgWrap, CONTROL_WRAPPER_CSS);
            const toggleEl = tgWrap.createEl('div', { cls: 'checkbox-container' });
            setDynamicCss(toggleEl, { margin: '0' });
            const selList = plugin.settings.feeds.filter((f: FeedConfig) => selectedFeeds.has(f.url));
            const allOn   = selList.every((f: FeedConfig) => f.enabled);
            if (allOn) toggleEl.classList.add('is-enabled');
            toggleEl.title = allOn ? 'Disable selected' : 'Enable selected';
            toggleEl.addEventListener('click', () => {
                void (async () => {
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
                })();
            });
        }

        const sep = controlsCard.createDiv();
        applyCssText(sep, SEPARATOR_CSS);

        if (hasSelection) {
            setDynamicCss(controlsCard, { 'border-color': 'var(--interactive-accent)' });

            const countEl = controlsCard.createSpan({ text: `${selectedFeeds.size} selected` });
            applyCssText(countEl, 'font-size: 0.82em; font-weight: 600; color: var(--interactive-accent); padding: 0 4px;');

            const deselectBtn = controlsCard.createEl('button');
            applyCssText(deselectBtn, 'display: flex; align-items: center; gap: 4px; padding: 3px 8px; border-radius: 6px; border: none; cursor: pointer; font-size: 0.83em; background: transparent; color: var(--text-muted); transition: background 0.12s ease;');
            deselectBtn.addEventListener('mouseenter', () => { setDynamicCss(deselectBtn, { background: 'var(--background-modifier-hover)' }); });
            deselectBtn.addEventListener('mouseleave', () => { setDynamicCss(deselectBtn, { background: 'transparent' }); });
            const xIcon = deselectBtn.createDiv();
            applyCssText(xIcon, 'display: flex; align-items: center; width: 14px; height: 14px; flex-shrink: 0;');
            setIcon(xIcon, 'x');
            deselectBtn.createSpan({ text: 'Deselect' });
            deselectBtn.addEventListener('click', () => { selectedFeeds.clear(); renderControlsCard(); rebuildList(); });

            const sep2 = controlsCard.createDiv();
            applyCssText(sep2, 'width: 1px; height: 22px; background: var(--background-modifier-border); margin: 0 16px; flex-shrink: 0;');

            const addActionBtn = (icon: string, label: string, onClick: () => void | Promise<void>) => {
                const btn = controlsCard.createEl('button');
                applyCssText(btn, 'display: flex; align-items: center; gap: 5px; padding: 5px 10px; border-radius: 6px; border: none; cursor: pointer; font-size: 0.83em; background: transparent; color: var(--text-normal); transition: background 0.12s ease; margin-left: 4px;');
                btn.title = label;
                btn.addEventListener('mouseenter', () => { setDynamicCss(btn, { background: 'var(--background-modifier-hover)' }); });
                btn.addEventListener('mouseleave', () => { setDynamicCss(btn, { background: 'transparent' }); });
                const iconEl = btn.createDiv();
                applyCssText(iconEl, 'display: flex; align-items: center; width: 15px; height: 15px; flex-shrink: 0;');
                setIcon(iconEl, icon);
                const labelEl = btn.createSpan({ text: label });

                const updateLabel = () => { setDynamicCss(labelEl, { display: controlsCard.offsetWidth < 480 ? 'none' : '' }); };
                updateLabel();

                const ro = new ResizeObserver(updateLabel);
                ro.observe(controlsCard);
                const roCleanup = new MutationObserver(() => { ro.disconnect(); roCleanup.disconnect(); });
                roCleanup.observe(controlsCard, { childList: true });

                btn.addEventListener('click', () => { void onClick(); });
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
            applyCssText(spacer, 'flex: 1;');

            addActionBtn('sliders-horizontal', 'Multi Edit', () => {
                openBulkEditModal(app, plugin, selectedFeeds, () => { selectedFeeds.clear(); fullRefresh(); });
            });

        } else {
            const label = controlsCard.createSpan({ text: 'Select all' });
            applyCssText(label, 'font-size: 0.82em; color: var(--text-muted);');

            const spacer = controlsCard.createDiv();
            applyCssText(spacer, 'flex: 1;');

            const editFoldersBtn = controlsCard.createEl('button');
            applyCssText(editFoldersBtn, 'display: flex; align-items: center; gap: 5px; padding: 5px 12px; border-radius: 6px; font-size: 0.85em; cursor: pointer; border: 1px solid var(--background-modifier-border); background: transparent; color: var(--text-muted); transition: all 0.15s ease;');
            const editFoldersIcon = editFoldersBtn.createDiv();
            applyCssText(editFoldersIcon, 'display: flex; align-items: center; width: 14px; height: 14px;');
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
    applyCssText(searchWrap, 'display: flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 20px; border: 1px solid var(--background-modifier-border); background: transparent; transition: border-color 0.15s ease; margin-left: 2px; flex: 1;');
    const searchIcon = searchWrap.createDiv();
    applyCssText(searchIcon, 'display: flex; align-items: center; width: 13px; height: 13px; flex-shrink: 0; opacity: 0.5;');
    setIcon(searchIcon, 'search');
    const searchInput = searchWrap.createEl('input', { type: 'text' });
    searchInput.placeholder = 'Search feeds…';
    applyCssText(searchInput, 'border: none; background: transparent; outline: none; font-size: 0.82em; color: var(--text-normal); width: 100%; line-height: 1; height: 18px;');
    searchWrap.addEventListener('focusin', () => { setDynamicCss(searchWrap, { 'border-color': 'var(--interactive-accent)' }); });
    searchWrap.addEventListener('focusout', () => {
        setDynamicCss(searchWrap, { 'border-color': searchQuery ? 'var(--interactive-accent)' : 'var(--background-modifier-border)' });
    });
    const debouncedSearch = debounce(() => {
        selectedFeeds.clear();
        fullRefresh();
    }, 150);

    searchInput.addEventListener('input', () => {
        searchQuery = searchInput.value;
        debouncedSearch();
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
        applyCssText(btn, `${BASE_TAB} ${isActive ? ACTIVE_TAB : INACTIVE_TAB}`);
        buttons.push(btn);
        btn.addEventListener('click', () => {
            buttons.forEach(b => { applyCssText(b, `${BASE_TAB} ${INACTIVE_TAB}`); });
            applyCssText(btn, `${BASE_TAB} ${ACTIVE_TAB}`);
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
): void {
    const isArchived = status === 'archived';
    const isDeleted  = status === 'deleted';

    const cardEl = feedsContainer.createDiv();
    applyCssText(cardEl, `
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
    `);
    cardEl.classList.add('rss-card-setting');
    cardEl.classList.add('rss-feed-card');
    cardEl.onmouseenter = () => { setDynamicCss(cardEl, { 'border-color': 'var(--interactive-accent)' }); };
    cardEl.onmouseleave = () => { setDynamicCss(cardEl, { 'border-color': 'var(--background-modifier-border)' }); };

    cardEl.dataset.feedUrl     = feed.url;
    cardEl.dataset.feedStatus  = status;
    cardEl.dataset.feedGroupId = feed.groupId ?? '';
    cardEl.dataset.feedEnabled = String(feed.enabled);

    const checkboxWrapper = cardEl.createDiv();
    checkboxWrapper.classList.add('rss-feed-card-select');
    applyCssText(checkboxWrapper, CONTROL_WRAPPER_CSS);
    const checkbox = checkboxWrapper.createEl('input', { type: 'checkbox' });
    checkbox.checked = selectedFeeds.has(feed.url);
    applyCssText(checkbox, CHECKBOX_CSS);
    checkbox.addEventListener('change', () => {
        if (checkbox.checked) selectedFeeds.add(feed.url);
        else selectedFeeds.delete(feed.url);
        onSelectionChange();
    });

    const toggleWrapper = cardEl.createDiv();
    toggleWrapper.classList.add('rss-feed-card-toggle');
    applyCssText(toggleWrapper, CONTROL_WRAPPER_CSS);
    const toggleEl = toggleWrapper.createEl('div', { cls: 'checkbox-container' });
    setDynamicCss(toggleEl, { margin: '0' });
    if (feed.enabled) toggleEl.classList.add('is-enabled');
    toggleEl.addEventListener('click', () => {
        void (async () => {
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
        })();
    });

    const separator = cardEl.createDiv();
    separator.classList.add('rss-feed-card-separator');
    applyCssText(separator, SEPARATOR_CSS);

    const infoEl = cardEl.createDiv();
    infoEl.classList.add('rss-feed-card-info');
    applyCssText(infoEl, 'flex: 1 1 auto; min-width: 0; margin: 0; padding: 0;');
    const nameEl = infoEl.createDiv({ text: feed.name || 'Untitled Feed' });
    nameEl.classList.add('rss-feed-card-name');
    applyCssText(nameEl, 'font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 0.95em;');

    const controlEl = cardEl.createDiv();
    controlEl.classList.add('rss-feed-card-actions');
    applyCssText(controlEl, 'display: flex; align-items: center; gap: 6px; flex-shrink: 0; margin-left: 12px;');

    // ── Delete Lives badge ────────────────────────────────────────────────────
    if (!isDeleted && feed.deleteLives) {
        const livesBadge = controlEl.createDiv();
        livesBadge.title = 'Delete lives: on';
        applyCssText(livesBadge, `
            position: relative;
            display: flex; align-items: center; justify-content: center;
            width: 24px; height: 24px; flex-shrink: 0;
            opacity: 0.85; transition: opacity 0.12s ease;
        `);
        livesBadge.onmouseenter = () => { setDynamicCss(livesBadge, { opacity: '1' }); };
        livesBadge.onmouseleave = () => { setDynamicCss(livesBadge, { opacity: '0.85' }); };

        const radioEl = livesBadge.createDiv();
        applyCssText(radioEl, 'display: flex; align-items: center; width: 18px; height: 18px; color: var(--text-muted);');
        setIcon(radioEl, 'radio');

        const banEl = livesBadge.createDiv();
        applyCssText(banEl, `
            position: absolute; bottom: 0; right: -2px;
            display: flex; align-items: center;
            width: 13px; height: 13px;
            color: var(--color-red);
            background: var(--background-secondary);
            border-radius: 50%;
        `);
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
            applyCssText(skipBadge, `
                position: relative;
                display: flex; align-items: center; justify-content: center;
                width: 24px; height: 24px; flex-shrink: 0;
                opacity: 0.85; transition: opacity 0.12s ease;
            `);
            skipBadge.onmouseenter = () => { setDynamicCss(skipBadge, { opacity: '1' }); };
            skipBadge.onmouseleave = () => { setDynamicCss(skipBadge, { opacity: '0.85' }); };

            const phoneEl = skipBadge.createDiv();
            applyCssText(phoneEl, 'display: flex; align-items: center; width: 18px; height: 18px; color: var(--text-muted);');
            setIcon(phoneEl, 'smartphone');

            const banEl = skipBadge.createDiv();
            applyCssText(banEl, `
                position: absolute; bottom: 0; right: -2px;
                display: flex; align-items: center;
                width: 13px; height: 13px;
                color: var(--color-red);
                background: var(--background-secondary);
                border-radius: 50%;
            `);
            setIcon(banEl, 'ban');
        }
    }

    // ── Folder badge ──────────────────────────────────────────────────────────
    if (!isDeleted && groups.length > 0) {
        const currentGroup = groups.find(g => g.id === feed.groupId);
        const badge = controlEl.createDiv({ text: currentGroup?.name ?? '— folder —' });
        applyCssText(badge, `
            font-size: 0.78em; color: var(--text-muted);
            background: var(--background-modifier-hover);
            border: 1px solid var(--background-modifier-border);
            border-radius: 4px; padding: 3px 8px;
            white-space: nowrap; flex-shrink: 0; cursor: pointer;
            transition: border-color 0.12s ease;
        `);
        badge.title = 'Change folder';
        badge.onmouseenter = () => { setDynamicCss(badge, { 'border-color': 'var(--interactive-accent)' }); };
        badge.onmouseleave = () => { setDynamicCss(badge, { 'border-color': 'var(--background-modifier-border)' }); };

        badge.addEventListener('click', (e) => {
            e.stopPropagation();
            const existing = document.querySelector('.rss-folder-popover');
            if (existing) { existing.remove(); return; }

            const pop = document.body.createDiv({ cls: 'rss-folder-popover' });
            applyCssText(pop, `
                position: fixed; z-index: 9999;
                background: var(--background-primary);
                border: 1px solid var(--background-modifier-border);
                border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,0.3);
                padding: 4px; min-width: 160px;
            `);

            const addOpt = (label: string, val: string) => {
                const item = pop.createDiv({ text: label });
                const isCur = val === (feed.groupId ?? '');
                applyCssText(item, `padding: 6px 10px; border-radius: 5px; cursor: pointer; font-size: 0.85em; color: ${isCur ? 'var(--text-normal)' : 'var(--text-muted)'}; font-weight: ${isCur ? '500' : '400'};`);
                item.onmouseenter = () => { setDynamicCss(item, { background: 'var(--background-modifier-hover)' }); setDynamicCss(item, { color: 'var(--text-normal)' }); };
                item.onmouseleave = () => { setDynamicCss(item, { background: 'transparent' }); };
                item.addEventListener('pointerdown', (ev) => {
                    void (async () => {
                    ev.preventDefault();
                    pop.remove();
                    const hide = showGlobalLoading('Moving feed...');
                    try {
                        await moveFeedFolder(app, plugin, feed, val === '' ? undefined : val);
                        await plugin.saveSettings();
                    } finally { hide(); }
                    badge.setText(groups.find(g => g.id === feed.groupId)?.name ?? '— folder —');
                    })();
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
            setDynamicCss(pop, {
                top: `${top}px`,
                left: `${rect.left}px`,
            });

            const close = (ev: MouseEvent) => {
                if (!pop.contains(ev.target as Node) && ev.target !== badge) {
                    pop.remove();
                    document.removeEventListener('click', close);
                }
            };
            window.setTimeout(() => document.addEventListener('click', close), 0);
        });

        // (selectEls removed — handled by virtual scroll container width)
    }

    if (!isDeleted && groups.length > 0) {
        const btnSep = controlEl.createDiv();
        applyCssText(btnSep, 'width: 1px; height: 20px; background: var(--background-modifier-border); flex-shrink: 0;');
    }

    // ── Button helper ─────────────────────────────────────────────────────────
    const addBtn = (icon: string, tooltip: string, color?: string): HTMLButtonElement => {
        const btn = controlEl.createEl('button');
        btn.title = tooltip;
        applyCssText(btn, `display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 6px; border: none; background: transparent; cursor: pointer; color: ${color ?? 'var(--text-normal)'}; transition: background 0.12s ease;`);
        btn.addEventListener('mouseenter', () => { setDynamicCss(btn, { background: 'var(--background-modifier-hover)' }); });
        btn.addEventListener('mouseleave', () => { setDynamicCss(btn, { background: 'transparent' }); });
        const iconEl = btn.createDiv();
        applyCssText(iconEl, 'display: flex; align-items: center; width: 18px; height: 18px;');
        setIcon(iconEl, icon);
        return btn;
    };

    // ── Update button (only for non-deleted feeds) ────────────────────────────
    if (!isDeleted) {
        const updateBtn = addBtn('refresh-cw', 'Update this feed');
        updateBtn.addEventListener('click', () => {
            void (async () => {
            if (plugin.isUpdating) {
                new Notice('An update is already running.');
                return;
            }

            // Spin the icon while updating
            const iconEl = updateBtn.querySelector('div') as HTMLElement;
            setDynamicCss(iconEl, { transition: 'transform 0.6s linear' });
            setDynamicCss(iconEl, { transform: 'rotate(360deg)' });
            updateBtn.disabled = true;

            try {
                const { saved, deleted } = await plugin.updateFeed(feed);
                plugin.showSummary(saved, deleted);
            } catch (e) {
                console.error(`RSS: Manual update failed for "${feed.name}":`, e);
                new Notice(`Update failed for "${feed.name}".`);
            } finally {
                setDynamicCss(iconEl, { transition: '' });
                setDynamicCss(iconEl, { transform: '' });
                updateBtn.disabled = false;
            }
            })();
        });
    }

    // ── Edit button ───────────────────────────────────────────────────────────
    const editBtn = addBtn('pencil', 'Edit feed');
    editBtn.addEventListener('click', () => {
        void (async () => {
        const liveIndex = plugin.settings.feeds.indexOf(feed);
        if (liveIndex === -1) return;
        const FeedEditModal = await getFeedEditModal();
        new FeedEditModal(app, plugin, feed,
            async () => { await plugin.saveSettings(); onRefresh(); },
            () => { plugin.settings.feeds.splice(liveIndex, 1); void plugin.saveSettings(); onRefresh(); }
        ).open();
        })();
    });

    if (isDeleted) {
        const btn = addBtn('undo', 'Restore feed');
        btn.addEventListener('click', () => {
            void (async () => {
            feed.deleted = false; delete feed.deletedAt;
            await plugin.saveSettings(); onRefresh();
            })();
        });
    } else if (isArchived) {
        const btn = addBtn('archive-restore', 'Unarchive feed');
        btn.addEventListener('click', () => {
            void (async () => {
            feed.archived = false;
            await plugin.saveSettings(); onRefresh();
            })();
        });
    } else {
        const btn = addBtn('archive', 'Archive feed');
        btn.addEventListener('click', () => {
            void (async () => {
            feed.archived = true; feed.enabled = false;
            await plugin.saveSettings(); onRefresh();
            })();
        });
    }

    if (isDeleted) {
        const btn = addBtn('trash', 'Permanently delete', 'var(--color-red)');
        btn.addEventListener('click', () => {
            void (async () => {
            const ConfirmDeleteModal = await getConfirmDeleteModal();
            new ConfirmDeleteModal(app,
                async () => {
                    const liveIdx = plugin.settings.feeds.indexOf(feed);
                    if (liveIdx !== -1) plugin.settings.feeds.splice(liveIdx, 1);
                    await plugin.saveSettings(); onRefresh();
                }
            ).open();
            })();
        });
    } else {
        const btn = addBtn('trash', 'Move to trash');
        btn.addEventListener('click', () => {
            void (async () => {
            feed.deleted = true; feed.deletedAt = Date.now(); feed.enabled = false;
            await plugin.saveSettings(); onRefresh();
            })();
        });
    }
}
