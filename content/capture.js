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

  fpc.captureFullPage = async function captureFullPage(windowId) {
    const dims = fpc.getPageDimensions();
    const { fullWidth, fullHeight, viewportWidth, viewportHeight } = dims;
    const origX = dims.scrollX;
    const origY = dims.scrollY;

    if (fullHeight <= viewportHeight && fullWidth <= viewportWidth) {
      return fpc.captureViewport(windowId);
    }

    fpc.scroll(0, 0);
    await fpc.awaitScroll(0, 0);

    const headers = fpc.findFixedElements()
      .filter((el) => el.isHeader)
      .map((el) => el.selector);

    const cols = Math.ceil(fullWidth / viewportWidth);
    const rows = Math.ceil(fullHeight / viewportHeight);
    const canvas = document.createElement("canvas");
    canvas.width = fullWidth;
    canvas.height = fullHeight;
    const ctx = canvas.getContext("2d");

    let headersHidden = false;

    try {
      for (let row = 0; row < rows; row++) {
        if (row === 1 && headers.length > 0 && !headersHidden) {
          fpc.hideFixed(headers);
          headersHidden = true;
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
          const srcX = idealX - clampedX;
          const srcY = idealY - clampedY;
          const drawW = Math.min(viewportWidth - srcX, fullWidth - idealX);
          const drawH = Math.min(viewportHeight - srcY, fullHeight - idealY);

          if (drawW > 0 && drawH > 0) {
            ctx.drawImage(img, srcX, srcY, drawW, drawH, idealX, idealY, drawW, drawH);
          }
        }
      }
    } finally {
      if (headersHidden) fpc.restoreFixed();
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

    const headers = fpc.findFixedElements()
      .filter((el) => el.isHeader)
      .map((el) => el.selector);

    fpc.scroll(0, 0);
    await fpc.awaitScroll(0, 0);

    const startCol = Math.floor(selX / viewportWidth);
    const endCol = Math.ceil((selX + selW) / viewportWidth);
    const startRow = Math.floor(selY / viewportHeight);
    const endRow = Math.ceil((selY + selH) / viewportHeight);
    let headersHidden = false;

    try {
      for (let row = startRow; row < endRow; row++) {
        if (row > startRow && headers.length > 0 && !headersHidden) {
          fpc.hideFixed(headers);
          headersHidden = true;
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
      if (headersHidden) fpc.restoreFixed();
      fpc.scroll(origX, origY);
    }

    return fpc.canvasToPngBlob(canvas);
  };
})();
