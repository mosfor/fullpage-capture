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
      Object.assign(el.style, {
        position: "fixed",
        top: "20px",
        left: "50%",
        transform: "translateX(-50%) scale(0)",
        zIndex: "2147483647",
        width: "48px",
        height: "48px",
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 4px 12px rgba(0,0,0,.15)",
        transition: "opacity .3s, transform .3s cubic-bezier(0.34,1.56,0.64,1)",
        pointerEvents: "none",
        opacity: "0",
      });
      document.body.appendChild(el);
    }
    const isError = text.startsWith("✗");
    el.style.background = isError ? "#d32f2f" : "#2e7d32";
    el.innerHTML = isError
      ? '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
      : '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    el.style.opacity = "1";
    el.style.transform = "translateX(-50%) scale(1)";
    setTimeout(() => {
      el.style.opacity = "0";
      el.style.transform = "translateX(-50%) scale(0.8)";
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
