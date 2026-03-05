import { FeedDatabase } from './feedDatabase';

// ─── Constants ────────────────────────────────────────────────────────────────

const DUPLICATE_TAG = 'duplicate';

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns true if the link already exists in the DB as 'saved'.
 * Date is irrelevant — same link = duplicate.
 */
export function isDuplicate(db: FeedDatabase, link: string): boolean {
    return db[link]?.status === 'saved';
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