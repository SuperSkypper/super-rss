import { App, normalizePath } from 'obsidian';

// ─── Types ────────────────────────────────────────────────────────────────────

type ArticleStatus =
    | 'saved'               // saved to vault
    | 'deleted_cleanup'     // removed by auto-delete (age filter)
    | 'deleted_skip_shorts' // skipped because it's a YouTube Short
    | 'deleted_skip_live'   // skipped because it's a live stream
    | 'deleted_pre_filter'  // filtered out before saving (pubDate too old)
    | 'deleted_manual';     // user manually deleted the file

interface ArticleEntry {
    link:    string;
    pubDate: string;
    status:  ArticleStatus;
}

export interface FeedDatabase {
    [link: string]: ArticleEntry;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PLUGIN_ID    = 'super-rss';
const DB_FILE_NAME = 'feed-database.json';

// ─── Paths ────────────────────────────────────────────────────────────────────

function getPluginFolderPath(app: App): string {
    return normalizePath(`${app.vault.configDir}/plugins/${PLUGIN_ID}`);
}

function getDbPath(app: App): string {
    return normalizePath(`${getPluginFolderPath(app)}/${DB_FILE_NAME}`);
}

// ─── Ensure folder exists ─────────────────────────────────────────────────────

async function ensurePluginFolder(app: App): Promise<void> {
    const folderPath = getPluginFolderPath(app);
    if (!(await app.vault.adapter.exists(folderPath))) {
        await app.vault.adapter.mkdir(folderPath);
    }
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function loadFeedDatabase(app: App): Promise<FeedDatabase> {
    const path = getDbPath(app);
    try {
        if (await app.vault.adapter.exists(path)) {
            const raw = await app.vault.adapter.read(path);
            return JSON.parse(raw) as FeedDatabase;
        }
    } catch {
        // Corrupted file — start fresh
    }
    return {};
}

// ─── Write ────────────────────────────────────────────────────────────────────

export async function saveFeedDatabase(app: App, db: FeedDatabase): Promise<void> {
    try {
        await ensurePluginFolder(app);
        await app.vault.adapter.write(getDbPath(app), JSON.stringify(db, null, 2));
    } catch (e) {
        console.error('RSS: failed to save feed-database.json', e);
    }
}

// ─── Write helpers ────────────────────────────────────────────────────────────

/**
 * Registers an article as saved.
 * Never overwrites an existing entry — keeps the oldest record.
 */
export function registerSaved(
    db:      FeedDatabase,
    link:    string,
    pubDate: string,
): void {
    if (link in db) return;
    db[link] = { link, pubDate, status: 'saved' };
}

/**
 * Registers an article as deleted/skipped.
 * Never overwrites an existing entry — keeps the oldest record.
 */
export function registerDeleted(
    db:      FeedDatabase,
    link:    string,
    pubDate: string,
    status:  Exclude<ArticleStatus, 'saved'>,
): void {
    if (link in db) return;
    db[link] = { link, pubDate, status };
}

// ─── Status checks ────────────────────────────────────────────────────────────

/**
 * Returns true if the article has already been processed (saved or blocked).
 * The only exception is deleted_skip_shorts when skipShorts has been disabled —
 * callers should handle that case explicitly using getStatus().
 */
export function isKnown(db: FeedDatabase, link: string): boolean {
    return link in db;
}

export function getStatus(db: FeedDatabase, link: string): ArticleStatus | null {
    return db[link]?.status ?? null;
}