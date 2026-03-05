import { Notice } from 'obsidian';
import RssPlugin from '../main';

// ─── Variable definitions ─────────────────────────────────────────────────────
// Single source of truth — imported by editFeed.ts too.

export type VariableScope = 'filename' | 'frontmatter' | 'content';

export interface TemplateVariable {
    tag: string;
    desc: string;
    scopes: VariableScope[];
}

export const SCOPE_ICONS: { scope: VariableScope; icon: string; label: string }[] = [
    { scope: 'filename',    icon: '📄', label: 'File Name' },
    { scope: 'frontmatter', icon: '🗂️', label: 'Frontmatter' },
    { scope: 'content',     icon: '✍️', label: 'Content' },
];

export const TEMPLATE_VARIABLES: TemplateVariable[] = [
    { tag: '{{title}}',     desc: 'Title',             scopes: ['filename', 'frontmatter', 'content'] },
    { tag: '{{author}}',    desc: 'Author',             scopes: ['filename', 'frontmatter', 'content'] },
    { tag: '{{datepub}}',   desc: 'Date Published',     scopes: ['filename', 'frontmatter', 'content'] },
    { tag: '{{datesaved}}', desc: 'Date Saved',         scopes: ['filename', 'frontmatter', 'content'] },
    { tag: '{{snippet}}',   desc: 'Snippet',            scopes: ['filename', 'frontmatter', 'content'] },
    { tag: '{{feedname}}',  desc: 'Feed Name',          scopes: ['filename', 'frontmatter', 'content'] },
    { tag: '{{link}}',      desc: 'Link',               scopes: ['frontmatter', 'content'] },
    { tag: '{{image}}',     desc: 'Image Link',         scopes: ['frontmatter', 'content'] },
    { tag: '{{duration}}',  desc: 'Duration (YouTube)', scopes: ['frontmatter', 'content'] },
    { tag: '{{#tags}}',     desc: 'Tags',               scopes: ['frontmatter', 'content'] },
    { tag: '{{content}}',   desc: 'Full Content',       scopes: ['content'] },
];

export async function copyToClipboard(text: string): Promise<void> {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
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
    el.style.borderColor = active
        ? 'var(--interactive-accent)'
        : 'var(--background-modifier-border)';
}

function createCardWrapper(containerEl: HTMLElement): HTMLDivElement {
    const wrapper = containerEl.createDiv();
    wrapper.style.cssText = CARD_STYLE;
    if (!isTouchDevice()) {
        wrapper.onmouseenter = () => accentBorder(wrapper, true);
        wrapper.onmouseleave = () => accentBorder(wrapper, false);
    }
    return wrapper;
}

function createCardHeader(containerEl: HTMLElement, icon: string, title: string): void {
    const header = containerEl.createDiv();
    header.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:3px;';
    header.createEl('span', { text: icon, attr: { 'aria-hidden': 'true' } });
    const titleEl = header.createEl('span', { text: title });
    titleEl.style.cssText = 'font-weight:600;color:var(--text-normal);font-size:0.9em;';
}

// ─── Main render ──────────────────────────────────────────────────────────────

export function renderGlobalTemplateTab(
    containerEl: HTMLElement,
    plugin: RssPlugin,
    autoResize: (el: HTMLTextAreaElement) => void
): void {
    containerEl.createEl('h3', { text: 'Default Template Configuration' });

    renderVariableReference(containerEl);
    renderFileNameSetting(containerEl, plugin);
    renderTextAreaSetting(containerEl, plugin, autoResize, 'frontmatter');
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
    infoBox.style.cssText = `
        background:var(--background-secondary);
        padding:12px 16px;border-radius:8px;
        margin-bottom:12px;
        border:1px solid var(--background-modifier-border);
        font-size:0.9em;
    `;

    infoBox.createEl('strong', { text: 'Available Variables' });

    const subtitle = infoBox.createEl('p', {
        text: 'Tap any variable to copy. Scope icons show where each variable can be used.',
    });
    subtitle.style.cssText = 'color:var(--text-muted);margin:3px 0 10px;font-size:0.85em;';

    // Legend
    const legend = infoBox.createDiv();
    legend.setAttribute('role', 'list');
    legend.style.cssText = 'display:flex;gap:12px;margin-bottom:8px;flex-wrap:wrap;';

    SCOPE_ICONS.forEach(({ icon, label }) => {
        const item = legend.createDiv({ attr: { role: 'listitem' } });
        item.style.cssText = 'display:flex;align-items:center;gap:5px;color:var(--text-muted);font-size:0.85em;';
        item.createEl('span', { text: icon, attr: { 'aria-hidden': 'true' } });
        item.createEl('span', { text: label });
    });

    // Variable grid
    const grid = infoBox.createDiv();
    grid.setAttribute('role', 'list');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:6px;';

    TEMPLATE_VARIABLES.forEach(v => {
        const row = grid.createDiv({
            attr: {
                role: 'listitem',
                tabindex: '0',
                'aria-label': `Copy variable ${v.tag} — ${v.desc}`,
            },
        });
        row.style.cssText = ROW_STYLE + (isTouchDevice() ? 'min-height:44px;' : '');

        if (!isTouchDevice()) {
            row.onmouseenter = () => accentBorder(row, true);
            row.onmouseleave = () => accentBorder(row, false);
        }

        const scopeIcons = row.createDiv({ attr: { 'aria-hidden': 'true' } });
        scopeIcons.style.cssText = 'display:flex;gap:3px;flex-shrink:0;font-size:0.9em;';

        SCOPE_ICONS.forEach(({ scope, icon }) => {
            const el = scopeIcons.createEl('span', { text: icon });
            el.style.opacity = v.scopes.includes(scope) ? '1' : '0.15';
        });

        const textGroup = row.createDiv();
        textGroup.style.cssText = 'display:flex;flex-direction:column;gap:1px;min-width:0;';

        const descEl = textGroup.createEl('span', { text: v.desc });
        descEl.style.cssText = 'color:var(--text-normal);font-size:0.92em;font-weight:500;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';

        const codeEl = textGroup.createEl('code', { text: v.tag });
        codeEl.style.cssText = 'color:var(--text-accent);font-size:0.78em;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';

        const handleCopy = async () => {
            try {
                await copyToClipboard(v.tag);
                new Notice(`Copied: ${v.tag}`);
            } catch {
                new Notice(`Failed to copy ${v.tag} — please copy it manually.`);
            }
        };

        row.onclick = handleCopy;

        row.onkeydown = (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleCopy();
            }
        };
    });
}

// ─── File name setting ────────────────────────────────────────────────────────

function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): T {
    let timer: ReturnType<typeof setTimeout>;
    return ((...args: any[]) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    }) as T;
}

function renderFileNameSetting(
    containerEl: HTMLElement,
    plugin: RssPlugin
): void {
    const wrapper = createCardWrapper(containerEl);
    createCardHeader(wrapper, '📄', 'File Name');

    const desc = wrapper.createEl('p', {
        text: 'Variables permitted: {{title}}, {{author}}, {{datepub}}, {{datesaved}}, {{snippet}}, {{feedname}}.',
    });
    desc.style.cssText = 'color:var(--text-muted);font-size:0.85em;margin:0 0 8px;';

    const input = wrapper.createEl('input', {
        type: 'text',
        attr: { 'aria-label': 'File name template' },
    });
    input.value = plugin.settings.fileNameTemplate ?? '{{title}}';
    input.style.cssText = `
        width:100%;box-sizing:border-box;
        font-family:var(--font-monospace);
        font-size:0.85em;
    `;

    const saveFileName = debounce(async () => {
        plugin.settings.fileNameTemplate = input.value;
        await plugin.saveSettings();
    }, 400);

    input.oninput = () => saveFileName();
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
        icon:  '🗂️',
        title: 'Properties / Frontmatter',
        desc:  'Supports all variables except {{content}}.',
        key:   'frontmatterTemplate',
    },
    content: {
        icon:  '✍️',
        title: 'Content Body',
        desc:  'All variables are available here.',
        key:   'template',
    },
};

function getTemplateSetting(plugin: RssPlugin, key: TemplateSettingsKey): string {
    return (plugin.settings[key as keyof typeof plugin.settings] as string) ?? '';
}

function setTemplateSetting(plugin: RssPlugin, key: TemplateSettingsKey, value: string): void {
    (plugin.settings[key as keyof typeof plugin.settings] as string) = value;
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
    desc.style.cssText = 'color:var(--text-muted);font-size:0.85em;margin:0 0 8px;';

    const textarea = wrapper.createEl('textarea', {
        attr: { 'aria-label': `${cfg.title} template` },
    });
    textarea.value = getTemplateSetting(plugin, cfg.key);
    textarea.style.cssText = `
        width:100%;box-sizing:border-box;
        font-family:var(--font-monospace);
        font-size:0.85em;
        min-height:120px;
        resize:vertical;overflow:auto;
    `;

    const saveTextarea = debounce(async () => {
        setTemplateSetting(plugin, cfg.key, textarea.value);
        await plugin.saveSettings();
    }, 400);

    textarea.oninput = () => {
        autoResize(textarea);
        saveTextarea();
    };

    requestAnimationFrame(() => autoResize(textarea));
}