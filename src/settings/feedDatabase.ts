import { App, normalizePath } from 'obsidian';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AutoArticleStatus = 'skip_shorts' | 'skip_live' | 'old_article';
export type UserArticleStatus = 'mark_as_read';
export type ArticleStatus     = AutoArticleStatus | UserArticleStatus;

export interface ArticleEntry {
    ts:      string;
    pubDate: string;
    status:  ArticleStatus;
    link:    string;
    title:   string;
}

export interface AutoDatabase {
    [link: string]: ArticleEntry;
}

export interface UserDatabase {
    [link: string]: ArticleEntry;
}

export type FeedDatabase = Record<string, ArticleEntry>;
type JsonRecord = Record<string, unknown>;

// ─── Constants ────────────────────────────────────────────────────────────────

const PLUGIN_ID = 'super-rss';
const DB_FILE   = 'feed-database.jsonl';

// ─── Paths ────────────────────────────────────────────────────────────────────

function getPluginFolderPath(app: App): string {
    return normalizePath(`${app.vault.configDir}/plugins/${PLUGIN_ID}`);
}

function getDbPath(app: App): string {
    return normalizePath(`${getPluginFolderPath(app)}/${DB_FILE}`);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function ensurePluginFolder(app: App): Promise<void> {
    const folderPath = getPluginFolderPath(app);
    if (!(await app.vault.adapter.exists(folderPath))) {
        await app.vault.adapter.mkdir(folderPath);
    }
}

async function appendLine(app: App, path: string, line: string): Promise<void> {
    await ensurePluginFolder(app);
    try {
        await app.vault.adapter.append(path, line + '\n');
    } catch (e) {
        console.error('RSS: Failed to append to database file.', e);
        throw new Error(`RSS: failed to append to database file "${path}"`);
    }
}

async function appendEntries(app: App, entries: ArticleEntry[]): Promise<void> {
    if (entries.length === 0) return;
    const path = getDbPath(app);
    for (const entry of entries) {
        await appendLine(app, path, JSON.stringify(entry));
    }
}

/**
 * Normalises any pubDate representation to a 13-digit zero-padded numeric string.
 * Accepts: numeric ms timestamp (number or string), ISO/RFC date strings.
 * Returns '0000000000000' when the value is missing or un-parseable.
 */
export function normalizePubDate(raw: string | number | undefined | null): string {
    if (raw == null || raw === '' || raw === '0' || raw === '0000000000000') {
        return '0000000000000';
    }
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!isNaN(n) && n > 0) return String(n).padStart(13, '0');
    const parsed = Date.parse(String(raw));
    if (!isNaN(parsed) && parsed > 0) return String(parsed).padStart(13, '0');
    return '0000000000000';
}

/**
 * Constructs an entry with keys in the canonical display order:
 *   ts → pubDate → status → link → title
 */
function makeEntry(
    link:    string,
    pubDate: string,
    status:  ArticleStatus,
    title:   string,
    ts?:     string,
): ArticleEntry {
    return { ts: ts ?? String(Date.now()), pubDate: normalizePubDate(pubDate), status, link, title };
}

function isRecord(value: unknown): value is JsonRecord {
    return typeof value === 'object' && value !== null;
}

function isArticleStatus(value: unknown): value is ArticleStatus {
    return value === 'skip_shorts'
        || value === 'skip_live'
        || value === 'old_article'
        || value === 'mark_as_read';
}

function asString(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
    return '';
}

function parseJsonRecord(line: string): JsonRecord | null {
    const parsed: unknown = JSON.parse(line);
    return isRecord(parsed) ? parsed : null;
}

function recordToEntry(record: JsonRecord): ArticleEntry | null {
    const link = asString(record.link);
    const status = record.status;
    if (!link || !isArticleStatus(status)) return null;

    return makeEntry(
        link,
        asString(record.pubDate),
        status,
        asString(record.title),
        asString(record.ts) || undefined,
    );
}

function sameEntry(a: ArticleEntry | undefined, b: ArticleEntry | undefined): boolean {
    if (!a || !b) return false;
    return a.link === b.link && a.pubDate === b.pubDate && a.status === b.status;
}

// ─── One-time migration ───────────────────────────────────────────────────────

/**
 * Runs at startup if the database contains legacy 'cleared' tombstone entries
 * or entries with the old key order. Rewrites the file with:
 *   - All 'cleared' entries removed
 *   - Keys normalised to: ts, pubDate, status, link, title
 *   - Duplicate links deduplicated (latest entry wins)
 */
export async function migrateAndPurgeDatabase(app: App): Promise<void> {
    const path = getDbPath(app);
    if (!(await app.vault.adapter.exists(path))) return;

    const raw = await app.vault.adapter.read(path);
    const lines = raw.split('\n').filter(l => l.trim().length > 0);

    // Detect any condition that requires a rewrite:
    //   • 'cleared' tombstones to remove
    //   • ts stored as a JSON number instead of string (e.g. "ts":1776...)
    //   • empty or non-numeric pubDate (e.g. RFC/ISO date strings from RSS)
    //   • empty or zero ts strings
    //   • missing title field
    const needsMigration = lines.some(l => {
        if (l.includes('"cleared"'))    return true;
        if (/"ts":\s*\d/.test(l))       return true;  // ts is a number
        if (!l.includes('"title"'))     return true;  // missing title field
        try {
            const e = parseJsonRecord(l);
            if (!e) return true;
            const pubDate = asString(e.pubDate);
            const ts = asString(e.ts);
            if (!pubDate || !/^\d+$/.test(pubDate)) return true; // non-numeric pubDate
            if (!ts      || !/^\d+$/.test(ts))      return true; // non-numeric ts
        } catch { return true; }
        return false;
    });
    if (!needsMigration) return;

    console.debug('RSS: Migrating database to new format...');

    // Latest entry for each link wins (JSONL is append-only, last = most recent)
    const latestMap = new Map<string, JsonRecord>();
    for (const line of lines) {
        try {
            const entry = parseJsonRecord(line);
            if (!entry) continue;
            const link = asString(entry.link);
            if (!link || entry.status === 'cleared') continue;
            latestMap.set(link, entry);
        } catch {
            console.warn('RSS Migration: skipping corrupted line.');
        }
    }

    const migrated: string[] = [];
    for (const [link, entry] of latestMap) {
        const rawTs = asString(entry.ts) || '0000000000000';
        const status = isArticleStatus(entry.status) ? entry.status : 'old_article';

        // makeEntry calls normalizePubDate internally, handling any date format
        const normalized = makeEntry(
            link,
            asString(entry.pubDate),  // normalizePubDate will handle conversion
            status,
            asString(entry.title),
            rawTs.padStart(13, '0'),
        );
        migrated.push(JSON.stringify(normalized));
    }

    await ensurePluginFolder(app);
    await app.vault.adapter.write(
        path,
        migrated.join('\n') + (migrated.length > 0 ? '\n' : ''),
    );
    console.debug(`RSS: Migration complete — ${migrated.length} entries retained.`);
}

// ─── Dev utilities ───────────────────────────────────────────────────────────

/**
 * Rewrites the database file removing all entries with the given status.
 * Returns the number of entries removed.
 */
export async function purgeEntriesByStatus(app: App, status: ArticleStatus): Promise<number> {
    const path = getDbPath(app);
    if (!(await app.vault.adapter.exists(path))) return 0;

    const raw   = await app.vault.adapter.read(path);
    const lines = raw.split('\n').filter(l => l.trim().length > 0);

    let removed = 0;

    // Deduplicate (last entry wins) then filter
    const latestMap = new Map<string, ArticleEntry>();
    for (const line of lines) {
        try {
            const record = parseJsonRecord(line);
            const entry = record ? recordToEntry(record) : null;
            if (entry) latestMap.set(entry.link, entry);
        } catch { /* skip corrupted */ }
    }

    const kept: string[] = [];
    for (const entry of latestMap.values()) {
        if (entry.status === status) {
            removed++;
        } else {
            kept.push(JSON.stringify(entry));
        }
    }

    if (removed === 0) return 0;

    await ensurePluginFolder(app);
    await app.vault.adapter.write(
        path,
        kept.join('\n') + (kept.length > 0 ? '\n' : ''),
    );
    console.debug(`RSS: Purged ${removed} '${status}' entries from database.`);
    return removed;
}

/** @deprecated Use purgeEntriesByStatus(app, 'old_article') instead. */
export function purgeOldArticleEntries(app: App): Promise<number> {
    return purgeEntriesByStatus(app, 'old_article');
}

// ─── Database loading ─────────────────────────────────────────────────────────

async function loadJsonL(app: App, path: string): Promise<FeedDatabase> {
    const db: FeedDatabase = {};
    try {
        if (!(await app.vault.adapter.exists(path))) return db;

        const content = await app.vault.adapter.read(path);
        const lines   = content.split('\n').filter(l => l.trim().length > 0);

        for (const line of lines) {
            try {
                const record = parseJsonRecord(line);
                const entry = record ? recordToEntry(record) : null;
                if (entry) db[entry.link] = entry;
            } catch (e) {
                console.warn('RSS: Skipping corrupted line', e);
            }
        }
    } catch (e) {
        console.error(`RSS: Failed to load ${path}`, e);
    }
    return db;
}

// ─── Public Read API ──────────────────────────────────────────────────────────

export async function loadDatabase(app: App): Promise<FeedDatabase> {
    return loadJsonL(app, getDbPath(app));
}

export async function loadAutoDatabase(app: App): Promise<AutoDatabase> {
    const full = await loadDatabase(app);
    const auto: AutoDatabase = {};
    for (const [k, v] of Object.entries(full)) {
        if (v.status !== 'mark_as_read') auto[k] = v;
    }
    return auto;
}

export async function loadUserDatabase(app: App): Promise<UserDatabase> {
    const full = await loadDatabase(app);
    const user: UserDatabase = {};
    for (const [k, v] of Object.entries(full)) {
        if (v.status === 'mark_as_read') user[k] = v;
    }
    return user;
}

export const loadCombinedDatabase = loadDatabase;
export const loadFeedDatabase     = loadDatabase;

// ─── Public Write API ─────────────────────────────────────────────────────────

/**
 * Appends auto-database entries that are new or changed relative to disk.
 * Bloqueios are permanent — entries are never removed from the file.
 */
export async function saveAutoDatabase(app: App, autoDb: AutoDatabase): Promise<void> {
    const full      = await loadDatabase(app);
    const toAppend: ArticleEntry[] = [];
    const now       = String(Date.now());

    for (const [link, entry] of Object.entries(autoDb)) {
        if (!sameEntry(full[link], entry)) {
            toAppend.push(makeEntry(link, entry.pubDate, entry.status, entry.title ?? '', entry.ts || now));
        }
    }

    await appendEntries(app, toAppend);
}

/**
 * Appends user-database entries that are new or changed relative to disk.
 */
export async function saveUserDatabase(app: App, userDb: UserDatabase): Promise<void> {
    const full      = await loadDatabase(app);
    const toAppend: ArticleEntry[] = [];
    const now       = String(Date.now());

    for (const [link, entry] of Object.entries(userDb)) {
        if (!sameEntry(full[link], entry)) {
            toAppend.push(makeEntry(link, entry.pubDate, entry.status, entry.title ?? '', entry.ts || now));
        }
    }

    await appendEntries(app, toAppend);
}

export const saveFeedDatabase = saveAutoDatabase;

// ─── Register functions (append-only) ─────────────────────────────────────────

export function registerAuto(
    db:      AutoDatabase,
    link:    string,
    pubDate: string,
    status:  AutoArticleStatus,
    title:   string = '',
): void {
    if (link in db) return;
    db[link] = makeEntry(link, pubDate, status, title);
}

export async function registerOldArticle(
    app:            App,
    autoDb:         AutoDatabase,
    userDb:         UserDatabase,
    link:           string,
    pubDate:        string,
    markAsReadMode: boolean,
    title:          string = '',
): Promise<void> {
    if (link in autoDb || link in userDb) return;

    const status: ArticleStatus = markAsReadMode ? 'mark_as_read' : 'old_article';
    const entry = makeEntry(link, pubDate, status, title);

    if (markAsReadMode) userDb[link] = entry;
    else autoDb[link] = entry;

    await appendLine(app, getDbPath(app), JSON.stringify(entry));
}

export async function registerManualRead(
    app:     App,
    db:      UserDatabase,
    link:    string,
    pubDate: string,
    title:   string = '',
): Promise<void> {
    if (link in db) return;

    const entry = makeEntry(link, pubDate, 'mark_as_read', title);
    db[link] = entry;
    await appendLine(app, getDbPath(app), JSON.stringify(entry));
}

// ─── Status checks ────────────────────────────────────────────────────────────

export function isKnown(db: FeedDatabase, link: string): boolean {
    return link in db;
}

export function getStatus(db: FeedDatabase, link: string): ArticleStatus | null {
    return db[link]?.status ?? null;
}
