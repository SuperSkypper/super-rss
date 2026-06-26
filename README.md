# 📡 Super RSS

An Obsidian plugin that fetches RSS feeds and saves articles as notes in your vault.

Available in the Obsidian Community Plugins directory.

## ✨ Features
**🗒️ Note Templates**
- Control filename, frontmatter, and content using template variables.
- Override global settings per feed (fetch interval, template, cleanup rules).

**📁 Feed Organization**
- Batch edit feeds.
- Group feeds into collapsible folders.
- Folders rename automatically when feeds are moved or edited.

**🔍 Deduplication**
- Scans your rss folder before importing to avoid duplicate notes.
- Tracks imported entries in a local database.

**🧹 Auto-Cleanup**
- Delete old notes automatically after a configurable period.
- Choose whether to measure age by publication date or saved date.
- Skip cleanup for notes that have a specific property checked.

**✅ Mark as Read**
- URI handler lets you mark items as read from within a note.
- Optional: delete the note automatically on mark as read.
- Mark as read in Obsidian Bases.

**🖼️ Images**
- Link images from articles to your notes.
- Optional: download images locally to your vault.

**▶️ YouTube**
- Automatically detect youtube rss by channel link.
- Picks the highest available thumbnail resolution.
- Fetches video duration for YouTube links.
- Optional: Toggle to skip shorts or live streams.


## 📦 Installation
Install **Super RSS** from **Settings → Community plugins** inside Obsidian.

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

## Note from the author

I am not a programmer. I built Super RSS because it was a tool I needed for my own workflow, and I decided to share it in case it helps other people too.

This plugin was created over roughly four months using the tools Claude and Codex.
