// FullPage Capture - shared e2e harness pieces.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const { Builder } = require("selenium-webdriver");
const firefox = require("selenium-webdriver/firefox");

const REPO = path.resolve(__dirname, "..", "..");

// Copy the extension, patch the manifest to auto-inject the content scripts
// plus the test hook on every page, and pack it into an XPI.
function buildTestXpi() {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), "fpc-dist-"));
  for (const dir of ["content", "background", "popup", "icons"]) {
    fs.cpSync(path.join(REPO, dir), path.join(dist, dir), { recursive: true });
  }
  fs.copyFileSync(path.join(__dirname, "test-hook.js"), path.join(dist, "test-hook.js"));

  const manifest = JSON.parse(fs.readFileSync(path.join(REPO, "manifest.json"), "utf8"));
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

async function makeDriver() {
  process.env.MOZ_DISABLE_CONTENT_SANDBOX = "1";
  process.env.MOZ_DISABLE_RDD_SANDBOX = "1";
  process.env.MOZ_DISABLE_GMP_SANDBOX = "1";

  const options = new firefox.Options().addArguments("-headless", "-width=1280", "-height=900");
  if (process.env.FIREFOX_BIN) options.setBinary(process.env.FIREFOX_BIN);
  const builder = new Builder().forBrowser("firefox").setFirefoxOptions(options);
  if (process.env.GECKODRIVER_BIN) {
    builder.setFirefoxService(new firefox.ServiceBuilder(process.env.GECKODRIVER_BIN));
  }
  const driver = await builder.build();
  await driver.installAddon(buildTestXpi(), true);
  return driver;
}

async function hookMessage(driver, type, timeoutMs = 120000) {
  await driver.executeScript(`window.postMessage({type: ${JSON.stringify(type)}}, "*")`);
  await driver.wait(async () => {
    const st = await driver.executeScript(
      'const el = document.getElementById("fpc-test-result"); return el ? el.dataset.status : null');
    if (st === "error") {
      const msg = await driver.executeScript('return document.getElementById("fpc-test-result").value');
      throw new Error(type + " failed in extension: " + msg);
    }
    return st === "ok";
  }, timeoutMs, type + " did not complete");
  return driver.executeScript('return document.getElementById("fpc-test-result").value');
}

module.exports = { REPO, buildTestXpi, makeDriver, hookMessage };
