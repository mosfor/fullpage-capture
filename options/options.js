// FullPage Capture - Options Page

const formatSelect = document.getElementById("format");
const qualitySlider = document.getElementById("quality");
const qualityValue = document.getElementById("qualityValue");
const qualityRow = document.getElementById("qualityRow");
const templateInput = document.getElementById("filenameTemplate");
const filenamePreview = document.getElementById("filenamePreview");
const saveAsCheckbox = document.getElementById("saveAs");
const delaySelect = document.getElementById("captureDelay");

const fpc = window.FullPageCapture;

fpc.getSettings().then((settings) => {
  formatSelect.value = settings.format;
  qualitySlider.value = settings.quality;
  templateInput.value = settings.filenameTemplate;
  saveAsCheckbox.checked = settings.saveAs;
  delaySelect.value = String(settings.captureDelay);
  updateQualityUI();
  updatePreview();
});

// Preview with sample values (the options page's own title/hostname
// would be misleading).
function updatePreview() {
  const ext = formatSelect.value === "jpeg" ? "jpg" : formatSelect.value;
  filenamePreview.textContent = fpc.buildFilename(templateInput.value, ext, {
    title: "Example Page",
    domain: "example.com",
  });
}

function updateQualityUI() {
  qualityValue.textContent = qualitySlider.value;
  const isPng = formatSelect.value === "png";
  qualitySlider.disabled = isPng;
  qualityRow.classList.toggle("disabled", isPng);
}

formatSelect.addEventListener("change", () => {
  updateQualityUI();
  updatePreview();
  browser.storage.local.set({ format: formatSelect.value });
});

qualitySlider.addEventListener("input", () => {
  qualityValue.textContent = qualitySlider.value;
});

qualitySlider.addEventListener("change", () => {
  browser.storage.local.set({ quality: parseInt(qualitySlider.value, 10) });
});

templateInput.addEventListener("input", () => {
  updatePreview();
  browser.storage.local.set({ filenameTemplate: templateInput.value });
});

saveAsCheckbox.addEventListener("change", () => {
  browser.storage.local.set({ saveAs: saveAsCheckbox.checked });
});

delaySelect.addEventListener("change", () => {
  browser.storage.local.set({ captureDelay: parseInt(delaySelect.value, 10) });
});
