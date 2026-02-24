import { App, Setting, Notice } from 'obsidian';
import RssPlugin from '../main';
import { cleanupOldFiles } from '../services/fileSaver';

export function renderGeneralTab(containerEl: HTMLElement, app: App, plugin: RssPlugin, applyCardStyle: (setting: Setting) => void) {
    let contentEl = containerEl.querySelector('.general-tab-content') as HTMLElement;
    if (!contentEl) {
        contentEl = containerEl.createDiv({ cls: 'general-tab-content' });
    }

    contentEl.empty();

    // Helper to re-render only this tab's content — does NOT touch containerEl
    const rerender = () => renderGeneralTab(containerEl, app, plugin, applyCardStyle);

    contentEl.createEl('h3', { text: 'Storage' });

    const folderSetting = new Setting(contentEl)
        .setName('RSS Folder')
        .setDesc('Base folder where articles will be saved.')
        .addText(text => text
            .setPlaceholder('RSS')
            .setValue(plugin.settings.folderPath ?? 'RSS')
            .onChange(async (value) => {
                plugin.settings.folderPath = value.trim() === '' ? 'RSS' : value.trim().replace(/\/+/g, '/').replace(/\/$/, '');
                await plugin.saveSettings();
            }));
    applyCardStyle(folderSetting);

    contentEl.createEl('h3', { text: 'Attachments & Images' });

    const downloadImgSetting = new Setting(contentEl)
        .setName('Download Images')
        .setDesc('Save article images locally to your vault.')
        .addToggle(toggle => toggle
            .setValue(plugin.settings.downloadImages ?? false)
            .onChange(async (value) => {
                plugin.settings.downloadImages = value;
                await plugin.saveSettings();
                rerender();
            }));
    applyCardStyle(downloadImgSetting);

    if (plugin.settings.downloadImages) {
        const locationSetting = new Setting(contentEl)
            .setName('Default Location For New Images')
            .setDesc('Where newly added images are placed.')
            .addDropdown(dropdown => dropdown
                .addOption('obsidian', 'Use Obsidian settings')
                .addOption('vault', 'Vault folder')
                .addOption('current', 'Same folder as file')
                .addOption('subfolder', 'In subfolder under RSS folder')
                .addOption('specified', 'In the folder specified below')
                .setValue(plugin.settings.imageLocation || 'obsidian')
                .onChange(async (value: any) => {
                    plugin.settings.imageLocation = value;
                    await plugin.saveSettings();
                    rerender();
                }));
        applyCardStyle(locationSetting);
        locationSetting.settingEl.style.marginLeft = '20px';
        locationSetting.settingEl.style.borderLeft = '3px solid var(--interactive-accent)';

        if (plugin.settings.imageLocation === 'obsidian') {
            const infoSetting = new Setting(contentEl)
                .setName('Using Obsidian Attachment Settings')
                .setDesc('Go to Settings → Files and links → Default location for new attachments to change this.');
            applyCardStyle(infoSetting);
            infoSetting.settingEl.style.marginLeft = '40px';
            infoSetting.settingEl.style.borderLeft = '3px solid var(--interactive-accent)';
            infoSetting.settingEl.style.opacity = '0.7';
        }

        if (plugin.settings.imageLocation === 'subfolder') {
            const subfolderNameSetting = new Setting(contentEl)
                .setName('Subfolder Name')
                .setDesc('Name of the subfolder (e.g., "attachments").')
                .addText(text => text
                    .setPlaceholder('attachments')
                    .setValue(plugin.settings.imagesFolder ?? 'attachments')
                    .onChange(async (v) => {
                        plugin.settings.imagesFolder = v;
                        await plugin.saveSettings();
                    }));
            applyCardStyle(subfolderNameSetting);
            subfolderNameSetting.settingEl.style.marginLeft = '40px';

            const feedBaseSetting = new Setting(contentEl)
                .setName('Use Feed Folder As Base')
                .setDesc('If enabled, subfolder is created inside each feed folder.')
                .addToggle(toggle => toggle
                    .setValue(plugin.settings.useFeedFolder ?? true)
                    .onChange(async (v) => {
                        plugin.settings.useFeedFolder = v;
                        await plugin.saveSettings();
                    }));
            applyCardStyle(feedBaseSetting);
            feedBaseSetting.settingEl.style.marginLeft = '40px';
        }

        if (plugin.settings.imageLocation === 'specified') {
            const pathSetting = new Setting(contentEl)
                .setName('Attachment Folder Path')
                .setDesc('Path to a specific folder in your vault.')
                .addText(text => text
                    .setPlaceholder('attachments')
                    .setValue(plugin.settings.imagesFolder ?? '')
                    .onChange(async (v) => {
                        plugin.settings.imagesFolder = v;
                        await plugin.saveSettings();
                    }));
            applyCardStyle(pathSetting);
            pathSetting.settingEl.style.marginLeft = '40px';
        }
    }

    contentEl.createEl('h3', { text: 'Timing' });

    const intervalSetting = new Setting(contentEl)
        .setName('Update Interval')
        .setDesc('Automatically update all feeds at specified intervals.')
        .addText(text => {
            const savedValue = plugin.settings.updateIntervalValue;
            text
                .setPlaceholder('30')
                .setValue(savedValue != null && savedValue !== 30 ? String(savedValue) : '')
                .onChange(async (v) => {
                    plugin.settings.updateIntervalValue = v.trim() === '' ? 30 : Number(v) || 30;
                    await plugin.saveSettings();
                });
        })
        .addDropdown(dropdown => dropdown
            .addOption('minutes', 'Minutes').addOption('hours', 'Hours')
            .addOption('days', 'Days').addOption('months', 'Months')
            .setValue(plugin.settings.updateIntervalUnit ?? 'minutes')
            .onChange(async (v: any) => {
                plugin.settings.updateIntervalUnit = v;
                await plugin.saveSettings();
            }));
    applyCardStyle(intervalSetting);

    // ── Auto Delete toggle
    const autoDeleteEnabled = (plugin.settings.autoCleanupValue ?? 0) > 0;

    const autoDeleteToggle = new Setting(contentEl)
        .setName('Auto Delete Old Articles')
        .setDesc('Automatically delete old articles after a specified time.')
        .addToggle(toggle => toggle
            .setValue(autoDeleteEnabled)
            .onChange(async (v) => {
                plugin.settings.autoCleanupValue = v ? 30 : 0;
                await plugin.saveSettings();
                rerender();
            }));
    applyCardStyle(autoDeleteToggle);

    if (autoDeleteEnabled) {
        const cleanupSetting = new Setting(contentEl)
            .setName('Delete Articles Older Than')
            .setDesc('Articles older than this will be deleted (keeps feed).')
            .addText(text => {
                const savedValue = plugin.settings.autoCleanupValue;
                text
                    .setPlaceholder('30')
                    .setValue(savedValue != null && savedValue !== 30 ? String(savedValue) : '')
                    .onChange(async (v) => {
                        plugin.settings.autoCleanupValue = v.trim() === '' ? 30 : Number(v) || 30;
                        await plugin.saveSettings();
                    });
            })
            .addDropdown(dropdown => dropdown
                .addOption('minutes', 'Minutes').addOption('hours', 'Hours')
                .addOption('days', 'Days').addOption('months', 'Months')
                .setValue(plugin.settings.autoCleanupUnit ?? 'days')
                .onChange(async (v: any) => {
                    plugin.settings.autoCleanupUnit = v;
                    await plugin.saveSettings();
                }));
        applyCardStyle(cleanupSetting);
        cleanupSetting.settingEl.style.marginLeft = '20px';
        cleanupSetting.settingEl.style.borderLeft = '3px solid var(--interactive-accent)';

        const cleanupDateFieldSetting = new Setting(contentEl)
            .setName('Date Criterion')
            .setDesc('Which date field to use when evaluating article age.')
            .addDropdown(dropdown => dropdown
                .addOption('datesaved', '{{datesaved}} — Date the article was saved')
                .addOption('datepub',   '{{datepub}} — Date the article was published')
                .setValue(plugin.settings.autoCleanupDateField ?? 'datesaved')
                .onChange(async (v: any) => {
                    plugin.settings.autoCleanupDateField = v;
                    await plugin.saveSettings();
                }));
        applyCardStyle(cleanupDateFieldSetting);
        cleanupDateFieldSetting.settingEl.style.marginLeft = '20px';
        cleanupDateFieldSetting.settingEl.style.borderLeft = '3px solid var(--interactive-accent)';

        const protectedCheckToggle = new Setting(contentEl)
            .setName('Check Property Before Deleting')
            .setDesc('If enabled, articles will only be deleted if the specified property is checked (true).')
            .addToggle(toggle => toggle
                .setValue(plugin.settings.autoCleanupCheckProperty ?? false)
                .onChange(async (v) => {
                    plugin.settings.autoCleanupCheckProperty = v;
                    await plugin.saveSettings();
                    rerender();
                }));
        applyCardStyle(protectedCheckToggle);
        protectedCheckToggle.settingEl.style.marginLeft = '20px';
        protectedCheckToggle.settingEl.style.borderLeft = '3px solid var(--interactive-accent)';

        if (plugin.settings.autoCleanupCheckProperty) {
            const protectedPropertySetting = new Setting(contentEl)
                .setName('Property Name')
                .setDesc('Name of the frontmatter checkbox property to check.')
                .addText(text => text
                    .setPlaceholder('Mark as Read')
                    .setValue(plugin.settings.autoCleanupCheckPropertyName ?? '')
                    .onChange(async (v) => {
                        plugin.settings.autoCleanupCheckPropertyName = v.trim();
                        await plugin.saveSettings();
                    }));
            applyCardStyle(protectedPropertySetting);
            protectedPropertySetting.settingEl.style.marginLeft = '40px';
            protectedPropertySetting.settingEl.style.borderLeft = '3px solid var(--interactive-accent)';
        }
    }

    contentEl.createEl('h3', { text: 'Developer Tools' });

    const devSetting = new Setting(contentEl)
        .setName('System Actions')
        .addButton(btn => btn.setButtonText('Update All Feeds').setCta().onClick(async () => {
            await plugin.updateAllFeeds();
        }))
        .addButton(btn => btn.setButtonText('Reload Plugin').onClick(async () => {
            await plugin.saveSettings();
            const pluginId = plugin.manifest.id;
            await (app as any).plugins.disablePlugin(pluginId);
            await (app as any).plugins.enablePlugin(pluginId);
            await (app as any).setting.openTabById(pluginId);
        }))
        .addButton(btn => btn.setButtonText('Clean Up Now').setWarning().onClick(async () => {
            const { autoCleanupValue: val, autoCleanupUnit: unit, folderPath: path } = plugin.settings;
            if (val <= 0) { new Notice('Set cleanup value > 0'); return; }
            await cleanupOldFiles(app.vault, path, val, unit, plugin.settings.autoCleanupDateField, plugin.settings);
            new Notice('Cleanup finished.');
        }));
    applyCardStyle(devSetting);
}