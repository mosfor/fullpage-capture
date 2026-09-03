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

  fpc.convertImage = async function convertImage(blob, format, quality) {
    if (format !== "jpeg" && format !== "webp") return blob;

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

  fpc.outputResult = async function outputResult(image, output) {
    const blob = image instanceof Blob
      ? image
      : await fetch(image).then((res) => res.blob());

    if (output === "file") {
      const settings = await fpc.getSettings();
      const converted = await fpc.convertImage(
        blob,
        settings.format,
        settings.quality
      );
      const ext = settings.format === "jpeg" ? "jpg" : settings.format;
      const dataUrl = converted === blob && !(image instanceof Blob)
        ? image
        : await fpc.blobToDataUrl(converted);
      const dlResult = await browser.runtime.sendMessage({
        action: "download",
        dataUrl,
        filename: fpc.buildFilename(settings.filenameTemplate, ext),
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
