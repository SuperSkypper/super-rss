# 📡 Super RSS

An Obsidian plugin that fetches RSS feeds and saves articles as notes in your vault.

> Not yet available on the Community Plugins directory. Manual installation only.


## ✨ Features
**📁 Feed organization**
- Group feeds into collapsible folders
- Folders rename automatically when feeds are moved or edited

**🗒️ Note templates**
- Control filename, frontmatter, and content using template variables (see table below)
- Override global settings per feed (fetch interval, template, cleanup rules)

**🔍 Deduplication**
- Scans your entire rss folder before importing to avoid duplicate notes.
- Tracks imported entries in a local database

**🧹 Auto-cleanup**
- Delete old notes automatically after a configurable period
- Choose whether to measure age by publication date or saved date
- Skip cleanup for notes that have a specific property checked.

**✅ Mark as Read**
- URI handler lets you mark items as read from within a note
- Optional: delete the note automatically on mark as read

**🖼️ Images**
- Download images locally to your vault (default folder, feed folder, or a custom subfolder)
- Falls back to scraping OpenGraph/Twitter meta tags if the feed doesn't include an image

**▶️ YouTube**
- Picks the highest available thumbnail resolution
- Option to skip Shorts or live streams
- Auto-tags items as `#shorts` or `#live` based on URL structure and configurable title keywords
- Fetches video duration for YouTube links


## 📦 Installation
1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/SuperSkypper/super-rss/releases).
2. Create the folder `<your vault>/.obsidian/plugins/super-rss/`.
3. Copy the three files into that folder.
4. Restart Obsidian and enable **Super RSS** under **Settings → Community plugins**.

## 📖 Template Variables

| Variable | Value |
|---|---|
| `{{title}}` | Article title |
| `{{author}}` | Author name |
| `{{datepub}}` | Publication date from the feed |
| `{{datesaved}}` | Date the note was created |
| `{{snippet}}` | Short description or summary |
| `{{feedname}}` | Name of the source feed |
| `{{link}}` | Original article URL |
| `{{image}}` | Local or remote image path |
| `{{duration}}` | Video duration (YouTube only) |
| `{{#tags}}` | Tags derived from feed categories |
| `{{content}}` | Full article content |

## 💬 Support

- [Ko-fi](https://ko-fi.com/superskypper)
- [X / Twitter](https://x.com/SuperSkypper)

## 📄 License

MIT — see [LICENSE](LICENSE).
