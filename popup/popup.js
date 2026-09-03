// FullPage Capture - Popup Script

const fullPageBtn = document.getElementById("fullPageBtn");
const viewportBtn = document.getElementById("viewportBtn");
const regionBtn = document.getElementById("regionBtn");
const scrollRegionBtn = document.getElementById("scrollRegionBtn");
const elementBtn = document.getElementById("elementBtn");
const outputToggle = document.getElementById("outputToggle");
const grid = document.getElementById("grid");
const overlay = document.getElementById("overlay");
const overlayMsg = document.getElementById("overlayMsg");
const overlayCheckIcon = document.getElementById("overlayCheckIcon");
const overlayErrorIcon = document.getElementById("overlayErrorIcon");
const status = document.getElementById("status");

let outputMode = "clipboard";

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

// Restore saved output preference
browser.storage.local.get("outputMode").then((data) => {
  if (data.outputMode) {
    outputMode = data.outputMode;
    updateToggle();
  }
});

function updateToggle() {
  outputToggle.querySelectorAll("button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.value === outputMode);
  });
}

outputToggle.querySelectorAll("button").forEach((btn) => {
  btn.addEventListener("click", () => {
    outputMode = btn.dataset.value;
    updateToggle();
    browser.storage.local.set({ outputMode });
  });
});

fullPageBtn.addEventListener("click", () => triggerCapture("fullPage"));
viewportBtn.addEventListener("click", () => triggerCapture("viewport"));
regionBtn.addEventListener("click", () => triggerCapture("region"));
scrollRegionBtn.addEventListener("click", () => triggerCapture("scrollRegion"));
elementBtn.addEventListener("click", () => triggerCapture("element"));

async function triggerCapture(mode) {
  try {
    disableAll();
    status.textContent = mode === "region"
      ? "Select a region..."
      : mode === "element"
        ? "Select an element..."
        : "Capturing...";

    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error("No active tab");

    const restricted = tab.url.startsWith("about:") ||
      tab.url.startsWith("moz-extension://") ||
      tab.url.startsWith("https://addons.mozilla.org");
    if (restricted) throw new Error("Cannot capture this page");

    try {
      await injectContentScripts(tab.id);
    } catch (e) {
      throw new Error("Cannot access this page");
    }

    const result = await browser.tabs.sendMessage(tab.id, {
      action: "triggerCapture",
      mode,
      output: outputMode,
      windowId: tab.windowId,
    });

    if (result && result.cancelled) {
      // User pressed Escape (selection or countdown) — nothing was output,
      // so don't show a false "Saved"/"Copied" confirmation.
      status.textContent = "";
    } else if (result && result.success) {
      const msg = outputMode === "file"
        ? "Saved to file"
        : outputMode === "edit"
          ? "Opening editor"
          : "Copied to clipboard";
      showOverlay("success", msg);
    } else {
      throw new Error(result?.error || "Capture failed");
    }
  } catch (error) {
    showOverlay("error", error.message);
  } finally {
    enableAll();
  }
}

function showOverlay(type, msg) {
  status.textContent = "";
  grid.style.display = "none";
  overlay.className = "overlay show " + type;
  overlayMsg.textContent = msg;
  overlayCheckIcon.style.display = type === "success" ? "block" : "none";
  overlayErrorIcon.style.display = type === "error" ? "block" : "none";

  setTimeout(() => {
    overlay.className = "overlay";
    grid.style.display = "grid";
  }, 1500);
}

async function injectContentScripts(tabId) {
  for (const file of CONTENT_SCRIPTS) {
    await browser.tabs.executeScript(tabId, { file });
  }
}

function disableAll() {
  fullPageBtn.disabled = true;
  viewportBtn.disabled = true;
  regionBtn.disabled = true;
  scrollRegionBtn.disabled = true;
  elementBtn.disabled = true;
}

function enableAll() {
  fullPageBtn.disabled = false;
  viewportBtn.disabled = false;
  regionBtn.disabled = false;
  scrollRegionBtn.disabled = false;
  elementBtn.disabled = false;
}
