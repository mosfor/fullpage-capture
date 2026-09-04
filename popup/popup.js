// FullPage Capture - Popup Script (viewfinder)
// The frame shows a thumbnail of the current tab with the chosen mode's
// coverage highlighted; the shutter fires the capture. Countdown, success
// and failure play out in the frame. The card flips over for quick settings.

const fpc = window.FullPageCapture;

const CONTENT_SCRIPTS = [
  "/content/settings.js",
  "/content/utils.js",
  "/content/pdf.js",
  "/content/scroll.js",
  "/content/fixed-elements.js",
  "/content/selection.js",
  "/content/capture.js",
  "/content/content.js",
];

const SVG = (body, extra = "") =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${body}</svg>`;

const MODES = [
  { id: "fullPage", label: "Full page", name: "full page", key: "1", waiting: null, desc: "The whole page, top to bottom, in one image",
    icon: SVG('<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/>') },
  { id: "viewport", label: "Visible", name: "visible area", key: "2", waiting: null, desc: "Just what is on screen right now",
    icon: SVG('<rect x="3" y="3" width="18" height="18" rx="2"/>') },
  { id: "region", label: "Region", name: "region", key: "3", waiting: "Drag a rectangle on the page", desc: "Drag a rectangle over the part you want",
    icon: SVG('<path d="M5 3h4M15 3h4M3 5v4M21 5v4M3 15v4M21 15v4M5 21h4M15 21h4"/>') },
  { id: "scrollRegion", label: "Scrolling", name: "scrolling region", key: "4", waiting: "Drag a rectangle, then it scrolls", desc: "Drag a rectangle, then it scrolls to capture everything below it",
    icon: SVG('<rect x="5" y="2" width="14" height="20" rx="2"/><polyline points="8 14 12 18 16 14"/>') },
  { id: "element", label: "Element", name: "element", key: "5", waiting: "Click an element on the page", desc: "Hover to highlight a block on the page, click to capture it",
    icon: SVG('<rect x="3" y="3" width="12" height="12" rx="2"/><path d="M12 12l9 3-4 1.5L15.5 20.5z"/>') },
];

const OUTPUTS = [
  { id: "clipboard", label: "Clipboard", done: "Copied to clipboard",
    icon: SVG('<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>') },
  { id: "file", label: "File", done: "Saved to file",
    icon: SVG('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>') },
  { id: "edit", label: "Edit", done: "Opening editor",
    icon: SVG('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>') },
];
const CHECK = SVG('<polyline points="20 6 9 17 4 12"/>', 'stroke-width="3"');

const $ = (id) => document.getElementById(id);
const app = $("app");
const card = $("card");
const frame = $("frame");
const thumb = $("thumb");
const thumbImg = $("thumbImg");
const thumbFull = $("thumbFull");
const sheet = $("sheet");
const hl = $("hl");
const timer = $("timer");
const arc = $("arc");
const num = $("num");
const chip = $("chip");
const chipMenu = $("chipMenu");
const modes = $("modes");
const puck = $("puck");
const shutter = $("shutter");
const shutterLabel = $("shutterLabel");
const filenamePreview = $("filenamePreview");

let settings = Object.assign({}, fpc.SETTINGS_DEFAULTS);
let tab = null;
let restricted = false;
let mode = "fullPage";
let phase = "idle"; // idle | waiting | countdown | capturing | success | fail | blocked
let error = "";
let settingsOpen = false;
let menuOpen = false;
let countdownTimer = null;
let resetTimer = null;
let cardHeight = 0;
let thumbLoaded = false;
let fullThumb = "none"; // none | loading | ready | failed

// ---------------------------------------------------------------- init

async function init() {
  buildStatic();

  const [stored, tabs] = await Promise.all([
    Promise.all([fpc.getSettings(), browser.storage.local.get("lastMode")]),
    browser.tabs.query({ active: true, currentWindow: true }),
  ]);
  settings = stored[0];
  if (MODES.some((m) => m.id === stored[1].lastMode)) mode = stored[1].lastMode;
  tab = tabs[0] || null;

  restricted = !tab || isRestricted(tab.url);
  if (restricted) {
    phase = "blocked";
    error = "Can't capture this page";
  }
  render();

  if (!restricted) {
    loadThumbnail();
    if (wantsFullPreview()) loadFullThumbnail();
  }
}

const wantsFullPreview = () => mode === "fullPage" || mode === "scrollRegion";

function isRestricted(url) {
  return !url ||
    url.startsWith("about:") ||
    url.startsWith("moz-extension://") ||
    url.startsWith("https://addons.mozilla.org");
}

// A real screenshot of the visible tab gives the mode highlight something
// concrete to sit on. Falls back to the wireframe if the capture fails.
async function loadThumbnail() {
  try {
    const dataUrl = await browser.tabs.captureVisibleTab(tab.windowId, {
      format: "jpeg",
      quality: 60,
    });
    thumbImg.onload = () => {
      thumbLoaded = true;
      render();
    };
    thumbImg.src = dataUrl;
  } catch (e) {
    /* wireframe stays */
  }
}

// Full-page preview for the modes that reach below the fold. One render of
// the page from layout via captureTab at thumbnail scale, so the bitmap is
// small (300 px wide) and the cost is one paint, run after the popup has
// already opened with the viewport thumbnail. Capped at 8000 CSS px tall;
// content that hasn't lazy-loaded yet shows as it currently is.
async function loadFullThumbnail() {
  if (fullThumb !== "none" || restricted) return;
  fullThumb = "loading";
  try {
    const [dims] = await browser.tabs.executeScript(tab.id, {
      code: "({ w: document.documentElement.clientWidth, vh: window.innerHeight, " +
        "h: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0) })",
    });
    const height = Math.min(dims.h, 8000);
    if (height <= dims.vh + 40) {
      // Nothing beyond the fold: the viewport thumbnail already tells the truth
      fullThumb = "failed";
      return;
    }
    const scale = Math.min(1, (150 * (window.devicePixelRatio || 1)) / dims.w);
    const dataUrl = await browser.tabs.captureTab(tab.id, {
      format: "jpeg",
      quality: 55,
      rect: { x: 0, y: 0, width: dims.w, height },
      scale,
    });
    await new Promise((resolve, reject) => {
      thumbFull.onload = resolve;
      thumbFull.onerror = reject;
      thumbFull.src = dataUrl;
    });
    // Pan speed follows the page length: ~1 s per 500 px, within 4–14 s
    const cssHeight = thumbFull.naturalHeight * (150 / thumbFull.naturalWidth);
    thumbFull.style.setProperty("--pan-dur", Math.max(4, Math.min(14, cssHeight / 60)) + "s");
    thumbFull.dataset.pan = cssHeight > 122 ? "1" : "";
    fullThumb = "ready";
    render();
  } catch (e) {
    fullThumb = "failed";
  }
}

function buildStatic() {
  MODES.forEach((m) => {
    const b = document.createElement("button");
    b.dataset.mode = m.id;
    b.title = `${m.desc} (Alt+Shift+${m.key})`;
    b.innerHTML = `${m.icon}<span>${m.label}</span>`;
    modes.appendChild(b);
  });
  OUTPUTS.forEach((o) => {
    const b = document.createElement("button");
    b.dataset.output = o.id;
    b.innerHTML = `${o.icon}<span>${o.label}</span>`;
    chipMenu.appendChild(b);
  });
  buildSeg($("segOutput"), OUTPUTS.map((o) => [o.id, o.label]), "outputMode");
  buildSeg($("segFormat"), [["png", "PNG"], ["jpeg", "JPEG"], ["pdf", "PDF"]], "format");
  buildSeg($("segDelay"), [["0", "Off"], ["3", "3s"], ["5", "5s"], ["10", "10s"]], "captureDelay");
  ["title", "domain", "date", "time", "timestamp"].forEach((v) => {
    const b = document.createElement("button");
    b.dataset.var = v;
    b.textContent = `{${v}}`;
    b.title = `Insert {${v}}`;
    $("vars").appendChild(b);
  });
}

function buildSeg(el, items, key) {
  items.forEach(([value, label]) => {
    const b = document.createElement("button");
    b.dataset.key = key;
    b.dataset.value = value;
    b.textContent = label;
    el.appendChild(b);
  });
}

// ---------------------------------------------------------------- render

function render() {
  const m = currentMode();
  const out = currentOutput();

  app.className = `popup ${phase}${settingsOpen ? " settings" : ""}`;
  app.dataset.mode = mode;

  // Mode strip
  const idx = MODES.indexOf(m);
  puck.style.transform = `translateX(calc(${idx} * (100% + 2px)))`;
  modes.querySelectorAll("button").forEach((b) => {
    b.classList.toggle("on", b.dataset.mode === mode);
  });

  // Chip
  $("chipIcon").innerHTML = phase === "success" ? CHECK : out.icon;
  $("chipLabel").textContent = out.label;
  chipMenu.hidden = !menuOpen;
  chipMenu.querySelectorAll("button").forEach((b) => {
    b.classList.toggle("on", b.dataset.output === out.id);
  });

  // Shutter
  const busyish = phase !== "idle" && phase !== "fail";
  shutter.disabled = busyish;
  shutterLabel.innerHTML = shutterText(m, out);

  // Countdown overlay
  timer.hidden = phase !== "countdown";

  // Thumbnail: full-page render for modes that reach below the fold
  const showFull = fullThumb === "ready" && wantsFullPreview();
  thumbFull.hidden = !showFull;
  thumbFull.classList.toggle("pan", showFull && thumbFull.dataset.pan === "1");
  thumbImg.hidden = showFull || !thumbLoaded;
  sheet.hidden = showFull || thumbLoaded;

  // Settings face
  document.querySelectorAll(".seg button").forEach((b) => {
    b.classList.toggle("on", String(settings[b.dataset.key]) === b.dataset.value);
  });
  $("saveAsToggle").setAttribute("aria-pressed", String(!!settings.saveAs));
  $("quality").value = settings.quality;
  $("qualityValue").textContent = settings.format === "png" ? "PNG is lossless" : settings.quality + "%";
  $("qualityRow").classList.toggle("disabled", settings.format === "png");
  const tpl = $("template");
  if (document.activeElement !== tpl) tpl.value = settings.filenameTemplate;
  filenamePreview.textContent = previewFilename();

  positionHighlight();
  sizeCard();
}

function shutterText(m, out) {
  const kbd = `<span class="kbd"><b>Alt</b><b>Shift</b><b>${m.key}</b></span>`;
  switch (phase) {
    case "idle": return `Capture ${m.name} ${kbd}`;
    case "waiting": return m.waiting || "Capturing…";
    case "countdown": return "Set up the page…";
    case "capturing": return "Capturing…";
    case "success": return out.done;
    case "fail": return `${error} <span class="retry">Retry</span>`;
    case "blocked": return error;
  }
  return "";
}

// The highlight tracks the thumbnail's rendered box so it works for both
// the real screenshot (any aspect) and the wireframe fallback.
function positionHighlight() {
  const f = frame.getBoundingClientRect();
  const t = thumb.getBoundingClientRect();
  const x = t.left - f.left, y = t.top - f.top, w = t.width, h = t.height;
  const toBottom = f.height - y + 4; // run off the bottom edge: "continues below"
  const showFull = !thumbFull.hidden;
  const geo = {
    fullPage: showFull ? [x, y, w, h] : [x, y, w, toBottom],
    viewport: [x, y, w, h],
    region: [x + w * 0.2, y + h * 0.28, w * 0.6, h * 0.42],
    scrollRegion: [x + w * 0.2, y + h * 0.28, w * 0.6, toBottom],
    element: [x + w * 0.08, y + h * 0.4, w * 0.84, h * 0.26],
  }[mode];
  hl.style.left = geo[0] + "px";
  hl.style.top = geo[1] + "px";
  hl.style.width = geo[2] + "px";
  hl.style.height = geo[3] + "px";
}

// Popup height follows whichever face is showing (the back is absolutely
// positioned so it can't size the card on its own).
function sizeCard() {
  const target = settingsOpen
    ? card.querySelector(".back").scrollHeight
    : card.querySelector(".front").offsetHeight;
  if (target && target !== cardHeight) {
    cardHeight = target;
    card.style.height = target + "px";
  }
}

function previewFilename() {
  const ext = settings.format === "pdf" ? "pdf" : fpc.extForFormat(settings.format);
  let domain = "";
  try { domain = new URL(tab && tab.url).hostname; } catch (e) { /* about:blank etc. */ }
  return fpc.buildFilename(settings.filenameTemplate, ext, {
    title: (tab && tab.title) || "Untitled",
    domain,
  });
}

const currentMode = () => MODES.find((m) => m.id === mode);
const currentOutput = () => OUTPUTS.find((o) => o.id === settings.outputMode) || OUTPUTS[0];

// ---------------------------------------------------------------- capture flow

async function capture() {
  if (phase === "fail") phase = "idle";
  if (phase !== "idle") return;
  menuOpen = false;
  clearTimeout(resetTimer);

  try {
    await injectContentScripts(tab.id);
  } catch (e) {
    return fail("Can't access this page");
  }

  const m = currentMode();
  const delay = parseInt(settings.captureDelay, 10) || 0;
  // Region modes need a selection on the page first; the page-side
  // countdown runs after that, once the popup has already closed.
  if (m.waiting) setPhase("waiting");
  else if (delay > 0) startCountdown(delay);
  else setPhase("capturing");

  let result;
  try {
    result = await browser.tabs.sendMessage(tab.id, {
      action: "triggerCapture",
      mode,
      output: settings.outputMode,
      windowId: tab.windowId,
    });
  } catch (e) {
    result = { success: false, error: e.message };
  }
  stopCountdown();

  if (result && result.cancelled) return setPhase("idle");
  if (result && result.success) {
    setPhase("success");
    resetTimer = setTimeout(() => setPhase("idle"), 1700);
  } else {
    fail((result && result.error) || "Capture failed");
  }
}

function fail(message) {
  error = message;
  setPhase("fail");
}

function setPhase(next) {
  phase = next;
  render();
}

// Mirrors the on-page countdown so the popup shows the same numbers. The
// page owns the real timing; this is the visual echo in the frame.
function startCountdown(seconds) {
  let remaining = seconds;
  phase = "countdown";
  showTick(remaining);
  render();
  countdownTimer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      stopCountdown();
      setPhase("capturing");
      return;
    }
    showTick(remaining);
  }, 1000);
}

function showTick(n) {
  num.textContent = n;
  // Restart the digit and ring animations for each tick
  for (const el of [num, arc]) {
    el.style.animation = "none";
    void el.offsetWidth;
    el.style.animation = "";
  }
}

function stopCountdown() {
  clearInterval(countdownTimer);
  countdownTimer = null;
}

async function cancelCountdown() {
  stopCountdown();
  try {
    await browser.tabs.sendMessage(tab.id, { action: "cancelCapture" });
  } catch (e) { /* page went away; nothing to cancel */ }
  setPhase("idle");
}

async function injectContentScripts(tabId) {
  for (const file of CONTENT_SCRIPTS) {
    await browser.tabs.executeScript(tabId, { file });
  }
}

// ---------------------------------------------------------------- settings

function selectMode(id) {
  if (phase !== "idle" && phase !== "fail") return;
  mode = id;
  browser.storage.local.set({ lastMode: id });
  if (wantsFullPreview() && !restricted) loadFullThumbnail();
  render();
}

function setSetting(key, value) {
  settings[key] = value;
  browser.storage.local.set({ [key]: value });
  render();
}

// ---------------------------------------------------------------- events

document.addEventListener("click", (e) => {
  const t = e.target;

  const modeBtn = t.closest("#modes button");
  if (modeBtn) return selectMode(modeBtn.dataset.mode);

  if (t.closest("#shutter")) {
    if (phase === "blocked") return;
    return capture();
  }

  if (t.closest("#chip")) {
    if (phase !== "idle" && phase !== "fail") return;
    menuOpen = !menuOpen;
    return render();
  }
  const outBtn = t.closest("#chipMenu button");
  if (outBtn) {
    menuOpen = false;
    return setSetting("outputMode", outBtn.dataset.output);
  }
  if (menuOpen) {
    menuOpen = false;
    render();
  }

  if (t.closest("#settingsBtn") || t.closest("#backBtn")) {
    settingsOpen = !settingsOpen;
    return render();
  }

  const segBtn = t.closest(".seg button");
  if (segBtn) {
    const key = segBtn.dataset.key;
    const raw = segBtn.dataset.value;
    return setSetting(key, key === "captureDelay" ? parseInt(raw, 10) : raw);
  }
  if (t.closest("#saveAsToggle")) return setSetting("saveAs", !settings.saveAs);

  const varBtn = t.closest("#vars button");
  if (varBtn) {
    const tpl = $("template");
    const at = tpl.selectionStart ?? tpl.value.length;
    const token = `{${varBtn.dataset.var}}`;
    const next = tpl.value.slice(0, at) + token + tpl.value.slice(tpl.selectionEnd ?? at);
    tpl.value = next;
    tpl.focus();
    tpl.setSelectionRange(at + token.length, at + token.length);
    return setSetting("filenameTemplate", next);
  }
});

$("quality").addEventListener("input", () => {
  settings.quality = parseInt($("quality").value, 10);
  render();
});
$("quality").addEventListener("change", () => {
  browser.storage.local.set({ quality: settings.quality });
});
$("template").addEventListener("input", () => {
  setSetting("filenameTemplate", $("template").value);
});

// Wheel over the frame or the mode strip scrubs through modes. Accumulate
// to a threshold and add a cooldown so one physical notch, which Firefox
// may deliver as several events or in line units, moves exactly one step.
let scrubAcc = 0;
let scrubLast = 0;
document.addEventListener("wheel", (e) => {
  if (!e.target.closest("#frame, #modes")) return;
  if (settingsOpen || (phase !== "idle" && phase !== "fail")) return;
  e.preventDefault();
  const raw = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
  scrubAcc += e.deltaMode === 1 ? raw * 16 : e.deltaMode === 2 ? raw * 100 : raw;
  if (Math.abs(scrubAcc) < 40) return;
  const dir = Math.sign(scrubAcc);
  scrubAcc = 0;
  if (Date.now() - scrubLast < 220) return;
  scrubLast = Date.now();
  stepMode(dir);
}, { passive: false });

function stepMode(dir) {
  const i = MODES.findIndex((m) => m.id === mode);
  const n = Math.max(0, Math.min(MODES.length - 1, i + dir));
  if (n !== i) selectMode(MODES[n].id);
}

document.addEventListener("keydown", (e) => {
  const typing = e.target.tagName === "INPUT";
  if (e.key === "Escape") {
    if (typing) { e.target.blur(); e.preventDefault(); return; }
    // Stopping a running countdown beats closing UI: a screenshot the user
    // is trying to abort must not fire because the settings face was open.
    if (phase === "countdown") { cancelCountdown(); e.preventDefault(); }
    else if (menuOpen) { menuOpen = false; render(); e.preventDefault(); }
    else if (settingsOpen) { settingsOpen = false; render(); e.preventDefault(); }
    return; // otherwise Firefox closes the popup, which is what Escape should do
  }
  if (settingsOpen || typing) return;
  const idle = phase === "idle" || phase === "fail";
  if (/^[1-5]$/.test(e.key) && idle && !e.altKey && !e.ctrlKey && !e.metaKey) {
    selectMode(MODES[+e.key - 1].id);
    return capture();
  }
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    e.preventDefault();
    return stepMode(e.key === "ArrowRight" ? 1 : -1);
  }
  if (e.key === "Enter" && idle && document.activeElement === document.body) {
    return capture();
  }
});

init();
