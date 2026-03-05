import { App, Notice } from 'obsidian';
import { PluginSettings } from '../main';

// ─── URI protocol ─────────────────────────────────────────────────────────────

export const MARK_AS_READ_PROTOCOL = 'rss-mark-as-read';

// ─── Link builder ─────────────────────────────────────────────────────────────

/**
 * Builds the markdown link injected as a frontmatter property value.
 *
 * Uses the file basename (no path, no .md) as identifier — same approach as
 * QuickAdd's checkbox toggle script — to avoid vault-routing issues with
 * obsidian:// URIs. The handler finds the file by basename search.
 *
 * The link property and the checkbox property are separate:
 *   - markAsReadLinkProperty    → holds this link (static, never changes)
 *   - markAsReadCheckboxProperty → toggled true/false on each click
 */
export function buildMarkAsReadLink(filePath: string, settings: PluginSettings): string {
    if (!settings.markAsReadEnabled) return '';

    const checkboxProp = settings.markAsReadCheckboxProperty?.trim() || 'Checkbox';

    // Extract basename without extension — e.g. "RSS/Feed/My Article.md" → "My Article"
    const basename    = filePath.split('/').pop()?.replace(/\.md$/i, '') ?? filePath;
    const encodedName = encodeURIComponent(basename);
    const encodedProp = encodeURIComponent(checkboxProp);

    return `[✅ Mark as Read](obsidian://${MARK_AS_READ_PROTOCOL}?file=${encodedName}&property=${encodedProp})`;
}

// ─── URI handler ──────────────────────────────────────────────────────────────

/**
 * Handles obsidian://rss-mark-as-read?file=<basename>&property=<name>
 *
 * Finds the file by basename and toggles the checkbox property.
 * Register in main.ts via plugin.registerObsidianProtocolHandler().
 */
export async function handleMarkAsRead(app: App, params: Record<string, string>): Promise<void> {
    const rawFile     = params['file']     ?? '';
    const propertyKey = params['property'] ? decodeURIComponent(params['property']) : 'Checkbox';

    if (!rawFile) {
        new Notice('RSS: Mark as Read — missing file name.');
        return;
    }

    let basename: string;
    try {
        basename = decodeURIComponent(rawFile);
    } catch {
        basename = rawFile;
    }

    const file = app.vault.getMarkdownFiles().find(f => f.basename === basename);

    if (!file) {
        new Notice(`RSS: Mark as Read — file not found: "${basename}"`);
        return;
    }

    try {
        await app.fileManager.processFrontMatter(file, (fm) => {
            fm[propertyKey] = !fm[propertyKey];
        });
    } catch (e) {
        console.error('RSS: Mark as Read failed:', e);
        new Notice('RSS: Failed to update property.');
    }
}