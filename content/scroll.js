// FullPage Capture - Scroll container detection and scroll helpers

(() => {
  const fpc = (window.FullPageCapture ||= {});
  let scrollContainer;

  const LIKELY_SCROLL_SELECTOR = [
    "main",
    "[role='main']",
    "[class*='scroll' i]",
    "[class*='scroller' i]",
    "[class*='scrollable' i]",
    "[class*='content' i]",
    "[class*='viewport' i]",
    "[id*='scroll' i]",
    "[id*='content' i]",
    "[id*='viewport' i]",
  ].join(",");

  function isScrollable(el) {
    if (!el || el === document.documentElement || el === document.body) return false;
    if (el.scrollHeight <= el.clientHeight + 10 && el.scrollWidth <= el.clientWidth + 10) return false;

    const style = getComputedStyle(el);
    const canY = (style.overflowY === "auto" || style.overflowY === "scroll") &&
      el.scrollHeight > el.clientHeight + 10;
    const canX = (style.overflowX === "auto" || style.overflowX === "scroll") &&
      el.scrollWidth > el.clientWidth + 10;
    return canY || canX;
  }

  function detectScrollContainer() {
    const html = document.documentElement;
    const body = document.body;
    const scrollingElement = document.scrollingElement || html;

    const pageCanScroll = scrollingElement.scrollHeight > scrollingElement.clientHeight + 10 ||
      scrollingElement.scrollWidth > scrollingElement.clientWidth + 10;
    const htmlOF = getComputedStyle(html);
    const bodyOF = getComputedStyle(body);
    const pageScrollBlocked = htmlOF.overflowY === "hidden" || bodyOF.overflowY === "hidden";

    if (pageCanScroll && !pageScrollBlocked) {
      return null;
    }

    const candidates = new Set();

    // Start from visible elements and walk ancestors. This catches SPA shells
    // without scanning every DOM node.
    // clientWidth/clientHeight exclude scrollbars; innerWidth/innerHeight
    // don't, and edge samples landing on a scrollbar hit nothing.
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const sampleXs = [vw / 2, 24, Math.max(24, vw - 24)];
    const sampleYs = [vh / 2, 80, Math.max(80, vh - 80)];
    for (const x of sampleXs) {
      for (const y of sampleYs) {
        for (const el of document.elementsFromPoint(x, y)) {
          let cur = el;
          while (cur && cur !== document.body) {
            candidates.add(cur);
            cur = cur.parentElement;
          }
        }
      }
    }

    try {
      for (const el of document.querySelectorAll(LIKELY_SCROLL_SELECTOR)) {
        candidates.add(el);
      }
    } catch (e) {}

    let best = findBestScrollable(candidates);

    // Keep legacy behavior for small/simple pages where a full scan is cheap.
    // Avoid it on huge DOMs, where it was the main performance problem.
    if (!best && document.getElementsByTagName("*").length <= 2000) {
      best = findBestScrollable(document.querySelectorAll("*"));
    }

    return best;
  }

  function findBestScrollable(elements) {
    let best = null;
    let bestArea = 0;
    for (const el of elements) {
      if (!isScrollable(el)) continue;
      const area = el.clientWidth * el.clientHeight;
      if (area > bestArea) {
        bestArea = area;
        best = el;
      }
    }
    return best;
  }

  fpc.getScrollContainer = function getScrollContainer() {
    if (scrollContainer === undefined) {
      scrollContainer = detectScrollContainer();
    }
    return scrollContainer;
  };

  fpc.scroll = function scroll(x, y) {
    // "instant" bypasses CSS scroll-behavior: smooth, which would otherwise
    // animate and leave tiles captured mid-scroll.
    const el = fpc.getScrollContainer();
    const target = el || window;
    try {
      target.scrollTo({ left: x, top: y, behavior: "instant" });
    } catch (e) {
      if (el) {
        el.scrollLeft = x;
        el.scrollTop = y;
      } else {
        window.scrollTo(x, y);
      }
    }
  };

  let scrollEffectsStyle = null;

  fpc.disableScrollEffects = function disableScrollEffects() {
    if (scrollEffectsStyle) return;
    scrollEffectsStyle = document.createElement("style");
    scrollEffectsStyle.textContent =
      "* { scroll-behavior: auto !important; scroll-snap-type: none !important; overflow-anchor: none !important; }";
    document.documentElement.appendChild(scrollEffectsStyle);
  };

  fpc.restoreScrollEffects = function restoreScrollEffects() {
    if (scrollEffectsStyle) {
      scrollEffectsStyle.remove();
      scrollEffectsStyle = null;
    }
  };

  fpc.getScrollPos = function getScrollPos() {
    const el = fpc.getScrollContainer();
    if (el) return { x: el.scrollLeft, y: el.scrollTop };
    return { x: window.scrollX, y: window.scrollY };
  };

  fpc.getScrollViewportRect = function getScrollViewportRect() {
    const el = fpc.getScrollContainer();
    if (!el) return { left: 0, top: 0 };
    const rect = el.getBoundingClientRect();
    return { left: rect.left, top: rect.top };
  };

  fpc.awaitScroll = function awaitScroll(targetX, targetY) {
    return new Promise((resolve) => {
      let elapsed = 0;
      const tick = () => {
        elapsed += 50;
        const pos = fpc.getScrollPos();
        if (
          elapsed >= 500 ||
          (Math.abs(pos.x - targetX) <= 1 && Math.abs(pos.y - targetY) <= 1)
        ) {
          setTimeout(resolve, 50);
          return;
        }
        setTimeout(tick, 50);
      };
      tick();
    });
  };

  fpc.getPageDimensions = function getPageDimensions() {
    const el = fpc.getScrollContainer();

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
  };
})();
