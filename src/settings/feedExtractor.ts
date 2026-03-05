import { requestUrl } from 'obsidian';

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
    duration:         string | undefined;
    /** Original parsed entry object, kept for processors that need unlisted fields */
    _raw:             any;
}

export interface RawFeed {
    title:       string;
    /** The actual URL used to fetch the feed (may differ from the user-supplied URL) */
    resolvedUrl: string;
    items:       RawFeedItem[];
}

// ─── Full content result ──────────────────────────────────────────────────────

export interface FullContent {
    /** Cleaned main content as HTML */
    content: string;
}

// ─── XML parsing via DOMParser (browser-native, works on all platforms) ───────

/**
 * Parses an XML string using the browser-native DOMParser.
 * Works on desktop (Electron/Chromium) and mobile (Android/iOS WebView).
 * Replaces xml2js which required Node.js native modules unavailable on mobile.
 */
function parseXml(xmlText: string): Document {
    const parser = new DOMParser();
    const doc    = parser.parseFromString(xmlText, 'text/xml');

    // DOMParser signals errors via a <parsererror> element instead of throwing
    const parseError = doc.querySelector('parseerror');
    if (parseError) {
        throw new Error(`XML parse error: ${parseError.textContent}`);
    }

    return doc;
}

// ─── DOM helpers ──────────────────────────────────────────────────────────────

/** Returns trimmed text content of the first matching element, or ''. */
function getText(parent: Element | Document, selector: string): string {
    return parent.querySelector(selector)?.textContent?.trim() ?? '';
}

/** Collects text content from all matching elements. */
function getAllText(parent: Element, selector: string): string[] {
    return Array.from(parent.querySelectorAll(selector))
        .map(el => el.textContent?.trim() ?? '')
        .filter(Boolean);
}

/**
 * querySelector with namespace-agnostic tag matching.
 * DOMParser preserves namespace prefixes in tag names (e.g. "media:thumbnail"),
 * but querySelector cannot handle colons in selectors.
 *
 * getElementsByTagName('*') may miss namespaced elements in some Chromium/Electron
 * builds, so we use getElementsByTagNameNS('*', localName) which explicitly
 * matches by local name across all namespaces.
 *
 * NOTE: the nodeName fallback matches any `*:localName` suffix — in pathological
 * feeds a different namespace could match. This is acceptable given real-world feeds.
 */
function getByTagName(parent: Element | Document, localName: string): Element | null {
    // Primary: namespace-aware lookup by localName across all namespaces
    const byNs = parent.getElementsByTagNameNS('*', localName);
    if (byNs.length > 0) return byNs[0] ?? null;

    // Fallback: match by prefixed nodeName (e.g. "media:thumbnail")
    const lower = localName.toLowerCase();
    const all   = parent.getElementsByTagName('*');
    for (const el of Array.from(all)) {
        const node = el.nodeName.toLowerCase();
        if (node === lower || node.endsWith(':' + lower)) return el;
    }
    return null;
}

function getAllByTagName(parent: Element, localName: string): Element[] {
    // Primary: namespace-aware lookup
    const byNs = Array.from(parent.getElementsByTagNameNS('*', localName));
    if (byNs.length > 0) return byNs;

    // Fallback: match by prefixed nodeName
    const lower = localName.toLowerCase();
    return Array.from(parent.getElementsByTagName('*')).filter(el => {
        const node = el.nodeName.toLowerCase();
        return node === lower || node.endsWith(':' + lower);
    });
}

// ─── YouTube URL resolution ───────────────────────────────────────────────────

const YT_FEED_BASE = 'https://www.youtube.com/feeds/videos.xml';

function isYoutubeUrl(url: string): boolean {
    return /youtube\.com|youtu\.be/.test(url);
}

/**
 * Given any YouTube channel URL, returns the RSS feed URL.
 * Supports:
 *   - youtube.com/feeds/videos.xml?...  (already a feed, returned as-is)
 *   - youtube.com/channel/UC...         (channel ID extracted directly)
 *   - youtube.com/@handle               (channel ID scraped from HTML first, ?user= as last resort)
 *   - youtube.com/c/name                (channel ID fetched from page HTML)
 *   - youtube.com/user/name             (channel ID fetched from page HTML)
 */
export async function resolveYoutubeFeed(url: string): Promise<string> {
    if (url.includes('feeds/videos.xml')) return url;

    const channelMatch = url.match(/youtube\.com\/channel\/(UC[\w-]+)/);
    if (channelMatch) {
        return `${YT_FEED_BASE}?channel_id=${channelMatch[1]}`;
    }

    const fetchPage = async (pageUrl: string): Promise<string | null> => {
        try {
            const res = await requestUrl({
                url: pageUrl,
                method: 'GET',
                headers: {
                    'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                },
            });
            return extractChannelIdFromHtml(res.text);
        } catch { return null; }
    };

    // NOTE: ?? is lazy — subsequent fetches only run if the previous returns null
    const channelId =
        await fetchPage(url) ??
        await fetchPage(url.replace(/\/?$/, '/videos')) ??
        await fetchPage(url.replace(/\/?$/, '/about'));

    if (channelId) return `${YT_FEED_BASE}?channel_id=${channelId}`;

    const handleMatch = url.match(/youtube\.com\/@([\w.-]+)/);
    if (handleMatch?.[1]) {
        const userFeedUrl = `${YT_FEED_BASE}?user=${handleMatch[1]}`;
        try {
            const probe = await requestUrl({ url: userFeedUrl, method: 'GET' });
            if (probe.status === 200 && probe.text.includes('<feed')) {
                console.warn(`RSS: Fell back to ?user= for ${url} — channel_id scraping failed`);
                return userFeedUrl;
            }
        } catch { /* fall through */ }
    }

    throw new Error(`Could not find YouTube channel ID for: ${url}`);
}

function extractChannelIdFromHtml(html: string): string | null {
    const canonicalMatch = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]+)"/);
    if (canonicalMatch?.[1]) return canonicalMatch[1];

    const patterns = [
        /"externalId"\s*:\s*"(UC[\w-]+)"/,
        /"channelId"\s*:\s*"(UC[\w-]+)"/,
        /"browseId"\s*:\s*"(UC[\w-]+)"/,
        /channel_id=(UC[\w-]+)/,
        /"ucid"\s*:\s*"(UC[\w-]+)"/,
        /\/channel\/(UC[\w-]+)/,
    ];
    for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match?.[1]) return match[1];
    }
    return null;
}

// ─── YouTube duration scraping ────────────────────────────────────────────────

function extractVideoId(url: string): string | null {
    const patterns = [
        /youtube\.com\/watch\?(?:.*&)?v=([\w-]+)/,
        /youtu\.be\/([\w-]+)/,
        /youtube\.com\/shorts\/([\w-]+)/,
        /youtube\.com\/embed\/([\w-]+)/,
    ];
    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match?.[1]) return match[1];
    }
    return null;
}

function secondsToFormatted(totalSeconds: number): string {
    const h  = Math.floor(totalSeconds / 3600);
    const m  = Math.floor((totalSeconds % 3600) / 60);
    const s  = totalSeconds % 60;
    const mm = String(m).padStart(h > 0 ? 2 : 1, '0');
    const ss = String(s).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function parseIsoDuration(iso: string): number {
    const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return 0;
    return (parseInt(match[1] ?? '0') * 3600)
         + (parseInt(match[2] ?? '0') * 60)
         +  parseInt(match[3] ?? '0');
}

export async function fetchYoutubeDuration(videoUrl: string): Promise<string | undefined> {
    const videoId = extractVideoId(videoUrl);
    if (!videoId) return undefined;

    try {
        const response = await requestUrl({
            url: `https://www.youtube.com/watch?v=${videoId}`,
            method: 'GET',
            headers: {
                'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
        });

        const html = response.text;

        // Strategy 1: schema.org JSON-LD
        const ldMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
        if (ldMatch?.[1]) {
            try {
                const ld          = JSON.parse(ldMatch[1]);
                const isoDuration = ld?.duration as string | undefined;
                if (isoDuration?.startsWith('PT')) {
                    const seconds = parseIsoDuration(isoDuration);
                    if (seconds > 0) return secondsToFormatted(seconds);
                }
            } catch { /* fall through */ }
        }

        // Strategy 2: ytInitialPlayerResponse blob
        const lengthMatch = html.match(/"lengthSeconds"\s*:\s*"(\d+)"/);
        if (lengthMatch?.[1]) {
            const seconds = parseInt(lengthMatch[1]);
            if (seconds > 0) return secondsToFormatted(seconds);
        }

        // Strategy 3: approxDurationMs in ytInitialData
        const approxMatch = html.match(/"approxDurationMs"\s*:\s*"(\d+)"/);
        if (approxMatch?.[1]) {
            const seconds = Math.floor(parseInt(approxMatch[1]) / 1000);
            if (seconds > 0) return secondsToFormatted(seconds);
        }

        // Strategy 4: <meta itemprop="duration">
        const metaMatch = html.match(/<meta\s+itemprop="duration"\s+content="(PT[^"]+)"/);
        if (metaMatch?.[1]) {
            const seconds = parseIsoDuration(metaMatch[1]);
            if (seconds > 0) return secondsToFormatted(seconds);
        }

        console.warn(`RSS: Could not extract duration for video "${videoId}" — all strategies failed`);
        return undefined;
    } catch (error) {
        console.warn(`RSS: Could not fetch duration for video "${videoId}":`, error);
        return undefined;
    }
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function fetchAndExtract(rawUrl: string): Promise<RawFeed> {
    try {
        const resolvedUrl = isYoutubeUrl(rawUrl)
            ? await resolveYoutubeFeed(rawUrl)
            : rawUrl;

        const response = await requestUrl({
            url: resolvedUrl,
            method: 'GET',
            headers: {
                'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept':          'application/rss+xml, application/atom+xml, text/xml, application/xml, */*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
            },
        });

        if (response.status !== 200) {
            throw new Error(`Failed to fetch feed: HTTP ${response.status}`);
        }

        const doc = parseXml(response.text);

        // Atom feed
        if (doc.querySelector('feed')) {
            return {
                title:       getText(doc, 'feed > title'),
                resolvedUrl,
                items:       extractAtomItems(doc),
            };
        }

        // RSS feed
        if (doc.querySelector('channel')) {
            return {
                title:       getText(doc, 'channel > title'),
                resolvedUrl,
                items:       extractRssItems(doc),
            };
        }

        throw new Error('Unsupported feed format');
    } catch (error) {
        console.error(`RSS Extractor Error (${rawUrl}):`, error);
        throw error;
    }
}

// ─── Atom ─────────────────────────────────────────────────────────────────────

function extractAtomItems(doc: Document): RawFeedItem[] {
    return Array.from(doc.querySelectorAll('feed > entry')).map((entry): RawFeedItem => {
        // <link rel="alternate" href="..."> or first <link>
        const linkEl = entry.querySelector('link[rel="alternate"]') ?? entry.querySelector('link');
        const link   = linkEl?.getAttribute('href')?.trim() ?? linkEl?.textContent?.trim() ?? '';

        const authorEl = entry.querySelector('author');
        const author   = authorEl
            ? (getText(authorEl, 'name') || (authorEl.textContent?.trim() ?? ''))
            : '';

        const content = getText(entry, 'content') || getText(entry, 'summary');

        // media:thumbnail — check inside media:group first, then root
        const mediaGrp = getByTagName(entry, 'group');
        const thumbEl  = mediaGrp
            ? getByTagName(mediaGrp, 'thumbnail')
            : getByTagName(entry, 'thumbnail');
        const imageUrl = thumbEl?.getAttribute('url') ?? '';

        const categories = getAllByTagName(entry, 'category')
            .map(el => el.getAttribute('term') ?? el.textContent?.trim() ?? '')
            .filter(Boolean);

        // FIX: _raw stores outerHTML string instead of a live DOM Element reference.
        // Storing the Element directly could leak memory or break on serialisation.
        return {
            title:       getText(entry, 'title'),
            link,
            content,
            description: getText(entry, 'summary'),
            author,
            pubDate:     getText(entry, 'published') || getText(entry, 'updated'),
            imageUrl,
            categories,
            duration:    undefined,
            _raw:        entry.outerHTML,
        };
    });
}

// ─── RSS ──────────────────────────────────────────────────────────────────────

function extractRssItems(doc: Document): RawFeedItem[] {
    return Array.from(doc.querySelectorAll('channel > item')).map((item): RawFeedItem => {
        const link        = getText(item, 'link') || (item.querySelector('link')?.getAttribute('href') ?? '');
        const description = getText(item, 'description');

        // content:encoded — DOMParser preserves the colon prefix in localName
        const contentEncoded = getByTagName(item, 'encoded');
        const content        = contentEncoded?.textContent?.trim() ?? description;

        // dc:creator preferred over <author>
        const creator = getByTagName(item, 'creator');
        const author  = creator?.textContent?.trim() ?? getText(item, 'author');

        // FIX: replaced mixed ?? / || chain with consistent || chain.
        // The old code used ?? after a ternary that could return '', which meant
        // the enclosure fallback was never reached when mediaUrl was not an image.
        const thumbEl  = getByTagName(item, 'thumbnail');
        const mediaEl  = getByTagName(item, 'content');
        const mediaUrl = mediaEl?.getAttribute('url') ?? '';
        const encEl    = item.querySelector('enclosure');
        const imageUrl =
            thumbEl?.getAttribute('url') ||
            (/\.(jpg|jpeg|png|webp|gif|svg|avif)/i.test(mediaUrl) ? mediaUrl : '') ||
            (encEl?.getAttribute('type')?.startsWith('image/') ? (encEl.getAttribute('url') ?? '') : '');

        const categories = getAllText(item, 'category');

        // FIX: _raw stores outerHTML string instead of a live DOM Element reference.
        return {
            title:       getText(item, 'title'),
            link,
            content,
            description,
            author,
            pubDate:     getText(item, 'pubDate'),
            imageUrl,
            categories,
            duration:    undefined,
            _raw:        item.outerHTML,
        };
    });
}

// ─── Full content extraction via Defuddle API ─────────────────────────────────

const DEFUDDLE_API = 'https://defuddle.md/';

/**
 * Fetches clean Markdown for a URL using the defuddle.md API.
 *
 * The API runs Defuddle in a real browser environment (with CSS loaded),
 * which produces much cleaner output than running Defuddle locally against
 * raw HTML fetched via requestUrl (no CSS = no mobile-style heuristics).
 *
 * Response format: Markdown with YAML frontmatter.
 * We strip the frontmatter and return only the content body, since title,
 * author, pubDate, and image are already sourced from the RSS feed itself.
 *
 * Falls back to null on any error so callers can gracefully use feed content.
 */
export async function fetchFullContent(url: string): Promise<FullContent | null> {
    try {
        // FIX: strip URL fragment (#section) before appending to API base —
        // fragments are not sent to servers but could produce a malformed path.
        const cleanUrl = url.split('#')[0] ?? url;
        const apiUrl   = DEFUDDLE_API + cleanUrl.replace(/^https?:\/\//, '');

        const response = await requestUrl({
            url:     apiUrl,
            method:  'GET',
            headers: { 'Accept': 'text/plain' },
        });

        if (response.status !== 200) return null;

        const markdown = response.text?.trim() ?? '';
        if (!markdown) return null;

        // Strip YAML frontmatter (--- ... ---) — metadata comes from the feed
        const content = markdown
            .replace(/^---\n[\s\S]*?\n---\n?/, '')
            .trim();

        if (!content) return null;

        return { content };
    } catch (e) {
        console.warn(`RSS: defuddle.md failed for ${url}:`, e);
        return null;
    }
}