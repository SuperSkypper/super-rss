# Changelog - v0.0.7

## Community review fixes
- Removed remaining direct style assignments from source files so UI styling uses Obsidian-compatible helpers such as `setCssProps`.
- Published this as a fresh release so the community validator reads the corrected source and release assets.
- Kept release artifact attestations enabled for the distributed assets.

# Changelog - v0.0.6

## New features & improvements
- Added a new properties-based frontmatter editor with drag-and-drop ordering, property name suggestions, and a source mode fallback for advanced templates.
- Added automatic migration for legacy frontmatter templates when they can be converted into editable properties.
- Added support for typed Obsidian properties when saving articles, including text, lists, numbers, checkboxes, dates, and datetimes.
- Added new template variables: `{{datepublished}}`, `{{ytduration}}`, and `{{tags}}`, while keeping `{{datepub}}`, `{{duration}}`, and `{{#tags}}` for backward compatibility.
- Added a manual **Delete old articles now** command and optional ribbon button that runs cleanup and duplicate removal on demand.
- Added configurable delete behavior for cleanup and duplicate removal: use the Obsidian default, move to Obsidian trash, move to system trash, or delete permanently.
- Moved auto-update enablement to device-specific local settings, so background updates can be enabled per device instead of syncing through vault data.
- Deferred heavier startup work until the workspace layout is ready, reducing plugin load impact.
- Improved the feeds list and bulk edit UI with search/filter refinements, clearer per-feed rule controls, folder badges, archive/trash actions, and more consistent styling.
- Added BRAT installation guidance and switched manual installation instructions toward the packaged `super-rss.zip`.

## Cleanup, saving, and feed processing
- Cleanup now respects the selected delete behavior across old articles, read articles, live articles, orphaned database entries, and duplicate files.
- Duplicate removal now registers discarded duplicate articles in the databases so they are not immediately recreated on the next update.
- Age-based cleanup now distinguishes normal old-article deletion from explicit mark-as-read deletion.
- Feed updates now run pre-update cleanup through a shared database flow.
- Article saving now renders frontmatter from structured properties when enabled, with better YAML formatting for known Obsidian property types.
- YouTube articles no longer duplicate the hero thumbnail when the content already includes the video embed.
- Feed parsing and database migration now use stricter type checks, better corrupted-line handling, and quieter debug logging.
- Update stopping now waits for the current async operation to settle and shows a clearer status message.

## Technical updates
- Updated `defuddle` from `0.18.1` to `0.19.1`.
- Updated `esbuild` from `0.25.5` to `0.28.1`.
- Fixed the version bump script so new plugin versions are always written to `versions.json`.
- Prepared release automation for GitHub pre-releases and updated plugin metadata to `0.0.6`.
- Reworked several settings modules to reduce unsafe `any` usage, use Obsidian CSS helpers more consistently, and improve async error handling.

# Changelog - v0.0.5 (Pre-release)

## 🔧 Technical Updates
- **Dependency Update**: Updated `defuddle` to version `0.18.1`, improving article content extraction with its latest features and bug fixes.
- **URI Protocol Fix**: Simplified URI encoding for "Mark as Read" functionality to ensure reliable file resolution.
- **Stability**: Improvements to the internal lockfile system and ESLint configuration.

# Changelog - v0.0.4 (Pre-release)

## 🚀 New Features & Improvements
- **Database Modernization**: Complete refactor of the RSS storage system for better stability. Removed legacy "tombstone" logic and optimized item recording.
- **Super Performance**: Implementation of a metadata caching system that drastically reduces CPU usage during updates and cleanup cycles.
- **Smart Status Bar**: Real-time progress tracking for saving, cleaning, and duplicate checking directly in the Obsidian status bar.
- **Reorganized Settings**: The General Settings tab has been redesigned to be more intuitive, logically grouping Auto-Update, Auto-Delete, and Storage options.
- **Fast Deduplication**: Replaced redundant vault scans with efficient memory-based lookups when marking duplicate articles.

## 🔧 Technical Updates
- **Dependency Update**: Updated `defuddle` to version `0.17.0`, improving article content extraction.
- **Code Refactoring**: Cleaner and more modular code, facilitating future maintenance and preventing bugs.

## 🐞 Bug Fixes
- Fixed an issue where some feed items were inconsistently skipped during import.
- Improved date logic to ensure new articles are not missed.
