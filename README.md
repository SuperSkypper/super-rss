# Super RSS

A powerful, high-performance RSS reader plugin for [Obsidian](https://obsidian.md). Automatically transform your favorite feeds into personal notes with total control over templates, images, and organization.

## 🚀 Key Features

### 📺 Smart YouTube Engine
- **Quality Selection**: Automatically identifies and selects the highest available resolution for thumbnails (`MaxRes`, `720p`, etc.) for a premium visual experience.
- **Content Filtering**: Pure flexibility to **Skip YouTube Shorts** or **Skip Live Streams** entirely, keeping your vault focused on long-form content.
- **Intelligent Tagging**: Automatic detection and injection of `#shorts` or `#live` tags based on link structure and customizable title keywords (e.g., `live, stream, 🔴`).
- **Time Tracking**: Automatically fetches video duration for YouTube links to help you manage your discovery.

### 🛡️ Smart Deduplication & Sync
- **Vault-Wide Scanning**: Automatically checks your existing notes to prevent duplicate imports, even if you move files across different folders.
- **Performance Focused**: Powered by a new metadata caching engine (v0.0.4) for blazing-fast updates with minimal CPU impact.
- **Database Refinement**: Modernized storage and entry tracking for a stable, append-only secondary database.

### 🧹 Intelligent Auto-Cleanup
- **Date-Based Rules**: Automatically delete old notes after a configurable time period, using either the `Published Date` or the `Saved Date`.
- **Selective Preservation**: Never lose important research! Enable "Checkbox Detection" to skip cleanup for any note where a specific property (like `Read` or `Starred`) is checked.

### 🖼️ High-End Image Engine
- **Local Downloads**: Save images directly to your vault with support for Obsidian's default folder, feed folders, or specific subfolders.
- **Meta-Image Scraper**: If a feed lacks an image, Super RSS automatically scrapes the source URL for OpenGraph and Twitter meta tags.
- **High-Res Thumbnails**: Optimized for beautiful Gallery and Card views (like Obsidian Bases).

### ⚙️ Total Customization
- **Nested Organization**: Support for collapsible **Groups** and automatic folder renaming when feeds are moved or edited.
- **Template Power**: Full control over Filenames, Frontmatter, and Content using a comprehensive variable system.
- **Per-Feed Overrides**: Global settings too broad? Customize intervals, templates, and cleanup rules for each individual feed.
- **Mark as Read**: Integrated URI handler for one-click status updates. Includes an optional **Delete on Mark as Read** mode.

## 📦 Installation

### Manual
1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/SuperSkypper/super-rss/releases).
2. Create the folder: `<Vault>/.obsidian/plugins/super-rss/`
3. Copy the files into that folder.
4. Reload Obsidian and enable **Super RSS** in **Settings → Community plugins**.

## 📖 Template Variables

| Variable | Description |
|---|---|
| `{{title}}` | Article title |
| `{{author}}` | Author name |
| `{{datepub}}` | Publication date from the source |
| `{{datesaved}}` | Date/time when the note was created |
| `{{snippet}}` | Short description or summary |
| `{{feedname}}` | Name of the source feed |
| `{{link}}` | Original article URL |
| `{{image}}` | Local or remote image link |
| `{{duration}}` | Video duration (YouTube) |
| `{{#tags}}` | Formatted tags from categories |
| `{{content}}` | Full article content (Readability enhanced) |

---

## Support
- [Support the project on Ko-fi](https://ko-fi.com/superskypper)
- [Follow @SuperSkypper on X/Twitter](https://x.com/SuperSkypper)

## License
MIT License. See [LICENSE](LICENSE) for details.