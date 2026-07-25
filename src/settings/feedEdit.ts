import { App, Modal, Setting, Notice, setIcon } from 'obsidian';
import RssPlugin, { FeedConfig, FeedGroup, resolveFeedPath } from '../main';
import { renderVariableReference } from './settingsTemplate';
import { openEditFoldersModal, promptFolderName } from './editFolders';
import { discardVaultFile } from './feedDelete';
import { setDynamicCss } from "../utils/css";

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(item => typeof item === 'string');
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


// ─── Device detection ─────────────────────────────────────────────────────────

let _isTouchDevice: boolean | undefined;

function isTouchDevice(): boolean {
    if (_isTouchDevice === undefined) {
        _isTouchDevice = typeof window !== 'undefined'
            && window.matchMedia('(hover: none)').matches;
    }
    return _isTouchDevice;
}

// ─── Font size helper ─────────────────────────────────────────────────────────

function inputFontSize(): string {
    return isTouchDevice() ? '16px' : '13px';
}

// ─── FeedEditModal ────────────────────────────────────────────────────────────

export class FeedEditModal extends Modal {
    feed: FeedConfig;
    plugin: RssPlugin;
    onSave: () => Promise<void>;
    onDelete?: () => void;
    private _saved = false;
    private _isNew: boolean;

    constructor(app: App, plugin: RssPlugin, feed: FeedConfig, onSave: () => Promise<void>, onDelete?: () => void, isNew = false) {
        super(app);
        this.feed     = feed;
        this.plugin   = plugin;
        this.onSave   = onSave;
        this.onDelete = onDelete;
        this._isNew   = isNew;
    }

    get onSubmit() { return this.onSave; }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        setDynamicCss(this.modalEl, { 'width': '860px' });
        setDynamicCss(this.modalEl, { 'max-width': '95vw' });
        setDynamicCss(this.modalEl, { 'height': 'min(720px, 90vh)' });
        setDynamicCss(this.modalEl, { 'max-height': 'none' });
        setDynamicCss(this.modalEl, { 'overflow': 'hidden' });
        setDynamicCss(this.modalEl, { 'display': 'flex' });
        setDynamicCss(this.modalEl, { 'flex-direction': 'column' });
        setDynamicCss(this.modalEl, { 'position': 'relative' });

        applyCssText(contentEl, 'display: flex; flex-direction: column; flex: 1 1 0; min-height: 0; overflow: hidden; padding: 0;');

        contentEl.createEl('h2', { text: 'Edit feed settings' });

        const tabContainer = contentEl.createDiv();
        applyCssText(tabContainer, 'display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; flex-shrink: 0;');
        const feedTabBtn   = tabContainer.createEl('button', { text: 'Feed' });
        const customTabBtn = tabContainer.createEl('button', { text: 'Custom' });

        const tabBody = contentEl.createDiv();
        applyCssText(tabBody, 'flex: 1 1 0; min-height: 0; overflow-y: auto; overflow-x: hidden; padding-right: 6px; -webkit-overflow-scrolling: touch;');

        const feedContent   = tabBody.createDiv();
        const customContent = tabBody.createDiv();

        let activeTab: 'feed' | 'custom' = 'feed';

        const updateView = () => {
            const base     = 'padding: 6px 16px; border-radius: 6px; cursor: pointer; font-size: 0.9em; border: 1px solid var(--background-modifier-border); transition: all 0.2s ease;';
            const inactive = 'background-color: var(--background-secondary-alt); color: var(--text-muted);';
            const active   = 'background-color: var(--interactive-accent); color: var(--text-on-accent); border-color: var(--interactive-accent);';
            applyCssText(feedTabBtn, `${base}${activeTab === 'feed'   ? active : inactive}`);
            applyCssText(customTabBtn, `${base}${activeTab === 'custom' ? active : inactive}`);
            setDynamicCss(feedContent, { 'display': activeTab === 'feed'   ? 'block' : 'none' });
            setDynamicCss(customContent, { 'display': activeTab === 'custom' ? 'block' : 'none' });
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
        applyCssText(el, `
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
        if (!isTouchDevice()) {
            el.onmouseenter = () => { setDynamicCss(el, { 'border-color': 'var(--interactive-accent)' }); };
            el.onmouseleave = () => { setDynamicCss(el, { 'border-color': 'var(--background-modifier-border)' }); };
        }
    }

    // ── Feed tab ──────────────────────────────────────────────────────────────

    private renderFeedTab(container: HTMLElement) {
        container.empty();

        const nameSetting = new Setting(container)
            .setName('Feed name')
            .addText(t => {
                t.setValue(this.feed.name || '')
                 .onChange(v => { this.feed.name = v; });
                setDynamicCss(t.inputEl, { 'font-size': inputFontSize() });
            });
        this.applyCardToSetting(nameSetting);

        const urlSetting = new Setting(container).setName('Feed address');
        this.applyCardToSetting(urlSetting);
        setDynamicCss(urlSetting.settingEl, { 'flex-direction': 'column' });
        setDynamicCss(urlSetting.settingEl, { 'align-items': 'flex-start' });
        setDynamicCss(urlSetting.controlEl, { 'width': '100%' });
        setDynamicCss(urlSetting.controlEl, { 'margin-top': '10px' });

        const urlInput = urlSetting.controlEl.createEl('input', { type: 'text' });
        urlInput.value          = this.feed.url || '';
        applyCssText(urlInput, `width: 100%; display: block; box-sizing: border-box; font-size: ${inputFontSize()};`);
        urlInput.inputMode      = 'url';
        urlInput.autocomplete   = 'off';
        urlInput.autocapitalize = 'off';
        urlInput.oninput   = (e) => { this.feed.url = (e.target as HTMLInputElement).value; };
        urlInput.onkeydown = (e) => {
            this.feed.url = urlInput.value;
            if (e.key === 'Enter') {
                e.preventDefault();
                // Mirror the Save button: await onSave() before closing so the
                // modal does not dismiss before settings are persisted.
                void (async () => {
                    try {
                        await this.onSave();
                        this._saved = true;
                    } finally {
                        this.close();
                    }
                })();
            }
        };

        const getGroups = () => [...this.plugin.settings.groups].sort((a, b) =>
            new Intl.Collator(undefined, { sensitivity: 'base' }).compare(a.name || '', b.name || ''));

        let groupSelectEl: HTMLSelectElement | null = null;

        const refreshGroupDropdown = () => {
            if (!groupSelectEl) return;
            const updated = getGroups();
            groupSelectEl.empty();
            groupSelectEl.createEl('option', { value: '', text: 'No folder' });
            updated.forEach(g => groupSelectEl!.createEl('option', { value: g.id, text: g.name }));
            groupSelectEl.value = this.feed.groupId ?? '';
        };

        const groupSetting = new Setting(container)
            .setName('Folder')
            .setDesc('Assign this feed to a folder. Leave as no folder to keep it loose.')
            .addDropdown(dropdown => {
                groupSelectEl = dropdown.selectEl;
                dropdown.addOption('', 'No folder');
                for (const group of getGroups()) {
                    dropdown.addOption(group.id, group.name);
                }
                dropdown.setValue(this.feed.groupId ?? '');
                dropdown.onChange(v => {
                    this.feed.groupId = v === '' ? undefined : v;
                });
            });

        const addFolderBtn = activeDocument.createElement('button');
        addFolderBtn.title = 'New folder';
        applyCssText(addFolderBtn, 'display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 5px; border: 1px solid var(--background-modifier-border); background: transparent; cursor: pointer; color: var(--text-muted); transition: all 0.12s ease; flex-shrink: 0; margin-right: 6px;');
        addFolderBtn.addEventListener('mouseenter', () => { setDynamicCss(addFolderBtn, { 'border-color': 'var(--interactive-accent)' }); setDynamicCss(addFolderBtn, { 'color': 'var(--text-normal)' }); });
        addFolderBtn.addEventListener('mouseleave', () => { setDynamicCss(addFolderBtn, { 'border-color': 'var(--background-modifier-border)' }); setDynamicCss(addFolderBtn, { 'color': 'var(--text-muted)' }); });
        const addFolderIcon = addFolderBtn.createDiv();
        applyCssText(addFolderIcon, 'display: flex; align-items: center; width: 14px; height: 14px;');
        setIcon(addFolderIcon, 'folder-plus');
        addFolderBtn.addEventListener('click', () => {
            void (async () => {
            const name = await promptFolderName(this.app);
            if (!name) return;
            const newGroup: FeedGroup = { id: `group-${Date.now()}`, name: name.trim() };
            this.plugin.settings.groups.push(newGroup);
            await this.plugin.saveSettingsSilent();
            refreshGroupDropdown();
            new Notice(`Folder "${newGroup.name}" created`);
            })();
        });
        groupSetting.controlEl.insertBefore(addFolderBtn, groupSelectEl);

        const editFoldersBtn = groupSetting.controlEl.createEl('button');
        editFoldersBtn.title = 'Edit folders';
        applyCssText(editFoldersBtn, 'display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 5px; border: 1px solid var(--background-modifier-border); background: transparent; cursor: pointer; color: var(--text-muted); transition: all 0.12s ease; flex-shrink: 0; margin-left: 6px;');
        editFoldersBtn.addEventListener('mouseenter', () => { setDynamicCss(editFoldersBtn, { 'border-color': 'var(--interactive-accent)' }); setDynamicCss(editFoldersBtn, { 'color': 'var(--text-normal)' }); });
        editFoldersBtn.addEventListener('mouseleave', () => { setDynamicCss(editFoldersBtn, { 'border-color': 'var(--background-modifier-border)' }); setDynamicCss(editFoldersBtn, { 'color': 'var(--text-muted)' }); });
        const editFoldersIcon = editFoldersBtn.createDiv();
        applyCssText(editFoldersIcon, 'display: flex; align-items: center; width: 14px; height: 14px;');
        setIcon(editFoldersIcon, 'folder-edit');
        editFoldersBtn.addEventListener('click', () => {
            openEditFoldersModal(this.app, this.plugin, () => { refreshGroupDropdown(); });
        });

        this.applyCardToSetting(groupSetting);

        const nameInputRef = nameSetting.controlEl.querySelector<HTMLInputElement>('input[type="text"]');

        const folderSetting = new Setting(container)
            .setName('Custom subfolder (optional)')
            .setDesc('Extra subfolder inside the assigned folder (or main RSS folder if no folder assigned).')
            .addText(t => {
                t.setPlaceholder(this.feed.name || 'Subfolder name')
                 .setValue(this.feed.folder || '')
                 .onChange(v => { this.feed.folder = v; });
                setDynamicCss(t.inputEl, { 'font-size': inputFontSize() });

                if (nameInputRef) {
                    nameInputRef.addEventListener('input', () => {
                        t.inputEl.placeholder = nameInputRef.value || 'Subfolder name';
                    });
                }
            });
        this.applyCardToSetting(folderSetting);

        const timingHeader = container.createEl('h4', { text: 'Timing' });
        applyCssText(timingHeader, 'margin: 20px 0 8px; color: var(--text-muted); font-size: 0.85em; text-transform: uppercase; letter-spacing: 0.05em;');

        const intervalSetting = new Setting(container)
            .setName('Update interval')
            .setDesc('Overrides the global interval for this feed. Leave blank to use global.')
            .addText(text => {
                text.setPlaceholder(String(this.plugin.settings.updateIntervalValue ?? 30))
                    .setValue(this.feed.updateIntervalValue != null ? String(this.feed.updateIntervalValue) : '')
                    .onChange(v => {
                        this.feed.updateIntervalValue = v.trim() === '' ? undefined : Number(v) || undefined;
                    });
                setDynamicCss(text.inputEl, { 'font-size': inputFontSize() });
                text.inputEl.inputMode      = 'numeric';
            })
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

        const autoDeleteEnabled = this.feed.autoCleanupValue != null;

        const autoDeleteToggle = new Setting(container)
            .setName('Auto delete old articles')
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
                .setName('Delete articles older than')
                .setDesc('Articles older than this will be deleted (keeps feed).')
                .addText(text => {
                    text.setPlaceholder(String(this.plugin.settings.autoCleanupValue ?? 30))
                        .setValue(this.feed.autoCleanupValue != null ? String(this.feed.autoCleanupValue) : '')
                        .onChange(v => {
                            this.feed.autoCleanupValue = v.trim() === '' ? undefined : Number(v) || undefined;
                        });
                    setDynamicCss(text.inputEl, { 'font-size': inputFontSize() });
                    text.inputEl.inputMode      = 'numeric';
                })
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
            setDynamicCss(deleteAfterSetting.settingEl, { 'margin-left': '20px' });
            setDynamicCss(deleteAfterSetting.settingEl, { 'border-left': '3px solid var(--interactive-accent)' });

            const globalDateLabel = this.plugin.settings.autoCleanupDateField === 'datepub'
                ? 'Global ({{datepublished}})'
                : 'Global ({{datesaved}})';

            const criterionSetting = new Setting(container)
                .setName('Date criterion')
                .setDesc('Which date field to use for this feed.')
                .addDropdown(dropdown => dropdown
                    .addOption('global',    globalDateLabel)
                    .addOption('datesaved', '{{datesaved}} — Date saved')
                    .addOption('datepub',   '{{datepublished}} — Date published')
                    .setValue(this.feed.autoCleanupDateField ?? 'global')
                    .onChange(v => {
                        this.feed.autoCleanupDateField = v as 'global' | 'datepub' | 'datesaved';
                    }));
            this.applyCardToSetting(criterionSetting);
            setDynamicCss(criterionSetting.settingEl, { 'margin-left': '20px' });
            setDynamicCss(criterionSetting.settingEl, { 'border-left': '3px solid var(--interactive-accent)' });
        }

        const youtubeHeader = container.createEl('h4', { text: 'YouTube' });
        applyCssText(youtubeHeader, 'margin: 8px 0; color: var(--text-muted); font-size: 0.85em; text-transform: uppercase; letter-spacing: 0.05em;');

        const tagShortsSetting = new Setting(container)
            .setName('Tag shorts')
            .setDesc('Automatically add the "shorts" tag to shorts articles. Overrides global setting.')
            .addDropdown(d => d
                .addOption('global', `Use global (${this.plugin.settings.tagShortsGlobal ? 'on' : 'off'})`)
                .addOption('on',     'Always on')
                .addOption('off',    'Always off')
                .setValue(
                    this.feed.tagShorts === true  ? 'on'  :
                    this.feed.tagShorts === false ? 'off' : 'global'
                )
                .onChange(v => {
                    this.feed.tagShorts = v === 'on' ? true : v === 'off' ? false : undefined;
                }));
        this.applyCardToSetting(tagShortsSetting);

        const skipShortsSetting = new Setting(container)
            .setName('Skip shorts')
            .setDesc('Never save articles from shorts links. Overrides global setting.')
            .addDropdown(d => d
                .addOption('global', `Use global (${this.plugin.settings.skipShortsGlobal ? 'on' : 'off'})`)
                .addOption('on',     'Always skip')
                .addOption('off',    'Never skip')
                .setValue(
                    this.feed.skipShorts === true  ? 'on'  :
                    this.feed.skipShorts === false ? 'off' : 'global'
                )
                .onChange(v => {
                    this.feed.skipShorts = v === 'on' ? true : v === 'off' ? false : undefined;
                }));
        this.applyCardToSetting(skipShortsSetting);

        const deleteLivesSetting = new Setting(container)
            .setName('Delete live stream articles')
            .setDesc('When enabled, automatically deletes articles tagged as "live" in this feed.')
            .addToggle(toggle => toggle
                .setValue(this.feed.deleteLives ?? false)
                .onChange(v => {
                    void (async () => {
                    this.feed.deleteLives = v;
                    if (v) await this.deleteLiveArticles();
                    })();
                }));
        this.applyCardToSetting(deleteLivesSetting);


    }

    // ── Delete live articles ──────────────────────────────────────────────────

    private async deleteLiveArticles(): Promise<void> {
        const { vault, metadataCache } = this.plugin.app;
        const feedPath = resolveFeedPath(this.feed, this.plugin.settings);
        const folder = this.plugin.app.vault.getAbstractFileByPath(feedPath);
        if (!folder) {
            new Notice('Feed folder not found.');
            return;
        }

        const files = vault.getMarkdownFiles().filter(f => f.path.startsWith(feedPath + '/'));
        let deletedCount = 0;

        for (const file of files) {
            const cache = metadataCache.getFileCache(file);
            const tags  = [
                ...(cache?.tags?.map(t => t.tag) ?? []),
                ...(isStringArray((cache?.frontmatter)?.tags)
                    ? (cache?.frontmatter as Record<string, unknown>).tags as string[]
                    : []),
            ].map((t: string) => t.replace(/^#/, '').toLowerCase());

            if (tags.includes('live')) {
                try {
                    await discardVaultFile(this.plugin.app, file, this.plugin.settings);
                    deletedCount++;
                } catch (e) {
                    console.error(`RSS: Failed to delete live article "${file.path}":`, e);
                }
            }
        }

        if (deletedCount === 0) {
            new Notice('No live articles found in this feed.', 4000);
        } else {
            new Notice(`${deletedCount} live article${deletedCount !== 1 ? 's' : ''} deleted.`, 4000);
        }
    }

    // ── Move feed articles to trash ───────────────────────────────────────────

    private async moveFeedArticlesToTrash(): Promise<void> {
        const { vault, fileManager } = this.plugin.app;
        const feedPath = resolveFeedPath(this.feed, this.plugin.settings);
        const files = vault.getMarkdownFiles().filter(f => f.path.startsWith(feedPath + '/'));
        if (files.length === 0) return;

        // Files are trashed without updating the DB — on the next update, saveFeedItem
        // will detect that the file no longer exists (vault.adapter.exists check) and
        // re-import it. This is intentional: "Move to Trash" is a feed removal action,
        // not a per-article action, so re-import prevention is handled at the feed level
        // (feed.deleted = true, feed.enabled = false set by the caller).
        let movedCount = 0;
        for (const file of files) {
            try {
                await fileManager.trashFile(file);
                movedCount++;
            } catch (e) {
                console.error(`RSS: Failed to trash "${file.path}":`, e);
            }
        }

        if (movedCount > 0) {
            new Notice(`${movedCount} article${movedCount !== 1 ? 's' : ''} moved to trash.`, 4000);
        }
    }

    // ── Custom tab ────────────────────────────────────────────────────────────

    private renderCustomTab(container: HTMLElement) {
        renderVariableReference(container);

        const templatesContainer = container.createDiv();
        applyCssText(templatesContainer, 'margin-top: 4px;');

        this.renderCustomField(templatesContainer, {
            icon:        '📄',
            title:       'File Name',
            desc:        'Variables: {{title}}, {{author}}, {{datepublished}}, {{datesaved}}, {{snippet}}, {{feedname}}',
            placeholder: '{{title}}',
            value:       this.feed.titleTemplate || '',
            type:        'input',
            onChange:    v => { this.feed.titleTemplate = v; },
        });

        this.renderCustomField(templatesContainer, {
            icon:        '🗂️',
            title:       'Properties / Frontmatter',
            desc:        'Support all variables except {{content}}',
            placeholder: this.plugin.settings.frontmatterTemplate || '(use global template)',
            value:       this.feed.frontmatterTemplate || '',
            type:        'textarea',
            onChange:    v => { this.feed.frontmatterTemplate = v; },
        });

        this.renderCustomField(templatesContainer, {
            icon:        '🗂️➕',
            title:       'Extra Frontmatter Properties',
            desc:        'Extra properties appended to the frontmatter.',
            placeholder: 'Number: 5\n List:\n  - "[[List]]"',
            value:       this.feed.extraFrontmatterRaw || '',
            type:        'textarea',
            onChange:    v => { this.feed.extraFrontmatterRaw = v; },
        });

        this.renderCustomField(templatesContainer, {
            icon:        '✍️',
            title:       'Content Body',
            desc:        'All variables',
            placeholder: this.plugin.settings.template || '(use global template)',
            value:       this.feed.contentTemplate || '',
            type:        'textarea',
            onChange:    v => { this.feed.contentTemplate = v; },
        });
    }

    private renderCustomField(
        container: HTMLElement,
        opts: {
            icon:        string;
            title:       string;
            desc:        string;
            placeholder: string;
            value:       string;
            type:        'input' | 'textarea';
            onChange:    (v: string) => void;
        }
    ): void {
        const wrapper = container.createDiv();
        applyCssText(wrapper, `
            background: var(--background-secondary);
            border: 1px solid var(--background-modifier-border);
            border-radius: 10px;
            padding: 12px 16px;
            margin-bottom: 12px;
            transition: border-color 0.2s ease;
        `);
        if (!isTouchDevice()) {
            wrapper.onmouseenter = () => { setDynamicCss(wrapper, { 'border-color': 'var(--interactive-accent)' }); };
            wrapper.onmouseleave = () => { setDynamicCss(wrapper, { 'border-color': 'var(--background-modifier-border)' }); };
        }

        const header = wrapper.createDiv();
        applyCssText(header, 'display: flex; align-items: center; gap: 8px; margin-bottom: 4px;');
        header.createEl('span', { text: opts.icon });

        const titleEl = header.createEl('span', { text: opts.title });
        applyCssText(titleEl, 'font-weight: 600; font-size: 0.88em; color: var(--text-normal);');

        const desc = wrapper.createEl('p', { text: opts.desc });
        applyCssText(desc, 'color: var(--text-muted); font-size: 0.82em; margin: 0 0 8px;');

        if (opts.type === 'input') {
            const input = wrapper.createEl('input', { type: 'text' });
            input.placeholder   = opts.placeholder;
            input.value         = opts.value;
            applyCssText(input, `width: 100%; box-sizing: border-box; font-family: var(--font-monospace); font-size: ${inputFontSize()};`);
            input.oninput = () => opts.onChange(input.value);
        } else {
            const textarea = wrapper.createEl('textarea');
            textarea.placeholder   = opts.placeholder;
            textarea.value         = opts.value;
            applyCssText(textarea, `
                width: 100%; box-sizing: border-box;
                font-family: var(--font-monospace);
                font-size: ${inputFontSize()};
                height: 120px; min-height: 80px; resize: vertical;
            `);
            textarea.oninput = () => opts.onChange(textarea.value);
        }
    }

    // ── Footer ────────────────────────────────────────────────────────────────

    private renderFooter(contentEl: HTMLElement) {
        const footer = contentEl.createDiv();
        applyCssText(footer, 'margin-top: 12px; flex-shrink: 0; display: flex; justify-content: space-between; align-items: center;');

        const leftSide = footer.createDiv();
        applyCssText(leftSide, 'display: flex; gap: 8px;');

        const makeIconBtn = (container: HTMLElement, icon: string, label: string, cls?: string): HTMLButtonElement => {
            const btn = container.createEl('button', cls ? { cls } : {});
            applyCssText(btn, 'display: flex; align-items: center; gap: 6px;');
            const iconEl = btn.createDiv();
            applyCssText(iconEl, 'display: flex; align-items: center; width: 14px; height: 14px; flex-shrink: 0;');
            setIcon(iconEl, icon);
            btn.createSpan({ text: label });
            return btn;
        };

        if (!this._isNew) {
            // Archive: only sets archived flag, does NOT call onDelete
            const archiveBtn = makeIconBtn(leftSide, 'archive', 'Archive');
            archiveBtn.onclick = () => {
                void (async () => {
                this.feed.archived = true;
                this.feed.enabled  = false;
                await this.onSave();
                this._saved = true;
                this.close();
                })();
            };

            // Move to Trash: sets deleted flag + moves articles, does NOT call onDelete
            const trashBtn = makeIconBtn(leftSide, 'trash', 'Move to Trash', 'mod-warning');
            trashBtn.onclick = () => {
                void (async () => {
                this.feed.deleted   = true;
                this.feed.deletedAt = Date.now();
                this.feed.enabled   = false;
                await this.moveFeedArticlesToTrash();
                await this.onSave();
                this._saved = true;
                this.close();
                })();
            };
        }

        const rightSide = footer.createDiv();
        applyCssText(rightSide, 'display: flex; gap: 10px;');

        const cancelBtn = rightSide.createEl('button', { text: 'Cancel' });
        cancelBtn.onclick = () => this.close();

        const saveBtn = rightSide.createEl('button', { text: this._isNew ? 'Import Feed' : 'Save Feed', cls: 'mod-cta' });
        saveBtn.onclick = () => {
            void (async () => {
            const overlay = this.modalEl.createDiv();
            applyCssText(overlay, `
                position: absolute; inset: 0;
                background: rgba(0, 0, 0, 0.45);
                border-radius: inherit;
                display: flex; flex-direction: column;
                align-items: center; justify-content: center;
                gap: 12px; z-index: 9999;
            `);

            const spinner = overlay.createDiv();
            applyCssText(spinner, `
                width: 32px; height: 32px;
                border: 3px solid rgba(255,255,255,0.2);
                border-top-color: var(--interactive-accent);
                border-radius: 50%;
                animation: rss-spin 0.7s linear infinite;
            `);

            const label = overlay.createEl('span', { text: 'Saving settings...' });
            applyCssText(label, 'color: white; font-size: 0.9em; opacity: 0.85;');

            saveBtn.disabled   = true;
            cancelBtn.disabled = true;

            try {
                await this.onSave();
                this._saved = true;
            } finally {
                overlay.remove();
                saveBtn.disabled   = false;
                cancelBtn.disabled = false;
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


            this.close();
            })();
        };
    }

    onClose() {
        // onDelete is only called when a NEW feed modal is closed without saving
        // (to clean up the feed that was pre-added to the list)
        if (this._isNew && !this._saved && this.onDelete) {
            this.onDelete();
        }
        this.contentEl.empty();
    }
}

// ─── ConfirmDeleteModal ───────────────────────────────────────────────────────

export class ConfirmDeleteModal extends Modal {
    private onConfirm: () => Promise<void>;

    constructor(app: App, onConfirm: () => Promise<void>) {
        super(app);
        this.onConfirm = onConfirm;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: 'Permanently delete feed?' });
        contentEl.createEl('p', { text: 'This action cannot be undone. The feed will be permanently removed.' });

        const footer = contentEl.createDiv();
        applyCssText(footer, 'display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;');

        const cancelBtn = footer.createEl('button', { text: 'Cancel' });
        cancelBtn.onclick = () => this.close();

        const deleteBtn = footer.createEl('button', { text: 'Delete feed', cls: 'mod-warning' });
        deleteBtn.onclick = () => {
            void (async () => {
                await this.onConfirm();
                this.close();
            })();
        };
    }

    onClose() { this.contentEl.empty(); }
}
