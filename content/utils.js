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

  // ---- On-page overlay: countdown, success, failure ----
  // Lives in a closed shadow root so page CSS can't restyle it and ours
  // can't leak. Hosts are removed as soon as they're done (and before any
  // capture), so the fixed-element hider never meets them.
  const OVERLAY_CSS = `
    :host { all: initial; }
    .stage { position: fixed; inset: 0; display: grid; place-items: center; pointer-events: none;
      font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
    .wrap { display: grid; justify-items: center; }
    .wrap.out { animation: fpc-fade .3s ease-in forwards; }
    .disc { width: 84px; height: 84px; border-radius: 50%; display: grid; place-items: center; color: #fff;
      box-shadow: 0 12px 36px rgba(0,0,0,.28); animation: fpc-pop .45s cubic-bezier(.34,1.56,.64,1); }
    .disc svg { width: 42px; height: 42px; }
    .disc.ok { background: #1F9D55; }
    .disc.bad { background: #E11B1B; animation: fpc-pop .45s cubic-bezier(.34,1.56,.64,1), fpc-shake .4s ease .4s; }
    .draw { stroke-dasharray: 1; stroke-dashoffset: 1; animation: fpc-draw .4s ease-out .18s forwards; }
    .draw.second { animation-delay: .32s; }
    .label { margin-top: 12px; max-width: 70vw; padding: 7px 13px; border-radius: 999px; background: rgba(20,22,26,.88);
      color: #fff; font-size: 13px; font-weight: 600; line-height: 1.25; text-align: center;
      animation: fpc-rise .35s ease-out .2s both; }
    .count { position: relative; width: 132px; height: 132px; display: grid; place-items: center; border-radius: 50%;
      background: rgba(255,255,255,.94); box-shadow: 0 14px 44px rgba(0,0,0,.3);
      animation: fpc-pop .4s cubic-bezier(.34,1.56,.64,1); }
    .count svg { position: absolute; inset: 0; width: 100%; height: 100%; }
    .count circle { fill: none; stroke-width: 5; }
    .count .track { stroke: rgba(240,160,32,.22); }
    .count .arc { stroke: #F0A020; stroke-linecap: round; stroke-dasharray: 1; transform: rotate(-90deg);
      transform-origin: center; animation: fpc-drain 1s linear forwards; }
    .count .num { font-size: 60px; font-weight: 600; line-height: 1; letter-spacing: -.04em; color: #F0A020;
      font-variant-numeric: tabular-nums; animation: fpc-digit .25s ease-out; }
    @keyframes fpc-pop { 0% { transform: scale(.4); opacity: 0; } 60% { transform: scale(1.08); opacity: 1; } 100% { transform: scale(1); } }
    @keyframes fpc-draw { to { stroke-dashoffset: 0; } }
    @keyframes fpc-rise { from { transform: translateY(8px); opacity: 0; } to { transform: none; opacity: 1; } }
    @keyframes fpc-fade { to { opacity: 0; transform: scale(.92); } }
    @keyframes fpc-drain { to { stroke-dashoffset: 1; } }
    @keyframes fpc-digit { from { transform: translateY(10px) scale(.8); opacity: 0; } to { transform: none; opacity: 1; } }
    @keyframes fpc-shake { 0%, 100% { transform: translateX(0); } 20% { transform: translateX(-6px); } 40% { transform: translateX(6px); } 60% { transform: translateX(-3px); } 80% { transform: translateX(3px); } }
    @media (prefers-reduced-motion: reduce) { * { animation-duration: .01ms !important; } }
  `;
  const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline class="draw" pathLength="1" points="20 6 9 17 4 12"/></svg>';
  const ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line class="draw" pathLength="1" x1="18" y1="6" x2="6" y2="18"/><line class="draw second" pathLength="1" x1="6" y1="6" x2="18" y2="18"/></svg>';

  // Hosts are tracked here, not looked up by id, so a page element that
  // happens to share the id is never touched.
  const overlayHosts = new Map();

  function mountOverlay(id) {
    const old = overlayHosts.get(id);
    if (old) old.remove();
    const host = document.createElement("div");
    host.id = id;
    overlayHosts.set(id, host);
    host.setAttribute("style", "position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;");
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `<style>${OVERLAY_CSS}</style><div class="stage"></div>`;
    (document.body || document.documentElement).appendChild(host);
    return { host, stage: root.querySelector(".stage") };
  }

  function unmountOverlay(id) {
    const host = overlayHosts.get(id);
    if (host) host.remove();
    overlayHosts.delete(id);
  }

  // Restart a CSS animation on an element (used for each countdown tick)
  function replay(el) {
    el.style.animation = "none";
    void el.offsetWidth;
    el.style.animation = "";
  }

  let notifyTimer = null;
  let notifyHost = null;

  // Take down a result disc that is still showing. Returns true if there
  // was one, so callers can wait a paint before capturing.
  fpc.dismissNotify = function dismissNotify() {
    if (notifyTimer) clearTimeout(notifyTimer);
    notifyTimer = null;
    const had = !!notifyHost;
    unmountOverlay("_fullpage-capture-notify");
    notifyHost = null;
    return had;
  };

  // Centered result disc: a check mark or cross that draws itself, with the
  // outcome spelled out underneath. kind is "success" or "error".
  fpc.notify = function notify(kind, text) {
    fpc.dismissNotify();
    const ok = kind === "success";
    const { host, stage } = mountOverlay("_fullpage-capture-notify");
    notifyHost = host;

    const wrap = document.createElement("div");
    wrap.className = "wrap";
    const disc = document.createElement("div");
    disc.className = "disc " + (ok ? "ok" : "bad");
    disc.innerHTML = ok ? ICON_CHECK : ICON_X;
    wrap.appendChild(disc);
    if (text) {
      const label = document.createElement("div");
      label.className = "label";
      label.textContent = text;
      wrap.appendChild(label);
    }
    stage.appendChild(wrap);

    notifyTimer = setTimeout(() => {
      wrap.classList.add("out");
      notifyTimer = setTimeout(() => {
        unmountOverlay("_fullpage-capture-notify");
        notifyHost = null;
        notifyTimer = null;
      }, 320);
    }, ok ? 1400 : 2800);
  };

  // Capture delay: shows a centered on-page countdown for `captureDelay`
  // seconds so the user can set up hover states or open dropdowns before
  // the shot. Escape cancels (throws "cancelled", handled silently
  // upstream). The overlay is removed and a paint awaited BEFORE resolving
  // so it can never appear in the capture.
  // The popup can cancel a running countdown too (Escape there closes the
  // popup rather than reaching the page's keydown listener). A Set, not a
  // slot: overlapping countdowns (popup + keyboard command) must all stop,
  // and one finishing must not drop another's hook. If the request lands
  // before a countdown is cancellable (still loading settings), remember
  // it and let the next delayBeforeCapture consume it.
  const activeCancels = new Set();
  let cancelRequested = false;
  fpc.cancelDelay = function cancelDelay() {
    if (activeCancels.size === 0) {
      cancelRequested = true;
      return;
    }
    for (const cancel of activeCancels) cancel();
  };
  fpc.clearCancelRequest = function clearCancelRequest() {
    cancelRequested = false;
  };

  fpc.delayBeforeCapture = async function delayBeforeCapture() {
    const settings = await fpc.getSettings();
    const seconds = Math.max(0, parseInt(settings.captureDelay, 10) || 0);
    if (cancelRequested) {
      cancelRequested = false;
      throw new Error("cancelled");
    }
    if (seconds === 0) return;

    const { host, stage } = mountOverlay("_fullpage-capture-countdown");
    stage.innerHTML = '<div class="wrap"><div class="count"><svg viewBox="0 0 132 132">' +
      '<circle class="track" cx="66" cy="66" r="62"/><circle class="arc" cx="66" cy="66" r="62" pathLength="1"/>' +
      '</svg><div class="num"></div></div><div class="label">Esc to cancel</div></div>';
    const num = stage.querySelector(".num");
    const arc = stage.querySelector(".arc");
    const showCount = (n) => {
      num.textContent = n;
      replay(num);
      replay(arc);
    };

    let cancel;
    const cancelPromise = new Promise((resolve) => {
      cancel = () => resolve(true);
    });
    activeCancels.add(cancel);
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
        showCount(remaining);
        cancelled = await Promise.race([
          fpc.sleep(1000).then(() => false),
          cancelPromise,
        ]);
      }
    } finally {
      activeCancels.delete(cancel);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("visibilitychange", onVisibility);
      // Must not appear in the shot: remove the overlay, then wait two rAFs
      // for the removal to paint before any capture fires (rAF is paused in
      // hidden tabs, so skip the wait there — nothing paints anyway).
      unmountOverlay("_fullpage-capture-countdown");
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
