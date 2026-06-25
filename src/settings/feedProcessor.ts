import { FeedItem } from '../main';
import { RawFeedItem } from './feedExtractor';

type RawTextValue = string | { _?: string } | undefined;
type RawLinkValue = RawFeedItem['link'];
type RawAuthorValue = RawFeedItem['author'];
type RawCategoryValue = NonNullable<RawFeedItem['categories']>[number];

interface LinkAttributes {
    href?: string;
    rel?: string;
}

interface LinkObject {
    $?: LinkAttributes;
}

interface CategoryObject {
    $?: {
        term?: string;
    };
    _?: string;
}

function hasTextValue(value: unknown): value is { _?: string } {
    return typeof value === 'object' && value !== null && '_' in value;
}

function hasLinkAttributes(value: unknown): value is LinkObject {
    return typeof value === 'object' && value !== null && '$' in value;
}

function getLinkHref(value: unknown): string {
    if (!hasLinkAttributes(value)) return '';
    return typeof value.$?.href === 'string' ? value.$.href : '';
}

function hasCategoryShape(value: unknown): value is CategoryObject {
    return typeof value === 'object' && value !== null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function processItem(raw: RawFeedItem): FeedItem {
    const link    = processLink(raw.link);
    const content = processContent(raw.content, link);

    // Inject the hero image at the top of the content when present and not
    // already referenced inside the content body (avoids duplicates).
    // Skip for YouTube links — the content already contains the video embed,
    // so the thumbnail would be redundant.
    const imageUrl  = raw.imageUrl || '';
    const isYoutube = /youtube\.com|youtu\.be/i.test(link);
    const heroEmbed = imageUrl && !isYoutube && !content.includes(imageUrl)
        ? `![](${imageUrl})\n\n`
        : '';

    return {
        title:            processTitle(raw.title),
        link,
        content:          heroEmbed + content,
        description:      processDescription(raw.description),
        descriptionShort: processDescriptionShort(raw.description),
        author:           processAuthor(raw.author),
        pubDate:          processPubDate(raw.pubDate),
        imageUrl,
        categories:       processCategories(raw.categories),
        duration:         raw.duration,
    };
}

/**
 * Processes and deduplicates feed items before returning them.
 * Deduplication is done on the raw level (by normalized link) to avoid
 * fetching/processing items that will be discarded anyway.
 */
export function processItems(raws: RawFeedItem[]): FeedItem[] {
    const uniqueRaws = deduplicateRaws(raws);
    return uniqueRaws.map(raw => processItem(raw));
}

// ─── Deduplication ────────────────────────────────────────────────────────────

/**
 * Filters out duplicate raw items before processing.
 * Keyed by the raw link string — consistent with the key used in articleStateDb
 * in feedSaver.ts (item.link). Keeps the first occurrence.
 */
function deduplicateRaws(raws: RawFeedItem[]): RawFeedItem[] {
    const seen = new Set<string>();
    const unique: RawFeedItem[] = [];

    for (const raw of raws) {
        const key = processLink(raw.link);

        if (!key) {
            unique.push(raw);
            continue;
        }

        if (seen.has(key)) {
            continue;
        }

        seen.add(key);
        unique.push(raw);
    }

    return unique;
}

// ─── Title ────────────────────────────────────────────────────────────────────

const INVALID_FILENAME_CHARS = /[\\/:*?"<>|#[\]^]/g;

export function decodeHtmlEntities(text: string): string {
    return text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#(\d+);/g, (_match: string, code: string) => String.fromCharCode(Number(code)))
        .replace(/&#x([0-9a-fA-F]+);/g, (_match: string, code: string) => String.fromCharCode(parseInt(code, 16)))
        .replace(/&apos;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&[a-z]+;/gi, '');
}

export function sanitizeFileName(name: string): string {
    return decodeHtmlEntities(name)
        .replace(INVALID_FILENAME_CHARS, ' - ')
        .replace(/\s+/g, ' ')
        .replace(/^[\s-]+|[\s-]+$/g, '')
        .substring(0, 200);
}

function processTitle(raw: RawTextValue): string {
    if (!raw) return '';
    const text = typeof raw === 'string' ? raw : (raw._ ?? '');
    return decodeHtmlEntities(text.trim());
}

// ─── Link ─────────────────────────────────────────────────────────────────────

function processLink(raw: RawLinkValue): string {
    if (!raw) return '';
    if (typeof raw === 'string') return raw.trim();
    if (Array.isArray(raw)) {
        const alternate = raw.find(link => link.$?.rel === 'alternate') ?? raw[0];
        return getLinkHref(alternate);
    }
    const href = getLinkHref(raw);
    if (href) return href.trim();
    return '';
}

// ─── HTML cleaning ────────────────────────────────────────────────────────────

/**
 * Strips HTML down to readable plain text:
 *   1. Remove HTML comments (e.g. Reddit's <!-- SC_OFF --> blocks)
 *   2. Convert <img> tags to Markdown syntax so images are preserved
 *   3. Replace block-level tags with newlines so paragraphs are preserved
 *   4. Strip all remaining tags
 *   5. Decode HTML entities
 *   6. Collapse excess whitespace
 *
 * Exported so callers outside this module (e.g. feedUpdate.ts) can clean
 * HTML returned by Defuddle when the Markdown conversion was not applied.
 */
export function cleanHtml(html: string): string {
    // Extract alt before src so the regex can capture both attributes in any order
    const withImages = html.replace(
        /<img(?=[^>]*\bsrc=["']([^"']+)["'])(?=[^>]*)?(?:.*?\balt=["']([^"']*)["'])?[^>]*>/gi,
        (match, src, alt = '') => `\n![${alt}](${src})\n`
    );

    return decodeHtmlEntities(
        withImages
            .replace(/<!--[\s\S]*?-->/g, '')
            .replace(/<\/?(p|br|div|blockquote|li|h[1-6]|tr)[^>]*>/gi, '\n')
            .replace(/<[^>]+>/g, '')
    )
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]+/g, ' ')
        .trim();
}

// ─── Content ──────────────────────────────────────────────────────────────────

function youtubeEmbed(link: string): string | null {
    const match = link.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
    return match ? `![](https://www.youtube.com/watch?v=${match[1]})` : null;
}

function processContent(raw: RawTextValue, link = ''): string {
    const embed = link ? youtubeEmbed(link) : null;

    if (!raw) return embed ?? '';

    const text = typeof raw === 'string' ? raw : (raw._ ?? '');

    const cleaned = cleanHtml(text);

    // Prepend the YouTube embed so it appears at the top of the saved note.
    return embed ? `${embed}\n\n${cleaned}` : cleaned;
}

// ─── Description ─────────────────────────────────────────────────────────────

function processDescription(raw: RawTextValue): string {
    if (!raw) return '';
    const text = typeof raw === 'string' ? raw : (raw._ ?? '');
    return cleanHtml(text);
}

function processDescriptionShort(raw: RawTextValue): string {
    const full = processDescription(raw);
    if (!full) return '';
    const oneLine = full.replace(/\n+/g, ' ').trim();
    return oneLine.length > 280 ? oneLine.slice(0, 277) + '...' : oneLine;
}

// ─── Author ───────────────────────────────────────────────────────────────────

function processAuthor(raw: RawAuthorValue): string {
    if (!raw) return '';
    if (typeof raw === 'string') return raw.trim();
    if (raw.name) return raw.name.trim();
    if (raw._) return raw._.trim();
    return '';
}

// ─── Date ─────────────────────────────────────────────────────────────────────

function processPubDate(raw: string | undefined): string {
    if (!raw) return '';
    return raw.trim();
}

// ─── Categories ───────────────────────────────────────────────────────────────

function processCategories(raw: RawFeedItem['categories']): string[] {
    if (!raw) return [];
    const cats = Array.isArray(raw) ? raw : [raw];
    return cats.map((c: RawCategoryValue) => {
        if (typeof c === 'string') return c.trim();
        if (hasCategoryShape(c) && c.$?.term) return c.$.term.trim();
        if (hasTextValue(c) && c._) return c._.trim();
        return '';
    }).filter(Boolean);
}
