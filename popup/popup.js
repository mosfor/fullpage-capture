// FullPage Capture - Popup Script
// Triggers capture via content script (same path as keyboard shortcut)

const captureBtn = document.getElementById("captureBtn");
const status = document.getElementById("status");

captureBtn.addEventListener("click", async () => {
  try {
    captureBtn.disabled = true;
    status.textContent = "Capturing...";
    status.className = "status";

    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error("No active tab");

    const restricted = tab.url.startsWith("about:") ||
      tab.url.startsWith("moz-extension://") ||
      tab.url.startsWith("https://addons.mozilla.org");
    if (restricted) throw new Error("Cannot capture this page");

    try {
      await browser.tabs.executeScript(tab.id, { file: "/content/content.js" });
    } catch (e) {
      throw new Error("Cannot access this page");
    }

    const result = await browser.tabs.sendMessage(tab.id, {
      action: "triggerCapture",
      windowId: tab.windowId,
    });

    if (result && result.success) {
      status.textContent = "✓ Copied to clipboard";
      status.className = "status success";
    } else {
      throw new Error(result?.error || "Capture failed");
    }
  } catch (error) {
    status.textContent = error.message;
    status.className = "status error";
  } finally {
    captureBtn.disabled = false;
  }
});
