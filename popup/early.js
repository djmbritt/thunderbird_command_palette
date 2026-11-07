// Runs in <head>, before the body is parsed or laid out.
//
// The popup's size is in rem, so it depends on the root font size, which
// palette.js only learns from an async experiment call that finishes after
// the page has loaded. Applying that late changes the popup's size after
// Thunderbird has measured it. So apply the size cached from the previous
// open now, synchronously; applyUIFontSize() corrects it (and the cache) only
// if Thunderbird's font size has changed since.

const UI_FONT_SIZE_CACHE_KEY = "uiFontSize";

function isPlausibleFontSize(px) {
  return px >= 8 && px <= 40;
}

try {
  const cached = Number(localStorage.getItem(UI_FONT_SIZE_CACHE_KEY));
  if (isPlausibleFontSize(cached)) document.documentElement.style.fontSize = `${cached}px`;
} catch {
  // localStorage unavailable: fall back to the CSS default (15px).
}
