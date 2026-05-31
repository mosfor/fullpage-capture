// FullPage Capture - Background Script
// Handles privileged APIs: captureVisibleTab, keyboard commands

// Capture the visible viewport (only callable from extension context)
browser.runtime.onMessage.addListener((request) => {
  if (request.action === "captureVisibleTab") {
    return browser.tabs.captureVisibleTab(request.windowId || null, { format: "png" })
      .then((dataUrl) => ({ success: true, dataUrl }))
      .catch((error) => ({ success: false, error: error.message }));
  }
});

// Keyboard shortcut handler
browser.commands.onCommand.addListener(async (command) => {
  if (command !== "capture-full-page") return;

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

  browser.tabs.sendMessage(tab.id, {
    action: "triggerCapture",
    windowId: tab.windowId,
  });
});
