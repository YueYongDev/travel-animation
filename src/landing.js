import {initSiteFooter} from "./site-footer";

const AUTH_STORAGE_KEY = "trailframe.auth";
const DEMO_EMAIL = "yueyong1030@outlook.com";
const DEMO_PASSWORD = "12345678";

const authModal = document.getElementById("authModal");
const authForm = document.getElementById("authForm");
const authEmail = document.getElementById("authEmail");
const authPassword = document.getElementById("authPassword");
const authCloseBtn = document.getElementById("authCloseBtn");
const authTabLogin = document.getElementById("authTabLogin");
const authTabRegister = document.getElementById("authTabRegister");
const authKicker = document.getElementById("authKicker");
const authTitlePrefix = document.getElementById("authTitlePrefix");
const authSubtitle = document.getElementById("authSubtitle");
const authMetaHint = document.getElementById("authMetaHint");
const authForgotBtn = document.getElementById("authForgotBtn");
const authFormMeta = document.querySelector(".auth-form-meta");
const authSubmitBtn = document.getElementById("authSubmitBtn");
const authGithubBtn = document.getElementById("authGithubBtn");
const authStatus = document.getElementById("authStatus");
const authOpeners = document.querySelectorAll("[data-auth-open]");
const authClosers = document.querySelectorAll("[data-auth-close]");
const startLinks = document.querySelectorAll("[data-auth-start]");
const headerAuthLink = document.querySelector(".header-auth-link");

let authMode = "login";
let pendingRedirect = null;
let lastFocusedElement = null;

function readAuthState() {
  try {
    const stored = window.localStorage.getItem(AUTH_STORAGE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeAuthState(value) {
  try {
    window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Ignore storage failures in demo mode.
  }
}

function clearAuthState() {
  try {
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch {
    // Ignore storage failures in demo mode.
  }
}

function sanitizeRedirectTarget(target) {
  if (!target) return null;

  try {
    const nextUrl = new URL(target, window.location.href);
    if (nextUrl.origin !== window.location.origin) return null;
    return `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
  } catch {
    return null;
  }
}

function updateUrl(removeRedirect = false) {
  const params = new URLSearchParams(window.location.search);
  params.delete("auth");
  if (removeRedirect) params.delete("redirect");
  const nextQuery = params.toString();
  const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${window.location.hash}`;
  window.history.replaceState({}, "", nextUrl);
}

function showStatus(message, kind = "info") {
  if (!authStatus) return;
  authStatus.hidden = false;
  authStatus.textContent = message;
  authStatus.dataset.kind = kind;
}

function clearStatus() {
  if (!authStatus) return;
  authStatus.hidden = true;
  authStatus.textContent = "";
  delete authStatus.dataset.kind;
}

function setSubmitLoading(loading) {
  if (!authSubmitBtn || !authGithubBtn) return;

  authSubmitBtn.disabled = loading;
  authGithubBtn.disabled = loading;
  authSubmitBtn.textContent = loading
    ? authMode === "register"
      ? "创建中..."
      : "登录中..."
    : authMode === "register"
      ? "创建账号"
      : "登录";
}

function setAuthMode(nextMode) {
  authMode = nextMode === "register" ? "register" : "login";
  const registerView = authMode === "register";

  authForm?.setAttribute("data-mode", authMode);
  authTabLogin?.classList.toggle("active", !registerView);
  authTabRegister?.classList.toggle("active", registerView);
  authTabLogin?.setAttribute("aria-selected", registerView ? "false" : "true");
  authTabRegister?.setAttribute("aria-selected", registerView ? "true" : "false");

  if (authKicker) authKicker.textContent = "Travel animation studio";
  if (authTitlePrefix) authTitlePrefix.textContent = registerView ? "创建账号" : "欢迎回来";
  if (authSubtitle) {
    authSubtitle.textContent = registerView
      ? "注册以保存和分享你的作品"
      : "登录以继续编辑和导出你的项目";
  }
  if (authMetaHint) {
    authMetaHint.hidden = true;
    authMetaHint.textContent = "";
  }
  if (authPassword) {
    authPassword.placeholder = registerView ? "设置密码（至少 6 位）" : "输入密码";
    authPassword.autocomplete = registerView ? "new-password" : "current-password";
  }
  if (authForgotBtn) authForgotBtn.hidden = registerView;
  if (authFormMeta) authFormMeta.hidden = registerView;

  if (!registerView) {
    if (authEmail && !authEmail.value.trim()) authEmail.value = DEMO_EMAIL;
    if (authPassword && !authPassword.value.trim()) authPassword.value = DEMO_PASSWORD;
  }

  clearStatus();
  setSubmitLoading(false);
}

function setModalOpen(open) {
  if (!authModal) return;

  authModal.hidden = !open;
  document.body.classList.toggle("auth-modal-open", open);

  if (open) {
    window.requestAnimationFrame(() => authEmail?.focus());
    return;
  }

  if (lastFocusedElement instanceof HTMLElement) {
    lastFocusedElement.focus();
  }
}

function openAuthModal(nextMode = "login", redirectTarget = null) {
  lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  pendingRedirect = sanitizeRedirectTarget(redirectTarget) ?? pendingRedirect;
  setAuthMode(nextMode);
  if (authEmail && authMode === "login" && !authEmail.value.trim()) authEmail.value = DEMO_EMAIL;
  if (authPassword) {
    authPassword.value = authMode === "login" ? DEMO_PASSWORD : "";
  }
  setModalOpen(true);
}

function closeAuthModal() {
  pendingRedirect = null;
  clearStatus();
  updateUrl(true);
  setModalOpen(false);
}

function getWorkspaceTarget() {
  return sanitizeRedirectTarget("./workspace/") || "./workspace/";
}

function proceedAfterAuth() {
  updateUrl(true);
  const nextTarget = pendingRedirect || getWorkspaceTarget();
  pendingRedirect = null;
  window.location.assign(nextTarget);
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function createAuthPayload(email, provider) {
  const localName = email.split("@")[0] || "trail";
  return {
    email,
    provider,
    displayName: localName.replace(/[._-]+/g, " ").trim() || "TrailFrame",
    loggedInAt: new Date().toISOString()
  };
}

function syncHeaderAuthLink() {
  const authState = readAuthState();
  if (!headerAuthLink) return;

  if (authState) {
    headerAuthLink.textContent = "工作台";
    headerAuthLink.dataset.authOpen = "account";
    headerAuthLink.setAttribute("aria-label", "进入工作台");
    return;
  }

  headerAuthLink.textContent = "登录";
  headerAuthLink.dataset.authOpen = "login";
  headerAuthLink.setAttribute("aria-label", "打开登录弹窗");
}

authOpeners.forEach((opener) => {
  opener.addEventListener("click", (event) => {
    const target = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    if (!target) return;

    if (target.dataset.authOpen === "account" && readAuthState()) {
      window.location.assign(getWorkspaceTarget());
      return;
    }

    openAuthModal(target.dataset.authOpen || "login");
  });
});

startLinks.forEach((link) => {
  link.addEventListener("click", (event) => {
    if (readAuthState()) return;

    event.preventDefault();
    const anchor = event.currentTarget instanceof HTMLAnchorElement ? event.currentTarget : null;
    openAuthModal("register", anchor?.getAttribute("href"));
  });
});

authTabLogin?.addEventListener("click", () => setAuthMode("login"));
authTabRegister?.addEventListener("click", () => setAuthMode("register"));
authCloseBtn?.addEventListener("click", closeAuthModal);
authClosers.forEach((closer) => closer.addEventListener("click", closeAuthModal));

authForgotBtn?.addEventListener("click", () => {
  showStatus("演示版未接入找回密码流程，请直接注册一个新账号继续体验。", "info");
});

authGithubBtn?.addEventListener("click", () => {
  setSubmitLoading(true);
  window.setTimeout(() => {
    writeAuthState(createAuthPayload("github@trailframe.app", "github"));
    syncHeaderAuthLink();
    showStatus("GitHub 登录已完成，正在进入工作台...", "success");
    window.setTimeout(proceedAfterAuth, 220);
  }, 180);
});

authForm?.addEventListener("submit", (event) => {
  event.preventDefault();

  const email = authEmail?.value.trim().toLowerCase() || "";
  const password = authPassword?.value.trim() || "";

  if (!isValidEmail(email)) {
    showStatus("请输入有效邮箱地址。", "error");
    authEmail?.focus();
    return;
  }

  if (password.length < 6) {
    showStatus("密码至少需要 6 位。", "error");
    authPassword?.focus();
    return;
  }

  setSubmitLoading(true);

  window.setTimeout(() => {
    clearAuthState();
    writeAuthState(createAuthPayload(email, "email"));
    syncHeaderAuthLink();
    showStatus(authMode === "register" ? "账号创建成功，正在进入工作台..." : "登录成功，正在进入工作台...", "success");
    window.setTimeout(proceedAfterAuth, 220);
  }, 180);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && authModal && !authModal.hidden) {
    closeAuthModal();
  }
});

const initialParams = new URLSearchParams(window.location.search);
const initialMode = initialParams.get("auth");
const initialRedirect = sanitizeRedirectTarget(initialParams.get("redirect"));

pendingRedirect = initialRedirect;
syncHeaderAuthLink();

if (readAuthState() && (initialMode === "login" || initialMode === "register")) {
  proceedAfterAuth();
} else if (initialMode === "login" || initialMode === "register") {
  openAuthModal(initialMode, initialRedirect);
} else {
  setAuthMode("login");
}

initSiteFooter();
