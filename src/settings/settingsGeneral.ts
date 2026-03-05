import { Setting, Modal, App } from 'obsidian';
import RssPlugin from '../main';

// ─── Types ────────────────────────────────────────────────────────────────────

type ImageLocation    = 'obsidian' | 'vault' | 'current' | 'subfolder' | 'specified';
type IntervalUnit     = 'minutes' | 'hours' | 'days' | 'months';
type CleanupDateField = 'datesaved' | 'datepub';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function displayValue(value: number | undefined | null, defaultValue: number): string {
    return value != null && value > 0 && value !== defaultValue ? String(value) : '';
}

function sanitizeFolderPath(value: string, fallback: string): string {
    const trimmed = value.trim();
    if (trimmed === '') return fallback;

    const sanitized = trimmed
        .replace(/\/+/g, '/')
        .replace(/^\//, '')
        .replace(/\/$/, '')
        .replace(/^\.\//, '');

    if (sanitized.split('/').some(seg => seg === '.' || seg === '..')) return fallback;

    return sanitized || fallback;
}

function parsePositiveInt(v: string, fallback: number): number {
    const n = Number(v.trim());
    if (v.trim() === '' || isNaN(n) || !isFinite(n) || n <= 0) return fallback;
    return Math.floor(n);
}

function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): T {
    let timer: ReturnType<typeof setTimeout>;
    return ((...args: any[]) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    }) as T;
}

function applyIndent(settingEl: HTMLElement, level: 1 | 2 = 1): void {
    settingEl.style.marginLeft = level === 2 ? '40px' : '20px';
    settingEl.style.borderLeft = '3px solid var(--interactive-accent)';
}

// ─── Confirmation modal ───────────────────────────────────────────────────────

class EnablePluginModal extends Modal {
    private onConfirm: () => void;
    private onCancel:  () => void;

    constructor(app: App, onConfirm: () => void, onCancel: () => void) {
        super(app);
        this.onConfirm = onConfirm;
        this.onCancel  = onCancel;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h2', { text: '⚙️ Before you enable' });

        const msg = contentEl.createEl('p');
        msg.style.cssText = 'color: var(--text-muted); margin-bottom: 16px; line-height: 1.6;';
        msg.setText('Make sure you have already configured the plugin before activating it. Enabling without proper setup may cause unexpected behaviour.');

        const checklist = contentEl.createEl('ul');
        checklist.style.cssText = 'color: var(--text-normal); margin: 0 0 20px 16px; line-height: 2;';
        [
            'Set your RSS Folder path',
            'Added at least one feed in My Feeds',
            'Configured your update interval',
            'Reviewed the template settings',
        ].forEach(item => checklist.createEl('li', { text: item }));

        const question = contentEl.createEl('p');
        question.style.cssText = 'font-weight: 600; margin-bottom: 16px;';
        question.setText('Have you already configured everything?');

        const footer = contentEl.createDiv();
        footer.style.cssText = 'display: flex; justify-content: flex-end; gap: 10px;';

        const cancelBtn = footer.createEl('button', { text: 'Not yet, go back' });
        cancelBtn.onclick = () => { this.onCancel(); this.close(); };

        const confirmBtn = footer.createEl('button', { text: 'Yes, enable plugin', cls: 'mod-cta' });
        confirmBtn.onclick = () => { this.onConfirm(); this.close(); };
    }

    onClose() { this.contentEl.empty(); }
}

// ─── Tab renderer ─────────────────────────────────────────────────────────────

export function renderGeneralTab(
    containerEl: HTMLElement,
    plugin: RssPlugin,
    applyCardStyle: (setting: Setting) => void
): void {
    let contentEl = containerEl.querySelector('.general-tab-content') as HTMLElement;
    if (!contentEl) {
        contentEl = containerEl.createDiv({ cls: 'general-tab-content' });
    }

    contentEl.empty();

    let rerenderScheduled = false;
    const rerender = () => {
        if (rerenderScheduled) return;
        rerenderScheduled = true;
        requestAnimationFrame(() => {
            rerenderScheduled = false;
            renderGeneralTab(containerEl, plugin, applyCardStyle);
        });
    };

    const isEnabled = plugin.settings.pluginEnabled ?? false;

    // ── Setup instructions & Enable toggle ────────────────────────────────────

    const setupCard = contentEl.createDiv();
    setupCard.style.cssText = `
        background: var(--background-secondary);
        border: 1px solid var(--background-modifier-border);
        border-radius: 10px;
        padding: 16px 18px;
        margin-bottom: 20px;
        transition: border-color 0.2s ease;
        ${isEnabled ? 'border-color: var(--interactive-accent);' : ''}
    `;

    const setupHeader = setupCard.createDiv();
    setupHeader.style.cssText = 'display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;';

    const setupText = setupHeader.createDiv();
    setupText.style.cssText = 'flex: 1; min-width: 0;';

    const setupTitle = setupText.createEl('div', { text: '⚙️ Setup instructions' });
    setupTitle.style.cssText = 'font-weight: 600; font-size: 0.95em; margin-bottom: 6px; color: var(--text-normal);';

    const setupDesc = setupText.createEl('div');
    setupDesc.style.cssText = 'font-size: 0.85em; color: var(--text-muted); line-height: 1.6;';

    if (isEnabled) {
        setupDesc.setText('Plugin is active and running. Feeds will be updated automatically based on your interval settings.');
    } else {
        setupDesc.setText('Configure the plugin before enabling it. Make sure to set your RSS folder, add feeds in My Feeds, and review the template settings.');

        const stepsList = setupText.createEl('ol');
        stepsList.style.cssText = 'font-size: 0.83em; color: var(--text-muted); margin: 8px 0 0 16px; line-height: 1.9;';
        [
            'Set your RSS Folder path below',
            'Go to My Feeds and add your feeds',
            'Set your update interval',
            'Review Global Template if needed',
            'Enable the plugin using the toggle →',
        ].forEach(step => stepsList.createEl('li', { text: step }));
    }

    // ── Enable toggle (right side) ────────────────────────────────────────────

    const toggleSide = setupHeader.createDiv();
    toggleSide.style.cssText = 'display: flex; flex-direction: column; align-items: center; gap: 6px; flex-shrink: 0; padding-top: 2px;';

    const toggleLabel = toggleSide.createEl('div');
    toggleLabel.style.cssText = 'font-size: 0.75em; color: var(--text-muted); white-space: nowrap;';
    toggleLabel.setText(isEnabled ? 'Enabled' : 'Disabled');

    const toggleEl = toggleSide.createEl('div', { cls: 'checkbox-container' });
    if (isEnabled) toggleEl.classList.add('is-enabled');
    toggleEl.style.cssText = 'margin: 0; cursor: pointer;';

    toggleEl.addEventListener('click', async () => {
        const currentlyEnabled = toggleEl.classList.contains('is-enabled');

        if (!currentlyEnabled) {
            new EnablePluginModal(
                plugin.app,
                async () => {
                    plugin.settings.pluginEnabled = true;
                    try { await plugin.saveSettings(); } catch (e) { console.error('[RSS Plugin] saveSettings failed:', e); }
                    rerender();
                },
                () => { /* cancelled, do nothing */ }
            ).open();
        } else {
            plugin.settings.pluginEnabled = false;
            try { await plugin.saveSettings(); } catch (e) { console.error('[RSS Plugin] saveSettings failed:', e); }
            rerender();
        }
    });

    // ── Storage ───────────────────────────────────────────────────────────────

    contentEl.createEl('h3', { text: 'Storage' });

    const folderSetting = new Setting(contentEl)
        .setName('RSS Folder')
        .setDesc('Base folder where articles will be saved.')
        .addText(text => {
            text.setPlaceholder('RSS')
                .setValue(plugin.settings.folderPath ?? 'RSS')
                .onChange(debounce(async (value: string) => {
                    plugin.settings.folderPath = sanitizeFolderPath(value, 'RSS');
                    try { await plugin.saveSettings(); } catch (e) { console.error('[RSS Plugin] saveSettings failed:', e); }
                }, 500));
            text.inputEl.style.fontSize = '16px';
            text.inputEl.autocapitalize = 'off';
            text.inputEl.autocomplete   = 'off';
            text.inputEl.spellcheck     = false;
        });
    applyCardStyle(folderSetting);

    const downloadImgSetting = new Setting(contentEl)
        .setName('Download Images')
        .setDesc('Save article images locally to your vault.')
        .addToggle(toggle => toggle
            .setValue(plugin.settings.downloadImages ?? false)
            .onChange(async (value) => {
                plugin.settings.downloadImages = value;
                try { await plugin.saveSettings(); } catch (e) { console.error('[RSS Plugin] saveSettings failed:', e); }
                rerender();
            }));
    applyCardStyle(downloadImgSetting);

    if (plugin.settings.downloadImages) {
        const locationSetting = new Setting(contentEl)
            .setName('Default Location For New Images')
            .setDesc('Where newly added images are placed.')
            .addDropdown(dropdown => dropdown
                .addOption('obsidian',  'Use Obsidian settings')
                .addOption('vault',     'Vault folder')
                .addOption('current',   'Same folder as file')
                .addOption('subfolder', 'In subfolder under RSS folder')
                .addOption('specified', 'In the folder specified below')
                .setValue(plugin.settings.imageLocation || 'obsidian')
                .onChange(async (value: ImageLocation) => {
                    plugin.settings.imageLocation = value;
                    try { await plugin.saveSettings(); } catch (e) { console.error('[RSS Plugin] saveSettings failed:', e); }
                    rerender();
                }));
        applyCardStyle(locationSetting);
        applyIndent(locationSetting.settingEl);

        if (plugin.settings.imageLocation === 'obsidian') {
            const infoSetting = new Setting(contentEl)
                .setName('Using Obsidian Attachment Settings')
                .setDesc('Go to Settings → Files and links → Default location for new attachments to change this.');
            applyCardStyle(infoSetting);
            applyIndent(infoSetting.settingEl, 2);
            infoSetting.settingEl.style.opacity = '0.7';
        }

        if (plugin.settings.imageLocation === 'subfolder') {
            const subfolderNameSetting = new Setting(contentEl)
                .setName('Subfolder Name')
                .setDesc('Name of the subfolder (e.g., "attachments").')
                .addText(text => {
                    text.setPlaceholder('attachments')
                        .setValue(plugin.settings.imagesFolder ?? 'attachments')
                        .onChange(debounce(async (v: string) => {
                            plugin.settings.imagesFolder = sanitizeFolderPath(v, 'attachments');
                            try { await plugin.saveSettings(); } catch (e) { console.error('[RSS Plugin] saveSettings failed:', e); }
                        }, 500));
                    text.inputEl.style.fontSize = '16px';
                    text.inputEl.autocapitalize = 'off';
                    text.inputEl.autocomplete   = 'off';
                    text.inputEl.spellcheck     = false;
                });
            applyCardStyle(subfolderNameSetting);
            applyIndent(subfolderNameSetting.settingEl, 2);

            const feedBaseSetting = new Setting(contentEl)
                .setName('Use Feed Folder As Base')
                .setDesc('If enabled, subfolder is created inside each feed folder.')
                .addToggle(toggle => toggle
                    .setValue(plugin.settings.useFeedFolder ?? true)
                    .onChange(async (v) => {
                        plugin.settings.useFeedFolder = v;
                        try { await plugin.saveSettings(); } catch (e) { console.error('[RSS Plugin] saveSettings failed:', e); }
                    }));
            applyCardStyle(feedBaseSetting);
            applyIndent(feedBaseSetting.settingEl, 2);
        }

        if (plugin.settings.imageLocation === 'specified') {
            const pathSetting = new Setting(contentEl)
                .setName('Attachment Folder Path')
                .setDesc('Path to a specific folder in your vault.')
                .addText(text => {
                    text.setPlaceholder('attachments')
                        .setValue(plugin.settings.imagesFolder ?? '')
                        .onChange(debounce(async (v: string) => {
                            plugin.settings.imagesFolder = sanitizeFolderPath(v, '');
                            try { await plugin.saveSettings(); } catch (e) { console.error('[RSS Plugin] saveSettings failed:', e); }
                        }, 500));
                    text.inputEl.style.fontSize = '16px';
                    text.inputEl.autocapitalize = 'off';
                    text.inputEl.autocomplete   = 'off';
                    text.inputEl.spellcheck     = false;
                });
            applyCardStyle(pathSetting);
            applyIndent(pathSetting.settingEl, 2);
        }
    }

    // ── Mark as Read ──────────────────────────────────────────────────────────

    contentEl.createEl('h3', { text: 'Mark as Read' });

    const markAsReadToggle = new Setting(contentEl)
        .setName('Enable Mark as Read Link')
        .setDesc('Adds a clickable link as a frontmatter property on each article. When clicked, sets the configured checkbox property to true. Works in Obsidian Bases card view where native checkboxes are not interactive.')
        .addToggle(toggle => toggle
            .setValue(plugin.settings.markAsReadEnabled ?? true)
            .onChange(async (v) => {
                plugin.settings.markAsReadEnabled = v;
                try { await plugin.saveSettings(); } catch (e) { console.error('[RSS Plugin] saveSettings failed:', e); }
                rerender();
            }));
    applyCardStyle(markAsReadToggle);

    if (plugin.settings.markAsReadEnabled) {
        const markAsReadLinkPropSetting = new Setting(contentEl)
            .setName('Link Property Name')
            .setDesc('Name of the frontmatter property that will hold the clickable Mark as Read link.')
            .addText(text => {
                text.setPlaceholder('Mark as Read')
                    .setValue(plugin.settings.markAsReadLinkProperty ?? 'Mark as Read')
                    .onChange(debounce(async (v: string) => {
                        plugin.settings.markAsReadLinkProperty = v.trim();
                        try { await plugin.saveSettings(); } catch (e) { console.error('[RSS Plugin] saveSettings failed:', e); }
                    }, 500));
                text.inputEl.style.fontSize = '16px';
                text.inputEl.autocapitalize = 'off';
                text.inputEl.autocomplete   = 'off';
                text.inputEl.spellcheck     = false;
            });
        applyCardStyle(markAsReadLinkPropSetting);
        applyIndent(markAsReadLinkPropSetting.settingEl);

        const markAsReadCheckboxPropSetting = new Setting(contentEl)
            .setName('Checkbox Property Name')
            .setDesc('Name of the frontmatter checkbox property that will be toggled when the link is clicked. Should match the "Check Property Before Deleting" property if you use that feature.')
            .addText(text => {
                text.setPlaceholder('Checkbox')
                    .setValue(plugin.settings.markAsReadCheckboxProperty ?? 'Checkbox')
                    .onChange(debounce(async (v: string) => {
                        plugin.settings.markAsReadCheckboxProperty = v.trim();
                        try { await plugin.saveSettings(); } catch (e) { console.error('[RSS Plugin] saveSettings failed:', e); }
                    }, 500));
                text.inputEl.style.fontSize = '16px';
                text.inputEl.autocapitalize = 'off';
                text.inputEl.autocomplete   = 'off';
                text.inputEl.spellcheck     = false;
            });
        applyCardStyle(markAsReadCheckboxPropSetting);
        applyIndent(markAsReadCheckboxPropSetting.settingEl);

        const copyFormulaSetting = new Setting(contentEl)
            .setName('Bases Formula')
            .setDesc('Copy this formula into an Obsidian Bases view to get a clickable Mark as Read button in card view.')
            .addButton(btn => {
                btn.setButtonText('Copy formula')
                   .onClick(async () => {
                        const checkboxProp = plugin.settings.markAsReadCheckboxProperty?.trim() || 'Checkbox';
                        const formula =
`link(
  "obsidian://rss-mark-as-read?file=" + file.name.replace("&", "%26"),
  if(${checkboxProp},
    html("<span style='font-size:1.5em'>✅</span>"),
    html("<span style='font-size:1.5em'>🟦</span>")
  )
)`;
                        try {
                            await navigator.clipboard.writeText(formula);
                            btn.setButtonText('Copied!');
                            setTimeout(() => btn.setButtonText('Copy formula'), 2000);
                        } catch {
                            btn.setButtonText('Failed');
                            setTimeout(() => btn.setButtonText('Copy formula'), 2000);
                        }
                   });
            });
        applyCardStyle(copyFormulaSetting);
        applyIndent(copyFormulaSetting.settingEl);
    }

    // ── Timing ────────────────────────────────────────────────────────────────

    contentEl.createEl('h3', { text: 'Timing' });

    const intervalSetting = new Setting(contentEl)
        .setName('Update Interval')
        .setDesc('Automatically update all feeds at specified intervals.')
        .addText(text => {
            text.setPlaceholder('30')
                .setValue(displayValue(plugin.settings.updateIntervalValue, 30))
                .onChange(debounce(async (v: string) => {
                    plugin.settings.updateIntervalValue = parsePositiveInt(v, 30);
                    try { await plugin.saveSettings(); } catch (e) { console.error('[RSS Plugin] saveSettings failed:', e); }
                }, 500));
            text.inputEl.style.fontSize = '16px';
            text.inputEl.inputMode      = 'numeric';
            text.inputEl.autocapitalize = 'off';
            text.inputEl.autocomplete   = 'off';
            text.inputEl.spellcheck     = false;
        })
        .addDropdown(dropdown => dropdown
            .addOption('minutes', 'Minutes').addOption('hours',  'Hours')
            .addOption('days',    'Days')   .addOption('months', 'Months')
            .setValue(plugin.settings.updateIntervalUnit ?? 'minutes')
            .onChange(async (v: IntervalUnit) => {
                plugin.settings.updateIntervalUnit = v;
                try { await plugin.saveSettings(); } catch (e) { console.error('[RSS Plugin] saveSettings failed:', e); }
            }));
    applyCardStyle(intervalSetting);

    // ── Auto Delete ───────────────────────────────────────────────────────────

    const autoDeleteEnabled = plugin.settings.autoCleanupValue != null
        && plugin.settings.autoCleanupValue > 0;

    const autoDeleteToggle = new Setting(contentEl)
        .setName('Auto Delete Old Articles')
        .setDesc('Automatically delete old articles after a specified time.')
        .addToggle(toggle => toggle
            .setValue(autoDeleteEnabled)
            .onChange(async (v) => {
                plugin.settings.autoCleanupValue = v ? 30 : 0;
                try { await plugin.saveSettings(); } catch (e) { console.error('[RSS Plugin] saveSettings failed:', e); }
                rerender();
            }));
    applyCardStyle(autoDeleteToggle);

    if (autoDeleteEnabled) {
        const cleanupSetting = new Setting(contentEl)
            .setName('Delete Articles Older Than')
            .setDesc('Articles older than this will be deleted (keeps feed).')
            .addText(text => {
                text.setPlaceholder('30')
                    .setValue(displayValue(plugin.settings.autoCleanupValue, 30))
                    .onChange(debounce(async (v: string) => {
                        plugin.settings.autoCleanupValue = parsePositiveInt(v, 30);
                        try { await plugin.saveSettings(); } catch (e) { console.error('[RSS Plugin] saveSettings failed:', e); }
                    }, 500));
                text.inputEl.style.fontSize = '16px';
                text.inputEl.inputMode      = 'numeric';
                text.inputEl.autocapitalize = 'off';
                text.inputEl.autocomplete   = 'off';
                text.inputEl.spellcheck     = false;
            })
            .addDropdown(dropdown => dropdown
                .addOption('minutes', 'Minutes').addOption('hours',  'Hours')
                .addOption('days',    'Days')   .addOption('months', 'Months')
                .setValue(plugin.settings.autoCleanupUnit ?? 'days')
                .onChange(async (v: IntervalUnit) => {
                    plugin.settings.autoCleanupUnit = v;
                    try { await plugin.saveSettings(); } catch (e) { console.error('[RSS Plugin] saveSettings failed:', e); }
                }));
        applyCardStyle(cleanupSetting);
        applyIndent(cleanupSetting.settingEl);

        const cleanupDateFieldSetting = new Setting(contentEl)
            .setName('Date Criterion')
            .setDesc('Which date field to use when evaluating article age.')
            .addDropdown(dropdown => dropdown
                .addOption('datesaved', '{{datesaved}} — Date the article was saved')
                .addOption('datepub',   '{{datepub}} — Date the article was published')
                .setValue(plugin.settings.autoCleanupDateField ?? 'datesaved')
                .onChange(async (v: CleanupDateField) => {
                    plugin.settings.autoCleanupDateField = v;
                    try { await plugin.saveSettings(); } catch (e) { console.error('[RSS Plugin] saveSettings failed:', e); }
                }));
        applyCardStyle(cleanupDateFieldSetting);
        applyIndent(cleanupDateFieldSetting.settingEl);

        const protectedCheckToggle = new Setting(contentEl)
            .setName('Check Property Before Deleting')
            .setDesc('If enabled, articles will only be deleted if the specified property is checked (true).')
            .addToggle(toggle => toggle
                .setValue(plugin.settings.autoCleanupCheckProperty ?? false)
                .onChange(async (v) => {
                    plugin.settings.autoCleanupCheckProperty = v;
                    try { await plugin.saveSettings(); } catch (e) { console.error('[RSS Plugin] saveSettings failed:', e); }
                    rerender();
                }));
        applyCardStyle(protectedCheckToggle);
        applyIndent(protectedCheckToggle.settingEl);

        if (plugin.settings.autoCleanupCheckProperty) {
            const fallbackProp = plugin.settings.markAsReadCheckboxProperty?.trim() || 'Checkbox';
            const protectedPropertySetting = new Setting(contentEl)
                .setName('Custom Property Name')
                .setDesc(`By default, uses the Mark as Read checkbox property ("${fallbackProp}"). Leave blank to keep this behaviour, or enter a custom property name to override it.`)
                .addText(text => {
                    text.setPlaceholder(fallbackProp)
                        .setValue(plugin.settings.autoCleanupCheckPropertyName ?? '')
                        .onChange(debounce(async (v: string) => {
                            plugin.settings.autoCleanupCheckPropertyName = v.trim();
                            try { await plugin.saveSettings(); } catch (e) { console.error('[RSS Plugin] saveSettings failed:', e); }
                        }, 500));
                    text.inputEl.style.fontSize = '16px';
                    text.inputEl.autocapitalize = 'off';
                    text.inputEl.autocomplete   = 'off';
                    text.inputEl.spellcheck     = false;
                });
            applyCardStyle(protectedPropertySetting);
            applyIndent(protectedPropertySetting.settingEl, 2);
        }
    }

    // ── Ribbon Icons ──────────────────────────────────────────────────────────

    contentEl.createEl('h3', { text: 'Ribbon Icons' });

    const ribbonUpdateSetting = new Setting(contentEl)
        .setName('Show "Update RSS Feeds" Button')
        .setDesc('Display the update button in the left sidebar ribbon.')
        .addToggle(toggle => toggle
            .setValue(plugin.settings.ribbonUpdate ?? true)
            .onChange(async (v) => {
                plugin.settings.ribbonUpdate = v;
                try { await plugin.saveSettings(); } catch (e) { console.error('[RSS Plugin] saveSettings failed:', e); }
            }));
    applyCardStyle(ribbonUpdateSetting);

    const ribbonAddSetting = new Setting(contentEl)
        .setName('Show "Add RSS Feed" Button')
        .setDesc('Display the add feed button in the left sidebar ribbon.')
        .addToggle(toggle => toggle
            .setValue(plugin.settings.ribbonAdd ?? true)
            .onChange(async (v) => {
                plugin.settings.ribbonAdd = v;
                try { await plugin.saveSettings(); } catch (e) { console.error('[RSS Plugin] saveSettings failed:', e); }
            }));
    applyCardStyle(ribbonAddSetting);

    // ── Notifications ─────────────────────────────────────────────────────────

    contentEl.createEl('h3', { text: 'Notifications' });

    const progressNoticeSetting = new Setting(contentEl)
        .setName('Show Updating Feeds Notification')
        .setDesc('Show a notification when updating feeds.')
        .addToggle(toggle => toggle
            .setValue(plugin.settings.showProgressNotice ?? true)
            .onChange(async (v) => {
                plugin.settings.showProgressNotice = v;
                try { await plugin.saveSettings(); } catch (e) { console.error('[RSS Plugin] saveSettings failed:', e); }
            }));
    applyCardStyle(progressNoticeSetting);

    const statusBarSetting = new Setting(contentEl)
        .setName('Show Progress in Status Bar')
        .setDesc('Display "RSS X/Y" in the bottom status bar while feeds are updating.')
        .addToggle(toggle => toggle
            .setValue(plugin.settings.showStatusBar ?? true)
            .onChange(async (v) => {
                plugin.settings.showStatusBar = v;
                try { await plugin.saveSettings(); } catch (e) { console.error('[RSS Plugin] saveSettings failed:', e); }
            }));
    applyCardStyle(statusBarSetting);

    // ── YouTube ───────────────────────────────────────────────────────────────

    contentEl.createEl('h3', { text: 'YouTube' });

    const tagShortsSetting = new Setting(contentEl)
        .setName('Tag YouTube Shorts')
        .setDesc('Automatically add the "shorts" tag to articles from YouTube Shorts URLs (/shorts/). Can be overridden per feed.')
        .addToggle(toggle => toggle
            .setValue(plugin.settings.tagShortsGlobal ?? false)
            .onChange(async (v) => {
                plugin.settings.tagShortsGlobal = v;
                try { await plugin.saveSettings(); } catch (e) { console.error('[RSS Plugin] saveSettings failed:', e); }
            }));
    applyCardStyle(tagShortsSetting);

    const skipShortsSetting = new Setting(contentEl)
        .setName('Skip YouTube Shorts')
        .setDesc('Never save articles from YouTube Shorts URLs (/shorts/). Can be overridden per feed.')
        .addToggle(toggle => toggle
            .setValue(plugin.settings.skipShortsGlobal ?? false)
            .onChange(async (v) => {
                plugin.settings.skipShortsGlobal = v;
                try { await plugin.saveSettings(); } catch (e) { console.error('[RSS Plugin] saveSettings failed:', e); }
            }));
    applyCardStyle(skipShortsSetting);

    const tagLiveToggle = new Setting(contentEl)
        .setName('Tag Live Streams')
        .setDesc('Automatically add the "live" tag to articles whose title contains live-related keywords. You can delete per-feed settings.')
        .addToggle(toggle => toggle
            .setValue(plugin.settings.tagLiveGlobal ?? false)
            .onChange(async (v) => {
                plugin.settings.tagLiveGlobal = v;
                try { await plugin.saveSettings(); } catch (e) { console.error('[RSS Plugin] saveSettings failed:', e); }
                rerender();
            }));
    applyCardStyle(tagLiveToggle);

    if (plugin.settings.tagLiveGlobal) {
        const tagLiveKeywordsSetting = new Setting(contentEl)
            .setName('Live Keywords')
            .setDesc('Comma-separated keywords to match against the article title (case-insensitive).')
            .addText(t => {
                t.setPlaceholder('live, ao vivo, stream, 🔴')
                 .setValue(plugin.settings.tagLiveKeywords ?? '')
                 .onChange(debounce(async (v: string) => {
                     plugin.settings.tagLiveKeywords = v.trim();
                     try { await plugin.saveSettings(); } catch (e) { console.error('[RSS Plugin] saveSettings failed:', e); }
                 }, 500));
                t.inputEl.style.fontSize = '16px';
                t.inputEl.autocapitalize = 'off';
                t.inputEl.autocomplete   = 'off';
                t.inputEl.spellcheck     = false;
            });
        applyCardStyle(tagLiveKeywordsSetting);
        applyIndent(tagLiveKeywordsSetting.settingEl);
    }


    // ── Developer Tools ───────────────────────────────────────────────────────

    contentEl.createEl('h3', { text: 'Developer Tools' });

    const devToolsSetting = new Setting(contentEl)
        .setName('Developer Mode')
        .setDesc('Enables extra controls for debugging, such as the Reload Plugin button in the tab bar.')
        .addToggle(toggle => toggle
            .setValue(plugin.settings.devMode ?? false)
            .onChange(async (v) => {
                plugin.settings.devMode = v;
                try {
                    await plugin.saveSettings();
                } catch (e) {
                    console.error('[RSS Plugin] Failed to save devMode setting:', e);
                    return;
                }
                try {
                    (plugin.app as any).setting.openTabById(plugin.manifest.id);
                } catch (e) {
                    console.warn('[RSS Plugin] Could not reopen settings tab:', e);
                }
            }));
    applyCardStyle(devToolsSetting);
}