# FullPage Capture

Minimal Firefox/Zen browser extension that captures screenshots and copies them to your clipboard as PNG. No tracking, no servers — everything runs locally.

## Features

- **Full-page capture** — renders the entire page in one pass (no scrolling artifacts); falls back to scroll-and-stitch for pages with inner scroll containers
- **Visible area capture** — grab exactly what's on screen
- **Region selection** — draw a rectangle to capture any area
- **Scrolling selection** — select a region then auto-scroll to capture content taller than the viewport with adjustable bounds
- **Element capture** — hover to highlight any element (scroll or arrow keys expand to its parent), click to capture exactly that element, even taller than the viewport
- **Scroll container detection** — works on pages with inner scrollable areas (dashboards, SPAs)
- **Sticky/fixed element handling** — fixed elements are hidden and sticky ones (sidebars, TOCs) un-stuck after the first frame, so nothing repeats in the stitched image
- **Clipboard, file, or editor** — output to clipboard, save as file, or open in the annotation editor
- **Annotation editor** — crop, arrows, rectangles, text, and blur (pixelation) on any capture, with undo/redo; copy or save the result when done
- **PNG, JPEG, or PDF** — pick file format and quality on the options page (clipboard is always PNG)
- **PDF export** — save any capture as a single-page PDF sized to the image; quality applies to JPEG and PDF (the PDF embeds a JPEG-compressed image)
- **Filename templates** — name saved files with `{title}`, `{domain}`, `{date}`, `{time}`, `{timestamp}` variables, and choose whether to see a Save As dialog
- **Capture delay** — optional 3/5/10-second on-page countdown before the shot (after region selection), so you can set up hover states or open menus; Esc cancels
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
| Element capture | `Alt+Shift+5` |

Customize in `about:addons` → gear icon → "Manage Extension Shortcuts"

## How it works

1. Detects if the page uses a scrollable container or standard body scroll
2. Measures full scrollable dimensions
3. **Standard pages:** does one quick scroll pass to trigger lazy-loaded content, then renders the whole page in a single call via `browser.tabs.captureTab()` with a `rect` — no scrolling, no stitching, sticky elements painted exactly once
4. **Pages with inner scroll containers** (dashboards, SPAs): scrolls in viewport-sized steps, captures each via `browser.tabs.captureVisibleTab()`, and stitches on a canvas — hiding fixed elements and un-sticking sticky ones after the first frame
5. Copies PNG to clipboard or triggers download

**Scrolling selection** works differently: you draw a region, then the extension scrolls within that column and stitches only the selected width — useful for capturing a specific section of a long page.

## Permissions

| Permission | Why |
|---|---|
| `activeTab` | Access current tab for capture |
| `tabs` | Query active tab info |
| `<all_urls>` | Inject content script on any page |
| `clipboardWrite` | Copy screenshot to clipboard |
| `downloads` | Save screenshot as file |
| `storage` | Remember settings (output, format, filename template) |

## Limitations

- Cannot capture Firefox internal pages (`about:*`, `addons.mozilla.org`)
- Pages taller than ~32,000px may hit canvas size limits
- Scroll container mode captures only the scrollable area (sidebars/fixed panels are excluded)

## License

MIT
