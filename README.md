# Super RSS

A powerful RSS reader plugin for [Obsidian](https://obsidian.md). Automatically saves feed articles as notes with customizable templates, image downloading, auto-cleanup, and Mark as Read support.

## Features

- **Feed management** — Add, edit, and organize RSS/Atom feeds into groups
- **Customizable templates** — Control frontmatter, content body, and file name via template variables
- **Image downloading** — Optionally save article images locally to your vault
- **YouTube support** — Fetches video duration, upgrades thumbnails to max resolution, tags Shorts and live streams
- **Auto-cleanup** — Automatically delete old articles after a configurable time period
- **Mark as Read** — Inject a clickable link as a frontmatter property; works with Obsidian Bases card view via a formula
- **OPML import/export** — Migrate feeds from other RSS readers
- **Per-feed overrides** — Most global settings can be overridden per feed

## Installation

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/SuperSkypper/super-rss/releases).
2. Copy the files to your vault: `<Vault>/.obsidian/plugins/super-rss/`
3. Reload Obsidian and enable **Super RSS** in **Settings → Community plugins**.

### Community plugin list

Coming soon.

## Getting started

1. Open **Settings → Super RSS → General**.
2. Set your **RSS Folder** path.
3. Go to **My Feeds** and add your first feed.
4. Configure your **Update Interval**.
5. Review the **Global Template** if needed.
6. Enable the plugin using the toggle at the top of General settings.

## Mark as Read (Obsidian Bases)

Super RSS injects a clickable link as a frontmatter property on each article. To use it in Bases card view, create a formula column with the following:

\`\`\`
link(
  "obsidian://rss-mark-as-read?file=" + file.name.replace("&", "%26"),
  if(Checkbox,
    html("<span style='font-size:1.5em'>✅</span>"),
    html("<span style='font-size:1.5em'>🟦</span>")
  )
)
\`\`\`

> Replace `Checkbox` with the property name configured in **Settings → Super RSS → General → Mark as Read → Checkbox Property Name**.

You can also copy this formula directly from the plugin settings.

## Template variables

| Variable | Description | Scopes |
|---|---|---|
| `{{title}}` | Article title | filename, frontmatter, content |
| `{{author}}` | Author | filename, frontmatter, content |
| `{{datepub}}` | Date published | filename, frontmatter, content |
| `{{datesaved}}` | Date saved | filename, frontmatter, content |
| `{{snippet}}` | Short description | filename, frontmatter, content |
| `{{feedname}}` | Feed name | filename, frontmatter, content |
| `{{link}}` | Article URL | frontmatter, content |
| `{{image}}` | Image link | frontmatter, content |
| `{{duration}}` | Video duration (YouTube) | frontmatter, content |
| `{{#tags}}` | Tags | frontmatter, content |
| `{{content}}` | Full article content | content |

## Development

\`\`\`bash
npm install
npm run dev      # watch mode
npm run build    # production build
\`\`\`

## Support

- [Ko-fi](https://ko-fi.com/superskypper)
- [X / Twitter](https://x.com/SuperSkypper)

## License

MIT