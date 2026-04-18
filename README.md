# Super RSS

An RSS reader plugin for [Obsidian](https://obsidian.md). It automatically saves articles from your feeds as notes in your vault.

## What it does

- **YouTube** - It finds the best quality thumbnail for the video. You can also tell it to skip YouTube Shorts or Live Streams.
- **No Duplicates** - It checks your vault to make sure it doesn't save the same article twice, even if you move the files.
- **Auto-Cleanup** - It can delete old articles after a few days. You can also set it to keep articles if they are marked with a specific property (like a "Read" checkbox).
- **Images** - It can download images to your vault. If a feed doesn't have an image, it tries to find one from the original link.
- **Groups** - You can organize your feeds into groups. If you rename a feed, the plugin can rename the folder for you.
- **Templates** - You can change how the notes look and what information (like author, date, etc.) is included.
- **Mark as Read** - Adds a link to your notes so you can mark them as read.

## How to install

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/SuperSkypper/super-rss/releases).
2. Go to your vault folder: `.obsidian/plugins/`
3. Create a folder named `super-rss` and put the files there.
4. Open Obsidian and enable the plugin in **Settings → Community plugins**.

## Templates

You can use these tags in your templates:

| Tag | Description |
|---|---|
| `{{title}}` | Article title |
| `{{author}}` | Author name |
| `{{datepub}}` | Date it was published |
| `{{datesaved}}` | Date it was saved to Obsidian |
| `{{snippet}}` | Short summary |
| `{{feedname}}` | Name of the feed |
| `{{link}}` | Link to the original article |
| `{{image}}` | Article image |
| `{{duration}}` | Video length (YouTube) |
| `{{#tags}}` | Tags from the feed |
| `{{content}}` | The full article text |

---

## Support
- [Support on Ko-fi](https://ko-fi.com/superskypper)
- [Follow on X/Twitter](https://x.com/SuperSkypper)

## License
MIT License.
