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
const os = require("os");
const path = require("path");
const http = require("http");
const { execFileSync } = require("child_process");

const { Builder } = require("selenium-webdriver");
const firefox = require("selenium-webdriver/firefox");
const { PNG } = require("pngjs");

const REPO = path.resolve(__dirname, "..", "..");
const FIXTURES = path.join(__dirname, "fixtures");
const PORT = 8899;

// ---------- build test extension ----------

function buildTestXpi() {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), "fpc-dist-"));
  for (const dir of ["content", "background", "popup", "icons"]) {
    fs.cpSync(path.join(REPO, dir), path.join(dist, dir), { recursive: true });
  }
  fs.copyFileSync(path.join(__dirname, "test-hook.js"), path.join(dist, "test-hook.js"));

  const manifest = JSON.parse(fs.readFileSync(path.join(REPO, "manifest.json"), "utf8"));
  // Test builds auto-inject on every page so the harness can trigger captures
  // without driving browser UI. Production injects on demand instead.
  manifest.content_scripts = [
    {
      matches: ["<all_urls>"],
      js: [
        "content/utils.js",
        "content/scroll.js",
        "content/fixed-elements.js",
        "content/selection.js",
        "content/capture.js",
        "content/content.js",
        "test-hook.js",
      ],
      run_at: "document_idle",
    },
  ];
  fs.writeFileSync(path.join(dist, "manifest.json"), JSON.stringify(manifest, null, 2));

  const xpi = path.join(dist, "..", path.basename(dist) + ".xpi");
  execFileSync("python3", ["-m", "zipfile", "-c", xpi,
    "manifest.json", "test-hook.js", "content", "background", "popup", "icons"], { cwd: dist });
  return xpi;
}

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

function checkGrid(png, name, x, y) {
  const p = cellProbe(x, y);
  const got = px(png, p.x, p.y);
  check(`${name} grid@(${p.x},${p.y})`, near(got, p.color), `expected rgb(${p.color}) got rgb(${got})`);
}

// ---------- capture via test hook ----------

async function capture(driver, url) {
  await driver.get(url);
  await driver.wait(async () => (await driver.getTitle()).includes("[grid-ready]"), 10000);
  // let the content scripts settle
  await driver.sleep(500);
  await driver.executeScript('window.postMessage({type:"FPC_TEST_CAPTURE"}, "*")');
  await driver.wait(async () => {
    const st = await driver.executeScript(
      'const el = document.getElementById("fpc-test-result"); return el ? el.dataset.status : null');
    if (st === "error") {
      const msg = await driver.executeScript('return document.getElementById("fpc-test-result").value');
      throw new Error("capture failed in extension: " + msg);
    }
    return st === "ok";
  }, 120000, "capture did not complete");
  const dataUrl = await driver.executeScript('return document.getElementById("fpc-test-result").value');
  return PNG.sync.read(Buffer.from(dataUrl.split(",")[1], "base64"));
}

// ---------- main ----------

(async () => {
  process.env.MOZ_DISABLE_CONTENT_SANDBOX = "1";
  process.env.MOZ_DISABLE_RDD_SANDBOX = "1";
  process.env.MOZ_DISABLE_GMP_SANDBOX = "1";

  const xpi = buildTestXpi();
  const server = await serveFixtures();

  const options = new firefox.Options().addArguments("-headless", "-width=1280", "-height=900");
  if (process.env.FIREFOX_BIN) options.setBinary(process.env.FIREFOX_BIN);
  const builder = new Builder().forBrowser("firefox").setFirefoxOptions(options);
  if (process.env.GECKODRIVER_BIN) {
    builder.setFirefoxService(new firefox.ServiceBuilder(process.env.GECKODRIVER_BIN));
  }
  const driver = await builder.build();

  try {
    await driver.installAddon(xpi, true);

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
    check("inner size = 1000x3000", png.width === 1000 && png.height === 3000,
      `got ${png.width}x${png.height}`);
    check("inner sticky painted once (top)", near(px(png, 75, 60), [255, 0, 0]), `got ${px(png, 75, 60)}`);
    check("inner sticky not repeated below fold", !near(px(png, 75, 1500), [255, 0, 0]), `got ${px(png, 75, 1500)}`);
    checkGrid(png, "inner", 500, 200);   // border offset: a 10px shift would break these
    checkGrid(png, "inner", 500, 1400);
    checkGrid(png, "inner", 500, 2900);
    checkGrid(png, "inner", 900, 2000);  // right of clientWidth: exercises horizontal stitch
    const restored2 = await driver.executeScript(
      'return { sticky: getComputedStyle(document.getElementById("innersticky")).position }');
    check("inner: sticky restored", restored2.sticky === "sticky", JSON.stringify(restored2));

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
