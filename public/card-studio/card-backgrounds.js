(function () {
  let customBackgroundUrl = "";

  const cards = () => [
    document.getElementById("goldenCard"),
    document.getElementById("exchangeCard"),
  ].filter(Boolean);

  function applyBackgroundUrl(url, render = true) {
    customBackgroundUrl = url;
    const themeSelect = document.getElementById("themeSelect");
    if (themeSelect) themeSelect.value = "bg-custom-image";
    const titleColor = document.getElementById("titleColorPicker");
    if (titleColor) titleColor.value = "#ffffff";
    cards().forEach((target) => {
      target.style.setProperty(
        "background-image",
        `linear-gradient(90deg, rgba(3, 10, 18, .5), rgba(3, 10, 18, .24), rgba(3, 10, 18, .5)), url("${url}")`,
        "important",
      );
    });
    if (render) window.updateCard?.();
  }

  function clearCustomBackgroundIfNeeded(theme) {
    if (theme === "bg-custom-image" && customBackgroundUrl) {
      applyBackgroundUrl(customBackgroundUrl, false);
      return;
    }
    cards().forEach((target) => target.style.removeProperty("background-image"));
  }

  function uploadBackground(input) {
    const file = input.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      window.alert("اختر ملف صورة صالحاً.");
      input.value = "";
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      window.alert("حجم الخلفية يجب ألا يتجاوز 12 ميجابايت.");
      input.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => applyBackgroundUrl(String(reader.result || ""));
    reader.readAsDataURL(file);
  }

  window.CardStudioBackgrounds = {
    applyBackgroundUrl,
    clearCustomBackgroundIfNeeded,
    uploadBackground,
  };
})();
