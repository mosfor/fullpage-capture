// FullPage Capture - Content Script
// Handles: scrolling, capturing, stitching, region selection, clipboard/download

(() => {
  if (window._fullPageCaptureInjected) return;
  window._fullPageCaptureInjected = true;

  const originalStyles = new Map();
  let scrollContainer;

  // --- Message handler ---

  browser.runtime.onMessage.addListener((request) => {
    switch (request.action) {
      case "triggerCapture":
        return capture(request.mode, request.output, request.windowId);
      case "getPageDimensions":
        return Promise.resolve(getPageDimensions());
      case "scrollToPosition":
        scroll(request.x, request.y);
        return awaitScroll(request.x, request.y).then(() => ({
          success: true,
        }));
      case "getFixedElements":
        return Promise.resolve({ elements: findFixedElements() });
      case "hideFixedElements":
        hideFixed(request.selectors);
        return Promise.resolve({ success: true });
      case "restoreFixedElements":
        restoreFixed();
        return Promise.resolve({ success: true });
    }
  });

  // --- Main capture dispatcher ---

  async function capture(mode, output, windowId) {
    try {
      let dataUrl;

      switch (mode) {
        case "fullPage":
          dataUrl = await captureFullPage(windowId);
          break;
        case "viewport":
          dataUrl = await captureViewport(windowId);
          break;
        case "region":
          dataUrl = await captureRegion(windowId);
          break;
        case "scrollRegion":
          dataUrl = await captureScrollRegion(windowId);
          break;
        default:
          throw new Error("Unknown capture mode");
      }

      await outputResult(dataUrl, output);
      notify("✓");
      return { success: true };
    } catch (e) {
      if (e.message === "cancelled") return { success: true };
      notify("✗ " + e.message);
      return { success: false, error: e.message };
    }
  }

  // --- Viewport capture ---

  async function captureViewport(windowId) {
    const res = await browser.runtime.sendMessage({
      action: "captureVisibleTab",
      windowId,
    });
    if (!res.success) throw new Error(res.error);
    return res.dataUrl;
  }

  // --- Full page capture ---

  async function captureFullPage(windowId) {
    const dims = getPageDimensions();
    const { fullWidth, fullHeight, viewportWidth, viewportHeight } = dims;
    const origX = dims.scrollX;
    const origY = dims.scrollY;

    // No scroll needed
    if (fullHeight <= viewportHeight && fullWidth <= viewportWidth) {
      return captureViewport(windowId);
    }

    scroll(0, 0);
    await awaitScroll(0, 0);

    const headers = findFixedElements()
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
          hideFixed(headers);
          headersHidden = true;
        }

        for (let col = 0; col < cols; col++) {
          const idealX = col * viewportWidth;
          const idealY = row * viewportHeight;
          const clampedX = Math.min(
            idealX,
            Math.max(0, fullWidth - viewportWidth),
          );
          const clampedY = Math.min(
            idealY,
            Math.max(0, fullHeight - viewportHeight),
          );

          scroll(clampedX, clampedY);
          await awaitScroll(clampedX, clampedY);
          await sleep(400);

          const res = await browser.runtime.sendMessage({
            action: "captureVisibleTab",
            windowId,
          });
          if (!res.success) throw new Error(res.error);

          const img = await loadImage(res.dataUrl);
          const srcX = idealX - clampedX;
          const srcY = idealY - clampedY;
          const drawW = Math.min(viewportWidth - srcX, fullWidth - idealX);
          const drawH = Math.min(viewportHeight - srcY, fullHeight - idealY);

          if (drawW > 0 && drawH > 0) {
            ctx.drawImage(
              img,
              srcX,
              srcY,
              drawW,
              drawH,
              idealX,
              idealY,
              drawW,
              drawH,
            );
          }
        }
      }
    } finally {
      if (headersHidden) restoreFixed();
    }

    scroll(origX, origY);
    return canvas.toDataURL("image/png");
  }

  // --- Region selection ---

  async function captureRegion(windowId) {
    const rect = await selectRegion();
    if (!rect) throw new Error("cancelled");

    // Small delay for overlay to disappear
    await sleep(50);

    // Capture the viewport
    const res = await browser.runtime.sendMessage({
      action: "captureVisibleTab",
      windowId,
    });
    if (!res.success) throw new Error(res.error);

    // Crop to selected region
    const dpr = window.devicePixelRatio || 1;
    const img = await loadImage(res.dataUrl);

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

    return canvas.toDataURL("image/png");
  }

  function selectRegion() {
    return new Promise((resolve) => {
      // Create overlay
      const overlay = document.createElement("div");
      Object.assign(overlay.style, {
        position: "fixed",
        top: "0",
        left: "0",
        width: "100%",
        height: "100%",
        zIndex: "2147483647",
        cursor: "crosshair",
        background: "rgba(0,0,0,0.1)",
      });

      // Selection box
      const box = document.createElement("div");
      Object.assign(box.style, {
        position: "fixed",
        border: "2px solid #4A90D9",
        background: "rgba(74,144,217,0.1)",
        display: "none",
        zIndex: "2147483647",
        pointerEvents: "none",
      });

      // Instructions
      const hint = document.createElement("div");
      Object.assign(hint.style, {
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        padding: "12px 20px",
        borderRadius: "8px",
        background: "rgba(0,0,0,0.7)",
        color: "#fff",
        font: "14px system-ui, sans-serif",
        pointerEvents: "none",
        zIndex: "2147483647",
      });
      hint.textContent = "Draw a rectangle to capture · Esc to cancel";

      document.body.appendChild(overlay);
      document.body.appendChild(box);
      document.body.appendChild(hint);

      let startX,
        startY,
        drawing = false;

      function cleanup() {
        overlay.remove();
        box.remove();
        hint.remove();
        document.removeEventListener("keydown", onKey);
      }

      function onKey(e) {
        if (e.key === "Escape") {
          cleanup();
          resolve(null);
        }
      }

      document.addEventListener("keydown", onKey);

      overlay.addEventListener("mousedown", (e) => {
        drawing = true;
        startX = e.clientX;
        startY = e.clientY;
        box.style.display = "block";
        hint.style.display = "none";
        box.style.left = startX + "px";
        box.style.top = startY + "px";
        box.style.width = "0";
        box.style.height = "0";
      });

      overlay.addEventListener("mousemove", (e) => {
        if (!drawing) return;
        const x = Math.min(e.clientX, startX);
        const y = Math.min(e.clientY, startY);
        const w = Math.abs(e.clientX - startX);
        const h = Math.abs(e.clientY - startY);
        box.style.left = x + "px";
        box.style.top = y + "px";
        box.style.width = w + "px";
        box.style.height = h + "px";
      });

      overlay.addEventListener("mouseup", (e) => {
        if (!drawing) return;
        drawing = false;

        const x = Math.min(e.clientX, startX);
        const y = Math.min(e.clientY, startY);
        const w = Math.abs(e.clientX - startX);
        const h = Math.abs(e.clientY - startY);

        cleanup();

        // Minimum selection size
        if (w < 5 || h < 5) {
          resolve(null);
          return;
        }

        resolve({ x, y, width: w, height: h });
      });
    });
  }

  // --- Scrolling region selection ---

  async function captureScrollRegion(windowId) {
    const rect = await selectScrollRegion();
    if (!rect) throw new Error("cancelled");

    // Use the same scroll/capture infrastructure as fullPage,
    // but crop each frame to the selection bounds.
    const dpr = window.devicePixelRatio || 1;
    const dims = getPageDimensions();
    const { fullWidth, fullHeight, viewportWidth, viewportHeight } = dims;
    const origX = dims.scrollX;
    const origY = dims.scrollY;

    // Clamp rect to page bounds
    const selX = Math.max(0, Math.min(rect.x, fullWidth));
    const selY = Math.max(0, Math.min(rect.y, fullHeight));
    const selW = Math.min(rect.width, fullWidth - selX);
    const selH = Math.min(rect.height, fullHeight - selY);

    if (selW < 5 || selH < 5) throw new Error("Selection too small");

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(selW * dpr);
    canvas.height = Math.round(selH * dpr);
    const ctx = canvas.getContext("2d");

    // Hide sticky headers
    const headers = findFixedElements()
      .filter((el) => el.isHeader)
      .map((el) => el.selector);

    scroll(0, 0);
    await awaitScroll(0, 0);

    // Calculate tiles needed to cover the selection.
    const startCol = Math.floor(selX / viewportWidth);
    const endCol = Math.ceil((selX + selW) / viewportWidth);
    const startRow = Math.floor(selY / viewportHeight);
    const endRow = Math.ceil((selY + selH) / viewportHeight);
    let headersHidden = false;

    try {
      for (let row = startRow; row < endRow; row++) {
        // Hide headers after first visible row
        if (row > startRow && headers.length > 0 && !headersHidden) {
          hideFixed(headers);
          headersHidden = true;
        }

        for (let col = startCol; col < endCol; col++) {
          const idealX = col * viewportWidth;
          const idealY = row * viewportHeight;
          const clampedX = Math.min(
            idealX,
            Math.max(0, fullWidth - viewportWidth),
          );
          const clampedY = Math.min(
            idealY,
            Math.max(0, fullHeight - viewportHeight),
          );

          scroll(clampedX, clampedY);
          await awaitScroll(clampedX, clampedY);
          await sleep(400);

          const res = await browser.runtime.sendMessage({
            action: "captureVisibleTab",
            windowId,
          });
          if (!res.success) throw new Error(res.error);

          const img = await loadImage(res.dataUrl);
          const viewportRect = getScrollViewportRect();

          // What portion of the scroll viewport overlaps with our selection?
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

          // Source position within the captured window image.
          const imgSrcX = (viewportRect.left + overlapLeft - vpLeft) * dpr;
          const imgSrcY = (viewportRect.top + overlapTop - vpTop) * dpr;

          // Destination on our canvas
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
      if (headersHidden) restoreFixed();
      scroll(origX, origY);
    }
    return canvas.toDataURL("image/png");
  }

  function selectScrollRegion() {
    return new Promise((resolve) => {
      const container = document.createElement("div");
      container.id = "_fullpage-scroll-select";

      const overlay = document.createElement("div");
      Object.assign(overlay.style, {
        position: "fixed",
        top: "0",
        left: "0",
        width: "100%",
        height: "100%",
        zIndex: "2147483646",
        cursor: "crosshair",
        background: "rgba(0,0,0,0.15)",
      });

      const box = document.createElement("div");
      Object.assign(box.style, {
        position: "fixed",
        border: "2px dashed #4A90D9",
        background: "rgba(74,144,217,0.08)",
        display: "none",
        zIndex: "2147483647",
        pointerEvents: "none",
      });

      const toolbar = document.createElement("div");
      Object.assign(toolbar.style, {
        position: "fixed",
        bottom: "20px",
        left: "50%",
        transform: "translateX(-50%)",
        display: "none",
        gap: "8px",
        zIndex: "2147483647",
        padding: "8px 16px",
        borderRadius: "8px",
        background: "rgba(0,0,0,0.85)",
        boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
        alignItems: "center",
        font: "13px system-ui, sans-serif",
      });

      const captureBtn = document.createElement("button");
      Object.assign(captureBtn.style, {
        padding: "6px 16px",
        border: "none",
        borderRadius: "5px",
        background: "#4A90D9",
        color: "#fff",
        fontWeight: "600",
        cursor: "pointer",
        fontSize: "13px",
      });
      captureBtn.textContent = "Capture";

      const cancelBtn = document.createElement("button");
      Object.assign(cancelBtn.style, {
        padding: "6px 16px",
        border: "none",
        borderRadius: "5px",
        background: "#555",
        color: "#fff",
        cursor: "pointer",
        fontSize: "13px",
      });
      cancelBtn.textContent = "Cancel";

      const sizeLabel = document.createElement("span");
      Object.assign(sizeLabel.style, { color: "#aaa", fontSize: "12px" });

      toolbar.appendChild(sizeLabel);
      toolbar.appendChild(captureBtn);
      toolbar.appendChild(cancelBtn);

      const hint = document.createElement("div");
      Object.assign(hint.style, {
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        padding: "12px 20px",
        borderRadius: "8px",
        background: "rgba(0,0,0,0.7)",
        color: "#fff",
        font: "14px system-ui, sans-serif",
        pointerEvents: "none",
        zIndex: "2147483647",
      });
      hint.textContent =
        "Draw a region \u00b7 Scroll to adjust \u00b7 Click Capture";

      document.body.appendChild(container);
      container.appendChild(overlay);
      container.appendChild(box);
      container.appendChild(toolbar);
      container.appendChild(hint);

      let selRect = null; // page-absolute coords
      let startX,
        startY,
        drawing = false;

      // Use the scroll container detection for coords
      function getCurScroll() {
        return getScrollPos();
      }

      function toPageCoords(clientX, clientY) {
        const s = getCurScroll();
        const viewportRect = getScrollViewportRect();
        return {
          x: clientX - viewportRect.left + s.x,
          y: clientY - viewportRect.top + s.y,
        };
      }

      function updateBox() {
        if (!selRect) return;
        const s = getCurScroll();
        const viewportRect = getScrollViewportRect();
        box.style.left = viewportRect.left + selRect.x - s.x + "px";
        box.style.top = viewportRect.top + selRect.y - s.y + "px";
        box.style.width = selRect.width + "px";
        box.style.height = selRect.height + "px";
        box.style.display = "block";
        sizeLabel.textContent = `${Math.round(selRect.width)} \u00d7 ${Math.round(selRect.height)}`;
        updateHandles();
      }

      // Resize handles
      const handles = {};
      const handlePositions = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

      function createHandles() {
        for (const pos of handlePositions) {
          const h = document.createElement("div");
          Object.assign(h.style, {
            position: "fixed",
            width: "10px",
            height: "10px",
            background: "#4A90D9",
            border: "1px solid #fff",
            borderRadius: "2px",
            zIndex: "2147483647",
            cursor:
              pos.includes("n") && pos.includes("e")
                ? "ne-resize"
                : pos.includes("n") && pos.includes("w")
                  ? "nw-resize"
                  : pos.includes("s") && pos.includes("e")
                    ? "se-resize"
                    : pos.includes("s") && pos.includes("w")
                      ? "sw-resize"
                      : pos === "n" || pos === "s"
                        ? "ns-resize"
                        : "ew-resize",
          });
          handles[pos] = h;
          container.appendChild(h);
        }
      }

      function updateHandles() {
        if (!selRect) return;
        const s = getCurScroll();
        const viewportRect = getScrollViewportRect();
        const vx = viewportRect.left + selRect.x - s.x;
        const vy = viewportRect.top + selRect.y - s.y;
        const w = selRect.width;
        const h = selRect.height;
        const half = 5;

        const positions = {
          n: { left: vx + w / 2 - half, top: vy - half },
          s: { left: vx + w / 2 - half, top: vy + h - half },
          e: { left: vx + w - half, top: vy + h / 2 - half },
          w: { left: vx - half, top: vy + h / 2 - half },
          ne: { left: vx + w - half, top: vy - half },
          nw: { left: vx - half, top: vy - half },
          se: { left: vx + w - half, top: vy + h - half },
          sw: { left: vx - half, top: vy + h - half },
        };

        for (const pos of handlePositions) {
          handles[pos].style.left = positions[pos].left + "px";
          handles[pos].style.top = positions[pos].top + "px";
          handles[pos].style.display = "block";
        }
      }

      // Listen for scroll on appropriate element
      const scrollEl = getScrollContainer();

      function onScroll() {
        updateBox();
      }

      function cleanup() {
        container.remove();
        document.removeEventListener("keydown", onKey);
        if (scrollEl) scrollEl.removeEventListener("scroll", onScroll);
        window.removeEventListener("scroll", onScroll);
      }

      function onKey(e) {
        if (e.key === "Escape") {
          cleanup();
          resolve(null);
        }
      }

      document.addEventListener("keydown", onKey);
      if (scrollEl) scrollEl.addEventListener("scroll", onScroll);
      window.addEventListener("scroll", onScroll);

      // Drawing phase
      overlay.addEventListener("mousedown", (e) => {
        drawing = true;
        const p = toPageCoords(e.clientX, e.clientY);
        startX = p.x;
        startY = p.y;
        hint.style.display = "none";
        for (const pos of handlePositions) {
          if (handles[pos]) handles[pos].style.display = "none";
        }
      });

      overlay.addEventListener("mousemove", (e) => {
        if (!drawing) return;
        const p = toPageCoords(e.clientX, e.clientY);
        selRect = {
          x: Math.min(p.x, startX),
          y: Math.min(p.y, startY),
          width: Math.abs(p.x - startX),
          height: Math.abs(p.y - startY),
        };
        updateBox();
      });

      overlay.addEventListener("mouseup", () => {
        if (!drawing) return;
        drawing = false;

        if (!selRect || selRect.width < 10 || selRect.height < 10) {
          selRect = null;
          box.style.display = "none";
          toolbar.style.display = "none";
          hint.style.display = "block";
          return;
        }

        overlay.style.pointerEvents = "none";
        overlay.style.background = "none";
        toolbar.style.display = "flex";
        createHandles();
        updateHandles();
      });

      // Handle dragging for resize
      let dragHandle = null;
      let dragStartX, dragStartY, dragOrigRect;

      container.addEventListener("mousedown", (e) => {
        for (const pos of handlePositions) {
          if (e.target === handles[pos]) {
            e.preventDefault();
            e.stopPropagation();
            dragHandle = pos;
            dragStartX = e.clientX;
            dragStartY = e.clientY;
            dragOrigRect = { ...selRect };
            break;
          }
        }
      });

      // Auto-scroll when dragging near edges
      let autoScrollInterval = null;
      const EDGE_THRESHOLD = 40;
      const SCROLL_SPEED = 12;

      function startAutoScroll() {
        stopAutoScroll();
        autoScrollInterval = setInterval(() => {
          if (!dragHandle) {
            stopAutoScroll();
            return;
          }

          let dy = 0,
            dx = 0;
          const el = getScrollContainer();

          if (mouseState.y < EDGE_THRESHOLD) dy = -SCROLL_SPEED;
          else if (mouseState.y > window.innerHeight - EDGE_THRESHOLD)
            dy = SCROLL_SPEED;

          if (mouseState.x < EDGE_THRESHOLD) dx = -SCROLL_SPEED;
          else if (mouseState.x > window.innerWidth - EDGE_THRESHOLD)
            dx = SCROLL_SPEED;

          if (dx === 0 && dy === 0) return;

          // Check scroll bounds before scrolling
          let actualDy = dy,
            actualDx = dx;
          if (el) {
            const maxTop = el.scrollHeight - el.clientHeight;
            if (dy > 0 && el.scrollTop >= maxTop) actualDy = 0;
            if (dy < 0 && el.scrollTop <= 0) actualDy = 0;
            if (dx > 0 && el.scrollLeft >= el.scrollWidth - el.clientWidth)
              actualDx = 0;
            if (dx < 0 && el.scrollLeft <= 0) actualDx = 0;
            el.scrollTop += actualDy;
            el.scrollLeft += actualDx;
          } else {
            const maxY =
              document.documentElement.scrollHeight - window.innerHeight;
            const maxX =
              document.documentElement.scrollWidth - window.innerWidth;
            if (dy > 0 && window.scrollY >= maxY) actualDy = 0;
            if (dy < 0 && window.scrollY <= 0) actualDy = 0;
            if (dx > 0 && window.scrollX >= maxX) actualDx = 0;
            if (dx < 0 && window.scrollX <= 0) actualDx = 0;
            window.scrollBy(actualDx, actualDy);
          }

          // Only expand selection if we actually scrolled
          if (selRect && dragHandle && (actualDx !== 0 || actualDy !== 0)) {
            if (dragHandle.includes("s") && actualDy > 0)
              selRect.height += actualDy;
            if (dragHandle.includes("n") && actualDy < 0) {
              selRect.y += actualDy;
              selRect.height -= actualDy;
            }
            if (dragHandle.includes("e") && actualDx > 0)
              selRect.width += actualDx;
            if (dragHandle.includes("w") && actualDx < 0) {
              selRect.x += actualDx;
              selRect.width -= actualDx;
            }
            dragOrigRect = { ...selRect };
            dragStartX = mouseState.x;
            dragStartY = mouseState.y;
          }

          updateBox();
        }, 16);
      }

      function stopAutoScroll() {
        if (autoScrollInterval) {
          clearInterval(autoScrollInterval);
          autoScrollInterval = null;
        }
      }

      const mouseState = { x: 0, y: 0 };

      function onDragMove(e) {
        if (!dragHandle) return;
        mouseState.x = e.clientX;
        mouseState.y = e.clientY;

        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;
        const r = { ...dragOrigRect };

        if (dragHandle.includes("e")) r.width = Math.max(20, r.width + dx);
        if (dragHandle.includes("w")) {
          r.x = r.x + dx;
          r.width = Math.max(20, r.width - dx);
        }
        if (dragHandle.includes("s")) r.height = Math.max(20, r.height + dy);
        if (dragHandle.includes("n")) {
          r.y = r.y + dy;
          r.height = Math.max(20, r.height - dy);
        }

        selRect = r;
        updateBox();

        // Trigger auto-scroll near edges
        if (
          e.clientY < EDGE_THRESHOLD ||
          e.clientY > window.innerHeight - EDGE_THRESHOLD ||
          e.clientX < EDGE_THRESHOLD ||
          e.clientX > window.innerWidth - EDGE_THRESHOLD
        ) {
          if (!autoScrollInterval) startAutoScroll();
        } else {
          stopAutoScroll();
        }
      }

      function onDragEnd() {
        dragHandle = null;
        stopAutoScroll();
      }

      document.addEventListener("mousemove", onDragMove);
      document.addEventListener("mouseup", onDragEnd);

      captureBtn.addEventListener("click", () => {
        const result = selRect ? { ...selRect } : null;
        document.removeEventListener("mousemove", onDragMove);
        document.removeEventListener("mouseup", onDragEnd);
        cleanup();
        resolve(result);
      });

      cancelBtn.addEventListener("click", () => {
        document.removeEventListener("mousemove", onDragMove);
        document.removeEventListener("mouseup", onDragEnd);
        cleanup();
        resolve(null);
      });
    });
  }

  // --- Output handling ---

  async function outputResult(dataUrl, output) {
    if (output === "file") {
      const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .slice(0, 19);
      const dlResult = await browser.runtime.sendMessage({
        action: "download",
        dataUrl,
        filename: `capture-${timestamp}.png`,
      });
      if (!dlResult.success)
        throw new Error(dlResult.error || "Download failed");
    } else {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
      ]);
    }
  }

  // --- Scroll container detection ---

  function detectScrollContainer() {
    const html = document.documentElement;
    const body = document.body;

    if (html.scrollHeight > html.clientHeight + 10) {
      const htmlOF = getComputedStyle(html).overflowY;
      const bodyOF = getComputedStyle(body).overflowY;
      if (htmlOF !== "hidden" && bodyOF !== "hidden") {
        return null;
      }
    }

    let best = null;
    let bestArea = 0;

    for (const el of document.querySelectorAll("*")) {
      const oy = getComputedStyle(el).overflowY;
      if (
        (oy === "auto" || oy === "scroll") &&
        el.scrollHeight > el.clientHeight + 10
      ) {
        const area = el.clientWidth * el.clientHeight;
        if (area > bestArea) {
          bestArea = area;
          best = el;
        }
      }
    }

    return best;
  }

  function getScrollContainer() {
    if (scrollContainer === undefined) {
      scrollContainer = detectScrollContainer();
    }
    return scrollContainer;
  }

  // --- Scroll helpers ---

  function scroll(x, y) {
    const el = getScrollContainer();
    if (el) {
      el.scrollLeft = x;
      el.scrollTop = y;
    } else {
      window.scrollTo(x, y);
    }
  }

  function getScrollPos() {
    const el = getScrollContainer();
    if (el) return { x: el.scrollLeft, y: el.scrollTop };
    return { x: window.scrollX, y: window.scrollY };
  }

  function getScrollViewportRect() {
    const el = getScrollContainer();
    if (!el) return { left: 0, top: 0 };
    const rect = el.getBoundingClientRect();
    return { left: rect.left, top: rect.top };
  }

  function awaitScroll(targetX, targetY) {
    return new Promise((resolve) => {
      let elapsed = 0;
      const tick = () => {
        elapsed += 50;
        const pos = getScrollPos();
        if (
          elapsed >= 500 ||
          (Math.abs(pos.x - targetX) <= 1 && Math.abs(pos.y - targetY) <= 1)
        ) {
          setTimeout(resolve, 100);
          return;
        }
        setTimeout(tick, 50);
      };
      tick();
    });
  }

  // --- Page dimensions ---

  function getPageDimensions() {
    const el = getScrollContainer();

    if (el) {
      return {
        fullWidth: el.scrollWidth,
        fullHeight: el.scrollHeight,
        viewportWidth: el.clientWidth,
        viewportHeight: el.clientHeight,
        scrollX: el.scrollLeft,
        scrollY: el.scrollTop,
      };
    }

    const body = document.body;
    const html = document.documentElement;
    return {
      fullWidth: Math.max(
        body.scrollWidth,
        body.offsetWidth,
        html.scrollWidth,
        html.offsetWidth,
        html.clientWidth,
      ),
      fullHeight: Math.max(
        body.scrollHeight,
        body.offsetHeight,
        html.scrollHeight,
        html.offsetHeight,
        html.clientHeight,
      ),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    };
  }

  // --- Fixed/sticky element handling ---

  function findFixedElements() {
    const results = [];
    for (const el of document.querySelectorAll("*")) {
      const style = getComputedStyle(el);
      if (style.position === "fixed" || style.position === "sticky") {
        const rect = el.getBoundingClientRect();
        const selector = uniqueSelector(el);
        if (selector) {
          results.push({
            selector,
            isHeader: rect.top < window.innerHeight / 2 && rect.height < 200,
          });
        }
      }
    }
    return results;
  }

  function hideFixed(selectors) {
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el) {
          originalStyles.set(sel, {
            visibility: el.style.visibility,
            opacity: el.style.opacity,
          });
          el.style.visibility = "hidden";
          el.style.opacity = "0";
        }
      } catch (e) {}
    }
  }

  function restoreFixed() {
    for (const [sel, styles] of originalStyles) {
      try {
        const el = document.querySelector(sel);
        if (el) {
          el.style.visibility = styles.visibility;
          el.style.opacity = styles.opacity;
        }
      } catch (e) {}
    }
    originalStyles.clear();
  }

  function uniqueSelector(el) {
    if (el.id) return "#" + el.id;
    const parts = [];
    let cur = el;
    while (cur && cur !== document.body) {
      let s = cur.tagName.toLowerCase();
      if (cur.className && typeof cur.className === "string") {
        const cls = cur.className
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2);
        if (cls.length) s += "." + cls.join(".");
      }
      parts.unshift(s);
      cur = cur.parentElement;
    }
    return parts.join(" > ");
  }

  // --- UI notification ---

  function notify(text) {
    let el = document.getElementById("_fullpage-capture-notify");
    if (!el) {
      el = document.createElement("div");
      el.id = "_fullpage-capture-notify";
      Object.assign(el.style, {
        position: "fixed",
        top: "16px",
        right: "16px",
        zIndex: "2147483647",
        padding: "8px 16px",
        borderRadius: "6px",
        font: "600 14px system-ui, sans-serif",
        color: "#fff",
        boxShadow: "0 2px 8px rgba(0,0,0,.2)",
        transition: "opacity .3s",
        pointerEvents: "none",
      });
      document.body.appendChild(el);
    }
    el.style.background = text.startsWith("✗") ? "#d32f2f" : "#2d7d46";
    el.textContent = text;
    el.style.opacity = "1";
    setTimeout(() => {
      el.style.opacity = "0";
    }, 2000);
  }

  // --- Utilities ---

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
})();
