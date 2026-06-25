import { MetadataCache, Notice, setIcon } from 'obsidian';
import RssPlugin, { FrontmatterMode, FrontmatterPropertyTemplate } from '../main';
import { migrateLegacyFrontmatterTemplate } from './frontmatterMigration';

// ─── Variable definitions ─────────────────────────────────────────────────────
// Single source of truth — imported by editFeed.ts too.

export type VariableScope = 'filename' | 'frontmatter' | 'content';

export interface TemplateVariable {
    tag: string;
    scopes: VariableScope[];
}

export const SCOPE_ICONS: { scope: VariableScope; icon: string; label: string }[] = [
    { scope: 'filename', icon: '📄', label: 'File Name' },
    { scope: 'frontmatter', icon: '🗂️', label: 'Frontmatter' },
    { scope: 'content', icon: '✍️', label: 'Content' },
];

export const TEMPLATE_VARIABLES: TemplateVariable[] = [
    { tag: '{{title}}',         scopes: ['filename', 'frontmatter', 'content'] },
    { tag: '{{author}}',        scopes: ['filename', 'frontmatter', 'content'] },
    { tag: '{{datepublished}}', scopes: ['filename', 'frontmatter', 'content'] },
    { tag: '{{datesaved}}',     scopes: ['filename', 'frontmatter', 'content'] },
    { tag: '{{snippet}}',       scopes: ['filename', 'frontmatter', 'content'] },
    { tag: '{{feedname}}',      scopes: ['filename', 'frontmatter', 'content'] },
    { tag: '{{link}}',          scopes: ['frontmatter', 'content'] },
    { tag: '{{image}}',         scopes: ['frontmatter', 'content'] },
    { tag: '{{ytduration}}',    scopes: ['frontmatter', 'content'] },
    { tag: '{{tags}}',          scopes: ['frontmatter', 'content'] },
    { tag: '{{content}}',       scopes: ['content'] },
];

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

interface PropertyInfo {
    name?: string;
    displayName?: string;
}

interface MetadataCacheWithPropertyInfos extends MetadataCache {
    getAllPropertyInfos?: () => Record<string, PropertyInfo>;
}


export async function copyToClipboard(text: string): Promise<void> {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }
    const textArea = document.createElement('textarea');
    textArea.value = text;
    applyCssText(textArea, 'position:fixed;top:-9999px;left:-9999px;opacity:0;');
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const ok = document.execCommand('copy'); // eslint-disable-line @typescript-eslint/no-deprecated
    document.body.removeChild(textArea);
    if (!ok) throw new Error('execCommand copy failed');
}

// ─── Device detection ─────────────────────────────────────────────────────────
// Lazy-evaluated to avoid crashes in non-browser environments.

let _isTouchDevice: boolean | undefined;

function isTouchDevice(): boolean {
    if (_isTouchDevice === undefined) {
        _isTouchDevice = typeof window !== 'undefined'
            && window.matchMedia('(hover: none)').matches;
    }
    return _isTouchDevice;
}

// ─── Shared card helpers ──────────────────────────────────────────────────────

const CARD_STYLE = `
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 8px;
    padding: 10px 14px;
    margin-bottom: 10px;
    transition: border-color 0.2s ease;
`;

function accentBorder(el: HTMLElement, active: boolean): void {
    el.setCssProps({ 'border-color': active
        ? 'var(--interactive-accent)'
        : 'var(--background-modifier-border)' });
}

function createCardWrapper(containerEl: HTMLElement): HTMLDivElement {
    const wrapper = containerEl.createDiv();
    applyCssText(wrapper, CARD_STYLE);
    if (!isTouchDevice()) {
        wrapper.onmouseenter = () => accentBorder(wrapper, true);
        wrapper.onmouseleave = () => accentBorder(wrapper, false);
    }
    return wrapper;
}

function createCardHeader(containerEl: HTMLElement, icon: string, title: string): void {
    const header = containerEl.createDiv();
    applyCssText(header, 'display:flex;align-items:center;gap:6px;margin-bottom:3px;');
    header.createEl('span', { text: icon, attr: { 'aria-hidden': 'true' } });
    const titleEl = header.createEl('span', { text: title });
    applyCssText(titleEl, 'font-weight:600;color:var(--text-normal);font-size:0.9em;');
}

// ─── Main render ──────────────────────────────────────────────────────────────

export function renderGlobalTemplateTab(
    containerEl: HTMLElement,
    plugin: RssPlugin,
    autoResize: (el: HTMLTextAreaElement) => void
): void {
    containerEl.createEl('h3', { text: 'Default template configuration' });

    renderVariableReference(containerEl);
    renderFileNameSetting(containerEl, plugin);
    renderFrontmatterModeSetting(containerEl, plugin, autoResize);
    renderTextAreaSetting(containerEl, plugin, autoResize, 'content');
}

// ─── Variable reference box ───────────────────────────────────────────────────

const ROW_STYLE = `
    display:flex;align-items:center;gap:6px;
    padding:5px 8px;border-radius:6px;cursor:pointer;
    background:var(--background-primary);
    border:1px solid var(--background-modifier-border);
    transition:border-color 0.15s ease;
`;

// FIX: exported so editFeed.ts can import and reuse this box directly.
export function renderVariableReference(containerEl: HTMLElement): void {
    const infoBox = containerEl.createDiv();
    applyCssText(infoBox, `
        background:var(--background-secondary);
        padding:12px 16px;border-radius:8px;
        margin-bottom:12px;
        border:1px solid var(--background-modifier-border);
        font-size:0.9em;
    `);

    infoBox.createEl('strong', { text: 'Available variables' });

    const subtitle = infoBox.createEl('p', {
        text: 'Tap any variable to copy. Scope icons show where each variable can be used.',
    });
    applyCssText(subtitle, 'color:var(--text-muted);margin:3px 0 10px;font-size:0.85em;');

    // Legend
    const legend = infoBox.createDiv();
    legend.setAttribute('role', 'list');
    applyCssText(legend, 'display:flex;gap:12px;margin-bottom:8px;flex-wrap:wrap;');

    SCOPE_ICONS.forEach(({ icon, label }) => {
        const item = legend.createDiv({ attr: { role: 'listitem' } });
        applyCssText(item, 'display:flex;align-items:center;gap:5px;color:var(--text-muted);font-size:0.85em;');
        item.createEl('span', { text: icon, attr: { 'aria-hidden': 'true' } });
        item.createEl('span', { text: label });
    });

    // Variable grid
    const grid = infoBox.createDiv();
    grid.setAttribute('role', 'list');
    applyCssText(grid, 'display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:6px;');

    TEMPLATE_VARIABLES.forEach(v => {
        const row = grid.createDiv({
            attr: {
                role: 'listitem',
                tabindex: '0',
                'aria-label': `Copy variable ${v.tag}`,
            },
        });
        applyCssText(row, ROW_STYLE + (isTouchDevice() ? 'min-height:44px;' : ''));

        if (!isTouchDevice()) {
            row.onmouseenter = () => accentBorder(row, true);
            row.onmouseleave = () => accentBorder(row, false);
        }

        const scopeIcons = row.createDiv({ attr: { 'aria-hidden': 'true' } });
        applyCssText(scopeIcons, 'display:flex;gap:3px;flex-shrink:0;font-size:0.9em;');

        SCOPE_ICONS.forEach(({ scope, icon }) => {
            const el = scopeIcons.createEl('span', { text: icon });
            el.setCssProps({ 'opacity': v.scopes.includes(scope) ? '1' : '0.15' });
        });

        const tagEl = row.createEl('span', { text: v.tag });
        applyCssText(tagEl, 'color:var(--text-accent);font-size:0.92em;font-weight:500;line-height:1.2;white-space:nowrap;');

        const handleCopy = async () => {
            try {
                await copyToClipboard(v.tag);
                new Notice(`Copied: ${v.tag}`);
            } catch {
                new Notice(`Failed to copy ${v.tag} — please copy it manually.`);
            }
        };

        row.onclick = () => {
            void handleCopy();
        };

        row.onkeydown = (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                void handleCopy();
            }
        };
    });
}

// ─── File name setting ────────────────────────────────────────────────────────

function debounce<T extends (...args: unknown[]) => void | Promise<void>>(
    fn: T,
    ms: number
): (...args: Parameters<T>) => void {
    let timer: ReturnType<typeof setTimeout>;
    return ((...args: Parameters<T>) => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            void fn(...args);
        }, ms);
    }) as (...args: Parameters<T>) => void;
}

function renderFileNameSetting(
    containerEl: HTMLElement,
    plugin: RssPlugin
): void {
    const wrapper = createCardWrapper(containerEl);
    createCardHeader(wrapper, '📄', 'File Name');

    const desc = wrapper.createEl('p', {
        text: 'Variables permitted: {{title}}, {{author}}, {{datepublished}}, {{datesaved}}, {{snippet}}, {{feedname}}.',
    });
    applyCssText(desc, 'color:var(--text-muted);font-size:0.85em;margin:0 0 8px;');

    const input = wrapper.createEl('input', {
        type: 'text',
        attr: { 'aria-label': 'File name template' },
    });
    input.value = plugin.settings.fileNameTemplate ?? '{{title}}';
    applyCssText(input, `
        width:100%;box-sizing:border-box;
        font-family:var(--font-monospace);
        font-size:0.85em;
    `);

    const saveFileName = debounce(async () => {
        plugin.settings.fileNameTemplate = input.value;
        await plugin.saveSettings();
    }, 400);

    input.oninput = () => {
        void saveFileName();
    };
}

// ─── Textarea settings ────────────────────────────────────────────────────────

type TextAreaTarget = 'frontmatter' | 'content';

type TemplateSettingsKey = 'frontmatterTemplate' | 'template';

const TEXTAREA_CONFIG: Record<TextAreaTarget, {
    icon: string;
    title: string;
    desc: string;
    key: TemplateSettingsKey;
}> = {
    frontmatter: {
        icon: '🗂️',
        title: 'Properties / Frontmatter',
        desc: 'Supports all variables except {{content}}.',
        key: 'frontmatterTemplate',
    },
    content: {
        icon: '✍️',
        title: 'Content Body',
        desc: 'All variables are available here.',
        key: 'template',
    },
};

function getTemplateSetting(plugin: RssPlugin, key: TemplateSettingsKey): string {
    return (plugin.settings[key as keyof typeof plugin.settings] as string) ?? '';
}

function setTemplateSetting(plugin: RssPlugin, key: TemplateSettingsKey, value: string): void {
    (plugin.settings[key as keyof typeof plugin.settings] as string) = value;
}

function createPropertyId(): string {
    return `prop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getKnownPropertyNames(plugin: RssPlugin): string[] {
    const names = new Map<string, string>();
    const addName = (name: string, overwrite = false) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        const key = trimmed.toLocaleLowerCase();
        if (overwrite || !names.has(key)) names.set(key, trimmed);
    };

    plugin.settings.frontmatterProperties?.forEach(property => {
        addName(property.name, true);
    });

    const cache = plugin.app.metadataCache as MetadataCacheWithPropertyInfos;
    const propertyInfos = cache.getAllPropertyInfos?.();
    if (propertyInfos && typeof propertyInfos === 'object') {
        Object.entries(propertyInfos).forEach(([name, info]) => {
            addName(info?.name ?? info?.displayName ?? name);
        });
    }

    plugin.app.vault.getMarkdownFiles().forEach(file => {
        const frontmatter = plugin.app.metadataCache.getFileCache(file)?.frontmatter;
        if (!frontmatter) return;
        Object.keys(frontmatter)
            .filter(name => name !== 'position')
            .forEach(name => addName(name));
    });

    return [...names.values()].sort((a, b) => new Intl.Collator(undefined, { sensitivity: 'base' }).compare(a, b));
}

function ensureFrontmatterProperties(plugin: RssPlugin): FrontmatterPropertyTemplate[] {
    if (!Array.isArray(plugin.settings.frontmatterProperties)) {
        plugin.settings.frontmatterProperties = [];
    }
    return plugin.settings.frontmatterProperties;
}

function normalizeProperty(property: Partial<FrontmatterPropertyTemplate>): FrontmatterPropertyTemplate {
    return {
        id:    property.id || createPropertyId(),
        name:  property.name ?? '',
        type:  property.type ?? 'text',
        value: property.value ?? '',
    };
}

function renderPropertyTemplateSource(property: FrontmatterPropertyTemplate): string {
    const name = property.name.trim();
    const value = property.value.trim();
    if (!value) return `${name}:`;
    return `${name}: ${property.value}`;
}

function renderPropertiesAsSource(properties: FrontmatterPropertyTemplate[]): string {
    return properties
        .map(normalizeProperty)
        .filter(property => property.name.trim())
        .map(renderPropertyTemplateSource)
        .join('\n');
}

function renderFrontmatterModeSetting(
    containerEl: HTMLElement,
    plugin: RssPlugin,
    autoResize: (el: HTMLTextAreaElement) => void
): void {
    const wrapper = createCardWrapper(containerEl);
    createCardHeader(wrapper, '🗂️', 'Properties / Frontmatter');

    const desc = wrapper.createEl('p', {
        text: 'Add note properties. Supports all variables except {{content}}.',
    });
    applyCssText(desc, 'color:var(--text-muted);font-size:0.85em;margin:0 0 10px;');

    const modeControls = wrapper.createDiv();
    applyCssText(modeControls, 'display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap;');

    const body = wrapper.createDiv();

    const setMode = (mode: FrontmatterMode) => {
        const currentMode = plugin.settings.frontmatterMode;
        if (mode === currentMode) return;

        if (mode === 'properties' && plugin.settings.frontmatterMode === 'source') {
            const migrated = migrateLegacyFrontmatterTemplate(plugin.settings.frontmatterTemplate ?? '');
            if (migrated?.length) {
                plugin.settings.frontmatterProperties = migrated;
            }
        } else if (mode === 'source' && plugin.settings.frontmatterMode === 'properties') {
            plugin.settings.frontmatterTemplate = renderPropertiesAsSource(ensureFrontmatterProperties(plugin));
        }
        plugin.settings.frontmatterMode = mode;
        renderModeButtons();
        renderModeBody();
        void plugin.saveSettings();
    };

    const editBtn = modeControls.createEl('button', { text: 'Edit mode', attr: { type: 'button' } });
    const sourceBtn = modeControls.createEl('button', { text: 'Source mode', attr: { type: 'button' } });

    const buttonBase = 'padding:5px 10px;border-radius:6px;border:1px solid var(--background-modifier-border);cursor:pointer;font-size:0.85em;';
    const renderModeButtons = () => {
        const active = 'background:var(--interactive-accent);color:var(--text-on-accent);border-color:var(--interactive-accent);';
        const inactive = 'background:var(--background-primary);color:var(--text-muted);';
        applyCssText(editBtn, buttonBase + (plugin.settings.frontmatterMode === 'properties' ? active : inactive));
        applyCssText(sourceBtn, buttonBase + (plugin.settings.frontmatterMode === 'source' ? active : inactive));
    };

    const renderModeBody = () => {
        body.empty();
        if (plugin.settings.frontmatterMode === 'source') {
            renderSourceFrontmatter(body, plugin, autoResize);
        } else {
            renderPropertiesEditor(body, plugin);
        }
    };

    editBtn.onclick = () => setMode('properties');
    sourceBtn.onclick = () => setMode('source');

    renderModeButtons();
    renderModeBody();
}

function renderPropertiesEditor(containerEl: HTMLElement, plugin: RssPlugin): void {
    const desc = containerEl.createEl('p', {
        text: 'Choose a name and value.',
    });
    applyCssText(desc, 'color:var(--text-muted);font-size:0.85em;margin:0 0 10px;');

    const list = containerEl.createDiv();
    applyCssText(list, 'display:flex;flex-direction:column;gap:6px;');

    const datalistId = `rss-property-names-${Date.now()}`;
    const datalist = containerEl.createEl('datalist', { attr: { id: datalistId } });
    getKnownPropertyNames(plugin).forEach(name => datalist.createEl('option', { value: name }));

    const save = debounce(async () => {
        await plugin.saveSettings();
    }, 300);

    const rerender = () => {
        list.empty();
        const properties = ensureFrontmatterProperties(plugin);
        properties.forEach((property, index) => {
            const normalized = normalizeProperty(property);
            properties[index] = normalized;
            renderPropertyRow(list, plugin, normalized, index, datalistId, rerender, save);
        });
    };

    const addBtn = containerEl.createEl('button', { text: 'Add property', attr: { type: 'button' } });
    applyCssText(addBtn, `
        margin-top:10px;
        border:1px solid var(--background-modifier-border);
        border-radius:6px;
        background:var(--background-primary);
        color:var(--text-accent);
        font-weight:600;
        cursor:pointer;
        padding:6px 10px;
        width:max-content;
    `);
    addBtn.onclick = () => {
        ensureFrontmatterProperties(plugin).push({
            id: createPropertyId(),
            name: '',
            type: 'text',
            value: '',
        });
        rerender();
        void save();
    };

    rerender();
}

function renderPropertyRow(
    container: HTMLElement,
    plugin: RssPlugin,
    property: FrontmatterPropertyTemplate,
    index: number,
    datalistId: string,
    rerender: () => void,
    save: () => void
): void {
    const row = container.createDiv();
    applyCssText(row, `
        display:grid;
        grid-template-columns:24px minmax(130px, 0.8fr) minmax(180px, 1.5fr) 28px;
        gap:7px;
        align-items:center;
        border-radius:6px;
        border-top:2px solid transparent;
        padding-top:2px;
    `);

    row.ondragstart = event => {
        event.dataTransfer?.setData('text/plain', String(index));
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
        row.setCssProps({ 'opacity': '0.5' });
    };
    row.ondragend = () => {
        row.setCssProps({ 'opacity': '1' });
        row.setCssProps({ 'border-top-color': 'transparent' });
    };
    row.ondragover = event => {
        event.preventDefault();
        row.setCssProps({ 'border-top-color': 'var(--interactive-accent)' });
    };
    row.ondragleave = () => {
        row.setCssProps({ 'border-top-color': 'transparent' });
    };
    row.ondrop = event => {
        event.preventDefault();
        row.setCssProps({ 'border-top-color': 'transparent' });
        const from = Number(event.dataTransfer?.getData('text/plain'));
        if (!Number.isInteger(from) || from === index) return;
        const properties = ensureFrontmatterProperties(plugin);
        const [moved] = properties.splice(from, 1);
        if (!moved) return;
        properties.splice(index, 0, moved);
        rerender();
        void save();
    };

    const drag = row.createEl('button', { attr: { 'aria-label': 'Drag property', type: 'button' } });
    drag.draggable = true;
    applyCssText(drag, 'width:24px;height:28px;padding:0;border:none;background:transparent;color:var(--text-muted);cursor:grab;display:flex;align-items:center;justify-content:center;');
    setIcon(drag, 'grip-vertical');

    const nameInput = row.createEl('input', {
        type: 'text',
        attr: {
            list: datalistId,
            placeholder: 'Property name',
            'aria-label': 'Property name',
        },
    });
    nameInput.value = property.name;
    applyCssText(nameInput, 'width:100%;box-sizing:border-box;font-size:0.85em;');
    nameInput.oninput = () => {
        property.name = nameInput.value;
        void save();
    };

    const valueInput = row.createEl('input', {
        type: 'text',
        attr: {
            placeholder: 'Property value',
            'aria-label': 'Property value',
        },
    });
    valueInput.value = property.value;
    applyCssText(valueInput, 'width:100%;box-sizing:border-box;font-family:var(--font-monospace);font-size:0.85em;');
    valueInput.oninput = () => {
        property.value = valueInput.value;
        void save();
    };

    const deleteBtn = row.createEl('button', { attr: { 'aria-label': 'Delete property', type: 'button' } });
    applyCssText(deleteBtn, 'width:28px;height:28px;padding:0;border:none;background:transparent;color:var(--text-muted);display:flex;align-items:center;justify-content:center;cursor:pointer;');
    setIcon(deleteBtn, 'trash-2');
    deleteBtn.onclick = () => {
        ensureFrontmatterProperties(plugin).splice(index, 1);
        rerender();
        void save();
    };
}

function renderSourceFrontmatter(
    container: HTMLElement,
    plugin: RssPlugin,
    autoResize: (el: HTMLTextAreaElement) => void
): void {
    const textarea = container.createEl('textarea', {
        attr: { 'aria-label': 'Source frontmatter template' },
    });
    textarea.value = plugin.settings.frontmatterTemplate ?? '';
    applyCssText(textarea, `
        width:100%;box-sizing:border-box;
        font-family:var(--font-monospace);
        font-size:0.85em;
        min-height:150px;
        resize:vertical;overflow:auto;
    `);

    const saveTextarea = debounce(async () => {
        plugin.settings.frontmatterTemplate = textarea.value;
        await plugin.saveSettings();
    }, 400);

    textarea.oninput = () => {
        autoResize(textarea);
        void saveTextarea();
    };

    requestAnimationFrame(() => autoResize(textarea));
}

function renderTextAreaSetting(
    containerEl: HTMLElement,
    plugin: RssPlugin,
    autoResize: (el: HTMLTextAreaElement) => void,
    target: TextAreaTarget
): void {
    const cfg = TEXTAREA_CONFIG[target];
    const wrapper = createCardWrapper(containerEl);
    createCardHeader(wrapper, cfg.icon, cfg.title);

    const desc = wrapper.createEl('p', { text: cfg.desc });
    applyCssText(desc, 'color:var(--text-muted);font-size:0.85em;margin:0 0 8px;');

    const textarea = wrapper.createEl('textarea', {
        attr: { 'aria-label': `${cfg.title} template` },
    });
    textarea.value = getTemplateSetting(plugin, cfg.key);
    applyCssText(textarea, `
        width:100%;box-sizing:border-box;
        font-family:var(--font-monospace);
        font-size:0.85em;
        min-height:120px;
        resize:vertical;overflow:auto;
    `);

    const saveTextarea = debounce(async () => {
        setTemplateSetting(plugin, cfg.key, textarea.value);
        await plugin.saveSettings();
    }, 400);

    textarea.oninput = () => {
        autoResize(textarea);
        void saveTextarea();
    };

    requestAnimationFrame(() => autoResize(textarea));
}
