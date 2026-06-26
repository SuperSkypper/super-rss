import { App, Modal, Setting, Notice } from 'obsidian';
import RssPlugin, { FeedConfig } from '../main';
import { fetchAndExtract } from './feedExtractor';
import { FeedEditModal } from './feedEdit';
import { setDynamicCss } from "../utils/css";

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

// ─── Device detection ─────────────────────────────────────────────────────────

let _isTouchDevice: boolean | undefined;

function isTouchDevice(): boolean {
    if (_isTouchDevice === undefined) {
        _isTouchDevice = typeof window !== 'undefined'
            && window.matchMedia('(hover: none)').matches;
    }
    return _isTouchDevice;
}

// ─── URL validation ───────────────────────────────────────────────────────────

function isValidUrl(value: string): boolean {
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

// ─── Font size helper ─────────────────────────────────────────────────────────
// On desktop: 13px keeps inputs visually compact.
// On mobile (touch): 16px minimum is required to prevent iOS auto-zoom on focus.

function inputFontSize(): string {
    return isTouchDevice() ? '16px' : '13px';
}

// ─── AddUrlModal ──────────────────────────────────────────────────────────────

export class AddUrlModal extends Modal {
    private url: string = '';
    private onSubmit: (url: string) => Promise<void>;

    constructor(app: App, onSubmit: (url: string) => Promise<void>) {
        super(app);
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: 'Add feed' });

        const urlSetting = new Setting(contentEl)
            .setName('Feed address')
            .setDesc('Enter the feed link.');

        setDynamicCss(urlSetting.settingEl, { 'flex-direction': 'column' });
        setDynamicCss(urlSetting.settingEl, { 'align-items': 'flex-start' });
        setDynamicCss(urlSetting.controlEl, { 'width': '100%' });
        setDynamicCss(urlSetting.controlEl, { 'margin-top': '8px' });

        const urlInput = urlSetting.controlEl.createEl('input', { type: 'text' });
        urlInput.placeholder    = 'https://example.com/rss.xml';
        applyCssText(urlInput, `width: 100%; display: block; box-sizing: border-box; font-size: ${inputFontSize()};`);
        urlInput.inputMode      = 'url';
        urlInput.autocomplete   = 'off';
        urlInput.autocapitalize = 'off';
        urlInput.oninput = () => { this.url = urlInput.value; };

        const btnContainer = contentEl.createDiv();
        applyCssText(btnContainer, 'margin-top: 20px; display: flex; justify-content: flex-end; gap: 10px;');

        const cancelBtn = btnContainer.createEl('button', { text: 'Cancel' });
        cancelBtn.onclick = () => this.close();

        const addBtn = btnContainer.createEl('button', { cls: 'mod-cta' });
        applyCssText(addBtn, 'display: flex; align-items: center; gap: 6px; min-width: 110px; justify-content: center;');

        const setButtonState = (loading: boolean) => {
            addBtn.empty();
            addBtn.disabled    = loading;
            cancelBtn.disabled = loading;

            if (loading) {
                const spinner = addBtn.createDiv();
                applyCssText(spinner, `
                    width: 12px; height: 12px;
                    border: 2px solid rgba(255,255,255,0.3);
                    border-top-color: white;
                    border-radius: 50%;
                    animation: rss-spin 0.7s linear infinite;
                    flex-shrink: 0;
                `);
                addBtn.createSpan({ text: 'Fetching...' });
            } else {
                addBtn.createSpan({ text: 'Fetch and edit' });
            }
        };

        setButtonState(false);

        addBtn.onclick = () => {
            void (async () => {
            const sanitizedUrl = this.url.trim();
            if (!isValidUrl(sanitizedUrl)) {
                new Notice('Enter a valid HTTP/HTTPS URL');
                return;
            }

            setButtonState(true);
            try {
                await this.onSubmit(sanitizedUrl);
                this.close();
            } catch {
                // onSubmit already shows a Notice on error; just restore the button
                setButtonState(false);
            }
            })();
        };
    }
}

// ─── addFeed ──────────────────────────────────────────────────────────────────

/**
 * Centralised "add feed" flow used by every entry point:
 * - Settings "Add Feed" button
 * - Command palette "Add RSS feed"
 * - OPML import (can call addFeedSilent directly)
 *
 * After the user saves the edit modal, settings are persisted first
 * and then the feed is fetched in the background — so per-feed overrides
 * are applied correctly without blocking the UI.
 *
 * The feed URL stored is always the resolved feed URL (e.g. the actual
 * YouTube RSS endpoint), not the original user-supplied URL.
 */
export async function addFeed(
    app:      App,
    plugin:   RssPlugin,
    url:      string,
    refresh?: () => void
): Promise<void> {
    new Notice('Fetching feed info...');

    let data: Awaited<ReturnType<typeof fetchAndExtract>>;
    try {
        data = await fetchAndExtract(url);
    } catch {
        new Notice('Failed to fetch feed. Check the URL.');
        throw new Error('Failed to fetch feed');
    }

    // Use the resolved URL (e.g. YouTube RSS endpoint) instead of the raw user input
    const resolvedUrl = data.resolvedUrl;

    if (plugin.settings.feeds.some(f => f.url === resolvedUrl)) {
        new Notice('This feed URL already exists!');
        throw new Error('Feed already exists');
    }

    const feedTitle = data.title || 'New Feed';

    const newFeed: FeedConfig = {
        name:         feedTitle,
        url:          resolvedUrl,
        folder:       '',
        enabled:      true,
        lastUpdated:  Date.now(),
        previousName: feedTitle,
    };

    plugin.settings.feeds.push(newFeed);
    await plugin.saveSettingsSilent();

    const addedIndex = plugin.settings.feeds.length - 1;
    const addedFeed  = plugin.settings.feeds[addedIndex];

    if (!addedFeed) return;

    new FeedEditModal(
        app,
        plugin,
        addedFeed,
        async () => {
            // Save settings first so all per-feed overrides are persisted,
            // then fetch in the background — UI is not blocked.
            await plugin.saveSettings();
            plugin.updateFeed(addedFeed).catch((err: unknown) => {
                const message = err instanceof Error ? err.message : String(err);
                new Notice(`Failed to fetch feed: ${message}`);
            });
            refresh?.();
        },
        () => {
            plugin.settings.feeds.splice(addedIndex, 1);
            void plugin.saveSettingsSilent();
            refresh?.();
        },
        true // isNew — onClose will call onDelete if user cancels
    ).open();
}
