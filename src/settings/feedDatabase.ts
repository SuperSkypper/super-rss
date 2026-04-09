import { App, normalizePath } from 'obsidian';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Statuses stored in feed-database-auto.json (plugin-driven, automatic):
 *   skip_shorts  — skipped because it is a YouTube Short
 *   skip_live    — skipped because it is a live stream
 *   old_article  — filtered out or deleted by the age-cleanup pipeline
 *
 * Statuses stored in feed-database-user.json (user-driven):
 *   mark_as_read — article was explicitly read/deleted by the user,
 *                  OR old_article promoted here when markAsRead is enabled
 *                  (so the user retains control over re-importing it later).
 */
export type AutoArticleStatus = 'skip_shorts' | 'skip_live' | 'old_article';
export type UserArticleStatus = 'mark_as_read';
export type ArticleStatus     = AutoArticleStatus | UserArticleStatus;

export interface ArticleEntry {
    link:    string;
    pubDate: string;
    status:  ArticleStatus;
    ts:      number;
}

export interface AutoDatabase {
    [link: string]: ArticleEntry;
}

export interface UserDatabase {
    [link: string]: ArticleEntry;
}

/**
 * Combined view of auto + user databases.
 * Auto DB entries take precedence — they carry more specific skip reasons.
 */
export type FeedDatabase = AutoDatabase;

// ─── Constants ────────────────────────────────────────────────────────────────

const PLUGIN_ID    = 'super-rss';
const AUTO_DB_FILE = 'feed-database-auto.json';
const USER_DB_FILE = 'feed-database-user.json';

// ─── Paths ────────────────────────────────────────────────────────────────────

function getPluginFolderPath(app: App): string {
    return normalizePath(`${app.vault.configDir}/plugins/${PLUGIN_ID}`);
}

function getAutoDbPath(app: App): string {
    return normalizePath(`${getPluginFolderPath(app)}/${AUTO_DB_FILE}`);
}

function getUserDbPath(app: App): string {
    return normalizePath(`${getPluginFolderPath(app)}/${USER_DB_FILE}`);
}

// ─── Ensure folder exists ─────────────────────────────────────────────────────

async function ensurePluginFolder(app: App): Promise<void> {
    const folderPath = getPluginFolderPath(app);
    if (!(await app.vault.adapter.exists(folderPath))) {
        await app.vault.adapter.mkdir(folderPath);
    }
}

// ─── Low-level read ───────────────────────────────────────────────────────────

async function readJsonFile<T extends object>(app: App, path: string): Promise<T> {
    try {
        if (await app.vault.adapter.exists(path)) {
            const raw = await app.vault.adapter.read(path);
            return JSON.parse(raw) as T;
        }
    } catch {
        // Corrupted or missing — return empty object
    }
    return {} as T;
}

// ─── Status mapping from legacy to new ───────────────────────────────────────

/**
 * Maps old ArticleStatus values (from feed-database.json,
 * feed-database-auto.json, and feed-database-user.json) to the new ones.
 *
 * Rules:
 *   deleted_skip_shorts → skip_shorts  (auto)
 *   deleted_skip_live   → skip_live    (auto)
 *   deleted_cleanup     → old_article  (auto)
 *   deleted_pre_filter  → old_article  (auto)
 *   deleted_manual      → mark_as_read (user)
 *   saved               → dropped (vault file existence is the source of truth)
 *
 * Returns null for statuses that should be dropped.
 */
function mapLegacyStatus(status: string): { newStatus: ArticleStatus; target: 'auto' | 'user' } | null {
    switch (status) {
        case 'deleted_skip_shorts': return { newStatus: 'skip_shorts',  target: 'auto' };
        case 'deleted_skip_live':   return { newStatus: 'skip_live',    target: 'auto' };
        case 'deleted_cleanup':     return { newStatus: 'old_article',  target: 'auto' };
        case 'deleted_pre_filter':  return { newStatus: 'old_article',  target: 'auto' };
        case 'deleted_manual':      return { newStatus: 'mark_as_read', target: 'user' };
        case 'saved':               return null; // vault is the source of truth
        // Already-migrated statuses — keep as-is in correct target
        case 'skip_shorts':         return { newStatus: 'skip_shorts',  target: 'auto' };
        case 'skip_live':           return { newStatus: 'skip_live',    target: 'auto' };
        case 'old_article':         return { newStatus: 'old_article',  target: 'auto' };
        case 'mark_as_read':        return { newStatus: 'mark_as_read', target: 'user' };
        default:                    return null;
    }
}

// ─── Migration ────────────────────────────────────────────────────────────────

/**
 * In-memory flag so migration only performs I/O once per plugin session.
 */
let _migrationDone = false;

/**
 * Migrates legacy database files to the new status schema.
 *
 * Sources migrated (in order):
 *   1. feed-database.json       (original monolithic DB)
 *   2. feed-database-auto.json  (old auto DB, may contain old status strings)
 *   3. feed-database-user.json  (old user DB, may contain old status strings)
 *
 * For each source file that exists:
 *   - A .bak copy is written alongside it (e.g. feed-database-auto.json.bak).
 *   - All entries are re-mapped to the new status values and target DB.
 *   - The source file is replaced with the migrated, canonical version.
 *   - Entries already present in the target DB are never overwritten.
 *
 * After migration the two canonical files contain only new-schema entries.
 */
async function migrateAllDatabases(app: App): Promise<void> {
    if (_migrationDone) return;
    _migrationDone = true; // set early so errors don't trigger infinite retries

    await ensurePluginFolder(app);
    const pluginFolder = getPluginFolderPath(app);

    // Files to migrate, in priority order.
    // Later sources fill gaps left by earlier ones (never overwrite).
    const sources: { file: string; path: string }[] = [
        { file: 'feed-database.json',      path: normalizePath(`${pluginFolder}/feed-database.json`) },
        { file: AUTO_DB_FILE,              path: getAutoDbPath(app) },
        { file: USER_DB_FILE,              path: getUserDbPath(app) },
    ];

    const newAutoDb: AutoDatabase = {};
    const newUserDb: UserDatabase = {};

    for (const source of sources) {
        if (!(await app.vault.adapter.exists(source.path))) continue;

        let raw: Record<string, any> = {};
        try {
            const text = await app.vault.adapter.read(source.path);
            raw = JSON.parse(text);
        } catch {
            console.warn(`RSS migration: could not parse ${source.file}, skipping.`);
            continue;
        }

        // Write .bak before touching the file
        const bakPath = normalizePath(`${source.path}.bak`);
        try {
            await app.vault.adapter.write(bakPath, JSON.stringify(raw, null, 2));
            console.log(`RSS migration: backed up ${source.file} → ${source.file}.bak`);
        } catch (e) {
            console.warn(`RSS migration: could not write backup for ${source.file}`, e);
        }

        let migratedAuto = 0;
        let migratedUser = 0;

        for (const [link, entry] of Object.entries(raw)) {
            if (!entry || !entry.status) continue;

            const mapped = mapLegacyStatus(entry.status as string);
            if (!mapped) continue; // 'saved' or unknown — drop

            const migratedEntry: ArticleEntry = {
                link,
                pubDate: entry.pubDate ?? '',
                status:  mapped.newStatus,
                ts:      entry.ts ?? 0,
            };

            if (mapped.target === 'auto') {
                if (link in newAutoDb) continue; // first-seen wins
                newAutoDb[link] = migratedEntry;
                migratedAuto++;
            } else {
                if (link in newUserDb) continue;
                newUserDb[link] = migratedEntry;
                migratedUser++;
            }
        }

        console.log(`RSS migration: ${source.file} → auto: +${migratedAuto}, user: +${migratedUser}`);
    }

    // Write the canonical migrated files
    try {
        await app.vault.adapter.write(getAutoDbPath(app), JSON.stringify(newAutoDb, null, 2));
        await app.vault.adapter.write(getUserDbPath(app), JSON.stringify(newUserDb, null, 2));
        console.log('RSS migration: complete. New auto entries:', Object.keys(newAutoDb).length,
                    '| New user entries:', Object.keys(newUserDb).length);
    } catch (e) {
        console.error('RSS migration: failed to write migrated databases.', e);
    }
}

/**
 * Returns true if any of the source files contain a legacy status string,
 * meaning a migration pass is needed.
 */
async function needsMigration(app: App): Promise<boolean> {
    const LEGACY_STATUSES = new Set([
        'saved', 'deleted_cleanup', 'deleted_skip_shorts',
        'deleted_skip_live', 'deleted_pre_filter', 'deleted_manual',
    ]);

    const pluginFolder = getPluginFolderPath(app);
    const paths = [
        normalizePath(`${pluginFolder}/feed-database.json`),
        getAutoDbPath(app),
        getUserDbPath(app),
    ];

    for (const p of paths) {
        if (!(await app.vault.adapter.exists(p))) continue;
        try {
            const raw = JSON.parse(await app.vault.adapter.read(p));
            for (const entry of Object.values(raw) as any[]) {
                if (entry?.status && LEGACY_STATUSES.has(entry.status)) return true;
            }
        } catch { /* ignore parse errors */ }
    }

    return false;
}

/**
 * Entry point called by all public read functions.
 * Runs the migration once per session if legacy status strings are detected.
 */
async function ensureMigrated(app: App): Promise<void> {
    if (_migrationDone) return;
    if (await needsMigration(app)) {
        await migrateAllDatabases(app);
    } else {
        _migrationDone = true;
    }
}

// ─── Public read API ──────────────────────────────────────────────────────────

export async function loadAutoDatabase(app: App): Promise<AutoDatabase> {
    await ensureMigrated(app);
    return readJsonFile<AutoDatabase>(app, getAutoDbPath(app));
}

export async function loadUserDatabase(app: App): Promise<UserDatabase> {
    await ensureMigrated(app);
    return readJsonFile<UserDatabase>(app, getUserDbPath(app));
}

/**
 * Loads a combined view of auto + user databases.
 * Auto DB entries take precedence — they carry more specific skip reasons.
 */
export async function loadCombinedDatabase(app: App): Promise<FeedDatabase> {
    await ensureMigrated(app);
    const [autoDb, userDb] = await Promise.all([
        readJsonFile<AutoDatabase>(app, getAutoDbPath(app)),
        readJsonFile<UserDatabase>(app, getUserDbPath(app)),
    ]);
    return { ...userDb, ...autoDb };
}

/** Alias kept for backward compatibility with callers using loadFeedDatabase. */
export const loadFeedDatabase = loadCombinedDatabase;

// ─── Public write API ─────────────────────────────────────────────────────────

export async function saveAutoDatabase(app: App, db: AutoDatabase): Promise<void> {
    try {
        await ensurePluginFolder(app);
        await app.vault.adapter.write(getAutoDbPath(app), JSON.stringify(db, null, 2));
    } catch (e) {
        console.error('RSS: failed to save feed-database-auto.json', e);
    }
}

export async function saveUserDatabase(app: App, db: UserDatabase): Promise<void> {
    try {
        await ensurePluginFolder(app);
        await app.vault.adapter.write(getUserDbPath(app), JSON.stringify(db, null, 2));
    } catch (e) {
        console.error('RSS: failed to save feed-database-user.json', e);
    }
}

/** Alias kept for backward compatibility with callers using saveFeedDatabase. */
export const saveFeedDatabase = saveAutoDatabase;

// ─── Write helpers ────────────────────────────────────────────────────────────

/**
 * Registers an article in the auto DB (plugin-driven, automatic actions).
 * Never overwrites an existing entry.
 *
 * Use for: skip_shorts, skip_live, old_article.
 */
export function registerAuto(
    db:      AutoDatabase,
    link:    string,
    pubDate: string,
    status:  AutoArticleStatus,
): void {
    if (link in db) return;
    db[link] = { link, pubDate, status, ts: Date.now() };
}

/**
 * Registers an old article in the correct database depending on whether the
 * "Mark as Read" feature is enabled.
 *
 * - markAsRead disabled → auto DB as 'old_article'  (plugin-managed)
 * - markAsRead enabled  → user DB as 'mark_as_read' (user retains control)
 *
 * When routing to the user DB the entry is persisted immediately so it is
 * never lost if the process is interrupted.
 */
export async function registerOldArticle(
    app:            App,
    autoDb:         AutoDatabase,
    userDb:         UserDatabase,
    link:           string,
    pubDate:        string,
    markAsReadMode: boolean,
): Promise<void> {
    if (link in autoDb || link in userDb) return;

    if (markAsReadMode) {
        userDb[link] = { link, pubDate, status: 'mark_as_read', ts: Date.now() };
        await saveUserDatabase(app, userDb);
    } else {
        autoDb[link] = { link, pubDate, status: 'old_article', ts: Date.now() };
    }
}

/**
 * Registers a manual read/deletion in the user DB and persists immediately.
 * Called when the user explicitly marks an article as read or deletes it.
 * Never overwrites an existing entry.
 */
export async function registerManualRead(
    app:     App,
    db:      UserDatabase,
    link:    string,
    pubDate: string,
): Promise<void> {
    if (link in db) return;
    db[link] = { link, pubDate, status: 'mark_as_read', ts: Date.now() };
    await saveUserDatabase(app, db);
}



// ─── Status checks ────────────────────────────────────────────────────────────

export function isKnown(db: FeedDatabase, link: string): boolean {
    return link in db;
}

export function getStatus(db: FeedDatabase, link: string): ArticleStatus | null {
    return db[link]?.status ?? null;
}
