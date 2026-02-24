import { App, Setting, Notice } from 'obsidian';
import RssPlugin from '../main';
import { cleanupOldFiles } from '../services/fileSaver';

export function renderGeneralTab(containerEl: HTMLElement, app: App, plugin: RssPlugin, applyCardStyle: (setting: Setting) => void) {
    containerEl.createEl('h3', { text: 'Storage' });

    const folderSetting = new Setting(containerEl)
        .setName('RSS Folder')
        .setDesc('Base folder where articles will be saved.')
        .addText(text => text
            .setPlaceholder('RSS')
            .setValue(plugin.settings.folderPath ?? 'RSS')
            .onChange(async (value) => {
                plugin.settings.folderPath = value;
                await plugin.saveSettings();
            }));
    applyCardStyle(folderSetting);

    containerEl.createEl('h3', { text: 'Attachments & Images' });

    const downloadImgSetting = new Setting(containerEl)
        .setName('Download Images')
        .setDesc('Save article images locally to your vault.')
        .addToggle(toggle => toggle
            .setValue(plugin.settings.downloadImages ?? false)
            .onChange(async (value) => {
                plugin.settings.downloadImages = value;
                await plugin.saveSettings();
                renderGeneralTab(containerEl, app, plugin, applyCardStyle);
            }));
    applyCardStyle(downloadImgSetting);

    if (plugin.settings.downloadImages) {
        const locationSetting = new Setting(containerEl)
            .setName('Default Location For New Images')
            .setDesc('Where newly added images are placed.')
            .addDropdown(dropdown => dropdown
                .addOption('obsidian', 'Use Obsidian settings')
                .addOption('vault', 'Vault folder')
                .addOption('current', 'Same folder as current file')
                .addOption('subfolder', 'In subfolder under current folder')
                .addOption('specified', 'In the folder specified below')
                .setValue(plugin.settings.imageLocation || 'obsidian')
                .onChange(async (value: any) => {
                    plugin.settings.imageLocation = value;
                    await plugin.saveSettings();
                    renderGeneralTab(containerEl, app, plugin, applyCardStyle);
                }));
        applyCardStyle(locationSetting);
        locationSetting.settingEl.style.marginLeft = '20px';
        locationSetting.settingEl.style.borderLeft = '3px solid var(--interactive-accent)';

        if (plugin.settings.imageLocation === 'obsidian') {
            const infoSetting = new Setting(containerEl)
                .setName('Using Obsidian Attachment Settings')
                .setDesc('Go to Settings → Files and links → Default location for new attachments to change this.');
            applyCardStyle(infoSetting);
            infoSetting.settingEl.style.marginLeft = '40px';
            infoSetting.settingEl.style.borderLeft = '3px solid var(--interactive-accent)';
            infoSetting.settingEl.style.opacity = '0.7';
        }

        if (plugin.settings.imageLocation === 'subfolder') {
            const subfolderNameSetting = new Setting(containerEl)
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

            const feedBaseSetting = new Setting(containerEl)
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
            const pathSetting = new Setting(containerEl)
                .setName('Attachment Folder Path')
                .setDesc('Path to a specific folder in your vault.')
                .addText(text => text
                    .setPlaceholder('path/to/folder')
                    .setValue(plugin.settings.imagesFolder ?? '')
                    .onChange(async (v) => {
                        plugin.settings.imagesFolder = v;
                        await plugin.saveSettings();
                    }));
            applyCardStyle(pathSetting);
            pathSetting.settingEl.style.marginLeft = '40px';
        }
    }

    containerEl.createEl('h3', { text: 'Timing' });

    const intervalSetting = new Setting(containerEl)
        .setName('Update Interval')
        .setDesc('Automatically update all feeds at specified intervals')
        .addText(text => text
            .setValue(String(plugin.settings.updateIntervalValue ?? 60))
            .onChange(async (v) => {
                plugin.settings.updateIntervalValue = Number(v) || 60;
                await plugin.saveSettings();
            }))
        .addDropdown(dropdown => dropdown
            .addOption('minutes', 'Minutes').addOption('hours', 'Hours')
            .addOption('days', 'Days').addOption('months', 'Months')
            .setValue(plugin.settings.updateIntervalUnit ?? 'minutes')
            .onChange(async (v: any) => {
                plugin.settings.updateIntervalUnit = v;
                await plugin.saveSettings();
            }));
    applyCardStyle(intervalSetting);

    const cleanupSetting = new Setting(containerEl)
        .setName('Auto Delete Old Articles')
        .setDesc('Automatically delete old articles after specified time (keeps feed)')
        .addText(text => text
            .setValue(String(plugin.settings.autoCleanupValue ?? 0))
            .onChange(async (v) => {
                plugin.settings.autoCleanupValue = Number(v) || 0;
                await plugin.saveSettings();
            }))
        .addDropdown(dropdown => dropdown
            .addOption('minutes', 'Minutes').addOption('hours', 'Hours')
            .addOption('days', 'Days').addOption('months', 'Months')
            .setValue(plugin.settings.autoCleanupUnit ?? 'days')
            .onChange(async (v: any) => {
                plugin.settings.autoCleanupUnit = v;
                await plugin.saveSettings();
            }));
    applyCardStyle(cleanupSetting);

    containerEl.createEl('h3', { text: 'Developer Tools' });

    const devSetting = new Setting(containerEl)
        .setName('System Actions')
        .addButton(btn => btn.setButtonText('Update All Feeds').setCta().onClick(async () => {
            await plugin.updateAllFeeds();
        }))
        .addButton(btn => btn.setButtonText('Reload Plugin').onClick(async () => {
            const pluginId = plugin.manifest.id;
            await (app as any).plugins.disablePlugin(pluginId);
            await (app as any).plugins.enablePlugin(pluginId);
            await (app as any).setting.openTabById(pluginId);
        }))
        .addButton(btn => btn.setButtonText('Clean Up Now').setWarning().onClick(async () => {
            const { autoCleanupValue: val, autoCleanupUnit: unit, folderPath: path } = plugin.settings;
            if (val <= 0) { new Notice('Set cleanup value > 0'); return; }
            await cleanupOldFiles(app.vault, path, val, unit);
            new Notice('Cleanup finished.');
        }));
    applyCardStyle(devSetting);
}