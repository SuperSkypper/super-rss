import { App, normalizePath, TFile } from 'obsidian';
import RssPlugin from '../main';
import { FeedDatabase, loadAutoDatabase, loadUserDatabase, registerOldArticle } from './feedDatabase';
import { FileMeta, discardVaultFile, readPubDateFromFrontmatter, resolveLinkFromFile } from './feedDelete';

// ─── Constants ────────────────────────────────────────────────────────────────

const DUPLICATE_TAG = 'duplicate';

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns true if the link is already known in the DB (any status).
 * Any DB entry for a link (skip_shorts, skip_live, old_article, mark_as_read)
 * means it has been seen before — vault file existence is the source of truth
 * for whether it is currently saved.
 */
export function isDuplicate(db: FeedDatabase, link: string): boolean {
    return link in db;
}

// ─── Tag injection ────────────────────────────────────────────────────────────

/**
 * Injects #duplicate into a frontmatter string.
 * Handles inline tags: [a, b], block tags:
 *   - a
 *   - b
 * single-value tags: tags: foo
 * and no tags at all.
 */
export function injectDuplicateTag(frontmatter: string): string {
    if (frontmatter.includes(DUPLICATE_TAG)) return frontmatter;

    const inlineMatch = frontmatter.match(/^(tags\s*:\s*\[)([^\]]*?)(\])/m);
    if (inlineMatch) {
        const existing = inlineMatch[2]?.trim() ?? '';
        const newTags  = existing ? `${existing}, ${DUPLICATE_TAG}` : DUPLICATE_TAG;
        return frontmatter.replace(inlineMatch[0], `${inlineMatch[1]}${newTags}${inlineMatch[3]}`);
    }

    const blockMatch = frontmatter.match(/^(tags\s*:[ \t]*\n(?:[ \t]+-[ \t]+\S.*\n?)*)/m);
    if (blockMatch) {
        return frontmatter.replace(blockMatch[0], `${blockMatch[0]}  - ${DUPLICATE_TAG}\n`);
    }

    const singleMatch = frontmatter.match(/^(tags\s*:\s*)(\S+.*)$/m);
    if (singleMatch) {
        return frontmatter.replace(
            singleMatch[0],
            `tags:\n  - ${(singleMatch[2] ?? '').trim()}\n  - ${DUPLICATE_TAG}`
        );
    }

    return `${frontmatter.trimEnd()}\ntags:\n  - ${DUPLICATE_TAG}`;
}

// ─── Tag duplicates in vault ──────────────────────────────────────────────────

export async function tagDuplicatesInVault(app: App, plugin: RssPlugin, fileCache?: FileMeta[]): Promise<number> {
    const { vault } = app;
    const rssFolderPath = normalizePath(plugin.settings.folderPath);
    const [autoDb, userDb] = await Promise.all([
        loadAutoDatabase(app),
        loadUserDatabase(app),
    ]);

    const linkToFiles = new Map<string, TFile[]>();

    if (fileCache) {
        for (const meta of fileCache) {
            if (meta.deleted || !meta.link) continue;
            if (!meta.file.path.startsWith(rssFolderPath + '/')) continue;

            const group = linkToFiles.get(meta.link) ?? [];
            group.push(meta.file);
            linkToFiles.set(meta.link, group);
        }
    } else {
        const files = vault.getMarkdownFiles().filter(f =>
            f.path.startsWith(rssFolderPath + '/')
        );

        for (const file of files) {
            const link = await resolveLinkFromFile(app, vault, file);
            if (!link) continue;

            const group = linkToFiles.get(link) ?? [];
            group.push(file);
            linkToFiles.set(link, group);
        }
    }

    let processed = 0;

    for (const [link, group] of linkToFiles) {
        if (group.length > 1) {
            // Sort files by creation time, ascending (oldest first)
            group.sort((a, b) => a.stat.ctime - b.stat.ctime);

            // Keep the oldest file (index 0), delete all others
            const duplicates = group.slice(1);

            for (const file of duplicates) {
                try {
                    const cachedMeta = fileCache?.find(m => m.file === file);
                    const pubDate = cachedMeta?.pubDate ?? await readPubDateFromFrontmatter(app, vault, file);
                    await discardVaultFile(app, file, plugin.settings);
                    await registerOldArticle(
                        app,
                        autoDb,
                        userDb,
                        link,
                        String(pubDate ?? file.stat.ctime),
                        plugin.settings.markAsReadEnabled,
                        file.basename,
                    );
                    console.debug(`RSS: deleted duplicate file "${file.path}"`);
                    processed++;

                    if (fileCache) {
                        const meta = cachedMeta ?? fileCache.find(m => m.file === file);
                        if (meta) meta.deleted = true;
                    }
                } catch (e) {
                    console.error(`RSS: failed to delete duplicate "${file.path}":`, e);
                }
            }
        }
    }

    return processed;
}
