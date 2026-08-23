// FullPage Capture - Screenshot capture modes and stitching

(() => {
  const fpc = (window.FullPageCapture ||= {});

  fpc.captureViewport = async function captureViewport(windowId) {
    const res = await browser.runtime.sendMessage({
      action: "captureVisibleTab",
      windowId,
    });
    if (!res.success) throw new Error(res.error);
    return res.dataUrl;
  };

  // Scroll through the page once so lazy-loaded images/content below the
  // fold actually render before a direct (no-scroll) capture.
  async function triggerLazyLoad(dims) {
    const { fullHeight, viewportHeight } = dims;
    const step = Math.max(viewportHeight, fullHeight / 40);
    for (let y = step; y < fullHeight; y += step) {
      fpc.scroll(0, Math.min(y, fullHeight - viewportHeight));
      await fpc.nextPaint();
      await fpc.sleep(40);
    }
  }

  // Direct render path: Firefox can rasterize any page rect from layout
  // without scrolling, so sticky/fixed elements paint exactly once and there
  // are no stitching seams. Only valid when the page itself is the scroller —
  // content inside an inner scroll container is clipped in layout.
  fpc.captureFullPageDirect = async function captureFullPageDirect(dims) {
    const { fullWidth, fullHeight } = dims;
    const dpr = window.devicePixelRatio || 1;
    const MAX_DIM = 32767;
    const MAX_CANVAS_PIXELS = 100e6;
    const scale = Math.min(
      dpr,
      MAX_DIM / fullWidth,
      MAX_DIM / fullHeight,
      Math.sqrt(MAX_CANVAS_PIXELS / (fullWidth * fullHeight)),
    );

    fpc.disableScrollEffects();
    try {
      await triggerLazyLoad(dims);
      fpc.scroll(0, 0);
      await fpc.awaitScroll(0, 0);
      await fpc.waitForCaptureReady();

      const res = await browser.runtime.sendMessage({
        action: "captureTab",
        rect: { x: 0, y: 0, width: fullWidth, height: fullHeight },
        scale,
      });
      if (!res.success) throw new Error(res.error);
      return res.dataUrl;
    } finally {
      fpc.restoreScrollEffects();
      fpc.scroll(dims.scrollX, dims.scrollY);
    }
  };

  fpc.captureFullPage = async function captureFullPage(windowId) {
    const dims = fpc.getPageDimensions();
    const { fullWidth, fullHeight, viewportWidth, viewportHeight } = dims;
    const origX = dims.scrollX;
    const origY = dims.scrollY;

    if (fullHeight <= viewportHeight && fullWidth <= viewportWidth) {
      return fpc.captureViewport(windowId);
    }

    if (!fpc.getScrollContainer()) {
      try {
        return await fpc.captureFullPageDirect(dims);
      } catch (e) {
        // captureTab unavailable or failed — fall back to scroll-and-stitch.
      }
    }

    // captureVisibleTab returns device pixels; the canvas must match or the
    // stitch only samples part of each tile on HiDPI/zoomed pages. Cap total
    // pixels to stay under Firefox's canvas allocation limit on huge pages.
    const dpr = window.devicePixelRatio || 1;
    const MAX_CANVAS_PIXELS = 100e6;
    const scale = Math.min(dpr, Math.sqrt(MAX_CANVAS_PIXELS / (fullWidth * fullHeight)));

    fpc.disableScrollEffects();
    fpc.scroll(0, 0);
    await fpc.awaitScroll(0, 0);

    const fixedElements = fpc.findFixedElements();

    const cols = Math.ceil(fullWidth / viewportWidth);
    const rows = Math.ceil(fullHeight / viewportHeight);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(fullWidth * scale);
    canvas.height = Math.round(fullHeight * scale);
    const ctx = canvas.getContext("2d");

    let fixedHidden = false;

    try {
      for (let row = 0; row < rows; row++) {
        if (row === 1 && fixedElements.length > 0 && !fixedHidden) {
          fpc.hideFixed(fixedElements);
          fixedHidden = true;
        }

        for (let col = 0; col < cols; col++) {
          const idealX = col * viewportWidth;
          const idealY = row * viewportHeight;
          const clampedX = Math.min(idealX, Math.max(0, fullWidth - viewportWidth));
          const clampedY = Math.min(idealY, Math.max(0, fullHeight - viewportHeight));

          fpc.scroll(clampedX, clampedY);
          await fpc.awaitScroll(clampedX, clampedY);
          await fpc.waitForCaptureReady();

          const res = await browser.runtime.sendMessage({
            action: "captureVisibleTab",
            windowId,
          });
          if (!res.success) throw new Error(res.error);

          const img = await fpc.loadImage(res.dataUrl);
          // When scrolling an inner container, the screenshot is of the whole
          // window — offset by the container's on-screen position.
          const vpOffset = fpc.getScrollViewportRect();
          const srcX = idealX - clampedX;
          const srcY = idealY - clampedY;
          const drawW = Math.min(viewportWidth - srcX, fullWidth - idealX);
          const drawH = Math.min(viewportHeight - srcY, fullHeight - idealY);

          if (drawW > 0 && drawH > 0) {
            ctx.drawImage(
              img,
              (vpOffset.left + srcX) * dpr,
              (vpOffset.top + srcY) * dpr,
              drawW * dpr,
              drawH * dpr,
              idealX * scale,
              idealY * scale,
              drawW * scale,
              drawH * scale,
            );
          }
        }
      }
    } finally {
      if (fixedHidden) fpc.restoreFixed();
      fpc.restoreScrollEffects();
      fpc.scroll(origX, origY);
    }

    return fpc.canvasToPngBlob(canvas);
  };

  fpc.captureRegion = async function captureRegion(windowId) {
    const rect = await fpc.selectRegion();
    if (!rect) throw new Error("cancelled");

    await fpc.sleep(50);

    const res = await browser.runtime.sendMessage({
      action: "captureVisibleTab",
      windowId,
    });
    if (!res.success) throw new Error(res.error);

    const dpr = window.devicePixelRatio || 1;
    const img = await fpc.loadImage(res.dataUrl);

    const canvas = document.createElement("canvas");
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext("2d");

    ctx.drawImage(
      img,
      rect.x * dpr,
      rect.y * dpr,
      rect.width * dpr,
      rect.height * dpr,
      0,
      0,
      rect.width * dpr,
      rect.height * dpr,
    );

    return fpc.canvasToPngBlob(canvas);
  };

  fpc.captureScrollRegion = async function captureScrollRegion(windowId) {
    const rect = await fpc.selectScrollRegion();
    if (!rect) throw new Error("cancelled");

    const dpr = window.devicePixelRatio || 1;
    const dims = fpc.getPageDimensions();
    const { fullWidth, fullHeight, viewportWidth, viewportHeight } = dims;
    const origX = dims.scrollX;
    const origY = dims.scrollY;

    const selX = Math.max(0, Math.min(rect.x, fullWidth));
    const selY = Math.max(0, Math.min(rect.y, fullHeight));
    const selW = Math.min(rect.width, fullWidth - selX);
    const selH = Math.min(rect.height, fullHeight - selY);

    if (selW < 5 || selH < 5) throw new Error("Selection too small");

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(selW * dpr);
    canvas.height = Math.round(selH * dpr);
    const ctx = canvas.getContext("2d");

    const fixedElements = fpc.findFixedElements();

    fpc.disableScrollEffects();
    fpc.scroll(0, 0);
    await fpc.awaitScroll(0, 0);

    const startCol = Math.floor(selX / viewportWidth);
    const endCol = Math.ceil((selX + selW) / viewportWidth);
    const startRow = Math.floor(selY / viewportHeight);
    const endRow = Math.ceil((selY + selH) / viewportHeight);
    let fixedHidden = false;

    try {
      for (let row = startRow; row < endRow; row++) {
        if (row > startRow && fixedElements.length > 0 && !fixedHidden) {
          fpc.hideFixed(fixedElements);
          fixedHidden = true;
        }

        for (let col = startCol; col < endCol; col++) {
          const idealX = col * viewportWidth;
          const idealY = row * viewportHeight;
          const clampedX = Math.min(idealX, Math.max(0, fullWidth - viewportWidth));
          const clampedY = Math.min(idealY, Math.max(0, fullHeight - viewportHeight));

          fpc.scroll(clampedX, clampedY);
          await fpc.awaitScroll(clampedX, clampedY);
          await fpc.waitForCaptureReady();

          const res = await browser.runtime.sendMessage({
            action: "captureVisibleTab",
            windowId,
          });
          if (!res.success) throw new Error(res.error);

          const img = await fpc.loadImage(res.dataUrl);
          const viewportRect = fpc.getScrollViewportRect();

          const vpLeft = clampedX;
          const vpTop = clampedY;
          const vpRight = clampedX + viewportWidth;
          const vpBottom = clampedY + viewportHeight;

          const overlapLeft = Math.max(selX, vpLeft);
          const overlapTop = Math.max(selY, vpTop);
          const overlapRight = Math.min(selX + selW, vpRight);
          const overlapBottom = Math.min(selY + selH, vpBottom);

          const overlapW = overlapRight - overlapLeft;
          const overlapH = overlapBottom - overlapTop;

          if (overlapW <= 0 || overlapH <= 0) continue;

          const imgSrcX = (viewportRect.left + overlapLeft - vpLeft) * dpr;
          const imgSrcY = (viewportRect.top + overlapTop - vpTop) * dpr;
          const destX = (overlapLeft - selX) * dpr;
          const destY = (overlapTop - selY) * dpr;

          ctx.drawImage(
            img,
            imgSrcX,
            imgSrcY,
            overlapW * dpr,
            overlapH * dpr,
            destX,
            destY,
            overlapW * dpr,
            overlapH * dpr,
          );
        }
      }
    } finally {
      if (fixedHidden) fpc.restoreFixed();
      fpc.restoreScrollEffects();
      fpc.scroll(origX, origY);
    }

    return fpc.canvasToPngBlob(canvas);
  };
})();
