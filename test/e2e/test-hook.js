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
    if (!ev.data || ev.data.type !== "FPC_TEST_CAPTURE") return;
    const el = resultNode();
    el.dataset.status = "running";
    try {
      const fpc = window.FullPageCapture;
      const result = await fpc.captureFullPage();
      el.value = typeof result === "string" ? result : await fpc.blobToDataUrl(result);
      el.dataset.status = "ok";
    } catch (e) {
      el.value = String(e && e.message);
      el.dataset.status = "error";
    }
  });
})();
