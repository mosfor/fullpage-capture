// FullPage Capture - Fixed/sticky element handling

(() => {
  const fpc = (window.FullPageCapture ||= {});
  const originalStyles = new Map();

  fpc.findFixedElements = function findFixedElements() {
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
  };

  fpc.hideFixed = function hideFixed(selectors) {
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
  };

  fpc.restoreFixed = function restoreFixed() {
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
  };

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
})();
