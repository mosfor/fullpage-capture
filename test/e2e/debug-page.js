// FullPage Capture - interactive debug tool.
// Loads ANY page in headless Firefox with the extension installed, prints
// capture diagnostics (scroll container, fixed/sticky elements, dimensions),
// runs a full-page capture, and saves the output PNG for visual inspection.
//
// Usage:
//   node debug-page.js <url> [output.png] [settle-ms]

const fs = require("fs");
const { makeDriver, hookMessage } = require("./common");

const url = process.argv[2];
const out = process.argv[3] || "/tmp/fpc-debug.png";
const settleMs = Number(process.argv[4] || 5000);

if (!url) {
  console.error("usage: node debug-page.js <url> [output.png] [settle-ms]");
  process.exit(2);
}

(async () => {
  const driver = await makeDriver();
  try {
    await driver.get(url);
    await driver.sleep(settleMs);

    const diag = JSON.parse(await hookMessage(driver, "FPC_TEST_DIAG", 30000));
    console.log("diagnostics:", JSON.stringify(diag, null, 2));

    const t0 = Date.now();
    const dataUrl = await hookMessage(driver, "FPC_TEST_CAPTURE");
    fs.writeFileSync(out, Buffer.from(dataUrl.split(",")[1], "base64"));
    console.log(`capture ok in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${out}`);
  } finally {
    await driver.quit().catch(() => {});
  }
})().catch((e) => {
  console.error("debug-page error:", e.message);
  process.exit(1);
});
