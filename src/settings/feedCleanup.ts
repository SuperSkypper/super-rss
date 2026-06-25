import { App, Notice, normalizePath } from 'obsidian';
import RssPlugin from '../main';
import { FileMeta, readPubDateFromFrontmatter, resolveLinkFromFile, runAutoCleanup } from './feedDelete';
import { loadAutoDatabase } from './feedDatabase';
import { tagDuplicatesInVault } from './feedDuplicate';

export async function runCleanupAndDedup(app: App, plugin: RssPlugin): Promise<void> {
    const enabledFeeds = plugin.settings.feeds.filter(
        f => f.enabled && f.url && !f.deleted
    );

    if (enabledFeeds.length === 0) {
        new Notice('No active feeds to clean up.');
        return;
    }

    plugin.setStatusBarText('Cleaning articles...');

    try {
        const db = await loadAutoDatabase(app);
        let totalDeleted = 0;

        const rssFolderPath = normalizePath(plugin.settings.folderPath);
        const allMdFiles = app.vault.getMarkdownFiles().filter(f => f.path.startsWith(rssFolderPath + '/'));
        const totalFiles = allMdFiles.length;
        const fileCache: FileMeta[] = [];

        for (let i = 0; i < totalFiles; i++) {
            const f = allMdFiles[i]!;
            plugin.setStatusBarText(`Saving: ${i + 1}/${totalFiles}`, `Processing ${f.path}`);
            const link = await resolveLinkFromFile(app, app.vault, f);
            const pubDate = await readPubDateFromFrontmatter(app, app.vault, f);
            fileCache.push({ file: f, link, pubDate, deleted: false });
        }

        totalDeleted += await runAutoCleanup(app, plugin, db, fileCache);

        try {
            plugin.setStatusBarText('Checking duplicates...');
            totalDeleted += await tagDuplicatesInVault(app, plugin, fileCache);
        } catch (e) {
            console.error('RSS: tagDuplicatesInVault failed:', e);
        }

        if (totalDeleted === 0) {
            new Notice('No old or duplicate articles to delete.', 4000);
        } else {
            new Notice(`${totalDeleted} article${totalDeleted !== 1 ? 's' : ''} deleted.`, 4000);
        }
    } finally {
        plugin.clearStatusBar();
    }
}
