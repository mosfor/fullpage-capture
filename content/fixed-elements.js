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

  // A position:fixed element covering (nearly) the whole viewport is almost
  // never chrome (a navbar, banner, cookie bar) — it is a content wrapper, as
  // used by transform-based smooth-scroll libraries (Locomotive, Lenis): the
  // page keeps a native scrollbar via a tall spacer while the visible content
  // lives in a full-viewport fixed wrapper moved with translateY. Hiding it
  // would blank the entire capture. Tradeoff: full-screen fixed modals also
  // match and stay visible in every tile.
  const VIEWPORT_COVER_RATIO = 0.85;

  function coversViewport(rect) {
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const w = Math.min(rect.right, vw) - Math.max(rect.left, 0);
    const h = Math.min(rect.bottom, vh) - Math.max(rect.top, 0);
    return w > 0 && h > 0 && (w * h) / (vw * vh) >= VIEWPORT_COVER_RATIO;
  }

  // Detects a full-viewport fixed content wrapper (transform-scroll pages).
  // Samples painted elements around the viewport center and walks ancestors —
  // the wrapper always paints there, so no full DOM scan is needed.
  fpc.hasFullViewportFixed = function hasFullViewportFixed() {
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const seen = new Set();
    for (const [x, y] of [[vw / 2, vh / 2], [vw / 4, vh / 4], [(3 * vw) / 4, (3 * vh) / 4]]) {
      for (const el of document.elementsFromPoint(x, y)) {
        let cur = el;
        while (cur && cur !== document.body && cur !== document.documentElement) {
          if (!seen.has(cur)) {
            seen.add(cur);
            if (
              getComputedStyle(cur).position === "fixed" &&
              coversViewport(cur.getBoundingClientRect())
            ) {
              return true;
            }
          }
          cur = cur.parentElement;
        }
      }
    }
    return false;
  };

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
    const visitedRoots = new Set();
    for (const x of sampleXs) {
      for (const y of sampleYs) {
        visitedRoots.clear();
        collectFromPoint(document, x, y, candidates, visitedRoots, 0);
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
      const all = [];
      collectSubtree(document, all, { shadowCount: 0 }, 0);
      return collectFixedElements(all);
    }

    return results;
  };

  // Sample a point in a document or shadow root: add the hit elements and
  // their ancestors as candidates, and recurse into any open shadow roots
  // among them. document.elementsFromPoint() retargets hits inside shadow
  // trees to the shadow HOST (whose computed position usually isn't
  // fixed/sticky), so overlays inside shadow DOM would otherwise be missed.
  // Closed shadow roots stay unreachable by design. Depth-capped and
  // visited-guarded against pathological/self-referential trees.
  const MAX_SHADOW_DEPTH = 8;
  function collectFromPoint(root, x, y, candidates, visitedRoots, depth) {
    if (depth > MAX_SHADOW_DEPTH || visitedRoots.has(root)) return;
    visitedRoots.add(root);
    let hits;
    try {
      hits = root.elementsFromPoint(x, y);
    } catch (e) {
      return;
    }
    for (const el of hits) {
      let cur = el;
      while (cur && cur !== document.body) {
        if (cur.nodeType === Node.ELEMENT_NODE) {
          candidates.add(cur);
          if (cur.shadowRoot) {
            collectFromPoint(cur.shadowRoot, x, y, candidates, visitedRoots, depth + 1);
          }
        }
        cur = cur.parentElement;
      }
    }
  }

  // Full-scan fallback helper: enumerate a root's elements and descend into
  // any open shadow roots. The ≤2000 light-DOM-node gate above keeps the
  // light tree cheap; shadow trees are additionally bounded by
  // MAX_SHADOW_SCAN_NODES total shadow elements (plus the shared depth cap)
  // so a huge web-component tree cannot blow up the scan.
  const MAX_SHADOW_SCAN_NODES = 2000;
  function collectSubtree(root, out, budget, depth) {
    if (depth > MAX_SHADOW_DEPTH) return;
    let els;
    try {
      els = root.querySelectorAll("*");
    } catch (e) {
      return;
    }
    for (const el of els) {
      if (depth > 0) {
        if (budget.shadowCount >= MAX_SHADOW_SCAN_NODES) return;
        budget.shadowCount++;
      }
      out.push(el);
      if (el.shadowRoot) collectSubtree(el.shadowRoot, out, budget, depth + 1);
    }
  }

  function collectFixedElements(elements) {
    const results = [];
    for (const el of elements) {
      if (el === document.documentElement || el === document.body) continue;

      const style = getComputedStyle(el);
      if (style.position !== "fixed" && style.position !== "sticky") continue;

      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;

      // Full-viewport fixed wrappers are content, not chrome — leave them.
      if (style.position === "fixed" && coversViewport(rect)) continue;

      results.push({ el, position: style.position });
    }
    return results;
  }

  // Fixed elements are hidden (they float over content and would repeat in
  // every tile). Sticky elements are un-stuck instead: switched to static so
  // they render once at their natural in-flow position and no content is lost.
  // Items carry direct element references — regenerated CSS selectors are
  // unreliable on class-heavy SPAs and used only for the legacy string form.
  fpc.hideFixed = function hideFixed(items) {
    for (const item of items) {
      try {
        const el = typeof item === "string" ? document.querySelector(item) : item.el;
        const position = typeof item === "string" ? "fixed" : item.position;
        if (!el || originalStyles.has(el)) continue;
        originalStyles.set(el, el.style.cssText);
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
    for (const [el, cssText] of originalStyles) {
      try {
        el.style.cssText = cssText;
      } catch (e) {}
    }
    originalStyles.clear();
  };

  fpc.uniqueSelector = uniqueSelector;

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
