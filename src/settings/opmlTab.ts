import { App, Notice, Setting, Modal } from 'obsidian';
import RssPlugin, { FeedConfig, FeedGroup } from '../main';

// ─── Export ───────────────────────────────────────────────────────────────────

function buildOpmlXml(plugin: RssPlugin): string {
    const groups = plugin.settings.groups;
    const feeds  = plugin.settings.feeds.filter(f => !(f.deleted ?? false) && !(f.archived ?? false));

    const escape = (s: string) => s
        .replace(/&/g,  '&amp;')
        .replace(/"/g,  '&quot;')
        .replace(/</g,  '&lt;')
        .replace(/>/g,  '&gt;');

    const feedLine = (feed: FeedConfig) =>
        `        <outline type="rss" text="${escape(feed.name || '')}" title="${escape(feed.name || '')}" xmlUrl="${escape(feed.url || '')}" />`;

    const lines: string[] = [];

    // Grouped feeds
    for (const group of groups) {
        const groupFeeds = feeds.filter(f => f.groupId === group.id);
        if (groupFeeds.length === 0) continue;
        lines.push(`    <outline text="${escape(group.name)}">`);
        groupFeeds.forEach(f => lines.push(feedLine(f)));
        lines.push(`    </outline>`);
    }

    // Loose feeds (no group or orphaned groupId)
    const looseFeeds = feeds.filter(f => !f.groupId || !groups.find(g => g.id === f.groupId));
    looseFeeds.forEach(f => lines.push(`    ${feedLine(f).trim()}`));

    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<opml version="2.0">',
        '  <head>',
        `    <title>RSS Reader Feeds</title>`,
        `    <dateCreated>${new Date().toUTCString()}</dateCreated>`,
        '  </head>',
        '  <body>',
        ...lines,
        '  </body>',
        '</opml>',
    ].join('\n');
}

function downloadOpml(xml: string) {
    const blob = new Blob([xml], { type: 'text/xml' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `rss-feeds-${new Date().toISOString().slice(0, 10)}.opml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ─── Import ───────────────────────────────────────────────────────────────────

export interface ParsedFeed {
    name:     string;
    url:      string;
    category: string | null; // group name from OPML, null if loose
    selected: boolean;
    isDupe:   boolean;
}

function parseOpml(xml: string): ParsedFeed[] {
    const parser  = new DOMParser();
    const doc     = parser.parseFromString(xml, 'text/xml');
    const results: ParsedFeed[] = [];

    const body = doc.querySelector('body');
    if (!body) return results;

    // Top-level outlines
    const topOutlines = Array.from(body.children);

    for (const outline of topOutlines) {
        const xmlUrl = outline.getAttribute('xmlUrl');

        if (xmlUrl) {
            // Loose feed at root level
            results.push({
                name:     outline.getAttribute('text') || outline.getAttribute('title') || 'Untitled',
                url:      xmlUrl,
                category: null,
                selected: true,
                isDupe:   false,
            });
        } else {
            // Category/group — process children
            const categoryName = outline.getAttribute('text') || outline.getAttribute('title') || 'Untitled';
            const children     = Array.from(outline.children);
            for (const child of children) {
                const childUrl = child.getAttribute('xmlUrl');
                if (!childUrl) continue;
                results.push({
                    name:     child.getAttribute('text') || child.getAttribute('title') || 'Untitled',
                    url:      childUrl,
                    category: categoryName,
                    selected: true,
                    isDupe:   false,
                });
            }
        }
    }

    return results;
}

async function importFeeds(
    plugin: RssPlugin,
    parsedFeeds: ParsedFeed[]
): Promise<{ imported: number; skipped: number }> {
    const selectedFeeds = parsedFeeds.filter(f => f.selected && !f.isDupe);
    let imported = 0;
    let skipped  = 0;

    // Collect existing group names to avoid duplicates
    const groupMap = new Map<string, string>(); // categoryName → groupId
    for (const group of plugin.settings.groups) {
        groupMap.set(group.name.toLowerCase(), group.id);
    }

    for (const parsedFeed of selectedFeeds) {
        // Double-check for dupes (in case state changed)
        if (plugin.settings.feeds.some(f => f.url === parsedFeed.url)) {
            skipped++;
            continue;
        }

        let groupId: string | undefined;

        if (parsedFeed.category) {
            const key = parsedFeed.category.toLowerCase();
            if (groupMap.has(key)) {
                groupId = groupMap.get(key);
            } else {
                // Create new group for this category
                const newGroup: FeedGroup = {
                    id:   `group-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    name: parsedFeed.category,
                };
                plugin.settings.groups.push(newGroup);
                groupMap.set(key, newGroup.id);
                groupId = newGroup.id;
            }
        }

        const newFeed: FeedConfig = {
            name:        parsedFeed.name,
            url:         parsedFeed.url,
            folder:      '',
            enabled:     true,
            lastUpdated: Date.now(),
            groupId,
        };

        plugin.settings.feeds.push(newFeed);
        imported++;
    }

    await plugin.saveSettings();
    return { imported, skipped };
}

// ─── Import preview modal ─────────────────────────────────────────────────────

function showImportModal(
    app: App,
    plugin: RssPlugin,
    parsedFeeds: ParsedFeed[],
    onDone: () => void
): void {

    class ImportPreviewModal extends Modal {
        private feeds: ParsedFeed[] = parsedFeeds.map(f => ({ ...f }));

        onOpen() {
            const { contentEl } = this;
            contentEl.empty();

            this.modalEl.style.width    = '720px';
            this.modalEl.style.maxWidth = '95vw';

            contentEl.createEl('h2', { text: 'Import OPML — Select Feeds' });

            // Summary bar
            const summary = contentEl.createDiv();
            summary.style.cssText = 'margin-bottom: 12px; color: var(--text-muted); font-size: 0.9em;';
            const updateSummary = () => {
                const total    = this.feeds.length;
                const dupes    = this.feeds.filter(f => f.isDupe).length;
                const selected = this.feeds.filter(f => f.selected && !f.isDupe).length;
                summary.setText(`${total} feeds found · ${dupes} duplicate(s) · ${selected} selected for import`);
            };

            // Select all toggle
            const selectAllRow = contentEl.createDiv();
            selectAllRow.style.cssText = 'display: flex; align-items: center; gap: 10px; margin-bottom: 16px; padding: 8px 12px; background: var(--background-secondary); border-radius: 8px;';

            const selectAllCheckbox = selectAllRow.createEl('input', { type: 'checkbox' });
            selectAllCheckbox.checked = true;
            selectAllRow.createEl('span', { text: 'Select / deselect all' }).style.cssText = 'font-weight: 600;';

            selectAllCheckbox.onchange = () => {
                const checked = selectAllCheckbox.checked;
                this.feeds.forEach(f => { if (!f.isDupe) f.selected = checked; });
                renderList();
                updateSummary();
            };

            // Feed list container
            const listContainer = contentEl.createDiv();
            listContainer.style.cssText = 'max-height: 420px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px;';

            const renderList = () => {
                listContainer.empty();

                // Group by category
                const categories = new Map<string, ParsedFeed[]>();
                this.feeds.forEach(f => {
                    const key = f.category ?? '__loose__';
                    if (!categories.has(key)) categories.set(key, []);
                    categories.get(key)!.push(f);
                });

                categories.forEach((catFeeds, catKey) => {
                    // Category header
                    if (catKey !== '__loose__') {
                        const catHeader = listContainer.createDiv();
                        catHeader.style.cssText = 'display: flex; align-items: center; gap: 6px; margin-top: 10px; margin-bottom: 2px; color: var(--text-accent); font-size: 0.85em; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;';
                        catHeader.createEl('span', { text: `📁 ${catKey}` });
                    }

                    catFeeds.forEach(feed => {
                        const row = listContainer.createDiv();
                        row.style.cssText = `
                            display: flex; align-items: center; gap: 10px;
                            padding: 8px 12px; border-radius: 8px;
                            background: var(--background-secondary);
                            border: 1px solid var(--background-modifier-border);
                            opacity: ${feed.isDupe ? '0.45' : '1'};
                        `;

                        const checkbox = row.createEl('input', { type: 'checkbox' });
                        checkbox.checked  = feed.selected && !feed.isDupe;
                        checkbox.disabled = feed.isDupe;

                        const info = row.createDiv();
                        info.style.cssText = 'flex: 1; min-width: 0;';

                        const nameEl = info.createEl('div', { text: feed.name });
                        nameEl.style.cssText = 'font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';

                        const urlEl = info.createEl('div', { text: feed.url });
                        urlEl.style.cssText = 'font-size: 0.8em; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-family: var(--font-monospace);';

                        if (feed.isDupe) {
                            const dupeTag = row.createEl('span', { text: 'Already exists' });
                            dupeTag.style.cssText = 'font-size: 0.75em; color: var(--text-muted); background: var(--background-modifier-border); padding: 2px 6px; border-radius: 4px; flex-shrink: 0;';
                        }

                        checkbox.onchange = () => {
                            feed.selected = checkbox.checked;
                            updateSummary();
                            // Sync select-all checkbox state
                            const allSelected = this.feeds.filter(f => !f.isDupe).every(f => f.selected);
                            selectAllCheckbox.checked = allSelected;
                        };
                    });
                });
            };

            // Mark duplicates
            this.feeds.forEach(f => {
                f.isDupe = plugin.settings.feeds.some(existing => existing.url === f.url);
                if (f.isDupe) f.selected = false;
            });

            renderList();
            updateSummary();

            // Footer
            const footer = contentEl.createDiv();
            footer.style.cssText = 'display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px;';

            const cancelBtn = footer.createEl('button', { text: 'Cancel' });
            cancelBtn.onclick = () => this.close();

            const importBtn = footer.createEl('button', { text: 'Import Selected', cls: 'mod-cta' });
            importBtn.onclick = async () => {
                const { imported, skipped } = await importFeeds(plugin, this.feeds);
                new Notice(`Imported ${imported} feed(s). Skipped ${skipped} duplicate(s).`);
                onDone();
                this.close();
            };
        }

        onClose() { this.contentEl.empty(); }
    }

    new ImportPreviewModal(app).open();
}

// ─── Tab renderer ─────────────────────────────────────────────────────────────

export function renderOpmlTab(
    containerEl: HTMLElement,
    app: App,
    plugin: RssPlugin,
    applyCardStyle: (setting: Setting) => void,
    onRefresh: () => void
): void {

    // ── Export ────────────────────────────────────────────────────────────────

    const exportHeader = containerEl.createEl('h4', { text: 'Export' });
    exportHeader.style.cssText = 'margin: 0 0 8px; color: var(--text-muted); font-size: 0.85em; text-transform: uppercase; letter-spacing: 0.05em;';

    const exportSetting = new Setting(containerEl)
        .setName('Export OPML')
        .setDesc('Download all active feeds as an OPML file. Folders become OPML categories.')
        .addButton(btn => btn
            .setButtonText('⬇ Export OPML')
            .setCta()
            .onClick(() => {
                const activeFeeds = plugin.settings.feeds.filter(f => !(f.deleted ?? false) && !(f.archived ?? false));
                if (activeFeeds.length === 0) {
                    new Notice('No active feeds to export.');
                    return;
                }
                const xml = buildOpmlXml(plugin);
                downloadOpml(xml);
                new Notice(`Exported ${activeFeeds.length} feed(s).`);
            }));
    applyCardStyle(exportSetting);

    // ── Import ────────────────────────────────────────────────────────────────

    const importHeader = containerEl.createEl('h4', { text: 'Import' });
    importHeader.style.cssText = 'margin: 24px 0 8px; color: var(--text-muted); font-size: 0.85em; text-transform: uppercase; letter-spacing: 0.05em;';

    const importSetting = new Setting(containerEl)
        .setName('Import OPML')
        .setDesc('Select an OPML file to import feeds. You can review and select which feeds to import before confirming.')
        .addButton(btn => btn
            .setButtonText('⬆ Import OPML')
            .onClick(() => {
                const input = document.createElement('input');
                input.type   = 'file';
                input.accept = '.opml,.xml';
                input.onchange = (e: Event) => {
                    const file = (e.target as HTMLInputElement).files?.[0];
                    if (!file) return;

                    const reader = new FileReader();
                    reader.onload = (ev) => {
                        const xml = ev.target?.result as string;
                        if (!xml) { new Notice('Failed to read file.'); return; }

                        const parsedFeeds = parseOpml(xml);
                        if (parsedFeeds.length === 0) {
                            new Notice('No feeds found in this OPML file.');
                            return;
                        }

                        showImportModal(app, plugin, parsedFeeds, onRefresh);
                    };
                    reader.readAsText(file);
                };
                input.click();
            }));
    applyCardStyle(importSetting);

    // ── Info box ──────────────────────────────────────────────────────────────

    const infoBox = containerEl.createDiv();
    infoBox.style.cssText = `
        margin-top: 24px; padding: 12px 16px;
        background: var(--background-secondary);
        border: 1px solid var(--background-modifier-border);
        border-radius: 8px; font-size: 0.85em;
        color: var(--text-muted); line-height: 1.6;
    `;
    infoBox.createEl('div', { text: '📋 About OPML' }).style.cssText = 'font-weight: 600; color: var(--text-normal); margin-bottom: 6px;';
    infoBox.createEl('div', { text: 'OPML (Outline Processor Markup Language) is the standard format for sharing RSS feed lists between readers.' });
    infoBox.createEl('div', { text: 'On export: folders become OPML categories. On import: OPML categories become folders.' }).style.marginTop = '4px';
}