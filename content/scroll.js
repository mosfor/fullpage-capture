// FullPage Capture - Scroll container detection and scroll helpers

(() => {
  const fpc = (window.FullPageCapture ||= {});
  let scrollContainer;

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

  fpc.getScrollContainer = function getScrollContainer() {
    if (scrollContainer === undefined) {
      scrollContainer = detectScrollContainer();
    }
    return scrollContainer;
  };

  fpc.scroll = function scroll(x, y) {
    const el = fpc.getScrollContainer();
    if (el) {
      el.scrollLeft = x;
      el.scrollTop = y;
    } else {
      window.scrollTo(x, y);
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
          setTimeout(resolve, 100);
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
