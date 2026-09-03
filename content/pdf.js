// FullPage Capture - Minimal single-page PDF generator (no libraries)
//
// Embeds the capture as a /DCTDecode JPEG — the simplest correct image path
// in PDF (embedding PNG would need Flate + predictors). Structure is verified
// by test/pdf-structure.test.js.

(() => {
  const fpc = (window.FullPageCapture ||= {});

  const A4_WIDTH_PT = 595;
  const MAX_PAGE_PT = 14400; // PDF spec maximum page dimension

  // Build a one-page PDF around `jpegBytes` (a JPEG of width x height
  // pixels). Pure — no DOM, no async — so the Node structure test can call
  // it directly. Returns an array of Uint8Array parts; offsets in the xref
  // table are computed from byte lengths, never string lengths, because the
  // JPEG stream is binary.
  fpc.buildPdfFromJpeg = function buildPdfFromJpeg(jpegBytes, width, height) {
    const encoder = new TextEncoder();

    // Page size: image width mapped to A4 width (595pt), height scaled
    // proportionally — pages may exceed A4 height, viewers handle long
    // pages fine. Cap the scale if height would exceed the spec max.
    let scale = A4_WIDTH_PT / width;
    if (height * scale > MAX_PAGE_PT) scale = MAX_PAGE_PT / height;
    const pageW = +(width * scale).toFixed(2);
    const pageH = +(height * scale).toFixed(2);

    // Image XObjects paint into a unit square; scale it to the media box
    const content = encoder.encode(`q ${pageW} 0 0 ${pageH} 0 0 cm /Im0 Do Q`);

    const parts = [];
    let offset = 0;
    const push = (bytes) => {
      parts.push(bytes);
      offset += bytes.length;
    };
    const pushText = (text) => push(encoder.encode(text));

    const objOffsets = [];
    const beginObj = (num) => {
      objOffsets[num] = offset;
      pushText(`${num} 0 obj\n`);
    };

    pushText("%PDF-1.4\n");
    // Comment with bytes > 127 so tools treat the file as binary
    push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

    beginObj(1);
    pushText("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

    beginObj(2);
    pushText("<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");

    beginObj(3);
    pushText(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] ` +
      "/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n"
    );

    beginObj(4);
    pushText(
      `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} ` +
      "/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode " +
      `/Length ${jpegBytes.length} >>\nstream\n`
    );
    push(jpegBytes);
    pushText("\nendstream\nendobj\n");

    beginObj(5);
    pushText(`<< /Length ${content.length} >>\nstream\n`);
    push(content);
    pushText("\nendstream\nendobj\n");

    // xref entries must be exactly 20 bytes: 10-digit offset, 5-digit
    // generation, type, two-byte terminator ("space LF" here)
    const xrefOffset = offset;
    let xref = "xref\n0 6\n0000000000 65535 f \n";
    for (let i = 1; i <= 5; i++) {
      xref += String(objOffsets[i]).padStart(10, "0") + " 00000 n \n";
    }
    pushText(xref);
    pushText(
      `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
    );

    return parts;
  };

  // Convert a captured image blob to a single-page PDF blob. The image is
  // re-encoded as JPEG at `quality` (1-100) so it embeds compactly.
  fpc.imageToPdf = async function imageToPdf(blob, quality) {
    const jpegBlob = await fpc.convertImage(blob, "jpeg", quality);

    // Pixel dimensions via a decode of the JPEG itself — no marker parsing
    const url = URL.createObjectURL(jpegBlob);
    let width, height;
    try {
      const img = await fpc.loadImage(url);
      width = img.naturalWidth;
      height = img.naturalHeight;
    } finally {
      URL.revokeObjectURL(url);
    }

    const jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer());
    const parts = fpc.buildPdfFromJpeg(jpegBytes, width, height);
    return new Blob(parts, { type: "application/pdf" });
  };
})();
