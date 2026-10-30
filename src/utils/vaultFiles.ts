import { TFile, TFolder, Vault, normalizePath } from 'obsidian';

/**
 * Collects the Markdown files inside a vault folder (including nested
 * subfolders), without enumerating the rest of the vault.
 *
 * Uses `Vault.getFolderByPath` + `Vault.recurseChildren` so the plugin only
 * ever touches paths inside the given folder, instead of scanning every file
 * in the vault and filtering afterwards.
 */
export function getMarkdownFilesInFolder(vault: Vault, folderPath: string): TFile[] {
    const folder = vault.getFolderByPath(normalizePath(folderPath));
    if (!(folder instanceof TFolder)) return [];

    const files: TFile[] = [];
    Vault.recurseChildren(folder, (child) => {
        if (child instanceof TFile && child.extension === 'md') files.push(child);
    });
    return files;
}
