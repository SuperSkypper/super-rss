import { App, Notice, normalizePath, TFile } from 'obsidian';
import { PluginSettings } from '../main';

// ─── URI protocol ─────────────────────────────────────────────────────────────

export const MARK_AS_READ_PROTOCOL = 'rss-mark-as-read';

// ─── Link builder ─────────────────────────────────────────────────────────────

/**
 * Builds the markdown link injected as a frontmatter property value.
 *
 * Uses the normalized vault path as identifier to avoid changing the wrong file
 * when two notes share the same basename in different feed folders.
 *
 * The link property and the checkbox property are separate:
 *   - markAsReadLinkProperty     → holds this link (static, never changes)
 *   - markAsReadCheckboxProperty → toggled true/false on each click
 *
 * URI encoding note:
 *   Obsidian automatically decodes URI parameters before passing them
 *   to the protocol handler. Standard encodeURIComponent() is sufficient.
 */
export function buildMarkAsReadLink(filePath: string, settings: PluginSettings): string {
    if (!settings.markAsReadEnabled) return '';

    const checkboxProp = settings.markAsReadCheckboxProperty?.trim() || 'Read';

    const encodedPath = encodeURIComponent(normalizePath(filePath));
    const encodedProp = encodeURIComponent(checkboxProp);

    return `[✅ Mark as read](obsidian://${MARK_AS_READ_PROTOCOL}?file=${encodedPath}&property=${encodedProp})`;
}

// ─── URI handler ──────────────────────────────────────────────────────────────

/**
 * Handles obsidian://rss-mark-as-read?file=<vault-path>&property=<name>
 *
 * Finds the file by exact vault path and toggles the checkbox property.
 * Register in main.ts via plugin.registerObsidianProtocolHandler().
 *
 * Note: Obsidian decodes URI parameters once before calling this handler.
 * Using standard encodeURIComponent ensures that after Obsidian's single decode,
 * params['file'] contains the correct decoded vault path.
 * Do NOT decode again here — use params['file'] directly.
 */
export async function handleMarkAsRead(app: App, params: Record<string, string>): Promise<void> {
    const fileParam   = params['file']     ?? '';
    const propertyKey = params['property'] ?? 'Read';

    if (!fileParam) {
        new Notice('RSS: mark as read — missing file path.');
        return;
    }

    const normalizedPath = normalizePath(fileParam);
    let file = app.vault.getAbstractFileByPath(normalizedPath);

    // Backward compatibility for links created before path-based Mark as Read.
    if (!(file instanceof TFile)) {
        file = app.vault.getMarkdownFiles().find(f => f.basename === fileParam) ?? null;
    }

    if (!(file instanceof TFile)) {
        new Notice(`RSS: mark as read — file not found: "${fileParam}"`);
        return;
    }

    try {
        await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
            fm[propertyKey] = true;
        });
    } catch (e) {
        console.error('RSS: mark as read failed:', e);
        new Notice('RSS: failed to update property.');
    }
}
