// FullPage Capture - Popup Script

const fullPageBtn = document.getElementById("fullPageBtn");
const viewportBtn = document.getElementById("viewportBtn");
const regionBtn = document.getElementById("regionBtn");
const scrollRegionBtn = document.getElementById("scrollRegionBtn");
const outputMode = document.getElementById("outputMode");
const status = document.getElementById("status");

const CONTENT_SCRIPTS = [
  "/content/utils.js",
  "/content/scroll.js",
  "/content/fixed-elements.js",
  "/content/selection.js",
  "/content/capture.js",
  "/content/content.js",
];

// Restore saved output preference
browser.storage.local.get("outputMode").then((data) => {
  if (data.outputMode) outputMode.value = data.outputMode;
});

outputMode.addEventListener("change", () => {
  browser.storage.local.set({ outputMode: outputMode.value });
});

fullPageBtn.addEventListener("click", () => triggerCapture("fullPage"));
viewportBtn.addEventListener("click", () => triggerCapture("viewport"));
regionBtn.addEventListener("click", () => triggerCapture("region"));
scrollRegionBtn.addEventListener("click", () => triggerCapture("scrollRegion"));

async function triggerCapture(mode) {
  try {
    disableAll();
    status.textContent = mode === "region" ? "Select a region..." : "Capturing...";
    status.className = "status";

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
      output: outputMode.value,
      windowId: tab.windowId,
    });

    if (result && result.success) {
      const msg = outputMode.value === "file" ? "✓ Saved" : "✓ Copied to clipboard";
      status.textContent = msg;
      status.className = "status success";
    } else {
      throw new Error(result?.error || "Capture failed");
    }
  } catch (error) {
    status.textContent = error.message;
    status.className = "status error";
  } finally {
    enableAll();
  }
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
}

function enableAll() {
  fullPageBtn.disabled = false;
  viewportBtn.disabled = false;
  regionBtn.disabled = false;
  scrollRegionBtn.disabled = false;
}
