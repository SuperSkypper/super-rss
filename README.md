# 📡 Super RSS

An Obsidian plugin that fetches RSS feeds and saves articles as notes in your vault.

> Not yet available on the Community Plugins directory. Manual installation or via BRAT.

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
### Brat Installation
1 - Add beta plugin
2 - Repository link: https://github.com/SuperSkypper/super-rss

### Manual Installation
1. Download `super-rss.zip` from the [latest release](https://github.com/SuperSkypper/super-rss/releases).
2. Extract to the folder `<your vault>/.obsidian/plugins/super-rss/`.
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
