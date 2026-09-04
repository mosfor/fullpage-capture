// FullPage Capture - Content Script
// Message routing and capture dispatcher.

(() => {
  if (window._fullPageCaptureInjected) return;
  window._fullPageCaptureInjected = true;

  const fpc = window.FullPageCapture;
  const DONE_LABEL = {
    clipboard: "Copied to clipboard",
    file: "Saved to file",
    edit: "Opening editor",
  };

  browser.runtime.onMessage.addListener((request) => {
    switch (request.action) {
      case "triggerCapture":
        return capture(request.mode, request.output, request.windowId);
      case "getPageDimensions":
        return Promise.resolve(fpc.getPageDimensions());
      case "scrollToPosition":
        fpc.scroll(request.x, request.y);
        return fpc.awaitScroll(request.x, request.y).then(() => ({
          success: true,
        }));
      case "getFixedElements":
        return Promise.resolve({
          elements: fpc.findFixedElements().map(({ el, position }) => ({
            selector: fpc.uniqueSelector(el),
            position,
          })),
        });
      case "hideFixedElements":
        fpc.hideFixed(request.selectors);
        return Promise.resolve({ success: true });
      case "cancelCapture":
        fpc.cancelDelay();
        return Promise.resolve({ success: true });
      case "restoreFixedElements":
        fpc.restoreFixed();
        return Promise.resolve({ success: true });
    }
  });

  async function capture(mode, output, windowId) {
    // A cancel request can only refer to a capture that has already been
    // triggered; anything left over from before this one is stale.
    fpc.clearCancelRequest();
    // A result disc from the previous capture may still be on screen; a
    // zero-delay capture would otherwise photograph it.
    if (fpc.dismissNotify()) await fpc.nextPaint();
    try {
      let dataUrl;

      // Capture delay runs up front for fullPage/viewport; region modes
      // delay after the selection is drawn instead (see capture.js).
      switch (mode) {
        case "fullPage":
          await fpc.delayBeforeCapture();
          dataUrl = await fpc.captureFullPage(windowId);
          break;
        case "viewport":
          await fpc.delayBeforeCapture();
          dataUrl = await fpc.captureViewport(windowId);
          break;
        case "region":
          dataUrl = await fpc.captureRegion(windowId);
          break;
        case "scrollRegion":
          dataUrl = await fpc.captureScrollRegion(windowId);
          break;
        case "element":
          dataUrl = await fpc.captureElement(windowId);
          break;
        default:
          throw new Error("Unknown capture mode");
      }

      await fpc.outputResult(dataUrl, output);
      fpc.notify("success", DONE_LABEL[output] || "Captured");
      return { success: true };
    } catch (e) {
      if (e.message === "cancelled") return { success: true, cancelled: true };
      fpc.notify("error", e.message);
      return { success: false, error: e.message };
    }
  }
})();
