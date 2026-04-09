import { App, normalizePath } from 'obsidian';
import RssPlugin from '../main';
import { FeedDatabase } from './feedDatabase';

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

export async function tagDuplicatesInVault(app: App, plugin: RssPlugin): Promise<number> {
    const { vault, metadataCache } = app;
    const rssFolderPath = normalizePath(plugin.settings.folderPath);

    const files = vault.getMarkdownFiles().filter(f =>
        f.path.startsWith(rssFolderPath + '/')
    );

    // Group files by their link property
    const linkToFiles = new Map<string, typeof files>();

    for (const file of files) {
        let link: string | null = null;

        const fm = metadataCache.getFileCache(file)?.frontmatter;
        if (fm) {
            const key = Object.keys(fm).find(k => k.toLowerCase() === 'link');
            if (key && fm[key]) link = String(fm[key]).trim();
        }

        if (!link) {
            try {
                const raw   = await vault.cachedRead(file);
                const match = raw.match(/^---\n([\s\S]*?)\n---/);
                if (match) {
                    for (const line of (match[1] ?? '').split('\n')) {
                        const ci = line.indexOf(':');
                        if (ci === -1) continue;
                        if (line.slice(0, ci).trim().toLowerCase() === 'link') {
                            link = line.slice(ci + 1).trim().replace(/^["']|["']$/g, '') || null;
                            break;
                        }
                    }
                }
            } catch { /* ignore unreadable files */ }
        }

        if (!link) continue;

        const group = linkToFiles.get(link) ?? [];
        group.push(file);
        linkToFiles.set(link, group);
    }

    let processed = 0;

    for (const [, group] of linkToFiles) {
        if (group.length === 2) {
            // Read frontmatters for both files
            const frontmatters = await Promise.all(group.map(async file => {
                try {
                    const raw = await vault.read(file);
                    const fmMatch = raw.match(/^(---\n)([\s\S]*?)(\n---)/);
                    return fmMatch ? fmMatch[2] ?? '' : '';
                } catch {
                    return '';
                }
            }));

            const bothTagged = frontmatters.every(fm => fm.includes('duplicate'));

            if (bothTagged) {
                // Delete the newer one based on creation time
                const file1 = group[0]!;
                const file2 = group[1]!;
                const ctime1 = file1.stat.ctime;
                const ctime2 = file2.stat.ctime;
                const toDelete = ctime1 > ctime2 ? file1 : file2;
                try {
                    await vault.delete(toDelete);
                    console.log(`RSS: deleted duplicate file "${toDelete.path}"`);
                    processed++;
                } catch (e) {
                    console.error(`RSS: failed to delete duplicate "${toDelete.path}":`, e);
                }
            } else {
                // Tag both if not already tagged
                for (let i = 0; i < group.length; i++) {
                    const file = group[i]!;
                    const fm = frontmatters[i]!;
                    if (fm.includes('duplicate')) continue;

                    try {
                        const raw = await vault.read(file);
                        const fmMatch = raw.match(/^(---\n)([\s\S]*?)(\n---)/);
                        if (!fmMatch) continue;

                        const full = fmMatch[0];
                        const open = fmMatch[1] ?? '';
                        const close = fmMatch[3] ?? '';

                        const newFm = injectDuplicateTag(fm);
                        const newContent = raw.replace(full, `${open}${newFm}${close}`);
                        await vault.modify(file, newContent);
                        processed++;
                    } catch (e) {
                        console.error(`RSS: failed to tag duplicate "${file.path}":`, e);
                    }
                }
            }
        } else if (group.length > 2) {
            // Tag all files in the group
            for (const file of group) {
                try {
                    const raw = await vault.read(file);
                    const fmMatch = raw.match(/^(---\n)([\s\S]*?)(\n---)/);
                    if (!fmMatch) continue;

                    const full = fmMatch[0];
                    const open = fmMatch[1] ?? '';
                    const fm = fmMatch[2] ?? '';
                    const close = fmMatch[3] ?? '';

                    if (fm.includes('duplicate')) continue; // already tagged

                    const newFm = injectDuplicateTag(fm);
                    const newContent = raw.replace(full, `${open}${newFm}${close}`);
                    await vault.modify(file, newContent);
                    processed++;
                } catch (e) {
                    console.error(`RSS: failed to tag duplicate "${file.path}":`, e);
                }
            }
        }
    }

    return processed;
}