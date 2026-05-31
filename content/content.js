// FullPage Capture - Content Script
// Handles: scrolling, capturing grid, stitching, clipboard copy

(() => {
  if (window._fullPageCaptureInjected) return;
  window._fullPageCaptureInjected = true;

  const originalStyles = new Map();
  let scrollContainer;

  // --- Message handler ---

  browser.runtime.onMessage.addListener((request) => {
    switch (request.action) {
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
      case "triggerCapture":
        return capture(request.windowId);
      case "copyToClipboard":
        return copyToClipboard(request.dataUrl);
    }
  });

  // --- Main capture logic ---

  async function capture(windowId) {
    try {
      const dims = getPageDimensions();
      const { fullWidth, fullHeight, viewportWidth, viewportHeight } = dims;
      const origX = dims.scrollX;
      const origY = dims.scrollY;

      // Single viewport — no scrolling needed
      if (fullHeight <= viewportHeight && fullWidth <= viewportWidth) {
        const res = await captureViewport(windowId);
        await copyToClipboard(res.dataUrl);
        notify("✓");
        return { success: true };
      }

      scroll(0, 0);
      await awaitScroll(0, 0);

      // Find headers to hide after first row
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
          // Hide sticky headers after first row to prevent duplication
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

            const res = await captureViewport(windowId);
            const img = await loadImage(res.dataUrl);

            // Calculate source offset for edge tiles where scroll was clamped
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

      const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      notify("✓");
      return { success: true };
    } catch (e) {
      notify("✗ " + e.message);
      return { success: false, error: e.message };
    }
  }

  // --- Viewport capture (delegates to background) ---

  function captureViewport(windowId) {
    return browser.runtime.sendMessage({ action: "captureVisibleTab", windowId });
  }

  // --- Clipboard ---

  async function copyToClipboard(dataUrl) {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return { success: true };
  }

  // --- Scroll container detection ---

  function detectScrollContainer() {
    const html = document.documentElement;
    const body = document.body;

    // Standard body scroll
    if (html.scrollHeight > html.clientHeight + 10) {
      const htmlOF = getComputedStyle(html).overflowY;
      const bodyOF = getComputedStyle(body).overflowY;
      if (htmlOF !== "hidden" && bodyOF !== "hidden") {
        return null;
      }
    }

    // Find largest scrollable element (for SPAs/dashboards with overflow containers)
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
