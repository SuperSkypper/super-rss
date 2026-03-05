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

    // Loose feeds (no group or group not found)
    const groupIds = new Set(groups.map(g => g.id));
    const looseFeeds = feeds.filter(f => !f.groupId || !groupIds.has(f.groupId));
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

function downloadOpml(xml: string): void {
    const blob = new Blob([xml], { type: 'text/xml' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `rss-feeds-${new Date().toISOString().slice(0, 10)}.opml`;
    try {
        document.body.appendChild(a);
        a.click();
    } finally {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}

// ─── Import ───────────────────────────────────────────────────────────────────

export interface ParsedFeed {
    name:     string;
    url:      string;
    category: string | null;
    selected: boolean;
    isDupe:   boolean;
}

function parseOpml(xml: string): ParsedFeed[] {
    const parser  = new DOMParser();
    const doc     = parser.parseFromString(xml, 'text/xml');
    const results: ParsedFeed[] = [];

    // Check for parse errors
    const parseError = doc.querySelector('parsererror');
    if (parseError) return results;

    const body = doc.querySelector('body');
    if (!body) return results;

    for (const outline of Array.from(body.children)) {
        const xmlUrl = outline.getAttribute('xmlUrl');

        if (xmlUrl) {
            results.push({
                name:     outline.getAttribute('text') || outline.getAttribute('title') || 'Untitled',
                url:      xmlUrl,
                category: null,
                selected: true,
                isDupe:   false,
            });
        } else {
            const categoryName = outline.getAttribute('text') || outline.getAttribute('title') || 'Untitled';
            for (const child of Array.from(outline.children)) {
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

    const groupMap = new Map<string, string>();
    for (const group of plugin.settings.groups) {
        groupMap.set(group.name.toLowerCase(), group.id);
    }

    const existingUrls = new Set(plugin.settings.feeds.map(f => f.url));

    for (const parsedFeed of selectedFeeds) {
        if (existingUrls.has(parsedFeed.url)) {
            skipped++;
            continue;
        }

        let groupId: string | undefined;

        if (parsedFeed.category) {
            const key = parsedFeed.category.toLowerCase();
            if (groupMap.has(key)) {
                groupId = groupMap.get(key);
            } else {
                const newGroup: FeedGroup = {
                    id:   crypto.randomUUID(),
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
        existingUrls.add(parsedFeed.url);
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
        private categoryMap: Map<string, ParsedFeed[]> = new Map();

        onOpen() {
            const { contentEl } = this;
            contentEl.empty();

            const existingUrls = new Set(plugin.settings.feeds.map(f => f.url));
            this.feeds.forEach(f => {
                f.isDupe   = existingUrls.has(f.url);
                if (f.isDupe) f.selected = false;
            });

            this.rebuildCategoryMap();

            this.modalEl.style.width    = 'min(720px, 95vw)';
            this.modalEl.style.maxWidth = '95vw';

            contentEl.createEl('h2', { text: 'Import OPML — Select Feeds' });

            const summary = contentEl.createDiv();
            summary.style.cssText = 'margin-bottom: 12px; color: var(--text-muted); font-size: 0.9em;';
            const updateSummary = () => {
                const total    = this.feeds.length;
                const dupes    = this.feeds.filter(f => f.isDupe).length;
                const selected = this.feeds.filter(f => f.selected && !f.isDupe).length;
                summary.setText(`${total} feeds found · ${dupes} duplicate(s) · ${selected} selected for import`);
            };

            const selectAllRow = contentEl.createDiv();
            selectAllRow.style.cssText = 'display: flex; align-items: center; gap: 10px; margin-bottom: 16px; padding: 8px 12px; background: var(--background-secondary); border-radius: 8px;';

            const selectAllCheckbox = selectAllRow.createEl('input', { type: 'checkbox' });
            selectAllCheckbox.checked = true;
            selectAllRow.createEl('span', { text: 'Select / deselect all' }).style.cssText = 'font-weight: 600;';

            selectAllCheckbox.onchange = () => {
                const checked = selectAllCheckbox.checked;
                this.feeds.forEach(f => { if (!f.isDupe) f.selected = checked; });
                listContainer.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach(cb => {
                    if (!cb.disabled) cb.checked = checked;
                });
                updateSummary();
            };

            const listContainer = contentEl.createDiv();
            listContainer.style.cssText = 'max-height: min(420px, 60vh); overflow-y: auto; display: flex; flex-direction: column; gap: 6px;';

            this.categoryMap.forEach((catFeeds, catKey) => {
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
                        const allSelected = this.feeds.filter(f => !f.isDupe).every(f => f.selected);
                        selectAllCheckbox.checked = allSelected;
                    };
                });
            });

            updateSummary();

            const footer = contentEl.createDiv();
            footer.style.cssText = 'display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 10px; margin-top: 20px;';

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

        private rebuildCategoryMap(): void {
            this.categoryMap.clear();
            this.feeds.forEach(f => {
                const key = f.category ?? '__loose__';
                if (!this.categoryMap.has(key)) this.categoryMap.set(key, []);
                this.categoryMap.get(key)!.push(f);
            });
        }

        onClose() { this.contentEl.empty(); }
    }

    new ImportPreviewModal(app).open();
}

// ─── Tab renderer ─────────────────────────────────────────────────────────────

const SECTION_HEADER_CSS = 'margin: 24px 0 8px; color: var(--text-muted); font-size: 0.85em; text-transform: uppercase; letter-spacing: 0.05em;';

export function renderOpmlTab(
    containerEl: HTMLElement,
    app: App,
    plugin: RssPlugin,
    applyCardStyle: (setting: Setting) => void,
    onRefresh: () => void
): void {
    // ── About OPML ────────────────────────────────────────────────────────────
    const aboutHeader = containerEl.createEl('h4', { text: 'About OPML' });
    aboutHeader.style.cssText = SECTION_HEADER_CSS;

    const infoBox = containerEl.createDiv();
    infoBox.style.cssText = `
        padding: 12px 16px;
        background: var(--background-secondary);
        border: 1px solid var(--background-modifier-border);
        border-radius: 8px;
        font-size: 0.85em;
        color: var(--text-muted);
        line-height: 1.6;
        margin-bottom: 4px;
    `;
    infoBox.createEl('div', { text: 'OPML (Outline Processor Markup Language) is the standard format for sharing RSS feed lists between readers.' });
    infoBox.createEl('div', { text: 'On export: folders become OPML categories. On import: OPML categories become folders.' }).style.marginTop = '4px';

    // ── Import ────────────────────────────────────────────────────────────────
    const importHeader = containerEl.createEl('h4', { text: 'Import' });
    importHeader.style.cssText = SECTION_HEADER_CSS;

    const importSetting = new Setting(containerEl)
        .setName('Import OPML')
        .setDesc('Select an OPML file to import feeds. You can review and select which feeds to import before confirming.')
        .addButton(btn => btn
            .setButtonText('Import OPML')
            .onClick(() => {
                const input = document.createElement('input');
                input.type   = 'file';
                input.accept = '.opml,.xml';

                // FIX: Move removeChild INSIDE onchange.
                // Previously, document.body.removeChild(input) was called immediately after
                // input.click(), which caused the iOS Safari file picker to fail — the input
                // element must remain in the DOM until the user selects a file and onchange fires.
                input.onchange = (e: Event) => {
                    // Safe to remove now — user has already interacted with the file picker
                    if (document.body.contains(input)) document.body.removeChild(input);

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

                // Also handle the case where the user cancels the file dialog (no onchange fires)
                // Use a focus event on window as a fallback cleanup
                const onWindowFocus = () => {
                    window.removeEventListener('focus', onWindowFocus);
                    // Give onchange time to fire first, then clean up if still in DOM
                    setTimeout(() => {
                        if (document.body.contains(input)) document.body.removeChild(input);
                    }, 500);
                };
                window.addEventListener('focus', onWindowFocus);

                document.body.appendChild(input);
                input.click();
            }));
    applyCardStyle(importSetting);

    // ── Export ────────────────────────────────────────────────────────────────
    const exportHeader = containerEl.createEl('h4', { text: 'Export' });
    exportHeader.style.cssText = SECTION_HEADER_CSS;

    const exportSetting = new Setting(containerEl)
        .setName('Export OPML')
        .setDesc('Download all active feeds as an OPML file. Folders become OPML categories.')
        .addButton(btn => btn
            .setButtonText('Export OPML')
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
}