# FullPage Capture

Minimal Firefox/Zen browser extension that captures screenshots and copies them to your clipboard as PNG. No tracking, no servers — everything runs locally.

## Features

- **Full-page capture** — auto-scrolls and stitches the entire page into one image
- **Visible area capture** — grab exactly what's on screen
- **Region selection** — draw a rectangle to capture any area
- **Scrolling selection** — select a region then auto-scroll to capture content taller than the viewport with adjustable bounds
- **Scroll container detection** — works on pages with inner scrollable areas (dashboards, SPAs)
- **Sticky/fixed element handling** — hides fixed headers after the first frame to prevent duplication
- **Clipboard or file** — output to clipboard or save as PNG file
- **Keyboard shortcuts** — all configurable via `about:addons`
- **Performance optimized** — reduced jank on large pages

## Install

### Firefox Add-ons (AMO)

[Install from AMO](https://addons.mozilla.org/firefox/addon/fullpage-capture/)

### From source

1. Clone this repo
2. Open `about:debugging#/runtime/this-firefox`
3. Click "Load Temporary Add-on"
4. Select `manifest.json`

## Shortcuts

| Action | Default |
|--------|---------|
| Full page | `Alt+Shift+1` |
| Visible area | `Alt+Shift+2` |
| Select region | `Alt+Shift+3` |
| Scrolling selection | `Alt+Shift+4` |

Customize in `about:addons` → gear icon → "Manage Extension Shortcuts"

## How it works

1. Detects if the page uses a scrollable container or standard body scroll
2. Measures full scrollable dimensions
3. Scrolls through the page in viewport-sized steps
4. Captures each viewport via `browser.tabs.captureVisibleTab()`
5. Stitches all captures on a canvas
6. Copies PNG to clipboard or triggers download

**Scrolling selection** works differently: you draw a region, then the extension scrolls within that column and stitches only the selected width — useful for capturing a specific section of a long page.

## Permissions

| Permission | Why |
|---|---|
| `activeTab` | Access current tab for capture |
| `tabs` | Query active tab info |
| `<all_urls>` | Inject content script on any page |
| `clipboardWrite` | Copy screenshot to clipboard |
| `downloads` | Save screenshot as file |
| `storage` | Remember output preference |

## Limitations

- Cannot capture Firefox internal pages (`about:*`, `addons.mozilla.org`)
- Pages taller than ~32,000px may hit canvas size limits
- Scroll container mode captures only the scrollable area (sidebars/fixed panels are excluded)

## License

MIT
