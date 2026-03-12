const COPY_RESET_MS = 1600;
const copyTimers = new WeakMap();

function getCurrentLocale() {
  return document.documentElement.dataset.locale === "en" ? "en" : "zh";
}

function getCopyLabels(locale = getCurrentLocale()) {
  if (locale === "en") {
    return {
      error: "Retry",
      idle: "Copy",
      success: "Copied",
    };
  }

  return {
    error: "重试",
    idle: "复制",
    success: "已复制",
  };
}

function fallbackCopyText(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();

  if (!copied) {
    throw new Error("Clipboard copy failed.");
  }
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  fallbackCopyText(text);
}

function setCopyState(button, label, state) {
  const chip = button.querySelector(".footer-copy-chip");
  if (!chip) return;

  chip.textContent = label;
  button.dataset.copyState = state;
}

function bindCopyButton(button) {
  const copyValue = button.dataset.copyText?.trim();
  if (!copyValue) return;

  const reset = () => {
    const timer = copyTimers.get(button);
    if (timer) window.clearTimeout(timer);
    setCopyState(button, getCopyLabels().idle, "idle");
  };

  button.addEventListener("click", async () => {
    const labels = getCopyLabels();

    try {
      await copyText(copyValue);
      setCopyState(button, labels.success, "success");
    } catch {
      setCopyState(button, labels.error, "error");
    }

    const previousTimer = copyTimers.get(button);
    if (previousTimer) window.clearTimeout(previousTimer);

    const nextTimer = window.setTimeout(reset, COPY_RESET_MS);
    copyTimers.set(button, nextTimer);
  });
}

export function setFooterLocale(locale) {
  const labels = getCopyLabels(locale);

  document.querySelectorAll(".footer-contact-card[data-copy-text]").forEach((button) => {
    if (!(button instanceof HTMLButtonElement)) return;

    const state = button.dataset.copyState === "success"
      ? "success"
      : button.dataset.copyState === "error"
        ? "error"
        : "idle";

    setCopyState(button, labels[state], state);
  });
}

export function initSiteFooter() {
  document.querySelectorAll(".js-current-year").forEach((node) => {
    node.textContent = String(new Date().getFullYear());
  });

  document.querySelectorAll(".footer-contact-card[data-copy-text]").forEach((button) => {
    if (!(button instanceof HTMLButtonElement)) return;
    bindCopyButton(button);
  });

  setFooterLocale(getCurrentLocale());
}
