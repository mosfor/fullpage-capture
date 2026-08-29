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

  // Copy the four regions around an inner scroll container (header, sidebars,
  // footer) from the first frame. The right and bottom strips shift to the far
  // edges of the expanded canvas; the area a strip doesn't reach stays the
  // page background — chrome appears exactly once.
  function drawChromeStrips(ctx, img, ch, fullWidth, fullHeight, dpr, scale) {
    const strips = [
      [0, 0, ch.vw, ch.top, 0, 0],
      [0, ch.top, ch.left, ch.clientH, 0, ch.top],
      [ch.left + ch.clientW, ch.top, ch.vw - ch.left - ch.clientW, ch.clientH,
        ch.left + fullWidth, ch.top],
      [0, ch.top + ch.clientH, ch.vw, ch.vh - ch.top - ch.clientH,
        0, ch.top + fullHeight],
    ];
    for (const [sx, sy, w, h, dx, dy] of strips) {
      if (w > 0 && h > 0) {
        ctx.drawImage(img, sx * dpr, sy * dpr, w * dpr, h * dpr,
          dx * scale, dy * scale, w * scale, h * scale);
      }
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
        console.debug("[FullPage Capture] direct render path (captureTab)", dims);
        return await fpc.captureFullPageDirect(dims);
      } catch (e) {
        // captureTab unavailable or failed — fall back to scroll-and-stitch.
        console.debug("[FullPage Capture] direct path failed, falling back to stitch:", e.message);
      }
    } else {
      console.debug("[FullPage Capture] inner scroll container detected, using stitch path", fpc.getScrollContainer());
    }

    const dpr = window.devicePixelRatio || 1;

    fpc.disableScrollEffects();
    fpc.scroll(0, 0);
    await fpc.awaitScroll(0, 0);

    // When an inner container scrolls, keep the chrome around it (sidebar,
    // header, footer) in the output: draw it once from the first frame and
    // expand the container's content in place. chrome is null for page scroll.
    const container = fpc.getScrollContainer();
    let chrome = null;
    if (container) {
      const rect = container.getBoundingClientRect();
      chrome = {
        vw: document.documentElement.clientWidth,
        vh: document.documentElement.clientHeight,
        left: rect.left + container.clientLeft,
        top: rect.top + container.clientTop,
        clientW: container.clientWidth,
        clientH: container.clientHeight,
      };
    }
    const canvasW = chrome ? chrome.vw - chrome.clientW + fullWidth : fullWidth;
    const canvasH = chrome ? chrome.vh - chrome.clientH + fullHeight : fullHeight;
    const destLeft = chrome ? chrome.left : 0;
    const destTop = chrome ? chrome.top : 0;

    // captureVisibleTab returns device pixels; the canvas must match or the
    // stitch only samples part of each tile on HiDPI/zoomed pages. Cap total
    // pixels to stay under Firefox's canvas allocation limit on huge pages.
    const MAX_CANVAS_PIXELS = 100e6;
    const scale = Math.min(dpr, Math.sqrt(MAX_CANVAS_PIXELS / (canvasW * canvasH)));

    const cols = Math.ceil(fullWidth / viewportWidth);
    const rows = Math.ceil(fullHeight / viewportHeight);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(canvasW * scale);
    canvas.height = Math.round(canvasH * scale);
    const ctx = canvas.getContext("2d");

    const bodyBg = getComputedStyle(document.body).backgroundColor;
    ctx.fillStyle = !bodyBg || bodyBg === "transparent" || bodyBg === "rgba(0, 0, 0, 0)"
      ? "#fff"
      : bodyBg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    try {
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const idealX = col * viewportWidth;
          const idealY = row * viewportHeight;
          const clampedX = Math.min(idealX, Math.max(0, fullWidth - viewportWidth));
          const clampedY = Math.min(idealY, Math.max(0, fullHeight - viewportHeight));

          fpc.scroll(clampedX, clampedY);
          await fpc.awaitScroll(clampedX, clampedY);
          // Re-detect on every tile after the first row: SPAs re-render on
          // scroll and can replace nodes, resurrecting sticky/fixed elements
          // that were already neutralized. hideFixed is idempotent per node.
          if (row > 0) {
            const found = fpc.findFixedElements();
            if (row === 1 && col === 0) {
              console.debug("[FullPage Capture] neutralizing fixed/sticky elements:", found);
            }
            fpc.hideFixed(found);
          }
          await fpc.waitForCaptureReady();

          const res = await browser.runtime.sendMessage({
            action: "captureVisibleTab",
            windowId,
          });
          if (!res.success) throw new Error(res.error);

          const img = await fpc.loadImage(res.dataUrl);

          // The first frame has all chrome visible — copy it once.
          if (chrome && row === 0 && col === 0) {
            drawChromeStrips(ctx, img, chrome, fullWidth, fullHeight, dpr, scale);
          }

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
              (destLeft + idealX) * scale,
              (destTop + idealY) * scale,
              drawW * scale,
              drawH * scale,
            );
          }
        }
      }
    } finally {
      fpc.restoreFixed();
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

    fpc.disableScrollEffects();
    fpc.scroll(0, 0);
    await fpc.awaitScroll(0, 0);

    const startCol = Math.floor(selX / viewportWidth);
    const endCol = Math.ceil((selX + selW) / viewportWidth);
    const startRow = Math.floor(selY / viewportHeight);
    const endRow = Math.ceil((selY + selH) / viewportHeight);

    try {
      for (let row = startRow; row < endRow; row++) {
        for (let col = startCol; col < endCol; col++) {
          const idealX = col * viewportWidth;
          const idealY = row * viewportHeight;
          const clampedX = Math.min(idealX, Math.max(0, fullWidth - viewportWidth));
          const clampedY = Math.min(idealY, Math.max(0, fullHeight - viewportHeight));

          fpc.scroll(clampedX, clampedY);
          await fpc.awaitScroll(clampedX, clampedY);
          // Re-detect per tile — see captureFullPage for rationale.
          if (row > startRow) fpc.hideFixed(fpc.findFixedElements());
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
      fpc.restoreFixed();
      fpc.restoreScrollEffects();
      fpc.scroll(origX, origY);
    }

    return fpc.canvasToPngBlob(canvas);
  };
})();
