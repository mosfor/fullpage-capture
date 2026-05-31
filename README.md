# FullPage Capture

Minimal Firefox/Zen browser extension that captures a full-page screenshot and copies it to your clipboard as PNG.

## Features

- **Full-page capture** — auto-scrolls and stitches the entire page
- **Scroll container detection** — works on pages with inner scrollable areas (dashboards, SPAs)
- **Sticky/fixed element handling** — hides fixed headers after the first frame to prevent duplication
- **Clipboard-first** — result goes straight to clipboard, no file dialogs
- **Keyboard shortcut** — `Alt+Shift+1` (configurable in `about:addons` → Manage Extension Shortcuts)
- **Zero dependencies** — pure browser APIs, no external libraries

## Install

### From source (temporary)

1. Clone this repo
2. Open `about:debugging#/runtime/this-firefox` in Firefox/Zen
3. Click "Load Temporary Add-on"
4. Select `manifest.json`

### From AMO (coming soon)

## Usage

1. Navigate to any page
2. Click the extension icon or press `Alt+Shift+1`
3. Wait for capture to complete
4. Paste anywhere — the PNG is in your clipboard

## How it works

1. Detects if the page uses a scrollable container or standard body scroll
2. Measures full scrollable dimensions
3. Scrolls through the page in viewport-sized steps
4. Captures each viewport via `browser.tabs.captureVisibleTab()`
5. Stitches all captures on a canvas
6. Copies the final PNG to clipboard

## Permissions

| Permission | Why |
|---|---|
| `activeTab` | Access current tab for capture |
| `tabs` | Query active tab info |
| `<all_urls>` | Inject content script on any page |
| `clipboardWrite` | Copy screenshot to clipboard |

## Limitations

- Cannot capture Firefox internal pages (`about:*`, `addons.mozilla.org`)
- Pages taller than ~32,000px may hit canvas size limits
- Scroll container mode captures only the scrollable area (sidebars/fixed panels are excluded)

## License

MIT
