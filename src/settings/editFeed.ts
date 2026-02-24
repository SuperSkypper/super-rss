import { App, Modal, Setting, Notice } from 'obsidian';
import RssPlugin, { FeedConfig } from '../main';

// ─── AddUrlModal ──────────────────────────────────────────────────────────────

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
            if (sanitizedUrl) {
                this.onSubmit(sanitizedUrl);
                this.close();
            } else {
                new Notice('Enter a valid URL');
            }
        };
    }
}

// ─── FeedEditModal ────────────────────────────────────────────────────────────

export class FeedEditModal extends Modal {
    feed: FeedConfig;
    plugin: RssPlugin;
    onSubmit: () => Promise<void>;
    onDelete?: () => void;

    constructor(app: App, plugin: RssPlugin, feed: FeedConfig, onSubmit: () => Promise<void>, onDelete?: () => void) {
        super(app);
        this.feed = feed;
        this.plugin = plugin;
        this.onSubmit = onSubmit;
        this.onDelete = onDelete;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: 'Edit Feed Settings' });

        this.modalEl.style.width     = '860px';
        this.modalEl.style.maxWidth  = '95vw';
        this.modalEl.style.maxHeight = '90vh';
        this.modalEl.style.overflow  = 'hidden';

        let activeTab: 'feed' | 'custom' = 'feed';

        const tabContainer = contentEl.createDiv();
        tabContainer.style.cssText = 'display: flex; gap: 8px; margin-bottom: 20px;';
        const feedTabBtn   = tabContainer.createEl('button', { text: 'Feed' });
        const customTabBtn = tabContainer.createEl('button', { text: 'Custom' });

        const tabBody = contentEl.createDiv();
        tabBody.style.cssText = 'height: 560px; overflow: auto; padding-right: 6px;';
        const feedContent   = tabBody.createDiv();
        const customContent = tabBody.createDiv();

        const updateView = () => {
            const base     = 'padding: 6px 16px; border-radius: 6px; cursor: pointer; font-size: 0.9em; border: 1px solid var(--background-modifier-border); transition: all 0.2s ease;';
            const inactive = 'background-color: var(--background-secondary-alt); color: var(--text-muted);';
            const active   = 'background-color: var(--interactive-accent); color: var(--text-on-accent); border-color: var(--interactive-accent);';
            feedTabBtn.style.cssText   = `${base} ${activeTab === 'feed'   ? active : inactive}`;
            customTabBtn.style.cssText = `${base} ${activeTab === 'custom' ? active : inactive}`;
            feedContent.style.display   = activeTab === 'feed'   ? 'block' : 'none';
            customContent.style.display = activeTab === 'custom' ? 'block' : 'none';
        };

        feedTabBtn.onclick   = () => { if (activeTab !== 'feed')   { activeTab = 'feed';   updateView(); } };
        customTabBtn.onclick = () => { if (activeTab !== 'custom') { activeTab = 'custom'; updateView(); } };
        updateView();

        this.renderFeedTab(feedContent);
        this.renderCustomTab(customContent);
        this.renderFooter(contentEl);
    }

    // ── Card style ────────────────────────────────────────────────────────────

    private applyCardToSetting(setting: Setting) {
        const el = setting.settingEl;
        el.style.cssText = `
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
        el.onmouseenter = () => { el.style.borderColor = 'var(--interactive-accent)'; };
        el.onmouseleave = () => { el.style.borderColor = 'var(--background-modifier-border)'; };
    }

    private applyFullWidthTextArea(setting: Setting) {
        setting.settingEl.style.flexDirection = 'column';
        setting.settingEl.style.alignItems    = 'flex-start';
        setting.controlEl.style.width         = '100%';
    }

    // ── Feed tab ──────────────────────────────────────────────────────────────

    private renderFeedTab(container: HTMLElement) {
        container.empty();

        // Feed Name
        const nameSetting = new Setting(container)
            .setName('Feed Name')
            .addText(t => t
                .setValue(this.feed.name || '')
                .onChange(v => { this.feed.name = v; }));
        this.applyCardToSetting(nameSetting);

        // Feed URL
        const urlSetting = new Setting(container).setName('Feed URL');
        this.applyCardToSetting(urlSetting);
        urlSetting.settingEl.style.flexDirection = 'column';
        urlSetting.settingEl.style.alignItems    = 'flex-start';
        urlSetting.controlEl.style.width         = '100%';
        urlSetting.controlEl.style.marginTop     = '10px';

        const urlInput = urlSetting.controlEl.createEl('input', { type: 'text' });
        urlInput.value = this.feed.url || '';
        urlInput.style.cssText = 'width: 100%; display: block; box-sizing: border-box;';
        urlInput.onchange  = (e) => { this.feed.url = (e.target as HTMLInputElement).value; };
        urlInput.onkeydown = (e) => { if (e.key === 'Enter') { this.onSubmit(); this.close(); } };

        // Folder group assignment
        const groups = this.plugin.settings.groups;
        const groupSetting = new Setting(container)
            .setName('Folder')
            .setDesc('Assign this feed to a folder. Leave as "No folder" to keep it loose.')
            .addDropdown(dropdown => {
                dropdown.addOption('', 'No folder');
                groups.forEach(g => dropdown.addOption(g.id, g.name));
                dropdown.setValue(this.feed.groupId ?? '');
                dropdown.onChange(v => {
                    this.feed.groupId = v === '' ? undefined : v;
                });
            });
        this.applyCardToSetting(groupSetting);

        // Custom Folder
        const folderSetting = new Setting(container)
            .setName('Custom Subfolder (optional)')
            .setDesc('Extra subfolder inside the assigned folder (or main RSS folder if no folder assigned).')
            .addText(t => {
                t.setPlaceholder(this.feed.name || 'Subfolder name')
                 .setValue(this.feed.folder || '')
                 .onChange(v => { this.feed.folder = v; });

                const nameInput = container.querySelector('input[type="text"]') as HTMLInputElement;
                if (nameInput) {
                    nameInput.addEventListener('input', () => {
                        t.inputEl.placeholder = nameInput.value || 'Subfolder name';
                    });
                }
            });
        this.applyCardToSetting(folderSetting);

        // Timing header
        const timingHeader = container.createEl('h4', { text: 'Timing' });
        timingHeader.style.cssText = 'margin: 20px 0 8px; color: var(--text-muted); font-size: 0.85em; text-transform: uppercase; letter-spacing: 0.05em;';

        // Update Interval
        const intervalSetting = new Setting(container)
            .setName('Update Interval')
            .setDesc('Overrides the global interval for this feed. Leave blank to use global.')
            .addText(text => text
                .setPlaceholder(String(this.plugin.settings.updateIntervalValue ?? 30))
                .setValue(this.feed.updateIntervalValue != null ? String(this.feed.updateIntervalValue) : '')
                .onChange(v => {
                    this.feed.updateIntervalValue = v.trim() === '' ? undefined : Number(v) || undefined;
                }))
            .addDropdown(dropdown => dropdown
                .addOption('minutes', 'Minutes')
                .addOption('hours',   'Hours')
                .addOption('days',    'Days')
                .addOption('months',  'Months')
                .setValue(this.feed.updateIntervalUnit ?? this.plugin.settings.updateIntervalUnit ?? 'minutes')
                .onChange(v => {
                    this.feed.updateIntervalUnit = v as 'minutes' | 'hours' | 'days' | 'months';
                }));
        this.applyCardToSetting(intervalSetting);

        // Auto Delete toggle
        const autoDeleteEnabled = this.feed.autoCleanupValue != null;

        const autoDeleteToggle = new Setting(container)
            .setName('Auto Delete Old Articles')
            .setDesc('Overrides global cleanup settings for this feed.')
            .addToggle(toggle => toggle
                .setValue(autoDeleteEnabled)
                .onChange(v => {
                    this.feed.autoCleanupValue     = v ? 30 : undefined;
                    this.feed.autoCleanupUnit      = v ? (this.plugin.settings.autoCleanupUnit ?? 'days') : undefined;
                    this.feed.autoCleanupDateField = v ? 'global' : undefined;
                    this.renderFeedTab(container);
                }));
        this.applyCardToSetting(autoDeleteToggle);

        if (autoDeleteEnabled) {
            const deleteAfterSetting = new Setting(container)
                .setName('Delete Articles Older Than')
                .setDesc('Articles older than this will be deleted (keeps feed).')
                .addText(text => text
                    .setPlaceholder(String(this.plugin.settings.autoCleanupValue ?? 30))
                    .setValue(this.feed.autoCleanupValue != null ? String(this.feed.autoCleanupValue) : '')
                    .onChange(v => {
                        this.feed.autoCleanupValue = v.trim() === '' ? undefined : Number(v) || undefined;
                    }))
                .addDropdown(dropdown => dropdown
                    .addOption('minutes', 'Minutes')
                    .addOption('hours',   'Hours')
                    .addOption('days',    'Days')
                    .addOption('months',  'Months')
                    .setValue(this.feed.autoCleanupUnit ?? this.plugin.settings.autoCleanupUnit ?? 'days')
                    .onChange(v => {
                        this.feed.autoCleanupUnit = v as 'minutes' | 'hours' | 'days' | 'months';
                    }));
            this.applyCardToSetting(deleteAfterSetting);
            deleteAfterSetting.settingEl.style.marginLeft = '20px';
            deleteAfterSetting.settingEl.style.borderLeft = '3px solid var(--interactive-accent)';

            const globalDateLabel = this.plugin.settings.autoCleanupDateField === 'datepub'
                ? 'Global ({{datepub}})'
                : 'Global ({{datesaved}})';

            const criterionSetting = new Setting(container)
                .setName('Date Criterion')
                .setDesc('Which date field to use for this feed.')
                .addDropdown(dropdown => dropdown
                    .addOption('global',    globalDateLabel)
                    .addOption('datesaved', '{{datesaved}} — Date saved')
                    .addOption('datepub',   '{{datepub}} — Date published')
                    .setValue(this.feed.autoCleanupDateField ?? 'global')
                    .onChange(v => {
                        this.feed.autoCleanupDateField = v as 'global' | 'datepub' | 'datesaved';
                    }));
            this.applyCardToSetting(criterionSetting);
            criterionSetting.settingEl.style.marginLeft = '20px';
            criterionSetting.settingEl.style.borderLeft = '3px solid var(--interactive-accent)';
        }
    }

    // ── Custom tab ────────────────────────────────────────────────────────────

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
        details.createEl('summary', { text: 'Available variables' }).style.cssText = 'color: var(--text-normal); cursor: pointer;';
        const varList = details.createDiv();
        varList.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr; gap: 8px; color: var(--text-muted); margin-top: 10px;';

        variables.forEach(v => {
            const item = varList.createDiv();
            item.style.cssText = 'cursor: pointer;';
            item.createEl('span', { text: `${v.label}: ` }).style.cssText = 'color: var(--text-normal);';
            item.createEl('code', { text: v.tag }).style.cssText = 'color: var(--text-accent);';
            item.onclick = async () => {
                await navigator.clipboard.writeText(v.tag);
                new Notice(`Copied: ${v.tag}`);
            };
        });

        const templatesContainer = container.createDiv();
        templatesContainer.style.cssText = 'margin: 20px 0; padding: 8px 0;';

        const fileNameSetting = new Setting(templatesContainer)
            .setName('File Name Template')
            .addText(t => t
                .setPlaceholder('{{title}}')
                .setValue(this.feed.titleTemplate || '')
                .onChange(v => { this.feed.titleTemplate = v; }));
        this.applyCardToSetting(fileNameSetting);

        const TEXTAREA_STYLE = 'width: 100%; margin-top: 10px; font-family: var(--font-monospace); font-size: 0.8em; resize: vertical; overflow-y: auto; box-sizing: border-box; height: 120px; min-height: 80px;';

        const frontmatterSetting = new Setting(templatesContainer)
            .setName('Properties/Frontmatter')
            .addTextArea(t => {
                const el = t.inputEl as HTMLTextAreaElement;
                t.setValue(this.feed.frontmatterTemplate || '')
                    .onChange(v => { this.feed.frontmatterTemplate = v; });
                el.placeholder = this.plugin.settings.frontmatterTemplate || '(use global template)';
                el.style.cssText = TEXTAREA_STYLE;
            });
        this.applyCardToSetting(frontmatterSetting);
        this.applyFullWidthTextArea(frontmatterSetting);

        const contentTemplateSetting = new Setting(templatesContainer)
            .setName('Content Template')
            .addTextArea(t => {
                const el = t.inputEl as HTMLTextAreaElement;
                t.setValue(this.feed.contentTemplate || '')
                    .onChange(v => { this.feed.contentTemplate = v; });
                el.placeholder = this.plugin.settings.template || '(use global template)';
                el.style.cssText = TEXTAREA_STYLE;
            });
        this.applyCardToSetting(contentTemplateSetting);
        this.applyFullWidthTextArea(contentTemplateSetting);
    }

    // ── Footer ────────────────────────────────────────────────────────────────

    private renderFooter(contentEl: HTMLElement) {
        const footer = contentEl.createDiv();
        footer.style.cssText = 'margin-top: 20px; display: flex; justify-content: space-between;';

        const delBtn = footer.createEl('button', { text: 'Delete Feed', cls: 'mod-warning' });
        delBtn.onclick = () => {
            this.feed.deleted   = true;
            this.feed.deletedAt = Date.now();
            this.feed.enabled   = false;
            this.onSubmit().then(() => this.close());
        };

        const rightSide = footer.createDiv();
        rightSide.style.cssText = 'display: flex; gap: 10px;';

        const cancelBtn = rightSide.createEl('button', { text: 'Cancel' });
        cancelBtn.onclick = () => this.close();

        const saveBtn = rightSide.createEl('button', { text: 'Save Feed', cls: 'mod-cta' });
        saveBtn.onclick = async () => {
            await this.onSubmit();
            this.close();
        };
    }

    onClose() {
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
        footer.style.cssText = 'display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;';

        const cancelBtn = footer.createEl('button', { text: 'Cancel' });
        cancelBtn.onclick = () => this.close();

        const deleteBtn = footer.createEl('button', { text: 'Delete Feed', cls: 'mod-error' });
        deleteBtn.onclick = async () => { await this.onConfirm(); this.close(); };
    }

    onClose() { this.contentEl.empty(); }
}