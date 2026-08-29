// FullPage Capture - E2E runner.
// Installs the real extension into headless Firefox and verifies capture
// output pixel-by-pixel against position-encoded fixture pages.
//
// Usage:
//   cd test/e2e && npm install && node run.js
// Env:
//   FIREFOX_BIN     path to firefox binary   (default: firefox on PATH)
//   GECKODRIVER_BIN path to geckodriver      (default: geckodriver on PATH)

const fs = require("fs");
const path = require("path");
const http = require("http");

const { PNG } = require("pngjs");
const { makeDriver, hookMessage } = require("./common");

const FIXTURES = path.join(__dirname, "fixtures");
const PORT = 8899;

// ---------- fixture server ----------

function serveFixtures() {
  const server = http.createServer((req, res) => {
    const file = path.join(FIXTURES, path.normalize(req.url).replace(/^\/+/, ""));
    if (!file.startsWith(FIXTURES) || !fs.existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": "text/html" }).end(fs.readFileSync(file));
  });
  return new Promise((resolve) => server.listen(PORT, "127.0.0.1", () => resolve(server)));
}

// ---------- pixel helpers ----------

function px(png, x, y) {
  const i = (Math.round(y) * png.width + Math.round(x)) * 4;
  return [png.data[i], png.data[i + 1], png.data[i + 2]];
}

function near(a, b, tol = 3) {
  return a.every((v, i) => Math.abs(v - b[i]) <= tol);
}

// Snap a page coordinate to its 16px cell center and return [probe, expectedColor].
function cellProbe(x, y) {
  const cx = Math.floor(x / 16);
  const cy = Math.floor(y / 16);
  return {
    x: cx * 16 + 8,
    y: cy * 16 + 8,
    color: [(cx + 1) & 255, (cy + 1) & 255, 64],
  };
}

const failures = [];
function check(name, ok, detail) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -- " + detail}`);
  if (!ok) failures.push(name);
}

function checkGrid(png, name, x, y, ox = 0, oy = 0) {
  const p = cellProbe(x, y);
  const got = px(png, ox + p.x, oy + p.y);
  check(`${name} grid@(${p.x},${p.y})`, near(got, p.color), `expected rgb(${p.color}) got rgb(${got})`);
}

// Container metrics needed to locate the expanded container inside the
// chrome-preserving output.
function containerMetrics(driver) {
  return driver.executeScript(`
    const el = document.getElementById("container");
    const r = el.getBoundingClientRect();
    return {
      vw: document.documentElement.clientWidth, vh: document.documentElement.clientHeight,
      left: Math.round(r.left + el.clientLeft), top: Math.round(r.top + el.clientTop),
      cw: el.clientWidth, ch: el.clientHeight, sw: el.scrollWidth, sh: el.scrollHeight,
    };`);
}

// ---------- capture via test hook ----------

async function capture(driver, url) {
  await driver.get(url);
  await driver.wait(async () => (await driver.getTitle()).includes("[grid-ready]"), 10000);
  // let the content scripts settle
  await driver.sleep(500);
  const dataUrl = await hookMessage(driver, "FPC_TEST_CAPTURE");
  return PNG.sync.read(Buffer.from(dataUrl.split(",")[1], "base64"));
}

// ---------- main ----------

(async () => {
  const server = await serveFixtures();
  const driver = await makeDriver();

  try {
    // --- fixture 1: document scroller -> direct captureTab path ---
    console.log("fixture: direct.html (document scroller, direct render path)");
    let png = await capture(driver, `http://127.0.0.1:${PORT}/direct.html`);
    check("direct height = 3600", png.height === 3600, `got ${png.height}`);
    check("direct width >= 1200", png.width >= 1200, `got ${png.width}`);
    check("topbar painted once (top)", near(px(png, 600, 20), [0, 0, 255]), `got ${px(png, 600, 20)}`);
    check("topbar not repeated below fold", !near(px(png, 600, 900), [0, 0, 255]), `got ${px(png, 600, 900)}`);
    check("sidebar painted once (top)", near(px(png, 90, 100), [255, 0, 0]), `got ${px(png, 90, 100)}`);
    check("sidebar not repeated below fold", !near(px(png, 90, 2000), [255, 0, 0]), `got ${px(png, 90, 2000)}`);
    checkGrid(png, "direct", 600, 200);
    checkGrid(png, "direct", 600, 1500);
    checkGrid(png, "direct", 900, 2600);
    checkGrid(png, "direct", 600, 3560);
    const restored1 = await driver.executeScript(
      'return { scrollY: window.scrollY, sticky: getComputedStyle(document.getElementById("sidebar")).position }');
    check("direct: page state restored", restored1.scrollY === 0 && restored1.sticky === "sticky",
      JSON.stringify(restored1));

    // --- fixture 2: bordered inner scroll container -> stitch path ---
    console.log("fixture: inner.html (bordered inner container, stitch path)");
    png = await capture(driver, `http://127.0.0.1:${PORT}/inner.html`);
    let m = await containerMetrics(driver);
    let expW = m.vw - m.cw + m.sw;
    let expH = m.vh - m.ch + m.sh;
    check(`inner size = ${expW}x${expH} (chrome + expanded container)`,
      png.width === Math.round(expW) && png.height === Math.round(expH),
      `got ${png.width}x${png.height}`);
    check("inner chrome marker painted once", near(px(png, 10, 10), [255, 0, 255]), `got ${px(png, 10, 10)}`);
    check("inner blank continuation = body bg",
      near(px(png, 10, m.top + m.ch + 300), [0, 128, 0]), `got ${px(png, 10, m.top + m.ch + 300)}`);
    check("inner sticky painted once (top)",
      near(px(png, m.left + 75, m.top + 60), [255, 0, 0]), `got ${px(png, m.left + 75, m.top + 60)}`);
    check("inner sticky not repeated below fold",
      !near(px(png, m.left + 75, m.top + 1500), [255, 0, 0]), `got ${px(png, m.left + 75, m.top + 1500)}`);
    checkGrid(png, "inner", 500, 200, m.left, m.top);   // border offset: a 10px shift breaks these
    checkGrid(png, "inner", 500, 1400, m.left, m.top);
    checkGrid(png, "inner", 500, 2900, m.left, m.top);
    checkGrid(png, "inner", 900, 2000, m.left, m.top);  // right of clientWidth: horizontal stitch
    const restored2 = await driver.executeScript(
      'return { sticky: getComputedStyle(document.getElementById("innersticky")).position }');
    check("inner: sticky restored", restored2.sticky === "sticky", JSON.stringify(restored2));

    // --- fixture 3: SPA that replaces the sticky node on every scroll ---
    console.log("fixture: rerender.html (sticky node recreated on scroll, stitch path)");
    png = await capture(driver, `http://127.0.0.1:${PORT}/rerender.html`);
    m = await containerMetrics(driver);
    expW = m.vw - m.cw + m.sw;
    expH = m.vh - m.ch + m.sh;
    check(`rerender size = ${expW}x${expH}`,
      png.width === Math.round(expW) && png.height === Math.round(expH),
      `got ${png.width}x${png.height}`);
    check("rerender sticky painted once (top)",
      near(px(png, m.left + 75, m.top + 60), [255, 0, 0]), `got ${px(png, m.left + 75, m.top + 60)}`);
    check("rerender sticky not repeated (row 1)",
      !near(px(png, m.left + 75, m.top + 660), [255, 0, 0]), `got ${px(png, m.left + 75, m.top + 660)}`);
    check("rerender sticky not repeated (row 2)",
      !near(px(png, m.left + 75, m.top + 1260), [255, 0, 0]), `got ${px(png, m.left + 75, m.top + 1260)}`);
    check("rerender sticky not repeated (deep)",
      !near(px(png, m.left + 75, m.top + 2460), [255, 0, 0]), `got ${px(png, m.left + 75, m.top + 2460)}`);
    checkGrid(png, "rerender", 550, 1500, m.left, m.top);
    checkGrid(png, "rerender", 1050, 2900, m.left, m.top);

    // --- fixture 4: sticky bar inside an open shadow root -> stitch path ---
    console.log("fixture: shadow-sticky.html (sticky inside open shadow root, stitch path)");
    png = await capture(driver, `http://127.0.0.1:${PORT}/shadow-sticky.html`);
    m = await containerMetrics(driver);
    expW = m.vw - m.cw + m.sw;
    expH = m.vh - m.ch + m.sh;
    check(`shadow size = ${expW}x${expH}`,
      png.width === Math.round(expW) && png.height === Math.round(expH),
      `got ${png.width}x${png.height}`);
    check("shadow chrome marker painted once", near(px(png, 10, 10), [255, 0, 255]), `got ${px(png, 10, 10)}`);
    check("shadow sticky painted once (top)",
      near(px(png, m.left + 75, m.top + 60), [255, 0, 0]), `got ${px(png, m.left + 75, m.top + 60)}`);
    check("shadow sticky not repeated (tile 2)",
      !near(px(png, m.left + 75, m.top + 1000), [255, 0, 0]), `got ${px(png, m.left + 75, m.top + 1000)}`);
    check("shadow sticky not repeated (tile 3)",
      !near(px(png, m.left + 75, m.top + 1500), [255, 0, 0]), `got ${px(png, m.left + 75, m.top + 1500)}`);
    check("shadow sticky not repeated (deep)",
      !near(px(png, m.left + 75, m.top + 2700), [255, 0, 0]), `got ${px(png, m.left + 75, m.top + 2700)}`);
    checkGrid(png, "shadow", 500, 200, m.left, m.top);
    checkGrid(png, "shadow", 500, 1400, m.left, m.top);
    checkGrid(png, "shadow", 500, 2900, m.left, m.top);
    checkGrid(png, "shadow", 900, 2000, m.left, m.top);  // right of clientWidth: horizontal stitch
    const restored4 = await driver.executeScript(
      `const r = document.getElementById("host").shadowRoot;
       return { sticky: getComputedStyle(r.querySelector(".z8p")).position };`);
    check("shadow: sticky restored", restored4.sticky === "sticky", JSON.stringify(restored4));

    // --- fixture 5: narrow off-center sticky inside shadow root ---
    // Misses every viewport sample point, so it exercises the small-page
    // full-scan fallback descending into open shadow roots.
    console.log("fixture: shadow-sticky-narrow.html (narrow shadow sticky, full-scan fallback)");
    png = await capture(driver, `http://127.0.0.1:${PORT}/shadow-sticky-narrow.html`);
    m = await containerMetrics(driver);
    expW = m.vw - m.cw + m.sw;
    expH = m.vh - m.ch + m.sh;
    check(`shadow-narrow size = ${expW}x${expH}`,
      png.width === Math.round(expW) && png.height === Math.round(expH),
      `got ${png.width}x${png.height}`);
    check("shadow-narrow sticky painted once (top)",
      near(px(png, m.left + 320, m.top + 60), [255, 0, 0]), `got ${px(png, m.left + 320, m.top + 60)}`);
    check("shadow-narrow sticky not repeated (tile 2)",
      !near(px(png, m.left + 320, m.top + 1000), [255, 0, 0]), `got ${px(png, m.left + 320, m.top + 1000)}`);
    check("shadow-narrow sticky not repeated (tile 3)",
      !near(px(png, m.left + 320, m.top + 1500), [255, 0, 0]), `got ${px(png, m.left + 320, m.top + 1500)}`);
    check("shadow-narrow sticky not repeated (deep)",
      !near(px(png, m.left + 320, m.top + 2700), [255, 0, 0]), `got ${px(png, m.left + 320, m.top + 2700)}`);
    checkGrid(png, "shadow-narrow", 500, 200, m.left, m.top);
    checkGrid(png, "shadow-narrow", 500, 1400, m.left, m.top);
    checkGrid(png, "shadow-narrow", 900, 2000, m.left, m.top);
    const restored5 = await driver.executeScript(
      `const r = document.getElementById("host").shadowRoot;
       return { sticky: getComputedStyle(r.querySelector(".n4q")).position };`);
    check("shadow-narrow: sticky restored", restored5.sticky === "sticky", JSON.stringify(restored5));

    // --- fixture 6: page appends content when scrolled -> direct path must
    // re-measure after the lazy-load pre-pass, not capture the stale height ---
    console.log("fixture: growing.html (content appended on scroll, direct render path)");
    png = await capture(driver, `http://127.0.0.1:${PORT}/growing.html`);
    check("growing height = 7200 (grown), not initial 2400", png.height === 7200, `got ${png.height}`);
    checkGrid(png, "growing", 600, 200);    // initial segment
    checkGrid(png, "growing", 600, 3000);   // first appended segment
    checkGrid(png, "growing", 900, 5200);   // second appended segment
    checkGrid(png, "growing", 600, 7160);   // near the final, grown bottom
    const grown = await driver.executeScript("return document.body.scrollHeight");
    check("growing: fixture grew to 7200", grown === 7200, `got ${grown}`);

    // --- fixture 7: growth smaller than one pre-pass step, tail paints its
    // grid lazily on visibility -> repeat sweep must reach the region start ---
    console.log("fixture: growing-small.html (growth < one step, lazy-painted tail)");
    png = await capture(driver, `http://127.0.0.1:${PORT}/growing-small.html`);
    check("growing-small height = 2800 (grown), not initial 2400", png.height === 2800, `got ${png.height}`);
    checkGrid(png, "growing-small", 600, 2200);  // initial content
    checkGrid(png, "growing-small", 600, 2450);  // start of lazy tail
    checkGrid(png, "growing-small", 900, 2760);  // near the grown bottom

    // --- fixture 8: transform-based smooth scroll (Locomotive/Lenis style) ---
    // Document scrolls via a tall spacer, but content lives in a full-viewport
    // fixed wrapper moved by translateY. Direct rasterization would be blank
    // below the fold; the wrapper must not be hidden as a fixed overlay. Grid
    // colors encode page position, so correct probes at several depths prove
    // real content rather than blank or repeated frames.
    console.log("fixture: transform-scroll.html (fixed wrapper + translateY, stitch fallback)");
    png = await capture(driver, `http://127.0.0.1:${PORT}/transform-scroll.html`);
    check("transform-scroll height = 4000 (full spacer height)", png.height === 4000, `got ${png.height}`);
    check("transform-scroll width >= 1200", png.width >= 1200, `got ${png.width}`);
    checkGrid(png, "transform-scroll", 600, 200);
    checkGrid(png, "transform-scroll", 600, 1200);
    checkGrid(png, "transform-scroll", 900, 2500);
    checkGrid(png, "transform-scroll", 600, 3960);
    const restored8 = await driver.executeScript(
      'return { scrollY: window.scrollY, viewVisibility: getComputedStyle(document.getElementById("view")).visibility }');
    check("transform-scroll: page state restored",
      restored8.scrollY === 0 && restored8.viewVisibility === "visible", JSON.stringify(restored8));

    console.log(failures.length === 0
      ? "\nALL E2E CHECKS PASSED"
      : `\n${failures.length} CHECK(S) FAILED:\n - ` + failures.join("\n - "));
    process.exitCode = failures.length === 0 ? 0 : 1;
  } finally {
    await driver.quit().catch(() => {});
    server.close();
  }
})().catch((e) => {
  console.error("E2E runner error:", e.message);
  process.exit(2);
});
