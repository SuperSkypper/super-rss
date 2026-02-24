import { App, PluginSettingTab, Setting } from 'obsidian';
import RssPlugin from './main';
import { renderGeneralTab }        from './settings/generalTab';
import { renderGlobalTemplateTab } from './settings/globalTemplateTab';
import { renderMyFeedsTab }        from './settings/myFeedsTab';
import { renderOpmlTab }           from './settings/opmlTab';

export class RssSettingTab extends PluginSettingTab {
    plugin: RssPlugin;
    private activeTab: 'general' | 'template' | 'feeds' | 'opml' = 'general';

    constructor(app: App, plugin: RssPlugin) {
        super(app, plugin);
        this.plugin = plugin;
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

    private renderActiveTab(
        tabBody: HTMLElement,
        cardStyle: (s: Setting) => void,
        autoResize: (el: HTMLTextAreaElement) => void,
        refresh: () => void
    ): void {
        switch (this.activeTab) {
            case 'general':
                renderGeneralTab(tabBody, this.app, this.plugin, cardStyle);
                break;
            case 'template':
                renderGlobalTemplateTab(tabBody, this.plugin, cardStyle, autoResize);
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
        containerEl.createEl('h2', { text: 'RSS Reader Settings' });

        const tabHeader = containerEl.createDiv();
        tabHeader.style.cssText = 'display: flex; gap: 8px; margin-bottom: 30px;';

        const createTabBtn = (id: 'general' | 'template' | 'feeds' | 'opml', label: string) => {
            const btn = tabHeader.createEl('button', { text: label });
            btn.style.cssText = 'padding: 6px 16px; border-radius: 6px; cursor: pointer; font-size: 0.9em; border: 1px solid var(--background-modifier-border); transition: all 0.2s ease;';
            if (this.activeTab === id) {
                btn.style.backgroundColor = 'var(--interactive-accent)';
                btn.style.color           = 'var(--text-on-accent)';
                btn.style.borderColor     = 'var(--interactive-accent)';
            } else {
                btn.style.backgroundColor = 'var(--background-secondary-alt)';
                btn.style.color           = 'var(--text-muted)';
            }
            btn.onclick = () => { this.activeTab = id; this.display(); };
        };

        createTabBtn('general',  'General');
        createTabBtn('template', 'Global Template');
        createTabBtn('feeds',    'My Feeds');
        createTabBtn('opml',     'OPML');

        const tabBody = containerEl.createDiv({ cls: 'rss-tab-body' });

        const cardStyle  = this.applyCardStyle.bind(this);
        const autoResize = this.autoResize.bind(this);

        const refresh = () => {
            tabBody.empty();
            this.renderActiveTab(tabBody, cardStyle, autoResize, refresh);
        };

        this.renderActiveTab(tabBody, cardStyle, autoResize, refresh);
    }
}