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
        return awaitScroll(request.x, request.y).then(() => ({ success: true }));
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
    const res = await browser.runtime.sendMessage({ action: "captureVisibleTab", windowId });
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
          const clampedX = Math.min(idealX, Math.max(0, fullWidth - viewportWidth));
          const clampedY = Math.min(idealY, Math.max(0, fullHeight - viewportHeight));

          scroll(clampedX, clampedY);
          await awaitScroll(clampedX, clampedY);
          await sleep(400);

          const res = await browser.runtime.sendMessage({ action: "captureVisibleTab", windowId });
          if (!res.success) throw new Error(res.error);

          const img = await loadImage(res.dataUrl);
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
    const res = await browser.runtime.sendMessage({ action: "captureVisibleTab", windowId });
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
      rect.x * dpr, rect.y * dpr, rect.width * dpr, rect.height * dpr,
      0, 0, rect.width * dpr, rect.height * dpr
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

      let startX, startY, drawing = false;

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

  // --- Output handling ---

  async function outputResult(dataUrl, output) {
    if (output === "file") {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const dlResult = await browser.runtime.sendMessage({
        action: "download",
        dataUrl,
        filename: `capture-${timestamp}.png`,
      });
      if (!dlResult.success) throw new Error(dlResult.error || "Download failed");
    } else {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
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
      if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight + 10) {
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

  function awaitScroll(targetX, targetY) {
    return new Promise((resolve) => {
      let elapsed = 0;
      const tick = () => {
        elapsed += 50;
        const pos = getScrollPos();
        if (elapsed >= 500 || (Math.abs(pos.x - targetX) <= 1 && Math.abs(pos.y - targetY) <= 1)) {
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
      fullWidth: Math.max(body.scrollWidth, body.offsetWidth, html.scrollWidth, html.offsetWidth, html.clientWidth),
      fullHeight: Math.max(body.scrollHeight, body.offsetHeight, html.scrollHeight, html.offsetHeight, html.clientHeight),
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
          originalStyles.set(sel, { visibility: el.style.visibility, opacity: el.style.opacity });
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
        const cls = cur.className.trim().split(/\s+/).filter(Boolean).slice(0, 2);
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
    setTimeout(() => { el.style.opacity = "0"; }, 2000);
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
