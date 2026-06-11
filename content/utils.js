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
        top: "16px",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: "2147483647",
        padding: "8px 16px",
        borderRadius: "6px",
        font: "600 14px system-ui, sans-serif",
        color: "#fff",
        boxShadow: "0 2px 8px rgba(0,0,0,.2)",
        transition: "opacity .3s",
        pointerEvents: "none",
      });
      document.body.appendChild(el);
    }
    Object.assign(el.style, {
      top: "16px",
      left: "50%",
      right: "auto",
      transform: "translateX(-50%)",
    });
    el.style.background = text.startsWith("✗") ? "#d32f2f" : "#2d7d46";
    el.textContent = text;
    el.style.opacity = "1";
    setTimeout(() => {
      el.style.opacity = "0";
    }, 2000);
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
