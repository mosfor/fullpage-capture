// Structure test for the PDF generator in content/pdf.js.
//
// Run with: node test/pdf-structure.test.js
//
// Builds a PDF around a small real JPEG (2x3px, generated with Pillow and
// hardcoded below) and checks the file structure: header, xref offsets
// pointing at the object definitions, startxref pointing at the xref table,
// and the JPEG stream embedded intact.

"use strict";

const path = require("path");
const assert = require("assert");

// content/pdf.js is a browser content script attaching to window
globalThis.window = {};
require(path.join(__dirname, "..", "content", "pdf.js"));
const fpc = globalThis.window.FullPageCapture;

// 2x3 solid-color JPEG, quality 50
const JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9" +
  "PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhC" +
  "Y2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAAR" +
  "CAADAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAA" +
  "AgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkK" +
  "FhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWG" +
  "h4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl" +
  "5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREA" +
  "AgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYk" +
  "NOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOE" +
  "hYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk" +
  "5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCSiiivGPWP/9k=";

const jpeg = new Uint8Array(Buffer.from(JPEG_BASE64, "base64"));
assert.strictEqual(jpeg[0], 0xff, "JPEG fixture should start with SOI");
assert.strictEqual(jpeg[1], 0xd8, "JPEG fixture should start with SOI");

const parts = fpc.buildPdfFromJpeg(jpeg, 2, 3);
const pdf = Buffer.concat(parts.map((p) => Buffer.from(p)));

// Header
assert.ok(
  pdf.subarray(0, 9).equals(Buffer.from("%PDF-1.4\n")),
  "file should start with %PDF-1.4"
);

// Trailer: startxref must point at the xref table
const tail = pdf.subarray(-200).toString("latin1");
const startxrefMatch = tail.match(/startxref\n(\d+)\n%%EOF\n$/);
assert.ok(startxrefMatch, "trailer should end with startxref / %%EOF");
const xrefOffset = parseInt(startxrefMatch[1], 10);
assert.strictEqual(
  pdf.subarray(xrefOffset, xrefOffset + 5).toString("latin1"),
  "xref\n",
  "startxref should point at the xref keyword"
);

// xref entries: each in-use offset must point at "N 0 obj"
const xrefText = pdf.subarray(xrefOffset).toString("latin1");
const entries = xrefText.match(/^\d{10} \d{5} [nf] $/gm);
assert.strictEqual(entries.length, 6, "xref should have 6 entries");
assert.strictEqual(entries[0], "0000000000 65535 f ", "free entry for object 0");
for (let num = 1; num <= 5; num++) {
  const offset = parseInt(entries[num].slice(0, 10), 10);
  const expected = `${num} 0 obj\n`;
  assert.strictEqual(
    pdf.subarray(offset, offset + expected.length).toString("latin1"),
    expected,
    `xref offset for object ${num} should point at its definition`
  );
}

// Image object: JPEG stream embedded byte-for-byte with the declared length
const text = pdf.toString("latin1");
const lengthMatch = text.match(/\/Filter \/DCTDecode \/Length (\d+) >>\nstream\n/);
assert.ok(lengthMatch, "image XObject should declare /DCTDecode and /Length");
assert.strictEqual(parseInt(lengthMatch[1], 10), jpeg.length);
const streamStart = lengthMatch.index + lengthMatch[0].length;
assert.ok(
  pdf.subarray(streamStart, streamStart + jpeg.length).equals(Buffer.from(jpeg)),
  "JPEG bytes should be embedded unmodified"
);

// Page geometry: width fixed at 595pt, height proportional (2x3 → 595x892.5)
assert.ok(
  text.includes("/MediaBox [0 0 595 892.5]"),
  "media box should scale image to A4 width"
);
assert.ok(
  text.includes("q 595 0 0 892.5 0 0 cm /Im0 Do Q"),
  "content stream should scale the image to the media box"
);

// Height cap: a very tall image must not exceed the 14400pt spec limit
const tallParts = fpc.buildPdfFromJpeg(jpeg, 1000, 60000);
const tallText = Buffer.concat(tallParts.map((p) => Buffer.from(p))).toString("latin1");
const box = tallText.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/);
assert.ok(parseFloat(box[2]) <= 14400, "page height should be capped at 14400pt");
assert.strictEqual(parseFloat(box[2]), 14400);
assert.strictEqual(parseFloat(box[1]), 240); // aspect preserved: 1000/60000 * 14400

console.log("pdf-structure: all checks passed");
