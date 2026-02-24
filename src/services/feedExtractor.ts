import { requestUrl } from 'obsidian';
import * as xml2js from 'xml2js';

// ─── Raw types (no transformation applied) ───────────────────────────────────

export interface RawFeedItem {
    title:            any;
    link:             any;
    content:          any;
    description:      any;
    author:           any;
    pubDate:          any;
    imageUrl:         any;
    categories:       any;
    /** Original parsed entry object, kept for processors that need unlisted fields */
    _raw:             any;
}

export interface RawFeed {
    title: any;
    items: RawFeedItem[];
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function fetchAndExtract(url: string): Promise<RawFeed> {
    try {
        const response = await requestUrl({
            url,
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Obsidian RSS)',
                'Accept': 'application/rss+xml, application/atom+xml, text/xml, application/xml',
            },
        });

        const parser = new xml2js.Parser({
            explicitArray: false,
            trim: true,
            tagNameProcessors: [xml2js.processors.stripPrefix],
        });

        const result: any = await parser.parseStringPromise(response.text);

        if (result?.feed) {
            return {
                title: result.feed.title,
                items: extractAtomItems(result.feed),
            };
        }

        if (result?.rss?.channel) {
            return {
                title: result.rss.channel.title,
                items: extractRssItems(result.rss.channel),
            };
        }

        throw new Error('Unsupported feed format');
    } catch (error) {
        console.error(`RSS Extractor Error (${url}):`, error);
        throw error;
    }
}

// ─── Atom ─────────────────────────────────────────────────────────────────────

function extractAtomItems(feed: any): RawFeedItem[] {
    const entries = normalizeToArray(feed?.entry);

    return entries.map((entry: any): RawFeedItem => ({
        title:       entry?.title,
        link:        entry?.link,
        content:     entry?.content,
        description: entry?.summary,
        author:      entry?.author,
        pubDate:     entry?.published ?? entry?.updated,
        imageUrl:    entry?.['media:thumbnail'] ?? entry?.['media:content'] ?? undefined,
        categories:  entry?.category,
        _raw:        entry,
    }));
}

// ─── RSS ──────────────────────────────────────────────────────────────────────

function extractRssItems(channel: any): RawFeedItem[] {
    const items = normalizeToArray(channel?.item);

    return items.map((item: any): RawFeedItem => ({
        title:       item?.title,
        link:        item?.link,
        content:     item?.encoded ?? item?.description,
        description: item?.description,
        author:      item?.creator ?? item?.author,
        pubDate:     item?.pubDate,
        imageUrl:    item?.['media:thumbnail'] ?? item?.['media:content'] ?? item?.enclosure,
        categories:  item?.category,
        _raw:        item,
    }));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeToArray(value: any): any[] {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
}