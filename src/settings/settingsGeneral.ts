import { Setting, Notice } from 'obsidian';
import RssPlugin from '../main';
import { purgeEntriesByStatus, ArticleStatus } from './feedDatabase';

// ─── Types ────────────────────────────────────────────────────────────────────

type ImageLocation = 'obsidian' | 'vault' | 'current' | 'subfolder' | 'specified';
type DeleteBehavior = 'obsidian' | 'direct' | 'obsidian-trash' | 'system-trash';
type IntervalUnit = 'minutes' | 'hours' | 'days' | 'months';
type CleanupDateField = 'datesaved' | 'datepub';

interface AppWithSettings {
    setting: {
        openTabById(id: string): void;
    };
}

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

function debounce<T extends (...args: unknown[]) => void | Promise<void>>(
    fn: T,
    ms: number
): (...args: Parameters<T>) => void {
    let timer: ReturnType<typeof setTimeout>;
    return ((...args: unknown[]) => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            void fn(...args);
        }, ms);
    }) as (...args: Parameters<T>) => void;
}

function saveSettings(plugin: RssPlugin): void {
    void plugin.saveSettings().catch(e => {
        console.error('[RSS Plugin] saveSettings failed:', e);
    });
}

function applyIndent(settingEl: HTMLElement, level: 1 | 2 = 1): void {
    settingEl.setCssProps({
        'margin-left': level === 2 ? '40px' : '20px',
        'border-left': '3px solid var(--interactive-accent)',
    });
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

    const isEnabled = plugin.isAutoUpdateEnabled();

    // ── Setup instructions ────────────────────────────────────────────────────

    const setupCard = contentEl.createDiv({ cls: 'super-rss-setup-card' });

    const setupHeader = setupCard.createDiv({ cls: 'super-rss-setup-header' });

    const setupText = setupHeader.createDiv({ cls: 'super-rss-setup-text' });

    setupText.createEl('div', { text: 'Setup instructions', cls: 'super-rss-setup-title' });

    const setupDesc = setupText.createEl('div', { cls: 'super-rss-setup-description' });
    setupDesc.setText('Configure the plugin below. Make sure to set your RSS folder and add feeds in the feeds tab.');

    // ── RSS Folder (No Storage H3) ────────────────────────────────────────────

    const folderSetting = new Setting(contentEl)
        .setName('RSS folder')
        .setDesc('Base folder where articles will be saved.')
        .addText(text => {
            text.setPlaceholder('RSS')
                .setValue(plugin.settings.folderPath ?? 'RSS')
                .onChange(debounce(async (value: string) => {
                    plugin.settings.folderPath = sanitizeFolderPath(value, 'RSS');
                    saveSettings(plugin);
                }, 500));
            text.inputEl.setCssProps({ 'font-size': '16px' });
            text.inputEl.autocapitalize = 'off';
            text.inputEl.autocomplete = 'off';
            text.inputEl.spellcheck = false;
        });
    applyCardStyle(folderSetting);

    // ── Auto Update ───────────────────────────────────────────────────────────

    contentEl.createEl('h3', { text: 'Auto update' });

    const autoUpdateSetting = new Setting(contentEl)
        .setName('Enable auto update')
        .setDesc('Automatically fetch articles from feeds in the background on this device.')
        .addToggle(toggle => toggle
            .setValue(isEnabled)
            .onChange(async (v) => {
                await plugin.setAutoUpdateEnabled(v);
                rerender();
            }));
    applyCardStyle(autoUpdateSetting);

    if (isEnabled) {
        const intervalSetting = new Setting(contentEl)
            .setName('Update interval')
            .setDesc('How often feeds should be automatically checked.')
            .addText(text => {
                text.setPlaceholder('30')
                    .setValue(displayValue(plugin.settings.updateIntervalValue, 30))
                    .onChange(debounce(async (v: string) => {
                        plugin.settings.updateIntervalValue = parsePositiveInt(v, 30);
                        saveSettings(plugin);
                    }, 500));
                text.inputEl.setCssProps({ 'font-size': '16px' });
                text.inputEl.inputMode = 'numeric';
                text.inputEl.autocapitalize = 'off';
                text.inputEl.autocomplete = 'off';
                text.inputEl.spellcheck = false;
            })
            .addDropdown(dropdown => dropdown
                .addOption('minutes', 'Minutes').addOption('hours', 'Hours')
                .addOption('days', 'Days').addOption('months', 'Months')
                .setValue(plugin.settings.updateIntervalUnit ?? 'minutes')
                .onChange((v: string) => {
                    plugin.settings.updateIntervalUnit = v as IntervalUnit;
                    saveSettings(plugin);
                }));
        applyCardStyle(intervalSetting);
        applyIndent(intervalSetting.settingEl);
    }

    // ── Auto Delete ───────────────────────────────────────────────────────────

    contentEl.createEl('h3', { text: 'Auto delete' });

    const autoDeleteEnabled = plugin.settings.autoCleanupValue != null && plugin.settings.autoCleanupValue > 0;

    const autoDeleteToggle = new Setting(contentEl)
        .setName('Auto delete old articles')
        .setDesc('Automatically delete old vault articles.')
        .addToggle(toggle => toggle
            .setValue(autoDeleteEnabled)
            .onChange((v) => {
                plugin.settings.autoCleanupValue = v ? 30 : 0;
                saveSettings(plugin);
                rerender();
            }));
    applyCardStyle(autoDeleteToggle);

    if (autoDeleteEnabled) {
        const cleanupSetting = new Setting(contentEl)
            .setName('Delete articles older than')
            .setDesc('Threshold age before an article is safely deleted.')
            .addText(text => {
                text.setPlaceholder('30')
                    .setValue(displayValue(plugin.settings.autoCleanupValue, 30))
                    .onChange(debounce(async (v: string) => {
                        plugin.settings.autoCleanupValue = parsePositiveInt(v, 30);
                        saveSettings(plugin);
                    }, 500));
                text.inputEl.setCssProps({ 'font-size': '16px' });
                text.inputEl.inputMode = 'numeric';
                text.inputEl.autocapitalize = 'off';
                text.inputEl.autocomplete = 'off';
                text.inputEl.spellcheck = false;
            })
            .addDropdown(dropdown => dropdown
                .addOption('minutes', 'Minutes').addOption('hours', 'Hours')
                .addOption('days', 'Days').addOption('months', 'Months')
                .setValue(plugin.settings.autoCleanupUnit ?? 'days')
                .onChange((v: string) => {
                    plugin.settings.autoCleanupUnit = v as IntervalUnit;
                    saveSettings(plugin);
                }));
        applyCardStyle(cleanupSetting);
        applyIndent(cleanupSetting.settingEl);

        const cleanupDateFieldSetting = new Setting(contentEl)
            .setName('Date criterion')
            .setDesc('Which date to use when identifying old articles.')
            .addDropdown(dropdown => dropdown
                .addOption('datesaved', 'Date saved')
                .addOption('datepub', 'Date published')
                .setValue(plugin.settings.autoCleanupDateField ?? 'datesaved')
                .onChange((v: string) => {
                    plugin.settings.autoCleanupDateField = v as CleanupDateField;
                    saveSettings(plugin);
                }));
        applyCardStyle(cleanupDateFieldSetting);
        applyIndent(cleanupDateFieldSetting.settingEl);

        const protectedCheckToggle = new Setting(contentEl)
            .setName('Check mark as read before deleting')
            .setDesc('Only delete articles if their checkbox property is true.')
            .addToggle(toggle => toggle
                .setValue(plugin.settings.autoCleanupCheckProperty ?? false)
                .onChange((v) => {
                    plugin.settings.autoCleanupCheckProperty = v;
                    saveSettings(plugin);
                    rerender();
                }));
        applyCardStyle(protectedCheckToggle);
        applyIndent(protectedCheckToggle.settingEl);

        if (plugin.settings.autoCleanupCheckProperty) {
            const fallbackProp = plugin.settings.markAsReadCheckboxProperty?.trim() || 'Checkbox';
            const protectedPropertySetting = new Setting(contentEl)
                .setName('Custom property name')
                .setDesc(`Defaults to the Mark as Read checkbox property ("${fallbackProp}"). Left empty to keep default.`)
                .addText(text => {
                    text.setPlaceholder(fallbackProp)
                        .setValue(plugin.settings.autoCleanupCheckPropertyName ?? '')
                        .onChange(debounce(async (v: string) => {
                            plugin.settings.autoCleanupCheckPropertyName = v.trim();
                            saveSettings(plugin);
                        }, 500));
                    text.inputEl.setCssProps({ 'font-size': '16px' });
                    text.inputEl.autocapitalize = 'off';
                    text.inputEl.autocomplete = 'off';
                    text.inputEl.spellcheck = false;
                });
            applyCardStyle(protectedPropertySetting);
            applyIndent(protectedPropertySetting.settingEl, 2);
        }
    }

    // ── Mark as Read ──────────────────────────────────────────────────────────

    contentEl.createEl('h3', { text: 'Mark as read' });

    const markAsReadToggle = new Setting(contentEl)
        .setName('Enable mark as read link')
        .setDesc('Adds a clickable link frontmatter property that toggles a checkbox when clicked.')
        .addToggle(toggle => toggle
            .setValue(plugin.settings.markAsReadEnabled ?? true)
            .onChange((v) => {
                plugin.settings.markAsReadEnabled = v;
                saveSettings(plugin);
                rerender();
            }));
    applyCardStyle(markAsReadToggle);

    if (plugin.settings.markAsReadEnabled) {
        const markAsReadLinkPropSetting = new Setting(contentEl)
            .setName('Mark as read button property name')
            .setDesc('Frontmatter property name for the clickable link.')
            .setDesc('Name of the frontmatter property that stores the "mark as read" link.')
            .addText(text => {
                text.setPlaceholder('Mark as read')
                    .setValue(plugin.settings.markAsReadLinkProperty ?? 'Mark as Read')
                    .onChange((val) => {
                        plugin.settings.markAsReadLinkProperty = val;
                        saveSettings(plugin);
                    });
            });
        applyCardStyle(markAsReadLinkPropSetting);
        applyIndent(markAsReadLinkPropSetting.settingEl);

        const markAsReadCheckboxPropSetting = new Setting(contentEl)
            .setName('Read property name')
            .setDesc('Name of the frontmatter property (boolean) that controls the read state.')
            .addText(text => {
                text.setPlaceholder('Read')
                    .setValue(plugin.settings.markAsReadCheckboxProperty ?? 'Read')
                    .onChange((val) => {
                        plugin.settings.markAsReadCheckboxProperty = val;
                        saveSettings(plugin);
                    });
            });
        applyCardStyle(markAsReadCheckboxPropSetting);
        applyIndent(markAsReadCheckboxPropSetting.settingEl);

        const markAsReadDeleteSetting = new Setting(contentEl)
            .setName('Auto-delete when marked as read')
            .setDesc('Automatically delete articles when their checkbox is ticked. Requires auto-update.')
            .addToggle(toggle => toggle
                .setValue(plugin.settings.markAsReadDeleteArticles ?? false)
                .onChange((v) => {
                    plugin.settings.markAsReadDeleteArticles = v;
                    saveSettings(plugin);
                }));
        applyCardStyle(markAsReadDeleteSetting);
        applyIndent(markAsReadDeleteSetting.settingEl);

        const copyFormulaSetting = new Setting(contentEl)
            .setName('Copy bases formula')
            .setDesc('Copy a formula for Obsidian bases to create a clickable mark as read button in gallery/card views.')
            .addButton(btn => {
                btn.setButtonText('Copy formula')
                    .onClick(() => {
                        void (async () => {
                        const checkboxProp = plugin.settings.markAsReadCheckboxProperty?.trim() || 'Read';
                        // Synchronize with buildMarkAsReadLink encoding logic
                        const formula =
                            `link(
  "obsidian://rss-mark-as-read?file=" + file.name.replace("%", "%25").replace("&", "%26").replace("#", "%23") + "&property=" + "${checkboxProp.replace(/%/g, '%25')}",
  if(${checkboxProp},
    html("<span style='font-size:1.5em'>✅</span>"),
    html("<span style='font-size:1.5em'>🟦</span>")
  )
)`;
                        try {
                            await navigator.clipboard.writeText(formula);
                            btn.setButtonText('Copied!');
                            setTimeout(() => {
                                btn.setButtonText('Copy formula');
                            }, 2000);
                        } catch {
                            btn.setButtonText('Failed');
                            setTimeout(() => {
                                btn.setButtonText('Copy formula');
                            }, 2000);
                        }
                        })();
                    });
            });
        applyCardStyle(copyFormulaSetting);
        applyIndent(copyFormulaSetting.settingEl);
    }

    // ── Storage ───────────────────────────────────────────────────────────────

    contentEl.createEl('h3', { text: 'Storage' });

    const deleteBehaviorSetting = new Setting(contentEl)
        .setName('Delete behavior')
        .setDesc('Choose how cleanup and duplicate removal discard article notes.')
        .addDropdown(dropdown => dropdown
            .addOption('obsidian', 'Use Obsidian setting')
            .addOption('obsidian-trash', 'Move to Obsidian trash')
            .addOption('system-trash', 'Move to system trash')
            .addOption('direct', 'Delete permanently')
            .setValue(plugin.settings.deleteBehavior ?? 'obsidian')
            .onChange((value: string) => {
                plugin.settings.deleteBehavior = value as DeleteBehavior;
                saveSettings(plugin);
            }));
    applyCardStyle(deleteBehaviorSetting);

    const downloadImgSetting = new Setting(contentEl)
        .setName('Download images')
        .setDesc('Save article images locally to your vault.')
        .addToggle(toggle => toggle
            .setValue(plugin.settings.downloadImages ?? false)
            .onChange((value) => {
                plugin.settings.downloadImages = value;
                saveSettings(plugin);
                rerender();
            }));
    applyCardStyle(downloadImgSetting);

    if (plugin.settings.downloadImages) {
        const locationSetting = new Setting(contentEl)
            .setName('Default location for new images')
            .setDesc('Where newly added images are placed.')
            .addDropdown(dropdown => dropdown
                .addOption('obsidian', 'Use Obsidian settings')
                .addOption('vault', 'Vault folder')
                .addOption('current', 'Same folder as file')
                .addOption('subfolder', 'In subfolder under RSS folder')
                .addOption('specified', 'In the folder specified below')
                .setValue(plugin.settings.imageLocation || 'obsidian')
                .onChange((value: string) => {
                    plugin.settings.imageLocation = value as ImageLocation;
                    saveSettings(plugin);
                    rerender();
                }));
        applyCardStyle(locationSetting);
        applyIndent(locationSetting.settingEl);

        if (plugin.settings.imageLocation === 'obsidian') {
            const infoSetting = new Setting(contentEl)
                .setName('Using Obsidian attachment settings')
                .setDesc('See Obsidian settings → Files and links → Default location for new attachments.'); // eslint-disable-line obsidianmd/ui/sentence-case -- Obsidian navigation labels
            applyCardStyle(infoSetting);
            applyIndent(infoSetting.settingEl, 2);
            infoSetting.settingEl.setCssProps({ opacity: '0.7' });
        }

        if (plugin.settings.imageLocation === 'subfolder') {
            const subfolderNameSetting = new Setting(contentEl)
                .setName('Subfolder name')
                .setDesc('Name of the subfolder (e.g., "attachments").')
                .addText(text => {
                    text.setPlaceholder('Attachments')
                        .setValue(plugin.settings.imagesFolder ?? 'attachments')
                        .onChange(debounce(async (v: string) => {
                            plugin.settings.imagesFolder = sanitizeFolderPath(v, 'attachments');
                            saveSettings(plugin);
                        }, 500));
                    text.inputEl.setCssProps({ 'font-size': '16px' });
                    text.inputEl.autocapitalize = 'off';
                    text.inputEl.autocomplete = 'off';
                    text.inputEl.spellcheck = false;
                });
            applyCardStyle(subfolderNameSetting);
            applyIndent(subfolderNameSetting.settingEl, 2);

            const feedBaseSetting = new Setting(contentEl)
                .setName('Use feed folder as base')
                .setDesc('If enabled, subfolder is created inside each feed folder.')
                .addToggle(toggle => toggle
                    .setValue(plugin.settings.useFeedFolder ?? true)
                    .onChange((v) => {
                        plugin.settings.useFeedFolder = v;
                        saveSettings(plugin);
                    }));
            applyCardStyle(feedBaseSetting);
            applyIndent(feedBaseSetting.settingEl, 2);
        }

        if (plugin.settings.imageLocation === 'specified') {
            const pathSetting = new Setting(contentEl)
                .setName('Attachment folder path')
                .setDesc('Path to a specific folder in your vault.')
                .addText(text => {
                    text.setPlaceholder('Attachments')
                        .setValue(plugin.settings.imagesFolder ?? '')
                        .onChange(debounce(async (v: string) => {
                            plugin.settings.imagesFolder = sanitizeFolderPath(v, '');
                            saveSettings(plugin);
                        }, 500));
                    text.inputEl.setCssProps({ 'font-size': '16px' });
                    text.inputEl.autocapitalize = 'off';
                    text.inputEl.autocomplete = 'off';
                    text.inputEl.spellcheck = false;
                });
            applyCardStyle(pathSetting);
            applyIndent(pathSetting.settingEl, 2);
        }
    }

    // ── Ribbon Icons ──────────────────────────────────────────────────────────

    contentEl.createEl('h3', { text: 'Ribbon icons' });

    const ribbonUpdateSetting = new Setting(contentEl)
        .setName('Show update RSS feeds button')
        .setDesc('Display the update button in the left sidebar ribbon.')
        .addToggle(toggle => toggle
            .setValue(plugin.settings.ribbonUpdate ?? true)
            .onChange((v) => {
                plugin.settings.ribbonUpdate = v;
                saveSettings(plugin);
            }));
    applyCardStyle(ribbonUpdateSetting);

    const ribbonAddSetting = new Setting(contentEl)
        .setName('Show add RSS feed button')
        .setDesc('Display the add feed button in the left sidebar ribbon.')
        .addToggle(toggle => toggle
            .setValue(plugin.settings.ribbonAdd ?? true)
            .onChange((v) => {
                plugin.settings.ribbonAdd = v;
                saveSettings(plugin);
            }));
    applyCardStyle(ribbonAddSetting);

    const ribbonCleanupSetting = new Setting(contentEl)
        .setName('Show delete old articles now button')
        .setDesc('Display the cleanup button in the left sidebar ribbon.')
        .addToggle(toggle => toggle
            .setValue(plugin.settings.ribbonCleanup ?? true)
            .onChange((v) => {
                plugin.settings.ribbonCleanup = v;
                saveSettings(plugin);
            }));
    applyCardStyle(ribbonCleanupSetting);

    // ── Notifications ─────────────────────────────────────────────────────────

    contentEl.createEl('h3', { text: 'Notifications' });

    const progressNoticeSetting = new Setting(contentEl)
        .setName('Show updating feeds notification')
        .setDesc('Show a notification when updating feeds.')
        .addToggle(toggle => toggle
            .setValue(plugin.settings.showProgressNotice ?? true)
            .onChange((v) => {
                plugin.settings.showProgressNotice = v;
                saveSettings(plugin);
            }));
    applyCardStyle(progressNoticeSetting);

    const statusBarSetting = new Setting(contentEl)
        .setName('Show progress in status bar')
        .setDesc('Display progress in the bottom status bar.')
        .addToggle(toggle => toggle
            .setValue(plugin.settings.showStatusBar ?? true)
            .onChange((v) => {
                plugin.settings.showStatusBar = v;
                saveSettings(plugin);
            }));
    applyCardStyle(statusBarSetting);

    // ── YouTube ───────────────────────────────────────────────────────────────

    contentEl.createEl('h3', { text: 'YouTube' });

    const tagShortsSetting = new Setting(contentEl)
        .setName('Tag YouTube shorts')
        .setDesc('Automatically tag articles from YouTube shorts.')
        .addToggle(toggle => toggle
            .setValue(plugin.settings.tagShortsGlobal ?? false)
            .onChange((v) => {
                plugin.settings.tagShortsGlobal = v;
                saveSettings(plugin);
            }));
    applyCardStyle(tagShortsSetting);

    const skipShortsSetting = new Setting(contentEl)
        .setName('Skip YouTube shorts')
        .setDesc('Never save articles from YouTube shorts.')
        .addToggle(toggle => toggle
            .setValue(plugin.settings.skipShortsGlobal ?? false)
            .onChange((v) => {
                plugin.settings.skipShortsGlobal = v;
                saveSettings(plugin);
            }));
    applyCardStyle(skipShortsSetting);

    const tagLiveToggle = new Setting(contentEl)
        .setName('Tag live streams')
        .setDesc('Tag articles matching live stream keywords in the title.')
        .addToggle(toggle => toggle
            .setValue(plugin.settings.tagLiveGlobal ?? false)
            .onChange((v) => {
                plugin.settings.tagLiveGlobal = v;
                saveSettings(plugin);
                rerender();
            }));
    applyCardStyle(tagLiveToggle);

    if (plugin.settings.tagLiveGlobal) {
        const tagLiveKeywordsSetting = new Setting(contentEl)
            .setName('Live keywords')
            .setDesc('Comma-separated keywords (case-insensitive).')
            .addText(t => {
                t.setPlaceholder('Live, ao vivo, stream')
                    .setValue(plugin.settings.tagLiveKeywords ?? '')
                    .onChange(debounce(async (v: string) => {
                        plugin.settings.tagLiveKeywords = v.trim();
                        saveSettings(plugin);
                    }, 500));
                t.inputEl.setCssProps({ 'font-size': '16px' });
                t.inputEl.autocapitalize = 'off';
                t.inputEl.autocomplete = 'off';
                t.inputEl.spellcheck = false;
            });
        applyCardStyle(tagLiveKeywordsSetting);
        applyIndent(tagLiveKeywordsSetting.settingEl);
    }


    // ── Developer Tools ───────────────────────────────────────────────────────

    contentEl.createEl('h3', { text: 'Developer tools' });

    const devToolsSetting = new Setting(contentEl)
        .setName('Developer mode')
        .setDesc('Enables extra controls for debugging.')
        .addToggle(toggle => toggle
            .setValue(plugin.settings.devMode ?? false)
            .onChange((v) => {
                plugin.settings.devMode = v;
                try {
                    saveSettings(plugin);
                } catch (e) {
                    console.error('[RSS Plugin] Failed to save devMode setting:', e);
                    return;
                }
                try {
                    (plugin.app as unknown as AppWithSettings).setting.openTabById(plugin.manifest.id);
                } catch (e) {
                    console.warn('[RSS Plugin] Could not reopen settings tab:', e);
                }
            }));
    applyCardStyle(devToolsSetting);

    if (plugin.settings.devMode) {
        const purgeConfigs: { status: ArticleStatus; label: string }[] = [
            { status: 'old_article', label: 'old_article' },
            { status: 'skip_shorts', label: 'skip_shorts' },
            { status: 'skip_live', label: 'skip_live' },
            { status: 'mark_as_read', label: 'mark_as_read' },
        ];

        for (const { status, label } of purgeConfigs) {
            let confirming = false;
            let resetTimer: ReturnType<typeof setTimeout> | null = null;

            const purgeSetting = new Setting(contentEl)
                .setName(`Purge ${label} entries`)
                .setDesc(`Permanently removes all ${label} entries from the database file.`)
                .addButton(btn => {
                    btn.setButtonText(`Purge ${label} entries`)
                        .setWarning()
                        .onClick(async () => {
                            if (!confirming) {
                                confirming = true;
                                btn.setButtonText('Click again to confirm');
                                btn.buttonEl.setCssProps({ background: 'var(--color-red)' });

                                resetTimer = setTimeout(() => {
                                    confirming = false;
                                    btn.setButtonText(`Purge ${label} entries`);
                                    btn.buttonEl.setCssProps({ background: '' });
                                }, 4000);
                            } else {
                                if (resetTimer) clearTimeout(resetTimer);
                                confirming = false;
                                btn.setButtonText('Purging...');
                                btn.setDisabled(true);

                                try {
                                    const removed = await purgeEntriesByStatus(plugin.app, status);
                                    if (removed > 0) {
                                        new Notice(`RSS: Removed ${removed} ${label} entr${removed !== 1 ? 'ies' : 'y'} from database.`, 5000);
                                    } else {
                                        new Notice(`RSS: No ${label} entries found.`, 3000);
                                    }
                                } catch (e) {
                                    console.error(`RSS: purgeEntriesByStatus('${status}') failed`, e);
                                    new Notice('RSS: failed to purge entries.', 4000);
                                } finally {
                                    btn.setButtonText(`Purge ${label} entries`);
                                    btn.buttonEl.setCssProps({ background: '' });
                                    btn.setDisabled(false);
                                }
                            }
                        });
                });
            applyCardStyle(purgeSetting);
            applyIndent(purgeSetting.settingEl);
        }
    }
}
