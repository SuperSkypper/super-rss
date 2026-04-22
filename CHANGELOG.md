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
