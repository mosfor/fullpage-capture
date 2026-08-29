// FullPage Capture - E2E test hook (test builds only, never shipped).
// Lets the harness trigger a capture from page context and read the result
// back out of the DOM. Injected via a patched manifest by test/e2e/run.js.

(() => {
  if (window._fpcTestHookInstalled) return;
  window._fpcTestHookInstalled = true;

  function resultNode() {
    let el = document.getElementById("fpc-test-result");
    if (!el) {
      el = document.createElement("textarea");
      el.id = "fpc-test-result";
      el.style.display = "none";
      document.body.appendChild(el);
    }
    return el;
  }

  window.addEventListener("message", async (ev) => {
    if (!ev.data || (ev.data.type !== "FPC_TEST_CAPTURE" && ev.data.type !== "FPC_TEST_DIAG")) return;
    const node = resultNode();
    node.dataset.status = "running";
    try {
      const fpc = window.FullPageCapture;
      if (ev.data.type === "FPC_TEST_DIAG") {
        const container = fpc.getScrollContainer();
        node.value = JSON.stringify({
          container: container && {
            tag: container.tagName,
            id: container.id,
            cls: String(container.className).slice(0, 100),
            client: [container.clientWidth, container.clientHeight],
            scroll: [container.scrollWidth, container.scrollHeight],
          },
          dims: fpc.getPageDimensions(),
          dpr: window.devicePixelRatio,
          fixed: fpc.findFixedElements().map((f) => ({
            tag: f.el.tagName,
            id: f.el.id,
            cls: String(f.el.className).slice(0, 100),
            position: f.position,
          })),
        });
      } else {
        const result = await fpc.captureFullPage();
        node.value = typeof result === "string" ? result : await fpc.blobToDataUrl(result);
      }
      node.dataset.status = "ok";
    } catch (e) {
      node.value = String(e && e.message);
      node.dataset.status = "error";
    }
  });
})();
