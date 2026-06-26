import { App, PluginSettingTab, Setting, Notice, setIcon } from 'obsidian';
import RssPlugin from './main';
import { renderGeneralTab }        from './settings/settingsGeneral';
import { renderGlobalTemplateTab } from './settings/settingsTemplate';
import { renderMyFeedsTab }        from './settings/settingsFeeds';
import { renderOpmlTab }           from './settings/settingsOPML';
import { AddUrlModal }             from './settings/feedAdd';
import { addFeed }                 from './settings/feedAdd';
import { runCleanupAndDedup }      from './settings/feedCleanup';
import { tagDuplicatesInVault }    from './settings/feedDuplicate';
import { setDynamicCss } from "./utils/css";

interface ObsidianPluginManager {
    disablePlugin: (pluginId: string) => Promise<void>;
    enablePlugin: (pluginId: string) => Promise<void>;
}

interface ObsidianSettingManager {
    openTabById: (pluginId: string) => Promise<void>;
}

interface AppWithPluginReload extends App {
    plugins: ObsidianPluginManager;
    setting: ObsidianSettingManager;
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


export class RssSettingTab extends PluginSettingTab {
    plugin: RssPlugin;
    private activeTab: 'general' | 'template' | 'feeds' | 'opml' = 'general';

    constructor(app: App, plugin: RssPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    private isTouchDevice(): boolean {
        return typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches;
    }

    private applyCardStyle(setting: Setting) {
        const { settingEl } = setting;
        applyCssText(settingEl, `
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
        `);
        settingEl.classList.add('rss-card-setting');
        settingEl.onmouseenter = () => { setDynamicCss(settingEl, { 'border-color': 'var(--interactive-accent)' }); };
        settingEl.onmouseleave = () => { setDynamicCss(settingEl, { 'border-color': 'var(--background-modifier-border)' }); };
    }

    private autoResize(el: HTMLTextAreaElement) {
        setDynamicCss(el, { 'height': 'auto' });
        setDynamicCss(el, { 'height': el.scrollHeight + 'px' });
    }

    private renderActiveTab(
        tabBody: HTMLElement,
        refresh: () => void
    ): void {
        const cardStyle  = this.applyCardStyle.bind(this);
        const autoResize = this.autoResize.bind(this);

        switch (this.activeTab) {
            case 'general':
                renderGeneralTab(tabBody, this.plugin, cardStyle);
                break;
            case 'template':
                renderGlobalTemplateTab(tabBody, this.plugin, autoResize);
                break;
            case 'feeds':
                renderMyFeedsTab(tabBody, this.app, this.plugin, cardStyle, refresh);
                break;
            case 'opml':
                renderOpmlTab(tabBody, this.app, this.plugin, cardStyle, refresh);
                break;
        }
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        ;

        const tabHeader = containerEl.createDiv();
        applyCssText(tabHeader, 'display: flex; align-items: center; gap: 8px; margin-bottom: 30px; flex-wrap: wrap;');

        let refresh: () => void;

        // ── Add Feed button ───────────────────────────────────────────────────
        const addFeedBtn = tabHeader.createEl('button');
        applyCssText(addFeedBtn, `
            display: flex; align-items: center; gap: 5px;
            padding: 6px 12px;
            ${this.isTouchDevice() ? 'min-height: 44px; min-width: 44px;' : ''}
            border-radius: 6px; cursor: pointer;
            font-size: 0.9em; border: none;
            background: var(--color-red); color: white;
            transition: opacity 0.15s ease;
        `);
        const addIcon = addFeedBtn.createDiv();
        applyCssText(addIcon, 'display: flex; align-items: center; width: 14px; height: 14px;');
        setIcon(addIcon, 'plus');
        addFeedBtn.createSpan({ text: 'Add Feed' });
        addFeedBtn.onclick = () => {
            new AddUrlModal(this.app, async (url: string) => {
                await addFeed(this.app, this.plugin, url, () => refresh());
            }).open();
        };

        // ── Update Feeds button ───────────────────────────────────────────────
        const updateBtn = tabHeader.createEl('button');
        updateBtn.title = 'Update feeds';
        applyCssText(updateBtn, `
            display: flex; align-items: center; justify-content: center;
            width: 30px; height: 30px;
            ${this.isTouchDevice() ? 'min-width: 44px; min-height: 44px;' : ''}
            padding: 0; border-radius: 6px; cursor: pointer;
            border: 1px solid var(--background-modifier-border);
            background: var(--background-secondary-alt); color: var(--text-muted);
            transition: all 0.15s ease;
        `);
        const updateIcon = updateBtn.createDiv();
        applyCssText(updateIcon, 'display: flex; align-items: center; width: 16px; height: 16px;');
        setIcon(updateIcon, 'refresh-cw');
        updateBtn.onclick = () => {
            void (async () => {
            const activeFeeds = this.plugin.settings.feeds.filter(
                f => f.enabled && !(f.archived ?? false) && !(f.deleted ?? false)
            );
            if (activeFeeds.length === 0) { new Notice('No active feeds to update'); return; }
            await this.plugin.updateAllFeeds();
            })();
        };

        // ── Stop button ───────────────────────────────────────────────────────
        const stopBtn = tabHeader.createEl('button');
        stopBtn.title = 'Stop updating';
        applyCssText(stopBtn, `
            display: flex; align-items: center; justify-content: center;
            width: 30px; height: 30px;
            ${this.isTouchDevice() ? 'min-width: 44px; min-height: 44px;' : ''}
            padding: 0; border-radius: 6px; cursor: pointer;
            border: 1px solid var(--background-modifier-border);
            background: var(--background-secondary-alt); color: var(--text-muted);
            transition: all 0.15s ease;
        `);
        const stopIcon = stopBtn.createDiv();
        applyCssText(stopIcon, 'display: flex; align-items: center; width: 16px; height: 16px;');
        setIcon(stopIcon, 'square');
        stopBtn.addEventListener('mouseenter', () => { setDynamicCss(stopBtn, { 'color': 'var(--color-red)' }); setDynamicCss(stopBtn, { 'border-color': 'var(--color-red)' }); });
        stopBtn.addEventListener('mouseleave', () => { setDynamicCss(stopBtn, { 'color': 'var(--text-muted)' }); setDynamicCss(stopBtn, { 'border-color': 'var(--background-modifier-border)' }); });
        stopBtn.onclick = () => { void this.plugin.stopUpdate(); };

        // ── Cleanup button ────────────────────────────────────────────────────
        const cleanupBtn = tabHeader.createEl('button');
        cleanupBtn.title = 'Delete old articles now';
        applyCssText(cleanupBtn, `
            display: flex; align-items: center; justify-content: center;
            width: 30px; height: 30px;
            ${this.isTouchDevice() ? 'min-width: 44px; min-height: 44px;' : ''}
            padding: 0; border-radius: 6px; cursor: pointer;
            border: 1px solid var(--background-modifier-border);
            background: var(--background-secondary-alt); color: var(--text-muted);
            transition: all 0.15s ease;
        `);
        const cleanupIcon = cleanupBtn.createDiv();
        applyCssText(cleanupIcon, 'display: flex; align-items: center; width: 16px; height: 16px;');
        setIcon(cleanupIcon, 'trash');
        cleanupBtn.addEventListener('mouseenter', () => { setDynamicCss(cleanupBtn, { 'color': 'var(--color-red)' }); setDynamicCss(cleanupBtn, { 'border-color': 'var(--color-red)' }); });
        cleanupBtn.addEventListener('mouseleave', () => { setDynamicCss(cleanupBtn, { 'color': 'var(--text-muted)' }); setDynamicCss(cleanupBtn, { 'border-color': 'var(--background-modifier-border)' }); });
        cleanupBtn.onclick = () => {
            void (async () => {
            new Notice('Running cleanup...', 3000);
            await runCleanupAndDedup(this.app, this.plugin);
            })();
        };

        // ── Separator ─────────────────────────────────────────────────────────
        applyCssText(tabHeader.createDiv(), 'width: 1px; height: 24px; background: var(--background-modifier-border); margin: 0 4px;');

        // ── Tab buttons ───────────────────────────────────────────────────────
        const tabBtns = new Map<string, HTMLButtonElement>();

        const createTabBtn = (id: 'general' | 'template' | 'feeds' | 'opml', label: string) => {
            const btn = tabHeader.createEl('button', { text: label });
            applyCssText(btn, `padding: 6px 16px; ${this.isTouchDevice() ? 'min-height: 44px;' : ''} border-radius: 6px; cursor: pointer; font-size: 0.9em; border: 1px solid var(--background-modifier-border); transition: all 0.2s ease;`);
            if (this.activeTab === id) {
                setDynamicCss(btn, { 'background-color': 'var(--interactive-accent)' });
                setDynamicCss(btn, { 'color': 'var(--text-on-accent)' });
                setDynamicCss(btn, { 'border-color': 'var(--interactive-accent)' });
            } else {
                setDynamicCss(btn, { 'background-color': 'var(--background-secondary-alt)' });
                setDynamicCss(btn, { 'color': 'var(--text-muted)' });
                setDynamicCss(btn, { 'border-color': 'var(--background-modifier-border)' });
            }
            btn.onclick = () => {
                if (this.activeTab === id) return;
                this.activeTab = id;
                tabBtns.forEach((b, bid) => {
                    if (bid === id) {
                        setDynamicCss(b, { 'background-color': 'var(--interactive-accent)' });
                        setDynamicCss(b, { 'color': 'var(--text-on-accent)' });
                        setDynamicCss(b, { 'border-color': 'var(--interactive-accent)' });
                    } else {
                        setDynamicCss(b, { 'background-color': 'var(--background-secondary-alt)' });
                        setDynamicCss(b, { 'color': 'var(--text-muted)' });
                        setDynamicCss(b, { 'border-color': 'var(--background-modifier-border)' });
                    }
                });
                refresh();
            };
            tabBtns.set(id, btn);
        };

        createTabBtn('general',  'General');
        createTabBtn('template', 'Template');
        createTabBtn('feeds',    'Feeds');
        createTabBtn('opml',     'Import/export');

        // ── Reload Plugin button (dev mode only) ──────────────────────────────
        if (this.plugin.settings.devMode) {
            applyCssText(tabHeader.createDiv(), 'width: 1px; height: 24px; background: var(--background-modifier-border); margin: 0 4px;');

            const reloadBtn = tabHeader.createEl('button');
            reloadBtn.title = 'Reload plugin';
            applyCssText(reloadBtn, `
                display: flex; align-items: center; justify-content: center;
                width: 30px; height: 30px;
                ${this.isTouchDevice() ? 'min-width: 44px; min-height: 44px;' : ''}
                padding: 0; border-radius: 6px; cursor: pointer;
                border: 1px solid var(--background-modifier-border);
                background: var(--background-secondary-alt); color: var(--text-muted);
                transition: all 0.15s ease;
            `);
            const reloadIcon = reloadBtn.createDiv();
            applyCssText(reloadIcon, 'display: flex; align-items: center; width: 16px; height: 16px;');
            setIcon(reloadIcon, 'rotate-ccw');
            reloadBtn.onclick = () => {
                void (async () => {
                await this.plugin.saveSettings();
                const pluginId = this.plugin.manifest.id;
                const appWithReload = this.app as AppWithPluginReload;
                await appWithReload.plugins.disablePlugin(pluginId);
                await appWithReload.plugins.enablePlugin(pluginId);
                await appWithReload.setting.openTabById(pluginId);
                })();
            };

            // ── Tag Duplicates button (dev mode only) ─────────────────────────
            const tagDupBtn = tabHeader.createEl('button');
            tagDupBtn.title = 'Tag duplicate articles';
            applyCssText(tagDupBtn, `
                display: flex; align-items: center; justify-content: center;
                width: 30px; height: 30px;
                ${this.isTouchDevice() ? 'min-width: 44px; min-height: 44px;' : ''}
                padding: 0; border-radius: 6px; cursor: pointer;
                border: 1px solid var(--background-modifier-border);
                background: var(--background-secondary-alt); color: var(--text-muted);
                transition: all 0.15s ease;
            `);
            const tagDupIcon = tagDupBtn.createDiv();
            applyCssText(tagDupIcon, 'display: flex; align-items: center; width: 16px; height: 16px;');
            setIcon(tagDupIcon, 'copy');
            tagDupBtn.addEventListener('mouseenter', () => { setDynamicCss(tagDupBtn, { 'color': 'var(--interactive-accent)' }); setDynamicCss(tagDupBtn, { 'border-color': 'var(--interactive-accent)' }); });
            tagDupBtn.addEventListener('mouseleave', () => { setDynamicCss(tagDupBtn, { 'color': 'var(--text-muted)' }); setDynamicCss(tagDupBtn, { 'border-color': 'var(--background-modifier-border)' }); });
            tagDupBtn.onclick = () => {
                void (async () => {
                tagDupBtn.disabled = true;
                try {
                    const count = await tagDuplicatesInVault(this.app, this.plugin);
                    new Notice(count > 0 ? `Processed ${count} duplicate article${count !== 1 ? 's' : ''}.` : 'No duplicates found.', 4000);
                } finally {
                    tagDupBtn.disabled = false;
                }
                })();
            };
        }

        const tabBody = containerEl.createDiv({ cls: 'rss-tab-body' });
        refresh = () => {
            tabBody.empty();
            this.renderActiveTab(tabBody, refresh);
        };

        this.renderActiveTab(tabBody, refresh);
    }
}
