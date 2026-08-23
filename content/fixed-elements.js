// FullPage Capture - Fixed/sticky element handling

(() => {
  const fpc = (window.FullPageCapture ||= {});
  const originalStyles = new Map();

  const LIKELY_FIXED_SELECTOR = [
    "header",
    "nav",
    "[role='banner']",
    "[role='navigation']",
    "[class*='header' i]",
    "[class*='navbar' i]",
    "[class*='nav-bar' i]",
    "[class*='sticky' i]",
    "[class*='fixed' i]",
    "[id*='header' i]",
    "[id*='navbar' i]",
    "[id*='sticky' i]",
  ].join(",");

  fpc.findFixedElements = function findFixedElements() {
    const candidates = new Set();

    // Sample what's actually painted in the viewport. This catches most fixed
    // overlays without walking the whole DOM on large pages. Use clientWidth/
    // clientHeight, not innerWidth/innerHeight: the latter include scrollbars,
    // and edge samples landing on a scrollbar hit nothing.
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const sampleXs = [8, vw / 2, Math.max(8, vw - 8)];
    const sampleYs = [8, 48, 96, vh / 2, Math.max(8, vh - 8)];
    for (const x of sampleXs) {
      for (const y of sampleYs) {
        for (const el of document.elementsFromPoint(x, y)) {
          let cur = el;
          while (cur && cur !== document.body) {
            if (cur.nodeType === Node.ELEMENT_NODE) candidates.add(cur);
            cur = cur.parentElement;
          }
        }
      }
    }

    // Add likely semantic/header nodes. This is bounded and avoids
    // querySelectorAll("*") + getComputedStyle for every element.
    try {
      for (const el of document.querySelectorAll(LIKELY_FIXED_SELECTOR)) {
        candidates.add(el);
      }
    } catch (e) {}

    const results = collectFixedElements(candidates);

    // Preserve old behavior on small pages. Skip full scans on large DOMs.
    if (results.length === 0 && document.getElementsByTagName("*").length <= 2000) {
      return collectFixedElements(document.querySelectorAll("*"));
    }

    return results;
  };

  function collectFixedElements(elements) {
    const results = [];
    for (const el of elements) {
      if (el === document.documentElement || el === document.body) continue;

      const style = getComputedStyle(el);
      if (style.position !== "fixed" && style.position !== "sticky") continue;

      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;

      const selector = uniqueSelector(el);
      if (selector) {
        results.push({ selector, position: style.position });
      }
    }
    return results;
  }

  // Fixed elements are hidden (they float over content and would repeat in
  // every tile). Sticky elements are un-stuck instead: switched to static so
  // they render once at their natural in-flow position and no content is lost.
  fpc.hideFixed = function hideFixed(items) {
    for (const item of items) {
      const sel = typeof item === "string" ? item : item.selector;
      const position = typeof item === "string" ? "fixed" : item.position;
      try {
        const el = document.querySelector(sel);
        if (!el || originalStyles.has(sel)) continue;
        originalStyles.set(sel, el.style.cssText);
        if (position === "sticky") {
          el.style.setProperty("position", "static", "important");
        } else {
          el.style.setProperty("visibility", "hidden", "important");
          el.style.setProperty("opacity", "0", "important");
        }
      } catch (e) {}
    }
  };

  fpc.restoreFixed = function restoreFixed() {
    for (const [sel, cssText] of originalStyles) {
      try {
        const el = document.querySelector(sel);
        if (el) el.style.cssText = cssText;
      } catch (e) {}
    }
    originalStyles.clear();
  };

  function uniqueSelector(el) {
    if (el.id) return "#" + CSS.escape(el.id);
    const parts = [];
    let cur = el;
    while (cur && cur !== document.body) {
      let s = cur.tagName.toLowerCase();
      if (cur.className && typeof cur.className === "string") {
        const cls = cur.className
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((name) => CSS.escape(name));
        if (cls.length) s += "." + cls.join(".");
      }
      parts.unshift(s);
      cur = cur.parentElement;
    }
    return parts.join(" > ");
  }
})();
