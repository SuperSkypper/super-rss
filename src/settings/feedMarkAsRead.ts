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
 *   - markAsReadLinkProperty     → holds this link (static, never changes)
 *   - markAsReadCheckboxProperty → toggled true/false on each click
 *
 * URI encoding note:
 *   Obsidian automatically decodes URI parameters before passing them
 *   to the protocol handler. Standard encodeURIComponent() is sufficient —
 *   no double-encoding needed. The handler uses params['file'] directly
 *   (already decoded) to find the file by basename.
 */
export function buildMarkAsReadLink(filePath: string, settings: PluginSettings): string {
    if (!settings.markAsReadEnabled) return '';

    const checkboxProp = settings.markAsReadCheckboxProperty?.trim() || 'Read';

    // Extract basename without extension — e.g. "RSS/Feed/My Article.md" → "My Article"
    const basename = filePath.split('/').pop()?.replace(/\.md$/i, '') ?? filePath;

    // Encode + escape % to survive Obsidian's Markdown parsing layer
    const encodedName = encodeURIComponent(basename).replace(/%/g, '%25');
    const encodedProp = encodeURIComponent(checkboxProp).replace(/%/g, '%25');

    return `[✅ Mark as Read](obsidian://${MARK_AS_READ_PROTOCOL}?file=${encodedName}&property=${encodedProp})`;
}

// ─── URI handler ──────────────────────────────────────────────────────────────

/**
 * Handles obsidian://rss-mark-as-read?file=<basename>&property=<name>
 *
 * Finds the file by basename and toggles the checkbox property.
 * Register in main.ts via plugin.registerObsidianProtocolHandler().
 *
 * Note: Obsidian decodes URI parameters once before calling this handler.
 * The builder's double-encoding (encode + escape %) ensures that after
 * Obsidian's single decode, params['file'] contains the original basename.
 * Do NOT decode again here — use params['file'] directly.
 */
export async function handleMarkAsRead(app: App, params: Record<string, string>): Promise<void> {
    const basename    = params['file']     ?? '';
    const propertyKey = params['property'] ?? 'Read';

    if (!basename) {
        new Notice('RSS: Mark as Read — missing file name.');
        return;
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