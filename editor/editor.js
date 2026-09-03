// FullPage Capture - Annotation Editor
//
// The base image is never modified. Annotations live in an array of ops in
// IMAGE coordinates; every render replays them over the base image. Crop is
// an op too (it stores the previous crop rect, so undo restores it). The
// canvas is rendered at natural image size and scaled to fit via CSS; all
// hit-testing converts back to image coordinates.

(() => {
  const fpc = window.FullPageCapture;

  const STROKES = { small: 2, medium: 4, large: 6 };
  const TEXT_SIZES = { small: 16, medium: 24, large: 32 };
  const PIXELATE_FACTOR = 12;
  const MIN_DRAG = 3; // image px below which a drag is treated as a stray click

  const stage = document.getElementById("stage");
  const canvasWrap = document.getElementById("canvasWrap");
  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d");
  const textInput = document.getElementById("textInput");
  const cropApplyBtn = document.getElementById("cropApplyBtn");
  const emptyMsg = document.getElementById("empty");
  const toast = document.getElementById("toast");
  const undoBtn = document.getElementById("undoBtn");
  const redoBtn = document.getElementById("redoBtn");
  const copyBtn = document.getElementById("copyBtn");
  const saveBtn = document.getElementById("saveBtn");

  let baseImg = null; // HTMLImageElement at natural capture size
  let meta = { title: "", domain: "" }; // source page, for filename tokens
  let ops = []; // committed annotations + crops, in order
  let redoStack = [];
  let tool = "select";
  let color = "#e0533d";
  let stroke = "medium";
  let drag = null; // in-progress pointer drag {x, y, x2, y2} (image coords)
  let pendingCrop = null; // drawn but not yet applied crop rect
  let displayScale = 1;
  let renderQueued = false;
  let toastTimer = null;
  let textCancelled = false;

  init();

  async function init() {
    const data = await browser.storage.local.get("pendingEdit");
    const pending = data.pendingEdit;
    if (!pending || !pending.dataUrl) {
      emptyMsg.hidden = false;
      return;
    }
    // One-shot handoff: consume it so a stale multi-MB capture never
    // lingers in storage.
    await browser.storage.local.remove("pendingEdit");

    meta.title = pending.title || "";
    meta.domain = pending.domain || "";

    baseImg = await fpc.loadImage(pending.dataUrl);
    canvasWrap.hidden = false;
    setTool("select");
    updateLayout();
    render();
  }

  // --- Crop state -----------------------------------------------------

  function currentCrop() {
    for (let i = ops.length - 1; i >= 0; i--) {
      if (ops[i].type === "crop") return ops[i].rect;
    }
    return { x: 0, y: 0, w: baseImg.naturalWidth, h: baseImg.naturalHeight };
  }

  // --- Layout (CSS scaling; canvas stays at natural size) --------------

  function updateLayout() {
    const crop = currentCrop();
    const availW = Math.max(100, stage.clientWidth - 48);
    // Fit width; never upscale past the image's natural CSS size. Tall
    // captures scroll vertically (the stage scrolls natively).
    displayScale = Math.min(
      availW / crop.w,
      1 / (window.devicePixelRatio || 1)
    );
    canvas.style.width = crop.w * displayScale + "px";
    canvas.style.height = crop.h * displayScale + "px";
  }

  window.addEventListener("resize", () => {
    if (!baseImg) return;
    updateLayout();
    positionCropApply();
  });

  // --- Rendering --------------------------------------------------------

  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      render();
    });
  }

  function render() {
    const crop = currentCrop();
    if (canvas.width !== crop.w || canvas.height !== crop.h) {
      canvas.width = crop.w;
      canvas.height = crop.h;
    }
    ctx.save();
    ctx.translate(-crop.x, -crop.y);
    drawComposition(ctx);

    // Live preview of the shape being dragged
    if (drag && tool !== "crop" && tool !== "select") {
      const op = dragToOp();
      if (op) drawOp(ctx, op);
    }

    // Crop preview: dim everything outside the chosen rect
    const cropPreview = pendingCrop ||
      (drag && tool === "crop" ? normalizeDrag() : null);
    if (cropPreview && cropPreview.w > 0 && cropPreview.h > 0) {
      const r = cropPreview;
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.beginPath();
      ctx.rect(crop.x, crop.y, crop.w, crop.h);
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.fill("evenodd");
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = Math.max(2, 2 / displayScale);
      ctx.strokeRect(r.x, r.y, r.w, r.h);
    }
    ctx.restore();
  }

  // Base image + committed annotations (no previews) — shared by the live
  // render and the export path.
  function drawComposition(c) {
    c.drawImage(baseImg, 0, 0);
    for (const op of ops) {
      if (op.type !== "crop") drawOp(c, op);
    }
  }

  function drawOp(c, op) {
    switch (op.type) {
      case "rect":
        c.strokeStyle = op.color;
        c.lineWidth = op.width;
        c.strokeRect(op.x, op.y, op.w, op.h);
        break;
      case "arrow": {
        const head = Math.max(op.width * 3, 8);
        const angle = Math.atan2(op.y2 - op.y, op.x2 - op.x);
        const bx = op.x2 - Math.cos(angle) * head;
        const by = op.y2 - Math.sin(angle) * head;
        c.strokeStyle = op.color;
        c.fillStyle = op.color;
        c.lineWidth = op.width;
        c.lineCap = "butt";
        c.beginPath();
        c.moveTo(op.x, op.y);
        c.lineTo(bx, by);
        c.stroke();
        const px = -Math.sin(angle) * head * 0.5;
        const py = Math.cos(angle) * head * 0.5;
        c.beginPath();
        c.moveTo(op.x2, op.y2);
        c.lineTo(bx + px, by + py);
        c.lineTo(bx - px, by - py);
        c.closePath();
        c.fill();
        break;
      }
      case "text":
        c.font = `600 ${op.size}px -apple-system, system-ui, sans-serif`;
        c.textBaseline = "top";
        c.fillStyle = op.color;
        c.fillText(op.text, op.x, op.y);
        break;
      case "blur": {
        // Pixelate: downscale the base image region ~1/12 and scale it
        // back up. Unlike a soft blur, this destroys the underlying
        // pixels deterministically — it can't be reversed by viewers.
        const sw = Math.max(1, Math.round(op.w / PIXELATE_FACTOR));
        const sh = Math.max(1, Math.round(op.h / PIXELATE_FACTOR));
        const tmp = document.createElement("canvas");
        tmp.width = sw;
        tmp.height = sh;
        const tctx = tmp.getContext("2d");
        tctx.imageSmoothingEnabled = true;
        tctx.drawImage(baseImg, op.x, op.y, op.w, op.h, 0, 0, sw, sh);
        c.imageSmoothingEnabled = true;
        c.drawImage(tmp, 0, 0, sw, sh, op.x, op.y, op.w, op.h);
        break;
      }
    }
  }

  function composeExport() {
    const crop = currentCrop();
    const out = document.createElement("canvas");
    out.width = crop.w;
    out.height = crop.h;
    const c = out.getContext("2d");
    c.translate(-crop.x, -crop.y);
    drawComposition(c);
    return out;
  }

  // --- History ----------------------------------------------------------

  function pushOp(op) {
    ops.push(op);
    redoStack = [];
    updateHistoryButtons();
  }

  function undo() {
    if (pendingCrop) {
      cancelPendingCrop();
      return;
    }
    if (!ops.length) return;
    const op = ops.pop();
    redoStack.push(op);
    updateHistoryButtons();
    if (op.type === "crop") updateLayout();
    render();
  }

  function redo() {
    if (!redoStack.length) return;
    const op = redoStack.pop();
    ops.push(op);
    updateHistoryButtons();
    if (op.type === "crop") updateLayout();
    render();
  }

  function updateHistoryButtons() {
    undoBtn.disabled = !ops.length && !pendingCrop;
    redoBtn.disabled = !redoStack.length;
  }

  // --- Toolbar ----------------------------------------------------------

  function setTool(next) {
    tool = next;
    document.querySelectorAll("[data-tool]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tool === tool);
    });
    canvasWrap.className = "canvas-wrap tool-" + tool;
    if (tool !== "crop") cancelPendingCrop();
  }

  document.querySelectorAll("[data-tool]").forEach((btn) => {
    btn.addEventListener("click", () => setTool(btn.dataset.tool));
  });

  document.querySelectorAll("[data-color]").forEach((btn) => {
    btn.addEventListener("click", () => {
      color = btn.dataset.color;
      document.querySelectorAll("[data-color]").forEach((b) => {
        b.classList.toggle("active", b === btn);
      });
      if (!textInput.hidden) textInput.style.color = color;
    });
  });

  document.querySelectorAll("[data-stroke]").forEach((btn) => {
    btn.addEventListener("click", () => {
      stroke = btn.dataset.stroke;
      document.querySelectorAll("[data-stroke]").forEach((b) => {
        b.classList.toggle("active", b === btn);
      });
    });
  });

  undoBtn.addEventListener("click", undo);
  redoBtn.addEventListener("click", redo);

  // --- Pointer handling (all coordinates converted to image space) ------

  function toImagePoint(e) {
    const crop = currentCrop();
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * crop.w + crop.x;
    const y = ((e.clientY - rect.top) / rect.height) * crop.h + crop.y;
    return {
      x: Math.min(Math.max(x, crop.x), crop.x + crop.w),
      y: Math.min(Math.max(y, crop.y), crop.y + crop.h),
    };
  }

  function normalizeDrag() {
    return {
      x: Math.round(Math.min(drag.x, drag.x2)),
      y: Math.round(Math.min(drag.y, drag.y2)),
      w: Math.round(Math.abs(drag.x2 - drag.x)),
      h: Math.round(Math.abs(drag.y2 - drag.y)),
    };
  }

  function dragToOp() {
    const width = STROKES[stroke];
    if (tool === "arrow") {
      if (Math.hypot(drag.x2 - drag.x, drag.y2 - drag.y) < MIN_DRAG) return null;
      return {
        type: "arrow",
        x: drag.x, y: drag.y, x2: drag.x2, y2: drag.y2,
        color, width,
      };
    }
    const r = normalizeDrag();
    if (r.w < MIN_DRAG || r.h < MIN_DRAG) return null;
    if (tool === "rect") {
      return { type: "rect", x: r.x, y: r.y, w: r.w, h: r.h, color, width };
    }
    if (tool === "blur") {
      return { type: "blur", x: r.x, y: r.y, w: r.w, h: r.h };
    }
    return null;
  }

  canvas.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || !baseImg) return;
    if (tool === "text") {
      e.preventDefault();
      openTextInput(toImagePoint(e));
      return;
    }
    if (tool === "select") return;
    e.preventDefault();
    if (tool === "crop") cancelPendingCrop();
    const p = toImagePoint(e);
    drag = { x: p.x, y: p.y, x2: p.x, y2: p.y };
  });

  window.addEventListener("mousemove", (e) => {
    if (!drag) return;
    const p = toImagePoint(e);
    drag.x2 = p.x;
    drag.y2 = p.y;
    scheduleRender();
  });

  window.addEventListener("mouseup", () => {
    if (!drag) return;
    if (tool === "crop") {
      const r = normalizeDrag();
      if (r.w >= MIN_DRAG && r.h >= MIN_DRAG) {
        pendingCrop = r;
        showCropApply();
      }
    } else {
      const op = dragToOp();
      if (op) pushOp(op);
    }
    drag = null;
    updateHistoryButtons();
    render();
  });

  // --- Crop apply / cancel ----------------------------------------------

  function showCropApply() {
    cropApplyBtn.hidden = false;
    positionCropApply();
  }

  function positionCropApply() {
    if (!pendingCrop) return;
    const crop = currentCrop();
    const left = (pendingCrop.x + pendingCrop.w - crop.x) * displayScale;
    const top = (pendingCrop.y + pendingCrop.h - crop.y) * displayScale;
    cropApplyBtn.style.left = Math.max(0, left - 34) + "px";
    cropApplyBtn.style.top = Math.max(0, top - 34) + "px";
  }

  function applyCrop() {
    if (!pendingCrop || pendingCrop.w < 1 || pendingCrop.h < 1) return;
    pushOp({ type: "crop", rect: pendingCrop, prev: currentCrop() });
    pendingCrop = null;
    cropApplyBtn.hidden = true;
    updateLayout();
    render();
  }

  function cancelPendingCrop() {
    if (!pendingCrop) return;
    pendingCrop = null;
    cropApplyBtn.hidden = true;
    updateHistoryButtons();
    render();
  }

  cropApplyBtn.addEventListener("click", applyCrop);

  // --- Text tool ----------------------------------------------------------

  function openTextInput(p) {
    commitTextInput(); // commit any open one first
    const crop = currentCrop();
    const size = TEXT_SIZES[stroke];
    textCancelled = false;
    textInput.value = "";
    textInput.dataset.x = p.x;
    textInput.dataset.y = p.y;
    textInput.dataset.size = size;
    textInput.style.left = (p.x - crop.x) * displayScale + "px";
    textInput.style.top = (p.y - crop.y) * displayScale + "px";
    textInput.style.fontSize = size * displayScale + "px";
    textInput.style.color = color;
    textInput.hidden = false;
    textInput.focus();
  }

  function commitTextInput() {
    if (textInput.hidden) return;
    const text = textInput.value.trim();
    textInput.hidden = true;
    if (textCancelled || !text) return;
    pushOp({
      type: "text",
      x: parseFloat(textInput.dataset.x),
      y: parseFloat(textInput.dataset.y),
      text,
      color: textInput.style.color,
      size: parseFloat(textInput.dataset.size),
    });
    render();
  }

  textInput.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      commitTextInput();
    } else if (e.key === "Escape") {
      textCancelled = true;
      textInput.hidden = true;
      textInput.blur();
    }
  });

  textInput.addEventListener("blur", commitTextInput);

  // --- Export -------------------------------------------------------------

  function showToast(msg, isError) {
    toast.textContent = msg;
    toast.className = "toast show" + (isError ? " error" : "");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.className = "toast";
      toastTimer = null;
    }, 1800);
  }

  async function copyToClipboard() {
    if (!baseImg) return;
    try {
      const blob = await fpc.canvasToPngBlob(composeExport());
      // Firefox ClipboardItem only accepts image/png
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
      ]);
      showToast("Copied ✓");
    } catch (e) {
      showToast("✗ " + e.message, true);
    }
  }

  async function saveFile() {
    if (!baseImg) return;
    try {
      const blob = await fpc.canvasToPngBlob(composeExport());
      const settings = await fpc.getSettings();
      let ext, out;
      if (settings.format === "pdf") {
        ext = "pdf";
        out = await fpc.imageToPdf(blob, settings.quality);
      } else {
        ext = settings.format === "jpeg" ? "jpg" : settings.format;
        out = await fpc.convertImage(blob, settings.format, settings.quality);
      }
      const result = await browser.runtime.sendMessage({
        action: "download",
        dataUrl: await fpc.blobToDataUrl(out),
        // The editor tab's own title/hostname would be wrong for {title}
        // and {domain} — use the captured page's, passed via pendingEdit.
        filename: fpc.buildFilename(settings.filenameTemplate, ext, meta),
        saveAs: settings.saveAs,
      });
      if (!result || !result.success)
        throw new Error((result && result.error) || "Download failed");
      showToast("Saved ✓");
    } catch (e) {
      showToast("✗ " + e.message, true);
    }
  }

  copyBtn.addEventListener("click", copyToClipboard);
  saveBtn.addEventListener("click", saveFile);

  // --- Keyboard -----------------------------------------------------------

  document.addEventListener("keydown", (e) => {
    if (e.target === textInput) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && e.key.toLowerCase() === "z") {
      e.preventDefault();
      undo();
    } else if ((mod && e.shiftKey && e.key.toLowerCase() === "z") ||
               (mod && e.key.toLowerCase() === "y")) {
      e.preventDefault();
      redo();
    } else if (mod && e.key.toLowerCase() === "c") {
      e.preventDefault();
      copyToClipboard();
    } else if (e.key === "Enter" && pendingCrop) {
      e.preventDefault();
      applyCrop();
    } else if (e.key === "Escape") {
      if (drag) {
        drag = null;
        render();
      } else {
        cancelPendingCrop();
      }
    }
  });
})();
