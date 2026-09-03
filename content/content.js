// FullPage Capture - Content Script
// Message routing and capture dispatcher.

(() => {
  if (window._fullPageCaptureInjected) return;
  window._fullPageCaptureInjected = true;

  const fpc = window.FullPageCapture;

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
      case "restoreFixedElements":
        fpc.restoreFixed();
        return Promise.resolve({ success: true });
    }
  });

  async function capture(mode, output, windowId) {
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
      fpc.notify("✓");
      return { success: true };
    } catch (e) {
      if (e.message === "cancelled") return { success: true, cancelled: true };
      fpc.notify("✗ " + e.message);
      return { success: false, error: e.message };
    }
  }
})();
