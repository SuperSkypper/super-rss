# Super RSS

A powerful, high-performance RSS reader plugin for [Obsidian](https://obsidian.md). Automatically transform your favorite feeds into personal notes with total control over templates, images, and organization.

## 🚀 Key Features

- **Smart Feed Management** — Add, edit, and organize RSS/Atom/JSON feeds into collapsible **Groups**.
- **Performance Engine (v0.0.4+)** — Blazing fast updates with minimal CPU usage thanks to advanced metadata caching.
- **YouTube Intelligence** — Automatically upgrades thumbnails to **Max Resolution (4K)**, identifies and tags **Shorts**, and detects **Live Streams** with customizable keywords.
- **Advanced Deduplication** — Real-time vault scanning to prevent duplicate notes, even across different folders.
- **Granular Auto-Cleanup** — Automatically delete old articles based on `Published Date` or `Saved Date`. Use **Selective Preservation** to keep articles if a specific property (like "Read") is checked.
- **Flexible Image Engine** — Download and save images locally to your vault (Obsidian default, Vault root, Feed folder, or custom path). Includes fallback scraping of OpenGraph/Twitter meta tags.
- **Total Template Control** — Full control over filenames, frontmatter, and content body using a powerful variable system.
- **Mark as Read Support** — Integrated link handler and checkbox support. Optionally **Delete on Mark as Read** for a clutter-free workflow.
- **OPML Support** — Easy import/export to migrate from other RSS readers.
- **Modern UX** — Real-time progress tracking in the **Status Bar** and customizable **Ribbon Icons**.

## 🛠️ Usage & Commands

| Action | Description |
|---|---|
| **Update All Feeds** | Manual trigger to refresh all your active feeds. |
| **Add RSS Feed** | Quick modal to subscribe to a new URL. |
| **Mark as Read** | Clickable URI handler to toggle read status in frontmatter. |
| **Purge Database** | Advanced maintenance tools to clean up the internal RSS index. |

## 📦 Installation

### Manual
1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/SuperSkypper/super-rss/releases).
2. Create the folder: `<Vault>/.obsidian/plugins/super-rss/`
3. Copy the files into that folder.
4. Reload Obsidian and enable **Super RSS** in **Settings → Community plugins**.

## 📖 Template Variables

Every part of your note can be customized using these variables:

| Variable | Description |
|---|---|
| `{{title}}` | Article title |
| `{{author}}` | Author name |
| `{{datepub}}` | Publication date from the feed |
| `{{datesaved}}` | Current date/time when saved |
| `{{snippet}}` | Short description or summary |
| `{{feedname}}` | Name of the source feed |
| `{{link}}` | Original article URL |
| `{{image}}` | Embedded image (local or remote) |
| `{{duration}}` | Video duration (YouTube only) |
| `{{#tags}}` | Formatted tags from categories |
| `{{content}}` | Full article content (Readability enhanced) |

---

## 🔗 YouTube Shorts & Live
Super RSS can automatically tag or skip specific content formats. You can configure global or per-feed keywords to identify **Live Streams** (e.g., `live, stream, 🔴`) and decide if you want to include or ignore **Shorts**.

## 🎯 Advanced Cleanup
Keep your vault lean by setting up auto-cleanup rules. You can define a threshold (e.g., 30 days) and specify if you want to check for a specific Obsidian property before deleting. This allows you to "Save" important articles simply by checking a box.

---

## Support
- [Support the project on Ko-fi](https://ko-fi.com/superskypper)
- [Follow @SuperSkypper on X/Twitter](https://x.com/SuperSkypper)

## License
MIT License. See [LICENSE](LICENSE) for details.