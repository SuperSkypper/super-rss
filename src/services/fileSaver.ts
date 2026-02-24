import { App, Vault, normalizePath } from 'obsidian';
import { FeedItem, FeedConfig, PluginSettings } from '../main';
import { sanitizeFileName } from './feedProcessor';

// ─── Public API ───────────────────────────────────────────────────────────────

export async function saveFeedItem(
    vault: Vault,
    app: App,
    item: FeedItem,
    folderPath: string,
    settings: PluginSettings,
    feed: FeedConfig
): Promise<boolean> {
    const fileNameTemplate = feed.titleTemplate || settings.fileNameTemplate || '{{title}}';
    const rawFileName = applyTemplate(fileNameTemplate, item, true, false);
    const fileName = sanitizeFileName(rawFileName) + '.md';

    const fullFolderPath = normalizePath(folderPath);
    const filePath = normalizePath(`${fullFolderPath}/${fileName}`);

    await ensureFolder(vault, fullFolderPath);

    // Skip if already saved to avoid duplicates
    if (await vault.adapter.exists(filePath)) return false;

    const frontmatterTemplate = feed.frontmatterTemplate || settings.frontmatterTemplate;
    const processedFrontmatter = applyTemplate(frontmatterTemplate, item, false, true);

    const contentTemplate = feed.contentTemplate || settings.template;
    const processedBody = applyTemplate(contentTemplate, item, false, false);

    const finalContent = `---\n${processedFrontmatter}\n---\n\n${processedBody}`;
    await vault.create(filePath, finalContent);

    return true;
}

export async function cleanupOldFiles(
    vault: Vault,
    folderPath: string,
    value: number,
    unit: 'minutes' | 'hours' | 'days' | 'months'
): Promise<void> {
    const cutoff = Date.now() - toMilliseconds(value, unit);
    const normalizedFolder = normalizePath(folderPath);
    const folder = vault.getAbstractFileByPath(normalizedFolder);

    if (!folder) return;

    const files = vault.getFiles().filter(f => f.path.startsWith(normalizedFolder + '/'));

    for (const file of files) {
        if (file.stat.mtime < cutoff) {
            try {
                await vault.delete(file);
            } catch (e) {
                console.error(`RSS Cleanup: failed to delete ${file.path}`, e);
            }
        }
    }
}

// ─── Template Engine ──────────────────────────────────────────────────────────

// Removes the entire line containing {{image}} if no imageUrl is present
function prepareTemplate(template: string, item: FeedItem): string {
    if (!item.imageUrl) {
        return template.replace(/^.*{{image}}.*\n?/gm, '');
    }
    return template;
}

// Formats image URL for YAML frontmatter
function formatImageForFrontmatter(imageUrl: string): string {
    return imageUrl ?? '';
}

// Formats image URL for markdown content body
function formatImageForContent(imageUrl: string): string {
    if (!imageUrl) return '';
    if (imageUrl.startsWith('[[')) return `!${imageUrl}`;
    return `![](${imageUrl})`;
}

// Escapes double quotes for YAML safety, preserving booleans and numbers as-is
function escapeYamlValue(value: any): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'boolean' || typeof value === 'number') return String(value);
    return String(value).replace(/"/g, '\\"');
}

export function applyTemplate(
    template: string | undefined,
    item: FeedItem,
    isFileName: boolean = false,
    isYaml: boolean = false
): string {
    if (!template) return '';

    let result = prepareTemplate(template, item);

    // Date formatting
    const dateSaved = new Date().toISOString().split('.')[0] ?? '';
    let datePub = '';
    try {
        if (item.pubDate) datePub = new Date(item.pubDate).toISOString().split('.')[0] ?? '';
    } catch {
        datePub = String(item.pubDate ?? '');
    }

    // Categories as #tags
    const tags = Array.isArray(item.categories)
        ? item.categories.map(c => `#${String(c ?? '').replace(/\s+/g, '-')}`).join(' ')
        : '';

    // Image rendering depending on context
    const imageValue = isFileName
        ? String(item.imageUrl ?? '')
        : isYaml
            ? formatImageForFrontmatter(String(item.imageUrl ?? ''))
            : formatImageForContent(String(item.imageUrl ?? ''));

    // Sanitize value depending on context
    const sanitize = (val: any): string => {
        if (val === null || val === undefined) return '';
        if (!isYaml) {
            if (typeof val === 'boolean') return val ? 'true' : 'false';
            if (typeof val === 'number') return String(val);
            return String(val);
        }
        return escapeYamlValue(val);
    };

    // {{content}} needs its own handler to preserve raw HTML/markdown
    const renderContent = (): string => {
        const value = item.content;
        if (value === null || value === undefined) return '';
        if (typeof value === 'boolean') return value ? 'true' : 'false';
        if (typeof value === 'number') return String(value);
        return isYaml ? escapeYamlValue(value) : String(value);
    };

    // First pass: known placeholders
    result = result
        .replace(/{{title}}/g,     sanitize(item.title ?? 'Untitled'))
        .replace(/{{author}}/g,    sanitize(item.author ?? 'Unknown'))
        .replace(/{{link}}/g,      sanitize(item.link ?? ''))
        .replace(/{{snippet}}/g,   sanitize(item.descriptionShort ?? item.description ?? ''))
        .replace(/{{image}}/g,     imageValue)
        .replace(/{{datepub}}/g,   datePub)
        .replace(/{{datesaved}}/g, dateSaved)
        .replace(/{{content}}/g,   renderContent())
        .replace(/{{#tags}}/g,     tags);

    // Second pass: any remaining {{key}} placeholders mapped to FeedItem fields
    result = result.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
        const value = (item as any)[key];
        if (value === null || value === undefined) return '';
        if (typeof value === 'boolean') return value ? 'true' : 'false';
        if (typeof value === 'number') return String(value);
        if (Array.isArray(value)) return value.map(x => escapeYamlValue(x)).join(', ');
        return isYaml ? escapeYamlValue(value) : String(value);
    });

    return result;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Creates subfolders recursively, part by part, to handle nested paths safely
async function ensureFolder(vault: Vault, folderPath: string): Promise<void> {
    if (!folderPath || folderPath === '/' || folderPath === '') return;

    const parts = folderPath.split('/').filter(p => p.length > 0);
    let currentPath = '';

    for (const part of parts) {
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        if (!vault.getAbstractFileByPath(currentPath)) {
            await vault.createFolder(currentPath);
        }
    }
}

function toMilliseconds(value: number, unit: 'minutes' | 'hours' | 'days' | 'months'): number {
    const minute = 60 * 1000;
    const hour   = minute * 60;
    const day    = hour * 24;
    switch (unit) {
        case 'minutes': return value * minute;
        case 'hours':   return value * hour;
        case 'days':    return value * day;
        case 'months':  return value * day * 30;
    }
}