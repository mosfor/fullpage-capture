// FullPage Capture - Settings (storage.local with defaults)

(() => {
  const fpc = (window.FullPageCapture ||= {});

  // Single source of truth for setting defaults; add future keys here.
  fpc.SETTINGS_DEFAULTS = {
    outputMode: "clipboard",
    format: "png",
    quality: 90,
  };

  fpc.getSettings = async function getSettings() {
    const stored = await browser.storage.local.get(
      Object.keys(fpc.SETTINGS_DEFAULTS)
    );
    return Object.assign({}, fpc.SETTINGS_DEFAULTS, stored);
  };
})();
