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

    // Atualizado para bater exatamente com o templateEngine.ts
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

    // File Name Setting
    const fileNameSetting = new Setting(containerEl)
        .setName('File Name Template')
        .setDesc('How the .md file should be named.')
        .addText(text => text
            .setValue(plugin.settings.fileNameTemplate ?? '{{title}}')
            .onChange(async v => {
                plugin.settings.fileNameTemplate = v;
                await plugin.saveSettings();
            }));
    applyCardStyle(fileNameSetting);

    // Frontmatter Template (Properties)
    addTextAreaSetting(
        containerEl, 
        plugin, 
        applyCardStyle, 
        autoResize, 
        'Properties/Frontmatter', 
        'YAML metadata. The engine will automatically remove quotes for clean checkboxes and links.', 
        'frontmatterTemplate'
    );

    // Body Template
    addTextAreaSetting(
        containerEl, 
        plugin, 
        applyCardStyle, 
        autoResize, 
        'Content Body', 
        'The main structure of the note below the properties.', 
        'template'
    );
}

function addTextAreaSetting(
    containerEl: HTMLElement,
    plugin: RssPlugin,
    applyCardStyle: (setting: Setting) => void,
    autoResize: (el: HTMLTextAreaElement) => void,
    name: string,
    desc: string,
    key: 'frontmatterTemplate' | 'template'
): void {
    const textAreaSetting = new Setting(containerEl)
        .setName(name)
        .setDesc(desc)
        .addTextArea(text => {
            const el = text.inputEl;
            // Usamos casting para PluginSettings para evitar erros de tipagem com o 'key'
            text.setValue((plugin.settings as any)[key] ?? '')
                .onChange(async (v) => {
                    (plugin.settings as any)[key] = v;
                    await plugin.saveSettings();
                    autoResize(el);
                });
            el.style.cssText = 'width: 100%; min-height: 120px; margin-top: 10px; font-family: var(--font-monospace); resize: vertical;';
            // Trigger initial resize
            setTimeout(() => autoResize(el), 0);
        });
    
    // Alinha a descrição e o título para ocupar a linha toda, já que o textarea é largo
    textAreaSetting.settingEl.style.display = 'block';
    applyCardStyle(textAreaSetting);
}