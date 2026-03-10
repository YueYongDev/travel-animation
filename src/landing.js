import { initSiteFooter } from "./site-footer";
import {
  assertSupabaseConfigured,
  getAuthErrorMessage,
  getSession,
  supabase,
} from "./lib/supabaseAuth";

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

const initialParams = new URLSearchParams(window.location.search);
const initialMode = initialParams.get("auth");
const initialRedirect = sanitizeRedirectTarget(initialParams.get("redirect"));

let authMode = "login";
let pendingRedirect = initialRedirect;
let lastFocusedElement = null;
let currentSession = null;

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
      ? "注册后立即获赠 10 积分，用于首次导出"
      : "登录以继续编辑、查看积分并导出视频";
  }
  if (authMetaHint) {
    authMetaHint.hidden = true;
    authMetaHint.textContent = "";
  }
  if (authPassword) {
    authPassword.placeholder = registerView ? "设置密码（至少 6 位）" : "输入密码";
    authPassword.autocomplete = registerView ? "new-password" : "current-password";
    authPassword.value = "";
  }
  if (authForgotBtn) authForgotBtn.hidden = registerView;
  if (authFormMeta) authFormMeta.hidden = registerView;

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

function syncHeaderAuthLink() {
  if (!headerAuthLink) return;

  if (currentSession) {
    headerAuthLink.textContent = "工作台";
    headerAuthLink.dataset.authOpen = "account";
    headerAuthLink.setAttribute("aria-label", "进入工作台");
    return;
  }

  headerAuthLink.textContent = "登录";
  headerAuthLink.dataset.authOpen = "login";
  headerAuthLink.setAttribute("aria-label", "打开登录弹窗");
}

async function refreshAuthState() {
  currentSession = await getSession();
  syncHeaderAuthLink();
  return currentSession;
}

function getOAuthReturnUrl() {
  const returnUrl = new URL(window.location.pathname, window.location.origin);
  returnUrl.searchParams.set("auth", "login");

  const redirectTarget = pendingRedirect || getWorkspaceTarget();
  if (redirectTarget) {
    returnUrl.searchParams.set("redirect", redirectTarget);
  }

  return returnUrl.toString();
}

authOpeners.forEach((opener) => {
  opener.addEventListener("click", (event) => {
    const target = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    if (!target) return;

    if (target.dataset.authOpen === "account" && currentSession) {
      window.location.assign(getWorkspaceTarget());
      return;
    }

    openAuthModal(target.dataset.authOpen || "login");
  });
});

startLinks.forEach((link) => {
  link.addEventListener("click", (event) => {
    if (currentSession) return;

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
  showStatus("重置密码页面还未单独实现，当前版本请先注册新账号或在 Supabase 控制台手动重置。", "info");
});

authGithubBtn?.addEventListener("click", async () => {
  setSubmitLoading(true);
  clearStatus();

  try {
    assertSupabaseConfigured();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "github",
      options: {
        redirectTo: getOAuthReturnUrl(),
      },
    });

    if (error) throw error;
  } catch (error) {
    showStatus(getAuthErrorMessage(error, authMode), "error");
    setSubmitLoading(false);
  }
});

authForm?.addEventListener("submit", async (event) => {
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
  clearStatus();

  try {
    assertSupabaseConfigured();

    if (authMode === "register") {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            display_name: email.split("@")[0]?.replace(/[._-]+/g, " ").trim() || "TrailFrame",
          },
        },
      });

      if (error) throw error;

      currentSession = data.session ?? null;
      syncHeaderAuthLink();

      if (data.session) {
        showStatus("账号创建成功，10 积分已入账，正在进入工作台...", "success");
        window.setTimeout(proceedAfterAuth, 220);
        return;
      }

      showStatus("注册成功，请先完成邮箱验证，再回来登录。", "success");
      setAuthMode("login");
      if (authEmail) authEmail.value = email;
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;

    await refreshAuthState();
    showStatus("登录成功，正在进入工作台...", "success");
    window.setTimeout(proceedAfterAuth, 220);
  } catch (error) {
    showStatus(getAuthErrorMessage(error, authMode), "error");
    setSubmitLoading(false);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && authModal && !authModal.hidden) {
    closeAuthModal();
  }
});

async function bootstrapAuth() {
  try {
    assertSupabaseConfigured();
  } catch (error) {
    syncHeaderAuthLink();
    if (initialMode === "login" || initialMode === "register") {
      openAuthModal(initialMode, initialRedirect);
      showStatus(error.message, "error");
    }
    return;
  }

  supabase.auth.onAuthStateChange((_event, session) => {
    currentSession = session;
    syncHeaderAuthLink();
  });

  await refreshAuthState();

  if (currentSession && (initialMode === "login" || initialMode === "register")) {
    proceedAfterAuth();
    return;
  }

  if (initialMode === "login" || initialMode === "register") {
    openAuthModal(initialMode, initialRedirect);
    return;
  }

  setAuthMode("login");
}

bootstrapAuth().catch((error) => {
  console.error(error);
  setAuthMode("login");
  showStatus(error.message || "登录初始化失败，请稍后重试。", "error");
});

initSiteFooter();
