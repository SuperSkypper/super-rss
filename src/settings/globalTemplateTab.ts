import { Setting, Notice } from 'obsidian';
import RssPlugin from '../main';

export function renderGlobalTemplateTab(
    containerEl: HTMLElement,
    plugin: RssPlugin,
    applyCardStyle: (setting: Setting) => void,
    autoResize: (el: HTMLTextAreaElement) => void
): void {
    containerEl.createEl('h3', { text: 'Default Template Configuration' });

    const infoBox = containerEl.createDiv();
    infoBox.style.cssText = 'background: var(--background-secondary); padding: 15px; border-radius: 8px; margin-bottom: 20px; border: 1px solid var(--background-modifier-border); font-size: 0.9em;';
    infoBox.createEl('strong', { text: 'Available Template Variables:' });
    infoBox.createEl('p', { text: 'Click on a variable to copy it and paste into the template fields below.' });

    const list = infoBox.createEl('ul');
    list.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr; gap: 5px 20px; padding: 10px 0 0 20px; color: var(--text-muted); list-style: none;';

    const variables = [
        { tag: '{{title}}',     desc: 'Title' },
        { tag: '{{author}}',    desc: 'Author' },
        { tag: '{{link}}',      desc: 'Link' },
        { tag: '{{image}}',     desc: 'Image URL/Link' },
        { tag: '{{datepub}}',   desc: 'Date Published' },
        { tag: '{{datesaved}}', desc: 'Date Saved' },
        { tag: '{{snippet}}',   desc: 'Short Snippet' },
        { tag: '{{content}}',   desc: 'Full Body Content' },
        { tag: '{{#tags}}',     desc: 'Hashtags List' },
        { tag: '{{feedname}}',  desc: 'Feed Name' },
    ];

    variables.forEach(v => {
        const li = list.createEl('li');
        const label = li.createEl('span', { text: `${v.desc}: ` });
        label.style.cssText = 'color: var(--text-normal);';
        const codeEl = li.createEl('code', { text: v.tag });
        codeEl.style.color = 'var(--text-accent)';
        codeEl.style.cursor = 'pointer';
        codeEl.onclick = async () => {
            await navigator.clipboard.writeText(v.tag);
            new Notice(`Copied: ${v.tag}`);
        };
    });

    // --- File Name Setting ---
    const fileNameSetting = new Setting(containerEl)
        .setName('File Name Template')
        .setDesc('How the .md file should be named.')
        .addText(text => {
            text.inputEl.style.cssText = 'width: 100% !important; height: 40px;'; 
            text.setValue(plugin.settings.fileNameTemplate ?? '{{title}}')
                .onChange(async v => {
                    plugin.settings.fileNameTemplate = v;
                    await plugin.saveSettings();
                });
        });

    fileNameSetting.settingEl.style.cssText = 'display: flex; flex-direction: column; align-items: stretch !important;';
    fileNameSetting.infoEl.style.cssText = 'margin-bottom: 8px; width: 100% !important; max-width: 100% !important;';
    
    const fileNameTitle = fileNameSetting.settingEl.querySelector('.setting-item-name') as HTMLElement;
    if (fileNameTitle) fileNameTitle.style.fontSize = '0.85em';

    fileNameSetting.controlEl.style.cssText = 'width: 100% !important; display: block !important;';
    applyCardStyle(fileNameSetting);

    // Frontmatter Template (Properties)
    addTextAreaSetting(containerEl, plugin, applyCardStyle, autoResize, 'Properties/Frontmatter', 'frontmatterTemplate');

    // Body Template
    addTextAreaSetting(containerEl, plugin, applyCardStyle, autoResize, 'Content Body', 'template');
}

function addTextAreaSetting(
    containerEl: HTMLElement,
    plugin: RssPlugin,
    applyCardStyle: (setting: Setting) => void,
    autoResize: (el: HTMLTextAreaElement) => void,
    name: string,
    key: 'frontmatterTemplate' | 'template'
): void {
    const textAreaSetting = new Setting(containerEl)
        .setName(name)
        .addTextArea(text => {
            const el = text.inputEl;
            text.setValue((plugin.settings as any)[key] ?? '')
                .onChange(async (v) => {
                    (plugin.settings as any)[key] = v;
                    await plugin.saveSettings();
                    autoResize(el);
                });
            // Adicionado "overflow: hidden" para remover a barra lateral
            el.style.cssText = 'width: 100% !important; min-height: 150px; font-family: var(--font-monospace); resize: none; box-sizing: border-box !important; overflow: hidden !important;';
            setTimeout(() => autoResize(el), 0);
        });

    textAreaSetting.settingEl.style.cssText = 'display: flex; flex-direction: column; align-items: stretch !important;';
    textAreaSetting.infoEl.style.cssText = 'margin-bottom: 8px; width: 100% !important; max-width: 100% !important;';
    
    const textAreaTitle = textAreaSetting.settingEl.querySelector('.setting-item-name') as HTMLElement;
    if (textAreaTitle) textAreaTitle.style.fontSize = '0.85em';

    textAreaSetting.controlEl.style.cssText = 'width: 100% !important; display: block !important;';
    applyCardStyle(textAreaSetting);
}