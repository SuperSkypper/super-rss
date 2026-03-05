import { App, PluginSettingTab, Setting, Notice, setIcon } from 'obsidian';
import RssPlugin, { resolveFeedPath } from './main';
import { renderGeneralTab }        from './settings/settingsGeneral';
import { renderGlobalTemplateTab } from './settings/settingsTemplate';
import { renderMyFeedsTab }        from './settings/settingsFeeds';
import { renderOpmlTab }           from './settings/settingsOPML';
import { AddUrlModal }             from './settings/feedAdd';
import { addFeed }                 from './settings/feedAdd';
import { cleanupOldFiles }         from './settings/feedSaver';

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
        settingEl.style.cssText = `
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
        `;
        settingEl.classList.add('rss-card-setting');
        settingEl.onmouseenter = () => { settingEl.style.borderColor = 'var(--interactive-accent)'; };
        settingEl.onmouseleave = () => { settingEl.style.borderColor = 'var(--background-modifier-border)'; };
    }

    private autoResize(el: HTMLTextAreaElement) {
        el.style.height = 'auto';
        el.style.height = el.scrollHeight + 'px';
    }

    // ── Standalone cleanup runner ─────────────────────────────────────────────

    private async runCleanupAndDedup(): Promise<void> {
        const enabledFeeds = this.plugin.settings.feeds.filter(
            f => f.enabled && f.url && !f.deleted
        );

        if (enabledFeeds.length === 0) {
            new Notice('No active feeds to clean up.');
            return;
        }

        const { loadFeedDatabase, saveFeedDatabase } = await import('./settings/feedDatabase');
        const db = await loadFeedDatabase(this.app);
        let totalDeleted = 0;

        for (const feed of enabledFeeds) {
            const feedPath         = resolveFeedPath(feed, this.plugin.settings);
            const feedDateField    = feed.autoCleanupDateField;
            const cleanupDateField = (!feedDateField || feedDateField === 'global')
                ? this.plugin.settings.autoCleanupDateField
                : feedDateField;

            if (feed.autoCleanupValue != null && feed.autoCleanupValue > 0) {
                try {
                    totalDeleted += await cleanupOldFiles(
                        this.app.vault,
                        this.app,
                        feedPath,
                        feed.autoCleanupValue,
                        feed.autoCleanupUnit ?? this.plugin.settings.autoCleanupUnit,
                        cleanupDateField,
                        this.plugin.settings,
                        db
                    );
                } catch (e) {
                    console.error(`Cleanup error [${feed.name}]:`, e);
                }
                continue;
            }

            if (this.plugin.settings.autoCleanupValue > 0) {
                try {
                    totalDeleted += await cleanupOldFiles(
                        this.app.vault,
                        this.app,
                        feedPath,
                        this.plugin.settings.autoCleanupValue,
                        this.plugin.settings.autoCleanupUnit,
                        this.plugin.settings.autoCleanupDateField,
                        this.plugin.settings,
                        db
                    );
                } catch (e) {
                    console.error(`Cleanup error [${feed.name}]:`, e);
                }
            }
        }

        await saveFeedDatabase(this.app, db);

        if (totalDeleted === 0) {
            new Notice('No old articles to delete.', 4000);
        } else {
            new Notice(`${totalDeleted} article${totalDeleted !== 1 ? 's' : ''} deleted.`, 4000);
        }
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
        containerEl.createEl('h2', { text: 'Super RSS Settings' });

        const tabHeader = containerEl.createDiv();
        tabHeader.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 30px; flex-wrap: wrap;';

        let refresh: () => void;

        // ── Add Feed button ───────────────────────────────────────────────────
        const addFeedBtn = tabHeader.createEl('button');
        addFeedBtn.style.cssText = `
            display: flex; align-items: center; gap: 5px;
            padding: 6px 12px;
            ${this.isTouchDevice() ? 'min-height: 44px; min-width: 44px;' : ''}
            border-radius: 6px; cursor: pointer;
            font-size: 0.9em; border: none;
            background: var(--color-red); color: white;
            transition: opacity 0.15s ease;
        `;
        const addIcon = addFeedBtn.createDiv();
        addIcon.style.cssText = 'display: flex; align-items: center; width: 14px; height: 14px;';
        setIcon(addIcon, 'plus');
        addFeedBtn.createSpan({ text: 'Add Feed' });
        addFeedBtn.onclick = () => {
            new AddUrlModal(this.app, async (url: string) => {
                await addFeed(this.app, this.plugin, url, () => refresh());
            }).open();
        };

        // ── Update Feeds button ───────────────────────────────────────────────
        const updateBtn = tabHeader.createEl('button');
        updateBtn.title = 'Update Feeds';
        updateBtn.style.cssText = `
            display: flex; align-items: center; justify-content: center;
            width: 30px; height: 30px;
            ${this.isTouchDevice() ? 'min-width: 44px; min-height: 44px;' : ''}
            padding: 0; border-radius: 6px; cursor: pointer;
            border: 1px solid var(--background-modifier-border);
            background: var(--background-secondary-alt); color: var(--text-muted);
            transition: all 0.15s ease;
        `;
        const updateIcon = updateBtn.createDiv();
        updateIcon.style.cssText = 'display: flex; align-items: center; width: 16px; height: 16px;';
        setIcon(updateIcon, 'refresh-cw');
        updateBtn.onclick = async () => {
            const activeFeeds = this.plugin.settings.feeds.filter(
                f => f.enabled && !(f.archived ?? false) && !(f.deleted ?? false)
            );
            if (activeFeeds.length === 0) { new Notice('No active feeds to update'); return; }
            await this.plugin.updateAllFeeds();
        };

        // ── Stop button ───────────────────────────────────────────────────────
        const stopBtn = tabHeader.createEl('button');
        stopBtn.title = 'Stop updating';
        stopBtn.style.cssText = `
            display: flex; align-items: center; justify-content: center;
            width: 30px; height: 30px;
            ${this.isTouchDevice() ? 'min-width: 44px; min-height: 44px;' : ''}
            padding: 0; border-radius: 6px; cursor: pointer;
            border: 1px solid var(--background-modifier-border);
            background: var(--background-secondary-alt); color: var(--text-muted);
            transition: all 0.15s ease;
        `;
        const stopIcon = stopBtn.createDiv();
        stopIcon.style.cssText = 'display: flex; align-items: center; width: 16px; height: 16px;';
        setIcon(stopIcon, 'square');
        stopBtn.addEventListener('mouseenter', () => { stopBtn.style.color = 'var(--color-red)'; stopBtn.style.borderColor = 'var(--color-red)'; });
        stopBtn.addEventListener('mouseleave', () => { stopBtn.style.color = 'var(--text-muted)'; stopBtn.style.borderColor = 'var(--background-modifier-border)'; });
        stopBtn.onclick = async () => { await this.plugin.stopUpdate(); };

        // ── Cleanup button ────────────────────────────────────────────────────
        const cleanupBtn = tabHeader.createEl('button');
        cleanupBtn.title = 'Delete old articles now';
        cleanupBtn.style.cssText = `
            display: flex; align-items: center; justify-content: center;
            width: 30px; height: 30px;
            ${this.isTouchDevice() ? 'min-width: 44px; min-height: 44px;' : ''}
            padding: 0; border-radius: 6px; cursor: pointer;
            border: 1px solid var(--background-modifier-border);
            background: var(--background-secondary-alt); color: var(--text-muted);
            transition: all 0.15s ease;
        `;
        const cleanupIcon = cleanupBtn.createDiv();
        cleanupIcon.style.cssText = 'display: flex; align-items: center; width: 16px; height: 16px;';
        setIcon(cleanupIcon, 'trash');
        cleanupBtn.addEventListener('mouseenter', () => { cleanupBtn.style.color = 'var(--color-red)'; cleanupBtn.style.borderColor = 'var(--color-red)'; });
        cleanupBtn.addEventListener('mouseleave', () => { cleanupBtn.style.color = 'var(--text-muted)'; cleanupBtn.style.borderColor = 'var(--background-modifier-border)'; });
        cleanupBtn.onclick = async () => {
            // Dedup always runs; cleanup rules are optional

            await this.runCleanupAndDedup();
        };

        // ── Separator ─────────────────────────────────────────────────────────
        tabHeader.createDiv().style.cssText = 'width: 1px; height: 24px; background: var(--background-modifier-border); margin: 0 4px;';

        // ── Tab buttons ───────────────────────────────────────────────────────
        const tabBtns = new Map<string, HTMLButtonElement>();

        const createTabBtn = (id: 'general' | 'template' | 'feeds' | 'opml', label: string) => {
            const btn = tabHeader.createEl('button', { text: label });
            btn.style.cssText = `padding: 6px 16px; ${this.isTouchDevice() ? 'min-height: 44px;' : ''} border-radius: 6px; cursor: pointer; font-size: 0.9em; border: 1px solid var(--background-modifier-border); transition: all 0.2s ease;`;
            if (this.activeTab === id) {
                btn.style.backgroundColor = 'var(--interactive-accent)';
                btn.style.color           = 'var(--text-on-accent)';
                btn.style.borderColor     = 'var(--interactive-accent)';
            } else {
                btn.style.backgroundColor = 'var(--background-secondary-alt)';
                btn.style.color           = 'var(--text-muted)';
                btn.style.borderColor     = 'var(--background-modifier-border)';
            }
            btn.onclick = () => {
                if (this.activeTab === id) return;
                this.activeTab = id;
                tabBtns.forEach((b, bid) => {
                    if (bid === id) {
                        b.style.backgroundColor = 'var(--interactive-accent)';
                        b.style.color           = 'var(--text-on-accent)';
                        b.style.borderColor     = 'var(--interactive-accent)';
                    } else {
                        b.style.backgroundColor = 'var(--background-secondary-alt)';
                        b.style.color           = 'var(--text-muted)';
                        b.style.borderColor     = 'var(--background-modifier-border)';
                    }
                });
                refresh();
            };
            tabBtns.set(id, btn);
        };

        createTabBtn('general',  'General');
        createTabBtn('template', 'Global Template');
        createTabBtn('feeds',    'My Feeds');
        createTabBtn('opml',     'OPML');

        // ── Reload Plugin button (dev mode only) ──────────────────────────────
        if (this.plugin.settings.devMode) {
            tabHeader.createDiv().style.cssText = 'width: 1px; height: 24px; background: var(--background-modifier-border); margin: 0 4px;';

            const reloadBtn = tabHeader.createEl('button');
            reloadBtn.title = 'Reload Plugin';
            reloadBtn.style.cssText = `
                display: flex; align-items: center; justify-content: center;
                width: 30px; height: 30px;
                ${this.isTouchDevice() ? 'min-width: 44px; min-height: 44px;' : ''}
                padding: 0; border-radius: 6px; cursor: pointer;
                border: 1px solid var(--background-modifier-border);
                background: var(--background-secondary-alt); color: var(--text-muted);
                transition: all 0.15s ease;
            `;
            const reloadIcon = reloadBtn.createDiv();
            reloadIcon.style.cssText = 'display: flex; align-items: center; width: 16px; height: 16px;';
            setIcon(reloadIcon, 'rotate-ccw');
            reloadBtn.onclick = async () => {
                await this.plugin.saveSettings();
                const pluginId = this.plugin.manifest.id;
                await (this.app as any).plugins.disablePlugin(pluginId);
                await (this.app as any).plugins.enablePlugin(pluginId);
                await (this.app as any).setting.openTabById(pluginId);
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