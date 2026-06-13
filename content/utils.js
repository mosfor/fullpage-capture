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
    el.innerHTML = isError
      ? '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
      : '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    el.style.setProperty("opacity", "1", "important");
    el.style.setProperty("transform", "translateX(-50%) scale(1)", "important");
    setTimeout(() => {
      el.style.setProperty("opacity", "0", "important");
      el.style.setProperty("transform", "translateX(-50%) scale(0.8)", "important");
    }, 1500);
  };

  fpc.outputResult = async function outputResult(dataUrl, output) {
    if (output === "file") {
      const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .slice(0, 19);
      const dlResult = await browser.runtime.sendMessage({
        action: "download",
        dataUrl,
        filename: `capture-${timestamp}.png`,
      });
      if (!dlResult.success)
        throw new Error(dlResult.error || "Download failed");
    } else {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
      ]);
    }
  };
})();
