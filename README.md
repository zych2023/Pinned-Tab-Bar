# Pinned Tab Bar

An Obsidian plugin that moves pinned tabs out of the tab header and into a dedicated sidebar strip, so the tab bar keeps its horizontal space for the files you actually switch between.

Nothing is unpinned. The plugin only changes *where* a pinned tab is displayed, never *whether* it is pinned.

## Features

- **Frees the tab header.** Pinned files stop eating tab-bar width.
- **Per-tab placement.** Each pinned file is configured on its own, not by a global switch:
  - keep it in the sidebar strip,
  - send it back to the tab bar with its full title, or
  - send it back to the tab bar as a compact badge.
- **Distinguishable at a glance.** Badges show the leading characters of the file name plus a color derived from its path, because several Markdown files would otherwise share the same file-type icon.
- **Local only.** No network requests, no telemetry.

## Installation

### Community directory

Settings → Community plugins → Browse → search for **Pinned Tab Bar**.

### Manual

1. Download `manifest.json`, `main.js`, and `styles.css` from the latest release.
2. Put them into `<vault>/.obsidian/plugins/pinned-tab-bar/`.
3. Reload Obsidian, then enable the plugin under Settings → Community plugins.

### BRAT

Command palette → `BRAT: Add a beta plugin for testing` → enter `zych2023/Pinned-Tab-Bar`.

## Usage

Each pinned tab has its own placement, recorded per file:

| Placement | Behaviour |
| --- | --- |
| **Sidebar** (default) | Hidden from the tab header, shown as a badge in the sidebar strip. |
| **Top, full** | Stays in the tab header with its complete title. Still pinned. |
| **Top, compact** | Stays in the tab header, squeezed to about 44 px, showing only the badge. Still pinned. |

So four pinned files can be split any way you like — two in the sidebar, one full in the tab bar, one compact — at the same time.

### Gestures

| Target | Action | Result |
| --- | --- | --- |
| Sidebar badge | Left click | Jump to that file; the badge highlights. |
| Sidebar badge | Right click | Placement, unpin, split, open in new window, copy path, close. |
| Tab-bar pinned tab | Double click | Send it back to the sidebar. |
| Tab-bar pinned tab | Right click | Obsidian's own menu, untouched by this plugin. |

### Commands

- **Refresh pinned bar**
- **Pin current tab**
- **All pinned tabs to sidebar**
- **All pinned tabs to top bar**
- **Diagnose and export layout snapshot** (writes `_ptb-diag.md` to the vault root, only when you run it)

## Settings

| Setting | Description |
| --- | --- |
| Language | Interface language: follow Obsidian, Chinese, or English. |
| Enable | Master switch. Disabling restores stock Obsidian behaviour immediately. |
| Sidebar location | Top of the left ribbon (default) / bottom of the left ribbon / status bar. |
| Placement per pinned tab | One row per pinned file, each with its own placement dropdown. |
| Badge style | Leading characters (recommended) or file-type icon. |
| Badge length | 1–4 characters, default 2. |
| Badge size | Size of the badge glyph in pixels. |

## Customizing a badge

Add two optional keys to a file's frontmatter:

```yaml
---
ptb-label: N     # text shown on the badge, overrides the file name
ptb-color: 200   # hue 0–360; 200 blue, 120 green, 0 red
---
```

## How it works

- Pinned state is read from the public `ViewState.pinned` field and changed with `WorkspaceLeaf.setPinned()`.
- The tab header belonging to a leaf is resolved through `leaf.parent.tabHeaderEls`, the same index mapping Obsidian itself uses when a tab is clicked.
- Placements are stored as `placementMap: { "relative/path.md": "sidebar" | "compact" | "top" }` and follow the file when it is renamed.

## Privacy

- No network requests of any kind.
- No analytics, telemetry, or crash reporting.
- File contents are never read. The plugin only looks at file names and paths, and only for pinned tabs.
- The single file it writes is its own settings file: `.obsidian/plugins/pinned-tab-bar/data.json`.

## Troubleshooting

**A pinned tab is not hidden from the tab header.** Run the diagnose command and open `_ptb-diag.md`, or disable and re-enable the plugin to force a refresh.

**The sidebar strip does not appear.** Check that the left ribbon is not collapsed (Settings → Appearance → Show left ribbon). If every pinned tab has been sent to the top, the strip is empty by design.

**Double-clicking a pinned tab no longer renames it.** Reclaiming that gesture is what makes "double-click to send back" possible. Use the right-click menu to rename instead.

## License

[MIT](LICENSE)
