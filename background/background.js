// FullPage Capture - Background Script
// Handles privileged APIs: captureVisibleTab, keyboard commands, downloads

browser.runtime.onMessage.addListener((request) => {
  if (request.action === "captureVisibleTab") {
    return browser.tabs.captureVisibleTab(request.windowId || null, { format: "png" })
      .then((dataUrl) => ({ success: true, dataUrl }))
      .catch((error) => ({ success: false, error: error.message }));
  }

  if (request.action === "download") {
    // Convert data URL to blob URL (data URLs can exceed size limits)
    return fetch(request.dataUrl)
      .then((res) => res.blob())
      .then((blob) => {
        const blobUrl = URL.createObjectURL(blob);
        return browser.downloads.download({
          url: blobUrl,
          filename: request.filename,
          saveAs: true,
        }).then((id) => {
          // Clean up blob URL after download starts
          setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
          return { success: true };
        });
      })
      .catch((error) => ({ success: false, error: error.message }));
  }
});

// Keyboard shortcut handlers
browser.commands.onCommand.addListener(async (command) => {
  const modeMap = {
    "capture-full-page": "fullPage",
    "capture-viewport": "viewport",
    "capture-region": "region",
    "capture-scroll-region": "scrollRegion",
  };

  const mode = modeMap[command];
  if (!mode) return;

  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  const restricted = tab.url.startsWith("about:") ||
    tab.url.startsWith("moz-extension://") ||
    tab.url.startsWith("https://addons.mozilla.org");
  if (restricted) return;

  try {
    await browser.tabs.executeScript(tab.id, { file: "/content/content.js" });
  } catch (e) {
    return;
  }

  // Get saved output preference
  const data = await browser.storage.local.get("outputMode");
  const output = data.outputMode || "clipboard";

  browser.tabs.sendMessage(tab.id, {
    action: "triggerCapture",
    mode,
    output,
    windowId: tab.windowId,
  });
});
