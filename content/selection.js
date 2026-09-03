// FullPage Capture - Region selection UI

(() => {
  const fpc = (window.FullPageCapture ||= {});

  fpc.selectRegion = function selectRegion() {
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
  };

  fpc.selectElement = function selectElement() {
    return new Promise((resolve) => {
      // Highlight box: pointer-events none, so elementFromPoint sees the page
      // through it — no full-screen overlay needed (it would swallow hits).
      const box = document.createElement("div");
      Object.assign(box.style, {
        position: "fixed",
        border: "2px solid #4A90D9",
        background: "rgba(74,144,217,0.15)",
        display: "none",
        zIndex: "2147483647",
        pointerEvents: "none",
        boxSizing: "border-box",
      });

      // Devtools-style tooltip: tag/id/class and rendered size
      const tooltip = document.createElement("div");
      Object.assign(tooltip.style, {
        position: "fixed",
        display: "none",
        padding: "4px 8px",
        borderRadius: "4px",
        background: "rgba(0,0,0,0.85)",
        color: "#fff",
        font: "12px system-ui, sans-serif",
        whiteSpace: "nowrap",
        pointerEvents: "none",
        zIndex: "2147483647",
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
      hint.textContent =
        "Click an element to capture · Scroll or ↑↓ to expand · Esc to cancel";

      document.body.appendChild(box);
      document.body.appendChild(tooltip);
      document.body.appendChild(hint);

      let hoverEl = null; // element directly under the cursor
      let depth = 0; // ancestor steps above hoverEl (wheel/arrow expansion)
      let lastX = -1,
        lastY = -1;

      function resolveTarget() {
        let el = hoverEl;
        for (let i = 0; i < depth && el; i++) {
          const parent = el.parentElement;
          if (!parent || parent === document.documentElement) break;
          el = parent;
        }
        return el;
      }

      function describe(el) {
        let name = el.tagName.toLowerCase();
        if (el.id) name += "#" + el.id;
        else if (el.classList.length > 0) name += "." + el.classList[0];
        return name;
      }

      function updateHighlight() {
        const el = resolveTarget();
        if (!el) {
          box.style.display = "none";
          tooltip.style.display = "none";
          return;
        }
        const r = el.getBoundingClientRect();
        box.style.left = r.left + "px";
        box.style.top = r.top + "px";
        box.style.width = r.width + "px";
        box.style.height = r.height + "px";
        box.style.display = "block";

        tooltip.textContent =
          `${describe(el)} · ${Math.round(r.width)} × ${Math.round(r.height)}`;
        tooltip.style.display = "block";
        const th = tooltip.offsetHeight || 24;
        const tw = tooltip.offsetWidth || 120;
        // Above the box when there's room, otherwise just inside its top edge
        const top = r.top - th - 6 >= 0
          ? r.top - th - 6
          : Math.min(Math.max(r.top + 6, 6), window.innerHeight - th - 6);
        tooltip.style.top = top + "px";
        tooltip.style.left =
          Math.max(6, Math.min(r.left, window.innerWidth - tw - 6)) + "px";
      }

      function refreshHover(clientX, clientY) {
        // box/tooltip/hint are pointer-events:none, so they never hit here
        const el = document.elementFromPoint(clientX, clientY);
        if (el && el !== document.documentElement && el !== hoverEl) {
          hoverEl = el;
          depth = 0; // new element under cursor resets the ancestor stack
        }
        updateHighlight();
      }

      function expand(dir) {
        const cur = resolveTarget();
        if (!cur) return;
        if (dir > 0) {
          const parent = cur.parentElement;
          if (parent && parent !== document.documentElement) depth++;
        } else if (depth > 0) {
          depth--;
        }
        updateHighlight();
      }

      function onMove(e) {
        lastX = e.clientX;
        lastY = e.clientY;
        hint.style.display = "none";
        refreshHover(e.clientX, e.clientY);
      }

      function onScrollOrResize() {
        if (lastX >= 0) refreshHover(lastX, lastY);
        else updateHighlight();
      }

      // Wheel expands to parent / back to child instead of scrolling the page
      function onWheel(e) {
        e.preventDefault();
        e.stopPropagation();
        expand(e.deltaY < 0 ? 1 : -1);
      }

      function onKey(e) {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          finish(null);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          e.stopPropagation();
          expand(1);
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          e.stopPropagation();
          expand(-1);
        }
      }

      // Capture-phase: the confirming click must never reach links/buttons
      function block(e) {
        e.preventDefault();
        e.stopPropagation();
      }

      function onClick(e) {
        e.preventDefault();
        e.stopPropagation();
        // Hit-test at the click position too: a click with no prior
        // mousemove (e.g. right after a keyboard-triggered start) would
        // otherwise find no hover element and leave the selection hanging.
        refreshHover(e.clientX, e.clientY);
        const el = resolveTarget();
        if (!el) return;
        const r = el.getBoundingClientRect();
        // Page coordinates: viewport rect + top-level scroll offsets. The
        // element rides along so the caller can re-measure after a capture
        // delay (the page may reflow while a dropdown is opened).
        finish({
          el,
          rect: {
            x: r.left + window.scrollX,
            y: r.top + window.scrollY,
            width: r.width,
            height: r.height,
          },
        });
      }

      function cleanup() {
        box.remove();
        tooltip.remove();
        hint.remove();
        document.removeEventListener("mousemove", onMove, true);
        document.removeEventListener("mousedown", block, true);
        document.removeEventListener("mouseup", block, true);
        document.removeEventListener("click", onClick, true);
        document.removeEventListener("keydown", onKey, true);
        document.removeEventListener("wheel", onWheel, true);
        window.removeEventListener("scroll", onScrollOrResize, true);
        window.removeEventListener("resize", onScrollOrResize);
      }

      async function finish(result) {
        cleanup();
        // The highlight/tooltip must never appear in the shot: wait two rAFs
        // for their removal to actually paint before any capture fires.
        await fpc.nextPaint();
        resolve(result);
      }

      document.addEventListener("mousemove", onMove, true);
      document.addEventListener("mousedown", block, true);
      document.addEventListener("mouseup", block, true);
      document.addEventListener("click", onClick, true);
      document.addEventListener("keydown", onKey, true);
      document.addEventListener("wheel", onWheel, { capture: true, passive: false });
      window.addEventListener("scroll", onScrollOrResize, true);
      window.addEventListener("resize", onScrollOrResize);
    });
  };

  fpc.selectScrollRegion = function selectScrollRegion() {
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
        return fpc.getScrollPos();
      }

      function toPageCoords(clientX, clientY) {
        const s = getCurScroll();
        const viewportRect = fpc.getScrollViewportRect();
        return {
          x: clientX - viewportRect.left + s.x,
          y: clientY - viewportRect.top + s.y,
        };
      }

      function updateBox() {
        if (!selRect) return;
        const s = getCurScroll();
        const viewportRect = fpc.getScrollViewportRect();
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
        const viewportRect = fpc.getScrollViewportRect();
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
      const scrollEl = fpc.getScrollContainer();

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
          const el = fpc.getScrollContainer();

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
  };
})();
