import { FeedItem } from '../main';
import { RawFeedItem } from './feedExtractor';
import { extractImageUrl } from './imageHandler';

// ─── Public API ───────────────────────────────────────────────────────────────

export async function processItem(raw: RawFeedItem): Promise<FeedItem> {
    const link = processLink(raw.link);
    return {
        title:            processTitle(raw.title),
        link,
        content:          processContent(raw.content),
        description:      processDescription(raw.description),
        descriptionShort: processDescriptionShort(raw.description),
        author:           processAuthor(raw.author),
        pubDate:          processPubDate(raw.pubDate),
        imageUrl:         await extractImageUrl(raw._raw, link),
        categories:       processCategories(raw.categories),
    };
}

export async function processItems(raws: RawFeedItem[]): Promise<FeedItem[]> {
    return Promise.all(raws.map(processItem));
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
        .replace(/&apos;/g, "'");
}

export function sanitizeFileName(name: string): string {
    return decodeHtmlEntities(name)
        .replace(INVALID_FILENAME_CHARS, ' - ') // replace invalid chars with spaced dash
        .replace(/\s+/g, ' ')                   // collapse multiple spaces
        .replace(/^[\s-]+|[\s-]+$/g, '')        // trim spaces and dashes from edges
        .substring(0, 200);                     // limit length
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

// ─── Content ──────────────────────────────────────────────────────────────────

function processContent(raw: any): string {
    if (!raw) return '';
    if (typeof raw === 'string') return raw;
    if (raw?._) return String(raw._);
    return String(raw);
}

// ─── Description ─────────────────────────────────────────────────────────────

function processDescription(raw: any): string {
    if (!raw) return '';
    if (typeof raw === 'string') return raw;
    if (raw?._) return String(raw._);
    return String(raw);
}

function processDescriptionShort(raw: any): string {
    const full = processDescription(raw);
    if (!full) return '';
    const stripped = full.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    return stripped.length > 280 ? stripped.slice(0, 277) + '...' : stripped;
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