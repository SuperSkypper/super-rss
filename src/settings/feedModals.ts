import { App, Modal, Setting, Notice } from 'obsidian';
import RssPlugin, { FeedConfig } from '../main';
import { fetchAndParse } from '../services/feedExtractor';

// ─── AddUrlModal ─────────────────────────────────────────────────────────────

export class AddUrlModal extends Modal {
    private url: string = '';
    private onSubmit: (url: string) => void;

    constructor(app: App, onSubmit: (url: string) => void) {
        super(app);
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: 'Add RSS Feed' });

        new Setting(contentEl)
            .setName('Feed URL')
            .setDesc('Enter the RSS/Atom link.')
            .addText(text => text
                .setPlaceholder('https://example.com/rss.xml')
                .onChange(v => this.url = v));

        const btnContainer = contentEl.createDiv();
        btnContainer.style.cssText = 'margin-top: 20px; display: flex; justify-content: flex-end; gap: 10px;';

        const cancelBtn = btnContainer.createEl('button', { text: 'Cancel' });
        cancelBtn.onclick = () => this.close();

        const addBtn = btnContainer.createEl('button', { text: 'Fetch & Edit', cls: 'mod-cta' });
        addBtn.onclick = () => {
            const sanitizedUrl = this.url.trim();
            if (sanitizedUrl) { this.onSubmit(sanitizedUrl); this.close(); }
            else new Notice('Enter a valid URL');
        };
    }
}

// ─── FeedEditModal ────────────────────────────────────────────────────────────

export class FeedEditModal extends Modal {
    feed: FeedConfig;
    onSubmit: () => void;
    onDelete?: () => void;
    plugin: RssPlugin;

    constructor(app: App, plugin: RssPlugin, feed: FeedConfig, onSubmit: () => void, onDelete?: () => void) {
        super(app);
        this.feed = feed;
        this.onSubmit = onSubmit;
        this.onDelete = onDelete;
        this.plugin = plugin;
    }

    private applyFullWidthTextArea(setting: Setting) {
        setting.settingEl.style.display = 'flex';
        setting.settingEl.style.flexDirection = 'column';
        setting.settingEl.style.alignItems = 'flex-start';
        setting.controlEl.style.width = '100%';
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: 'Edit Feed Settings' });

        this.modalEl.style.width = '700px';
        this.modalEl.style.maxHeight = '80vh';
        this.modalEl.style.overflow = 'hidden';

        let activeTab: 'feed' | 'custom' = 'feed';

        const tabContainer = contentEl.createDiv();
        tabContainer.style.cssText = 'display: flex; gap: 8px; margin-bottom: 20px;';
        const feedTabBtn = tabContainer.createEl('button', { text: 'Feed' });
        const customTabBtn = tabContainer.createEl('button', { text: 'Custom' });

        const tabBody = contentEl.createDiv();
        tabBody.style.cssText = 'height: 420px; overflow: auto; padding-right: 6px;';
        const feedContent = tabBody.createDiv();
        const customContent = tabBody.createDiv();

        const updateView = () => {
            const baseStyle = 'padding: 6px 16px; border-radius: 6px; cursor: pointer; font-size: 0.9em; border: 1px solid var(--background-modifier-border); transition: all 0.2s ease;';
            const inactiveStyle = 'background-color: var(--background-secondary-alt); color: var(--text-muted);';
            const activeStyle = 'background-color: var(--interactive-accent); color: var(--text-on-accent); border-color: var(--interactive-accent);';
            feedTabBtn.style.cssText = `${baseStyle} ${activeTab === 'feed' ? activeStyle : inactiveStyle}`;
            customTabBtn.style.cssText = `${baseStyle} ${activeTab === 'custom' ? activeStyle : inactiveStyle}`;
            feedContent.style.display = activeTab === 'feed' ? 'block' : 'none';
            customContent.style.display = activeTab === 'custom' ? 'block' : 'none';
        };

        feedTabBtn.onclick = () => { if (activeTab !== 'feed') { activeTab = 'feed'; updateView(); } };
        customTabBtn.onclick = () => { if (activeTab !== 'custom') { activeTab = 'custom'; updateView(); } };
        updateView();

        this.renderFeedTab(feedContent);
        this.renderCustomTab(customContent);
        this.renderFooter(contentEl);
    }

    private renderFeedTab(container: HTMLElement) {
        new Setting(container)
            .setName('Feed Name')
            .addText(t => t.setValue(this.feed.name || '').onChange(v => { this.feed.name = v; this.onSubmit(); }));

        const urlSetting = new Setting(container).setName('Feed URL');
        urlSetting.settingEl.style.display = 'flex';
        urlSetting.settingEl.style.flexDirection = 'column';
        urlSetting.settingEl.style.alignItems = 'flex-start';
        urlSetting.controlEl.style.width = '100%';
        urlSetting.controlEl.style.marginTop = '10px';

        const urlInput = urlSetting.controlEl.createEl('input', { type: 'text' });
        urlInput.value = this.feed.url || '';
        urlInput.style.width = '100%';
        urlInput.style.display = 'block';
        urlInput.onchange = (e) => { this.feed.url = (e.target as HTMLInputElement).value; this.onSubmit(); };
        urlInput.onkeydown = (e) => { if (e.key === 'Enter') { this.onSubmit(); this.close(); } };

        new Setting(container)
            .setName('Custom Folder Name (optional)')
            .setDesc('Subfolder within your main RSS folder.')
            .addText(t => t
                .setPlaceholder(this.feed.name || 'Folder name')
                .setValue(this.feed.folder || '')
                .onChange(v => { this.feed.folder = v; this.onSubmit(); }));
    }

    private renderCustomTab(container: HTMLElement) {
        const variables = [
            { label: 'Title',          tag: '{{title}}' },
            { label: 'Author',         tag: '{{author}}' },
            { label: 'Link',           tag: '{{link}}' },
            { label: 'Image',          tag: '{{image}}' },
            { label: 'Date Published', tag: '{{datepub}}' },
            { label: 'Date Saved',     tag: '{{datesaved}}' },
            { label: 'Snippet',        tag: '{{snippet}}' },
            { label: 'Body',           tag: '{{content}}' },
        ];

        const details = container.createEl('details');
        details.style.cssText = 'margin: 15px 0; padding: 10px; background: var(--background-secondary); border-radius: 6px; font-size: 0.9em; border: 1px solid var(--background-modifier-border);';
        const summary = details.createEl('summary', { text: 'Available variables' });
        summary.style.cssText = 'color: var(--text-normal); cursor: pointer;';
        const varList = details.createDiv();
        varList.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr; gap: 8px; color: var(--text-muted); margin-top: 10px;';

        variables.forEach(v => {
            const item = varList.createDiv();
            item.style.cssText = 'cursor: pointer;';
            item.createEl('span', { text: `${v.label}: ` }).style.cssText = 'color: var(--text-normal);';
            const code = item.createEl('code', { text: v.tag });
            code.style.cssText = 'color: var(--text-accent);';
            item.onclick = async () => {
                await navigator.clipboard.writeText(v.tag);
                new Notice(`Copied: ${v.tag}`);
            };
        });

        const templatesContainer = container.createDiv();
        templatesContainer.style.cssText = 'margin: 20px 0; padding: 8px 0;';

        new Setting(templatesContainer)
            .setName('File Name Template')
            .addText(t => t
                .setPlaceholder('{{title}}')
                .setValue(this.feed.titleTemplate || '')
                .onChange(v => { this.feed.titleTemplate = v; this.onSubmit(); }));

        const frontmatterSetting = new Setting(templatesContainer)
            .setName('Properties/Frontmatter')
            .addTextArea(t => {
                const el = t.inputEl as HTMLTextAreaElement;
                t.setValue(this.feed.frontmatterTemplate || '')
                    .onChange(v => { this.feed.frontmatterTemplate = v; this.onSubmit(); });
                el.placeholder = this.plugin.settings.frontmatterTemplate || '(use global template)';
                el.style.cssText = 'width: 100%; margin-top: 10px; font-family: var(--font-monospace); font-size: 0.8em; resize: none; box-sizing: border-box;';
                el.rows = 5;
            });
        this.applyFullWidthTextArea(frontmatterSetting);

        const contentTemplateSetting = new Setting(templatesContainer)
            .setName('Content Template')
            .addTextArea(t => {
                const el = t.inputEl as HTMLTextAreaElement;
                t.setValue(this.feed.contentTemplate || '')
                    .onChange(v => { this.feed.contentTemplate = v; this.onSubmit(); });
                el.placeholder = this.plugin.settings.template || '(use global template)';
                el.style.cssText = 'width: 100%; margin-top: 10px; font-family: var(--font-monospace); font-size: 0.8em; resize: none; box-sizing: border-box;';
                el.rows = 5;
            });
        this.applyFullWidthTextArea(contentTemplateSetting);
    }

    private renderFooter(contentEl: HTMLElement) {
        const footer = contentEl.createDiv();
        footer.style.cssText = 'margin-top: 40px; display: flex; justify-content: space-between;';

        const delBtn = footer.createEl('button', { text: 'Delete Feed', cls: 'mod-warning' });
        delBtn.onclick = () => {
            if (confirm('Are you sure you want to delete this feed?')) {
                if (this.onDelete) this.onDelete();
                this.close();
            }
        };

        const rightSide = footer.createDiv();
        rightSide.style.cssText = 'display: flex; gap: 10px;';
        const cancelBtn = rightSide.createEl('button', { text: 'Cancel' });
        cancelBtn.onclick = () => this.close();
        const saveBtn = rightSide.createEl('button', { text: 'Save Feed', cls: 'mod-cta' });
        saveBtn.onclick = () => { this.onSubmit(); this.close(); };
    }

    onClose() {
        this.onSubmit();
        this.contentEl.empty();
    }
}

// ─── ConfirmDeleteModal ───────────────────────────────────────────────────────

export class ConfirmDeleteModal extends Modal {
    private onConfirm: () => Promise<void>;
    private onConfirmWithContent: () => Promise<void>;

    constructor(app: App, onConfirm: () => Promise<void>, onConfirmWithContent: () => Promise<void>) {
        super(app);
        this.onConfirm = onConfirm;
        this.onConfirmWithContent = onConfirmWithContent;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: 'Permanently Delete Feed?' });
        contentEl.createEl('p', { text: 'This action cannot be undone. The feed will be permanently deleted.' });

        const footer = contentEl.createDiv();
        footer.style.cssText = 'display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px; flex-wrap: wrap;';

        const cancelBtn = footer.createEl('button', { text: 'Cancel' });
        cancelBtn.onclick = () => this.close();

        const deleteBtn = footer.createEl('button', { text: 'Delete Feed Only', cls: 'mod-error' });
        deleteBtn.onclick = async () => { await this.onConfirm(); this.close(); };

        const deleteWithContentBtn = footer.createEl('button', { text: 'Delete Feed & Content', cls: 'mod-error' });
        deleteWithContentBtn.onclick = async () => { await this.onConfirmWithContent(); this.close(); };
    }

    onClose() { this.contentEl.empty(); }
}