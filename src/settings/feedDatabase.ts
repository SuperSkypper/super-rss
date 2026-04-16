import { App, normalizePath } from 'obsidian';

// ─── Types ────────────────────────────────────────────────────────────────────

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

export type FeedDatabase = Record<string, ArticleEntry>;

// ─── Constants ────────────────────────────────────────────────────────────────

const PLUGIN_ID = 'super-rss';
const AUTO_DB_FILE = 'feed-database-auto.json';   // apenas para migração
const USER_DB_FILE = 'feed-database-user.json';   // apenas para migração
const DB_FILE      = 'feed-database.jsonl';       // arquivo único

// ─── Paths ────────────────────────────────────────────────────────────────────

function getPluginFolderPath(app: App): string {
    return normalizePath(`${app.vault.configDir}/plugins/${PLUGIN_ID}`);
}

function getDbPath(app: App): string {
    return normalizePath(`${getPluginFolderPath(app)}/${DB_FILE}`);
}

function getAutoDbPath(app: App): string {
    return normalizePath(`${getPluginFolderPath(app)}/${AUTO_DB_FILE}`);
}

function getUserDbPath(app: App): string {
    return normalizePath(`${getPluginFolderPath(app)}/${USER_DB_FILE}`);
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
        console.warn('RSS: Append failed, falling back to write', e);
        await app.vault.adapter.write(path, line + '\n');
    }
}

async function readJsonFile<T extends object>(app: App, path: string): Promise<T> {
    try {
        if (await app.vault.adapter.exists(path)) {
            const raw = await app.vault.adapter.read(path);
            return JSON.parse(raw) as T;
        }
    } catch {}
    return {} as T;
}

async function loadJsonL(app: App, path: string): Promise<Record<string, ArticleEntry>> {
    const db: Record<string, ArticleEntry> = {};
    try {
        if (!(await app.vault.adapter.exists(path))) return db;

        const content = await app.vault.adapter.read(path);
        const lines = content.split('\n').filter(l => l.trim().length > 0);

        for (const line of lines) {
            try {
                const entry = JSON.parse(line) as ArticleEntry;
                if (entry.link) db[entry.link] = entry;
            } catch (e) {
                console.warn('RSS: Skipping corrupted line', e);
            }
        }
    } catch (e) {
        console.error(`RSS: Failed to load ${path}`, e);
    }
    return db;
}

// ─── Migração automática ─────────────────────────────────────────────────────

async function migrateLegacyJsonToJsonL(app: App): Promise<FeedDatabase> {
    const dbPath = getDbPath(app);
    if (await app.vault.adapter.exists(dbPath)) return {};

    const autoPath = getAutoDbPath(app);
    const userPath = getUserDbPath(app);

    const [autoExists, userExists] = await Promise.all([
        app.vault.adapter.exists(autoPath),
        app.vault.adapter.exists(userPath)
    ]);

    if (!autoExists && !userExists) return {};

    console.log('RSS: Migrando bancos antigos para o novo feed-database.jsonl...');

    const [autoDb, userDb] = await Promise.all([
        autoExists ? readJsonFile<AutoDatabase>(app, autoPath) : {},
        userExists ? readJsonFile<UserDatabase>(app, userPath) : {},
    ]);

    const combined = { ...userDb, ...autoDb };

    const content = Object.values(combined)
        .map(entry => JSON.stringify(entry))
        .join('\n');

    await ensurePluginFolder(app);
    await app.vault.adapter.write(dbPath, content ? content + '\n' : '');

    console.log(`RSS: Migração concluída com ${Object.keys(combined).length} entradas.`);
    console.log('RSS: Arquivos antigos mantidos (pode apagar manualmente depois).');

    return combined;
}

// ─── Public Read API ──────────────────────────────────────────────────────────

export async function loadDatabase(app: App): Promise<FeedDatabase> {
    let db = await loadJsonL(app, getDbPath(app));

    if (Object.keys(db).length === 0) {
        db = await migrateLegacyJsonToJsonL(app);
    }

    return db;
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
export const loadFeedDatabase = loadDatabase;

// ─── Public Write API ─────────────────────────────────────────────────────────

export async function saveAutoDatabase(app: App, autoDb: AutoDatabase): Promise<void> {
    const fullDb = await loadDatabase(app);

    // Remove entradas antigas do tipo auto
    for (const [link, entry] of Object.entries(fullDb)) {
        if (entry.status !== 'mark_as_read') {
            delete fullDb[link];
        }
    }

    Object.assign(fullDb, autoDb);

    const content = Object.values(fullDb)
        .map(e => JSON.stringify(e))
        .join('\n');

    await ensurePluginFolder(app);
    await app.vault.adapter.write(getDbPath(app), content ? content + '\n' : '');
}

export async function saveUserDatabase(app: App, userDb: UserDatabase): Promise<void> {
    const fullDb = await loadDatabase(app);

    // Remove entradas antigas do tipo user
    for (const [link, entry] of Object.entries(fullDb)) {
        if (entry.status === 'mark_as_read') {
            delete fullDb[link];
        }
    }

    Object.assign(fullDb, userDb);

    const content = Object.values(fullDb)
        .map(e => JSON.stringify(e))
        .join('\n');

    await ensurePluginFolder(app);
    await app.vault.adapter.write(getDbPath(app), content ? content + '\n' : '');
}

export const saveFeedDatabase = saveAutoDatabase;

// ─── Register functions (append-only) ─────────────────────────────────────────

export function registerAuto(
    db: AutoDatabase,
    link: string,
    pubDate: string,
    status: AutoArticleStatus,
): void {
    if (link in db) return;
    db[link] = { link, pubDate, status, ts: Date.now() };
}

export async function registerOldArticle(
    app: App,
    autoDb: AutoDatabase,
    userDb: UserDatabase,
    link: string,
    pubDate: string,
    markAsReadMode: boolean,
): Promise<void> {
    if (link in autoDb || link in userDb) return;

    const entry: ArticleEntry = {
        link,
        pubDate,
        status: markAsReadMode ? 'mark_as_read' : 'old_article',
        ts: Date.now()
    };

    if (markAsReadMode) userDb[link] = entry;
    else autoDb[link] = entry;

    await appendLine(app, getDbPath(app), JSON.stringify(entry));
}

export async function registerManualRead(
    app: App,
    db: UserDatabase,
    link: string,
    pubDate: string,
): Promise<void> {
    if (link in db) return;

    const entry: ArticleEntry = {
        link,
        pubDate,
        status: 'mark_as_read',
        ts: Date.now()
    };

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