import { FeedItem } from '../main';
import { RawFeedItem } from './feedExtractor';

// ─── Public API ───────────────────────────────────────────────────────────────

export function processItem(raw: RawFeedItem): FeedItem {
    const link = processLink(raw.link);

    return {
        title:            processTitle(raw.title),
        link,
        content:          processContent(raw.content, link),
        description:      processDescription(raw.description),
        descriptionShort: processDescriptionShort(raw.description),
        author:           processAuthor(raw.author),
        pubDate:          processPubDate(raw.pubDate),
        imageUrl:         raw.imageUrl || '',
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

const INVALID_FILENAME_CHARS = /[\\/:*?"<>|#\[\]^]/g;

export function decodeHtmlEntities(text: string): string {
    return text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
        .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
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

function processTitle(raw: any): string {
    if (!raw) return '';
    const text = typeof raw === 'string' ? raw : (raw?._ ?? String(raw));
    return decodeHtmlEntities(text.trim());
}

// ─── Link ─────────────────────────────────────────────────────────────────────

function processLink(raw: any): string {
    if (!raw) return '';
    if (typeof raw === 'string') return raw.trim();
    if (Array.isArray(raw)) {
        const alternate = raw.find((l: any) => l?.$?.rel === 'alternate') ?? raw[0];
        return alternate?.$?.href ?? String(alternate).trim();
    }
    if (raw?.$?.href) return raw.$.href.trim();
    return String(raw).trim();
}

// ─── HTML cleaning ────────────────────────────────────────────────────────────

/**
 * Strips HTML down to readable plain text:
 *   1. Remove HTML comments (e.g. Reddit's <!-- SC_OFF --> blocks)
 *   2. Replace block-level tags with newlines so paragraphs are preserved
 *   3. Strip all remaining tags
 *   4. Decode HTML entities
 *   5. Collapse excess whitespace
 */
function cleanHtml(html: string): string {
    return decodeHtmlEntities(
        html
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

function processContent(raw: any, link = ''): string {
    const embed = link ? youtubeEmbed(link) : null;
    if (embed) return embed;
    if (!raw) return '';
    const text = typeof raw === 'string' ? raw : (raw?._ ?? String(raw));
    return cleanHtml(text);
}

// ─── Description ─────────────────────────────────────────────────────────────

function processDescription(raw: any): string {
    if (!raw) return '';
    const text = typeof raw === 'string' ? raw : (raw?._ ?? String(raw));
    return cleanHtml(text);
}

function processDescriptionShort(raw: any): string {
    const full = processDescription(raw);
    if (!full) return '';
    const oneLine = full.replace(/\n+/g, ' ').trim();
    return oneLine.length > 280 ? oneLine.slice(0, 277) + '...' : oneLine;
}

// ─── Author ───────────────────────────────────────────────────────────────────

function processAuthor(raw: any): string {
    if (!raw) return '';
    if (typeof raw === 'string') return raw.trim();
    if (raw?.name) return String(raw.name).trim();
    if (raw?._) return String(raw._).trim();
    return String(raw).trim();
}

// ─── Date ─────────────────────────────────────────────────────────────────────

function processPubDate(raw: any): string {
    if (!raw) return '';
    return String(raw).trim();
}

// ─── Categories ───────────────────────────────────────────────────────────────

function processCategories(raw: any): string[] {
    if (!raw) return [];
    const cats = Array.isArray(raw) ? raw : [raw];
    return cats.map((c: any) => {
        if (typeof c === 'string') return c.trim();
        if (c?.$?.term) return String(c.$.term).trim();
        if (c?._) return String(c._).trim();
        return String(c).trim();
    }).filter(Boolean);
}