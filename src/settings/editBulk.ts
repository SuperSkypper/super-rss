import { App, Modal, Notice } from 'obsidian';
import RssPlugin from '../main';
import { renderVariableReference } from './settingsTemplate';
import { sortGroups } from './editFolders';

// ─── Font size helper ─────────────────────────────────────────────────────────
function inputFontSize(): string {
    return typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches
        ? '16px' : '13px';
}

// ─── Bulk Edit Modal ──────────────────────────────────────────────────────────

export function openBulkEditModal(
    app: App,
    plugin: RssPlugin,
    selectedFeeds: Set<string>,
    onDone: () => void
): void {
    class BulkEditModal extends Modal {

        private apply = {
            groupId:             false,
            folder:              false,
            enabled:             false,
            updateIntervalValue: false,
            autoCleanupValue:    false,
            tagShorts:           false,
            skipShorts:          false,
            titleTemplate:       false,
            frontmatterTemplate: false,
            contentTemplate:     false,
        };

        private values: Record<string, any> = {
            groupId:              '',
            folder:               '',
            enabled:              true,
            updateIntervalValue:  30,
            updateIntervalUnit:   plugin.settings.updateIntervalUnit ?? 'minutes',
            autoCleanupValue:     30,
            autoCleanupUnit:      plugin.settings.autoCleanupUnit ?? 'days',
            autoCleanupDateField: 'global',
            tagShorts:            undefined,
            skipShorts:           undefined,
            titleTemplate:        '',
            frontmatterTemplate:  '',
            contentTemplate:      '',
        };

        onOpen() {
            const { contentEl } = this;
            contentEl.empty();

            // Fixed height — same approach as FeedEditModal so tabs don't resize
            this.modalEl.style.width         = '860px';
            this.modalEl.style.maxWidth      = '95vw';
            this.modalEl.style.height        = 'min(720px, 90vh)';
            this.modalEl.style.maxHeight     = 'none';
            this.modalEl.style.overflow      = 'hidden';
            this.modalEl.style.display       = 'flex';
            this.modalEl.style.flexDirection = 'column';

            contentEl.style.cssText = 'display: flex; flex-direction: column; flex: 1 1 0; min-height: 0; overflow: hidden; padding: 0;';

            contentEl.createEl('h2', { text: `Bulk Edit — ${selectedFeeds.size} feed${selectedFeeds.size !== 1 ? 's' : ''} selected` });

            const hint = contentEl.createEl('p', { text: 'Check ✓ next to each field you want to overwrite. Unchecked fields stay unchanged.' });
            hint.style.cssText = 'font-size: 0.83em; color: var(--text-muted); margin: -4px 0 12px; flex-shrink: 0;';

            const tabContainer = contentEl.createDiv();
            tabContainer.style.cssText = 'display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; flex-shrink: 0;';
            const feedTabBtn      = tabContainer.createEl('button', { text: 'Feed' });
            const overridesTabBtn = tabContainer.createEl('button', { text: 'Per-Feed Rules' });
            const customTabBtn    = tabContainer.createEl('button', { text: 'Custom' });

            const tabBody = contentEl.createDiv();
            tabBody.style.cssText = 'flex: 1 1 0; min-height: 0; overflow-y: auto; overflow-x: hidden; padding-right: 6px; -webkit-overflow-scrolling: touch;';

            const feedContent      = tabBody.createDiv();
            const overridesContent = tabBody.createDiv();
            const customContent    = tabBody.createDiv();

            let activeTab: 'feed' | 'overrides' | 'custom' = 'feed';

            const updateTabView = () => {
                const base     = 'padding: 6px 16px; border-radius: 6px; cursor: pointer; font-size: 0.9em; border: 1px solid var(--background-modifier-border); transition: all 0.2s ease;';
                const inactive = 'background-color: var(--background-secondary-alt); color: var(--text-muted);';
                const active   = 'background-color: var(--interactive-accent); color: var(--text-on-accent); border-color: var(--interactive-accent);';
                feedTabBtn.style.cssText      = `${base}${activeTab === 'feed'      ? active : inactive}`;
                overridesTabBtn.style.cssText = `${base}${activeTab === 'overrides' ? active : inactive}`;
                customTabBtn.style.cssText    = `${base}${activeTab === 'custom'    ? active : inactive}`;
                feedContent.style.display      = activeTab === 'feed'      ? 'block' : 'none';
                overridesContent.style.display = activeTab === 'overrides' ? 'block' : 'none';
                customContent.style.display    = activeTab === 'custom'    ? 'block' : 'none';
            };

            feedTabBtn.onclick      = () => { if (activeTab !== 'feed')      { activeTab = 'feed';      updateTabView(); } };
            overridesTabBtn.onclick = () => { if (activeTab !== 'overrides') { activeTab = 'overrides'; updateTabView(); } };
            customTabBtn.onclick    = () => { if (activeTab !== 'custom')    { activeTab = 'custom';    updateTabView(); } };
            updateTabView();

            this.renderFeedTab(feedContent);
            this.renderOverridesTab(overridesContent);
            this.renderCustomTab(customContent);
            this.renderFooter(contentEl);
        }

        // ── Shared card wrapper with apply checkbox ───────────────────────────

        private wrapWithApply(
            container: HTMLElement,
            fieldKey: keyof typeof this.apply,
            buildCard: (card: HTMLElement, markDirty: () => void) => void
        ): void {
            const row = container.createDiv();
            row.style.cssText = 'display: flex; align-items: flex-start; gap: 10px; margin-bottom: 12px;';

            const cbWrap = row.createDiv();
            cbWrap.style.cssText = 'display: flex; align-items: center; padding-top: 14px; flex-shrink: 0;';
            const cb = cbWrap.createEl('input', { type: 'checkbox' });
            cb.style.cssText = 'cursor: pointer; width: 15px; height: 15px; margin: 0;';
            cb.title   = 'Will be applied to all selected feeds';
            cb.checked = this.apply[fieldKey];

            const card = row.createDiv();
            card.style.cssText = `
                flex: 1;
                background: var(--background-secondary);
                border: 1px solid var(--background-modifier-border);
                border-radius: 10px;
                padding: 12px 18px;
                transition: border-color 0.15s ease;
            `;
            card.onmouseenter = () => { card.style.borderColor = 'var(--interactive-accent)'; };
            card.onmouseleave = () => {
                card.style.borderColor = cb.checked
                    ? 'var(--interactive-accent)'
                    : 'var(--background-modifier-border)';
            };

            const markDirty = () => {
                if (!cb.checked) {
                    cb.checked = true;
                    this.apply[fieldKey] = true;
                    card.style.borderColor = 'var(--interactive-accent)';
                }
            };

            buildCard(card, markDirty);

            cb.addEventListener('change', () => {
                this.apply[fieldKey] = cb.checked;
                card.style.borderColor = cb.checked
                    ? 'var(--interactive-accent)'
                    : 'var(--background-modifier-border)';
            });
        }

        // ── Card header helper ────────────────────────────────────────────────

        private cardHeader(card: HTMLElement, icon: string, title: string, desc?: string): void {
            const header = card.createDiv();
            header.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 4px;';
            header.createEl('span', { text: icon });
            const titleEl = header.createEl('span', { text: title });
            titleEl.style.cssText = 'font-weight: 600; font-size: 0.88em; color: var(--text-normal);';
            if (desc) {
                const descEl = card.createEl('p', { text: desc });
                descEl.style.cssText = 'color: var(--text-muted); font-size: 0.82em; margin: 0 0 8px;';
            }
        }

        // ── Feed tab ──────────────────────────────────────────────────────────

        private renderFeedTab(container: HTMLElement) {
            container.empty();

            // Enable / Disable
            this.wrapWithApply(container, 'enabled', (card, markDirty) => {
                this.cardHeader(card, '⚡', 'Enable / Disable', 'Override the enabled state for all selected feeds.');
                const row = card.createDiv();
                row.style.cssText = 'display: flex; align-items: center; gap: 12px;';
                const toggleEl = row.createEl('div', { cls: 'checkbox-container' });
                toggleEl.style.margin = '0';
                if (this.values.enabled) toggleEl.classList.add('is-enabled');
                const stateLabel = row.createEl('span', { text: this.values.enabled ? 'Enabled' : 'Disabled' });
                stateLabel.style.cssText = 'font-size: 0.85em; color: var(--text-muted);';
                toggleEl.addEventListener('click', () => {
                    this.values.enabled = !this.values.enabled;
                    toggleEl.classList.toggle('is-enabled', this.values.enabled);
                    stateLabel.setText(this.values.enabled ? 'Enabled' : 'Disabled');
                    markDirty();
                });
            });

            // Folder
            this.wrapWithApply(container, 'groupId', (card, markDirty) => {
                this.cardHeader(card, '🗂️', 'Folder', 'Assign selected feeds to a folder.');
                const select = card.createEl('select');
                select.style.cssText = `width: 100%; box-sizing: border-box; font-size: ${inputFontSize()};`;
                select.createEl('option', { value: '', text: '— No folder —' });
                sortGroups(plugin.settings.groups).forEach(g => select.createEl('option', { value: g.id, text: g.name }));
                select.value = this.values.groupId;
                select.addEventListener('change', () => { this.values.groupId = select.value; markDirty(); });
            });

            // Custom Subfolder
            this.wrapWithApply(container, 'folder', (card, markDirty) => {
                this.cardHeader(card, '📁', 'Custom Subfolder (optional)', 'Extra subfolder inside the assigned folder (or main RSS folder if no folder assigned).');
                const input = card.createEl('input', { type: 'text' });
                input.placeholder   = 'Subfolder name';
                input.value         = this.values.folder;
                input.style.cssText = `width: 100%; box-sizing: border-box; font-size: ${inputFontSize()};`;
                input.addEventListener('input', () => { this.values.folder = input.value; markDirty(); });
            });
        }

        // ── Per-Feed Rules tab ────────────────────────────────────────────────

        private renderOverridesTab(container: HTMLElement) {
            container.empty();

            const sectionHeader = (text: string) => {
                const h = container.createEl('h4', { text });
                h.style.cssText = 'margin: 16px 0 8px; color: var(--text-muted); font-size: 0.85em; text-transform: uppercase; letter-spacing: 0.05em;';
            };

            sectionHeader('Timing');

            // Update Interval
            this.wrapWithApply(container, 'updateIntervalValue', (card, markDirty) => {
                this.cardHeader(card, '⏱️', 'Update Interval', 'Overrides the global interval for all selected feeds. Leave blank to use global.');
                const row = card.createDiv();
                row.style.cssText = 'display: flex; align-items: center; gap: 8px;';

                const input = row.createEl('input', { type: 'text' });
                input.placeholder   = String(plugin.settings.updateIntervalValue ?? 30);
                input.value         = String(this.values.updateIntervalValue);
                input.inputMode     = 'numeric';
                input.style.cssText = `width: 80px; box-sizing: border-box; font-size: ${inputFontSize()};`;
                input.addEventListener('input', () => {
                    const v = parseInt(input.value);
                    if (!isNaN(v) && v > 0) { this.values.updateIntervalValue = v; markDirty(); }
                });

                const unitSelect = row.createEl('select');
                unitSelect.style.cssText = `font-size: ${inputFontSize()};`;
                for (const [val, txt] of [['minutes','Minutes'],['hours','Hours'],['days','Days'],['months','Months']]) {
                    unitSelect.createEl('option', { value: val, text: txt });
                }
                unitSelect.value = this.values.updateIntervalUnit;
                unitSelect.addEventListener('change', () => { this.values.updateIntervalUnit = unitSelect.value; markDirty(); });
            });

            // Auto Delete
            this.wrapWithApply(container, 'autoCleanupValue', (card, markDirty) => {
                this.cardHeader(card, '🗑️', 'Auto Delete Old Articles', 'Overrides global cleanup settings for selected feeds.');

                const deleteRow = card.createDiv();
                deleteRow.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 10px;';

                const deleteLabel = deleteRow.createEl('span', { text: 'Delete articles older than' });
                deleteLabel.style.cssText = 'font-size: 0.85em; color: var(--text-muted); white-space: nowrap;';

                const input = deleteRow.createEl('input', { type: 'text' });
                input.placeholder   = String(plugin.settings.autoCleanupValue ?? 30);
                input.value         = String(this.values.autoCleanupValue);
                input.inputMode     = 'numeric';
                input.style.cssText = `width: 70px; box-sizing: border-box; font-size: ${inputFontSize()};`;
                input.addEventListener('input', () => {
                    const v = parseInt(input.value);
                    if (!isNaN(v) && v > 0) { this.values.autoCleanupValue = v; markDirty(); }
                });

                const unitSelect = deleteRow.createEl('select');
                unitSelect.style.cssText = `font-size: ${inputFontSize()};`;
                for (const [val, txt] of [['minutes','Minutes'],['hours','Hours'],['days','Days'],['months','Months']]) {
                    unitSelect.createEl('option', { value: val, text: txt });
                }
                unitSelect.value = this.values.autoCleanupUnit;
                unitSelect.addEventListener('change', () => { this.values.autoCleanupUnit = unitSelect.value; markDirty(); });

                const criterionWrapper = card.createDiv();
                criterionWrapper.style.cssText = 'margin-left: 20px; border-left: 3px solid var(--interactive-accent); padding-left: 12px;';
                const criterionLabel = criterionWrapper.createEl('p', { text: 'Date Criterion — Which date field to use.' });
                criterionLabel.style.cssText = 'font-size: 0.82em; color: var(--text-muted); margin: 0 0 6px;';
                const globalDateLabel = plugin.settings.autoCleanupDateField === 'datepub'
                    ? 'Global ({{datepub}})'
                    : 'Global ({{datesaved}})';
                const dateSelect = criterionWrapper.createEl('select');
                dateSelect.style.cssText = `font-size: ${inputFontSize()};`;
                for (const [val, txt] of [
                    ['global',    globalDateLabel],
                    ['datesaved', '{{datesaved}} — Date saved'],
                    ['datepub',   '{{datepub}} — Date published'],
                ]) {
                    dateSelect.createEl('option', { value: val, text: txt });
                }
                dateSelect.value = this.values.autoCleanupDateField;
                dateSelect.addEventListener('change', () => { this.values.autoCleanupDateField = dateSelect.value; markDirty(); });
            });

            sectionHeader('YouTube');

            // Tag YouTube Shorts
            this.wrapWithApply(container, 'tagShorts', (card, markDirty) => {
                this.cardHeader(card, '🩳', 'Tag YouTube Shorts', 'Automatically add the "shorts" tag to YouTube Shorts articles. Overrides global setting.');
                const select = card.createEl('select');
                select.style.cssText = `width: 100%; box-sizing: border-box; font-size: ${inputFontSize()};`;
                select.createEl('option', { value: 'global', text: `Use global (${plugin.settings.tagShortsGlobal ? 'on' : 'off'})` });
                select.createEl('option', { value: 'on',     text: 'Always on'  });
                select.createEl('option', { value: 'off',    text: 'Always off' });
                select.value = this.values.tagShorts === true ? 'on' : this.values.tagShorts === false ? 'off' : 'global';
                select.addEventListener('change', () => {
                    this.values.tagShorts = select.value === 'on' ? true : select.value === 'off' ? false : undefined;
                    markDirty();
                });
            });

            // Skip YouTube Shorts
            this.wrapWithApply(container, 'skipShorts', (card, markDirty) => {
                this.cardHeader(card, '⏭️', 'Skip YouTube Shorts', 'Never save articles from YouTube Shorts URLs. Overrides global setting.');
                const select = card.createEl('select');
                select.style.cssText = `width: 100%; box-sizing: border-box; font-size: ${inputFontSize()};`;
                select.createEl('option', { value: 'global', text: `Use global (${plugin.settings.skipShortsGlobal ? 'on' : 'off'})` });
                select.createEl('option', { value: 'on',     text: 'Always skip' });
                select.createEl('option', { value: 'off',    text: 'Never skip'  });
                select.value = this.values.skipShorts === true ? 'on' : this.values.skipShorts === false ? 'off' : 'global';
                select.addEventListener('change', () => {
                    this.values.skipShorts = select.value === 'on' ? true : select.value === 'off' ? false : undefined;
                    markDirty();
                });
            });
        }

        // ── Custom tab ────────────────────────────────────────────────────────

        private renderCustomTab(container: HTMLElement) {
            renderVariableReference(container);

            const templatesContainer = container.createDiv();
            templatesContainer.style.cssText = 'margin-top: 4px;';

            const renderField = (
                fieldKey:    keyof typeof this.apply,
                icon:        string,
                title:       string,
                desc:        string,
                placeholder: string,
                valueKey:    string,
                type:        'input' | 'textarea'
            ) => {
                this.wrapWithApply(templatesContainer, fieldKey, (card, markDirty) => {
                    this.cardHeader(card, icon, title, desc);

                    if (type === 'input') {
                        const input = card.createEl('input', { type: 'text' });
                        input.placeholder   = placeholder;
                        input.value         = this.values[valueKey] ?? '';
                        input.style.cssText = `width: 100%; box-sizing: border-box; font-family: var(--font-monospace); font-size: ${inputFontSize()};`;
                        input.addEventListener('input', () => { this.values[valueKey] = input.value; markDirty(); });
                    } else {
                        const textarea = card.createEl('textarea');
                        textarea.placeholder   = placeholder;
                        textarea.value         = this.values[valueKey] ?? '';
                        textarea.style.cssText = `
                            width: 100%; box-sizing: border-box;
                            font-family: var(--font-monospace);
                            font-size: ${inputFontSize()};
                            height: 120px; min-height: 80px; resize: vertical;
                        `;
                        textarea.addEventListener('input', () => { this.values[valueKey] = textarea.value; markDirty(); });
                    }
                });
            };

            renderField('titleTemplate',       '📄', 'File Name',               'Variables: {{title}}, {{author}}, {{datepub}}, {{datesaved}}, {{snippet}}, {{feedname}}', '{{title}}',                                                     'titleTemplate',       'input');
            renderField('frontmatterTemplate', '🗂️', 'Properties / Frontmatter', 'Support all variables except {{content}}',                                               plugin.settings.frontmatterTemplate || '(use global template)',  'frontmatterTemplate', 'textarea');
            renderField('contentTemplate',     '✍️', 'Content Body',             'All variables',                                                                           plugin.settings.template             || '(use global template)',  'contentTemplate',     'textarea');
        }

        // ── Footer ────────────────────────────────────────────────────────────

        private renderFooter(contentEl: HTMLElement) {
            const footer = contentEl.createDiv();
            footer.style.cssText = 'margin-top: 12px; flex-shrink: 0; display: flex; justify-content: flex-end; gap: 8px;';

            const cancelBtn = footer.createEl('button', { text: 'Cancel' });
            cancelBtn.onclick = () => this.close();

            const applyBtn = footer.createEl('button', { text: 'Apply to selected feeds', cls: 'mod-cta' });
            applyBtn.onclick = async () => {
                const a = this.apply;
                const v = this.values;

                const feedCount = selectedFeeds.size;

                const FIELD_LABELS: Record<keyof typeof this.apply, string> = {
                    enabled:             'Enabled',
                    groupId:             'Folder',
                    folder:              'Subfolder',
                    updateIntervalValue: 'Update Interval',
                    autoCleanupValue:    'Auto Delete',
                    tagShorts:           'Tag Shorts',
                    skipShorts:          'Skip Shorts',
                    titleTemplate:       'File Name',
                    frontmatterTemplate: 'Frontmatter',
                    contentTemplate:     'Content',
                };

                const appliedFields = (Object.keys(a) as Array<keyof typeof this.apply>)
                    .filter(key => a[key])
                    .map(key => FIELD_LABELS[key])
                    .join(', ');

                plugin.settings.feeds.forEach(feed => {
                    if (!selectedFeeds.has(feed.url)) return;
                    if (a.enabled)             feed.enabled              = v.enabled;
                    if (a.groupId)             { if (v.groupId === '') delete feed.groupId; else feed.groupId = v.groupId; }
                    if (a.folder)              feed.folder               = v.folder;
                    if (a.updateIntervalValue) { feed.updateIntervalValue = v.updateIntervalValue; feed.updateIntervalUnit = v.updateIntervalUnit; }
                    if (a.autoCleanupValue)    { feed.autoCleanupValue = v.autoCleanupValue; feed.autoCleanupUnit = v.autoCleanupUnit; feed.autoCleanupDateField = v.autoCleanupDateField; }
                    if (a.tagShorts)           feed.tagShorts  = v.tagShorts;
                    if (a.skipShorts)          feed.skipShorts = v.skipShorts;
                    if (a.titleTemplate)       feed.titleTemplate       = v.titleTemplate;
                    if (a.frontmatterTemplate) feed.frontmatterTemplate = v.frontmatterTemplate;
                    if (a.contentTemplate)     feed.contentTemplate     = v.contentTemplate;
                });

                await plugin.saveSettings();

                this.close();
                onDone();

                if (appliedFields) {
                    new Notice(`Updated ${feedCount} feed${feedCount !== 1 ? 's' : ''}: ${appliedFields}`);
                } else {
                    new Notice('No fields were selected to apply.');
                }
            };
        }

        onClose() { this.contentEl.empty(); }
    }

    new BulkEditModal(app).open();
}