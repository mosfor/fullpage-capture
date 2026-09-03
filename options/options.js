// FullPage Capture - Options Page

const formatSelect = document.getElementById("format");
const qualitySlider = document.getElementById("quality");
const qualityValue = document.getElementById("qualityValue");
const qualityRow = document.getElementById("qualityRow");

const fpc = window.FullPageCapture;

fpc.getSettings().then((settings) => {
  formatSelect.value = settings.format;
  qualitySlider.value = settings.quality;
  updateQualityUI();
});

function updateQualityUI() {
  qualityValue.textContent = qualitySlider.value;
  const isPng = formatSelect.value === "png";
  qualitySlider.disabled = isPng;
  qualityRow.classList.toggle("disabled", isPng);
}

formatSelect.addEventListener("change", () => {
  updateQualityUI();
  browser.storage.local.set({ format: formatSelect.value });
});

qualitySlider.addEventListener("input", () => {
  qualityValue.textContent = qualitySlider.value;
});

qualitySlider.addEventListener("change", () => {
  browser.storage.local.set({ quality: parseInt(qualitySlider.value, 10) });
});
