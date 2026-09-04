// FullPage Capture - Shared utilities and output handling

(() => {
  const fpc = (window.FullPageCapture ||= {});

  fpc.loadImage = function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  };

  fpc.sleep = function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  };

  fpc.nextPaint = function nextPaint() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
  };

  fpc.waitForCaptureReady = async function waitForCaptureReady() {
    await fpc.nextPaint();
    await fpc.sleep(80);
  };

  fpc.canvasToPngBlob = function canvasToPngBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Failed to encode screenshot"));
      }, "image/png");
    });
  };

  fpc.blobToDataUrl = function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error("Failed to read screenshot"));
      reader.readAsDataURL(blob);
    });
  };

  let notifyTimer = null;

  fpc.notify = function notify(text) {
    let el = document.getElementById("_fullpage-capture-notify");
    if (!el) {
      el = document.createElement("div");
      el.id = "_fullpage-capture-notify";
      el.setAttribute("style", [
        "position:fixed!important",
        "top:20px!important",
        "left:50%!important",
        "transform:translateX(-50%) scale(0)!important",
        "z-index:2147483647!important",
        "width:56px!important",
        "height:56px!important",
        "border-radius:50%!important",
        "display:flex!important",
        "align-items:center!important",
        "justify-content:center!important",
        "box-shadow:0 4px 16px rgba(0,0,0,.2)!important",
        "transition:opacity .3s,transform .3s cubic-bezier(0.34,1.56,0.64,1)!important",
        "pointer-events:none!important",
        "opacity:0!important",
        "padding:0!important",
        "margin:0!important",
        "overflow:hidden!important",
        "box-sizing:border-box!important",
        "line-height:1!important",
      ].join(";"));
      document.body.appendChild(el);
    }
    const isError = text.startsWith("✗");
    el.style.setProperty("background", isError ? "#d32f2f" : "#2e7d32", "important");
    el.textContent = isError ? "×" : "✓";
    el.style.setProperty("color", "#fff", "important");
    el.style.setProperty("font", "700 30px system-ui, sans-serif", "important");
    el.style.setProperty("opacity", "1", "important");
    el.style.setProperty("transform", "translateX(-50%) scale(1)", "important");
    if (notifyTimer) clearTimeout(notifyTimer);
    notifyTimer = setTimeout(() => {
      el.style.setProperty("opacity", "0", "important");
      el.style.setProperty("transform", "translateX(-50%) scale(0.8)", "important");
      notifyTimer = null;
    }, 1500);
  };

  // Capture delay: shows an on-page countdown for `captureDelay` seconds so
  // the user can set up hover states or open dropdowns before the shot.
  // Escape cancels (throws "cancelled", handled silently upstream). The
  // countdown element is removed and a paint awaited BEFORE resolving so it
  // can never appear in the capture; its class deliberately avoids "fixed"/
  // "sticky" substrings so the fixed-element hider never targets it either.
  fpc.delayBeforeCapture = async function delayBeforeCapture() {
    const settings = await fpc.getSettings();
    const seconds = Math.max(0, parseInt(settings.captureDelay, 10) || 0);
    if (seconds === 0) return;

    const el = document.createElement("div");
    el.className = "_fullpage-capture-countdown";
    el.setAttribute("style", [
      "position:fixed!important",
      "top:20px!important",
      "right:20px!important",
      "z-index:2147483647!important",
      "min-width:48px!important",
      "padding:8px 12px!important",
      "border-radius:8px!important",
      "background:rgba(0,0,0,0.75)!important",
      "color:#fff!important",
      "font:700 20px system-ui, sans-serif!important",
      "text-align:center!important",
      "pointer-events:none!important",
      "box-shadow:0 4px 16px rgba(0,0,0,.2)!important",
      "margin:0!important",
      "box-sizing:border-box!important",
      "line-height:1.2!important",
    ].join(";"));
    document.body.appendChild(el);

    let cancel;
    const cancelPromise = new Promise((resolve) => {
      cancel = () => resolve(true);
    });
    const onKey = (e) => {
      if (e.key === "Escape") {
        // Swallow the key so it only cancels the capture, not whatever
        // menu/dialog the user set up on the page during the delay.
        e.preventDefault();
        e.stopPropagation();
        cancel();
      }
    };
    // Switching away mid-countdown cancels: a viewport capture of a hidden
    // tab would grab whatever tab is visible instead, and rAF (used below
    // to hide the badge) never fires while hidden, hanging the capture.
    const onVisibility = () => {
      if (document.hidden) cancel();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("visibilitychange", onVisibility);

    let cancelled = document.hidden;
    try {
      for (let remaining = seconds; remaining > 0 && !cancelled; remaining--) {
        el.textContent = remaining + "…";
        cancelled = await Promise.race([
          fpc.sleep(1000).then(() => false),
          cancelPromise,
        ]);
      }
    } finally {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("visibilitychange", onVisibility);
      // Must not appear in the shot: remove, then wait two rAFs for the
      // removal to actually paint before any capture fires (rAF is paused
      // in hidden tabs, so skip the wait there — nothing paints anyway).
      el.remove();
      if (!document.hidden) await fpc.nextPaint();
    }

    if (cancelled) throw new Error("cancelled");
  };

  // Only JPEG re-encoding is supported: Firefox's canvas.toBlob has no WebP
  // encoder and silently falls back to PNG for unknown types, so any other
  // format value passes through as the original PNG.
  fpc.convertImage = async function convertImage(blob, format, quality) {
    if (format !== "jpeg") return blob;

    const url = URL.createObjectURL(blob);
    try {
      const img = await fpc.loadImage(url);
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (format === "jpeg") {
        // JPEG has no alpha; transparent areas would encode as black
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(img, 0, 0);
      return await new Promise((resolve, reject) => {
        canvas.toBlob((out) => {
          if (out) resolve(out);
          else reject(new Error("Failed to encode screenshot"));
        }, "image/" + format, quality / 100);
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  // Expand {title} {domain} {date} {time} {timestamp} in a filename
  // template and sanitize the result for cross-platform use. `overrides`
  // lets callers (e.g. the options page preview) substitute sample values.
  fpc.buildFilename = function buildFilename(template, ext, overrides) {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const values = Object.assign({
      title: document.title,
      domain: location.hostname,
      date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
      time: `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`,
      timestamp: String(Math.floor(now.getTime() / 1000)),
    }, overrides);

    let name = String(template)
      // Known tokens expand; unknown tokens keep their text, braces dropped
      .replace(/\{(\w+)\}/g, (match, key) =>
        Object.prototype.hasOwnProperty.call(values, key) ? values[key] : key
      )
      .replace(/[{}]/g, "")
      // Characters illegal in filenames on any major OS, plus control chars
      .replace(/[/\\:*?"<>|\u0000-\u001f\u007f]+/g, "-")
      .replace(/-{2,}/g, "-")
      .slice(0, 120)
      .replace(/^[-. ]+|[-. ]+$/g, "");

    return `${name || "capture"}.${ext}`;
  };

  fpc.extForFormat = function extForFormat(format) {
    return format === "jpeg" ? "jpg" : format;
  };

  // Encode a PNG capture blob per the user's format settings. Single home
  // for the format→encoder fork and extension mapping, shared by the
  // capture path, the editor's Save, and the options-page preview.
  fpc.encodeForSave = async function encodeForSave(blob, settings) {
    if (settings.format === "pdf") {
      return { blob: await fpc.imageToPdf(blob, settings.quality), ext: "pdf" };
    }
    return {
      blob: await fpc.convertImage(blob, settings.format, settings.quality),
      ext: fpc.extForFormat(settings.format),
    };
  };

  fpc.outputResult = async function outputResult(image, output) {
    const blob = image instanceof Blob
      ? image
      : await fetch(image).then((res) => res.blob());

    if (output === "edit") {
      const dataUrl = image instanceof Blob
        ? await fpc.blobToDataUrl(image)
        : image;
      const result = await browser.runtime.sendMessage({
        action: "openEditor",
        dataUrl,
      });
      if (!result || !result.success)
        throw new Error((result && result.error) || "Failed to open editor");
    } else if (output === "file") {
      const settings = await fpc.getSettings();
      const encoded = await fpc.encodeForSave(blob, settings);
      const dlResult = await browser.runtime.sendMessage({
        action: "download",
        dataUrl: await fpc.blobToDataUrl(encoded.blob),
        filename: fpc.buildFilename(settings.filenameTemplate, encoded.ext),
        saveAs: settings.saveAs,
      });
      if (!dlResult.success)
        throw new Error(dlResult.error || "Download failed");
    } else {
      // Firefox ClipboardItem only accepts image/png
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
      ]);
    }
  };
})();
