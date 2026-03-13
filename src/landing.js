import { initSiteFooter, setFooterLocale } from "./site-footer";
import {
  assertSupabaseConfigured,
  buildAuthState,
  getAuthErrorMessage,
  getAuthInitials,
  getAuthProviderLabel,
  getSession,
  isEmailRegistered,
  signOut,
  supabase,
  waitForProfile,
} from "./lib/supabaseAuth";

const LANDING_LOCALE_KEY = "trailframe-landing-locale";

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
const headerStartLink = document.querySelector(".primary-link-start");
const localeToggle = document.getElementById("localeToggle");
const landingAccountMenuRoot = document.getElementById("landingAccountMenuRoot");
const landingAccountMenuButton = document.getElementById("landingAccountMenuButton");
const landingAccountAvatar = document.getElementById("landingAccountAvatar");
const landingAccountMenu = document.getElementById("landingAccountMenu");
const landingAccountMenuTitle = document.getElementById("landingAccountMenuTitle");
const landingAccountMenuSubtitle = document.getElementById("landingAccountMenuSubtitle");
const landingWorkspaceLink = document.getElementById("landingWorkspaceLink");
const landingAccountSignOutBtn = document.getElementById("landingAccountSignOutBtn");
const authTabs = document.querySelector(".auth-tabs");
const authFieldLabels = Array.from(document.querySelectorAll(".auth-field-label"));
const authGithubLabel = authGithubBtn?.querySelector("span") ?? null;
const metaDescription = document.querySelector('meta[name="description"]');
const brandEyebrowNodes = Array.from(document.querySelectorAll(".brand-copy .eyebrow"));
const landingNav = document.querySelector(".landing-nav");
const landingNavLinks = Array.from(document.querySelectorAll(".landing-nav a"));
const headerStartCta = document.querySelector(".primary-link-start .cta-label");
const heroEyebrow = document.querySelector(".hero-copy .eyebrow");
const heroTitleLines = Array.from(document.querySelectorAll(".hero-title-line"));
const heroLead = document.querySelector(".hero-lead");
const heroPrimaryCta = document.querySelector(".hero-actions .primary-link .cta-label");
const heroSecondaryCta = document.querySelector(".hero-actions .secondary-link");
const heroMetaItems = Array.from(document.querySelectorAll(".hero-meta span"));
const heroProofText = document.querySelector(".hero-proof p");
const demoChip = document.querySelector(".demo-chip");
const demoRoutePill = document.querySelector(".demo-route-pill");
const demoKicker = document.querySelector(".demo-kicker");
const demoCurrentStop = document.querySelector(".demo-overlay-card strong");
const demoToolbarItems = Array.from(document.querySelectorAll(".demo-toolbar span"));
const featuresEyebrow = document.querySelector("#features .section-heading .eyebrow");
const featuresTitle = document.getElementById("featuresTitle");
const featuresBody = document.querySelector("#features .section-heading p");
const featureCards = Array.from(document.querySelectorAll(".feature-card")).map((card) => ({
  body: card.querySelector("p"),
  title: card.querySelector("strong"),
}));
const workflowEyebrow = document.querySelector(".workflow-eyebrow");
const workflowTitle = document.querySelector(".workflow-header h2");
const workflowBody = document.querySelector(".workflow-header p");
const workflowConnectors = Array.from(document.querySelectorAll(".workflow-connector span"));
const workflowCards = Array.from(document.querySelectorAll(".workflow-card")).map((card) => ({
  body: card.querySelector("p"),
  title: card.querySelector("strong"),
}));
const footerCopy = document.querySelector(".footer-copy");
const footerMeta = document.querySelector(".footer-meta");
const footerLinksHeading = document.querySelector(".footer-links-column h3");
const footerLinks = Array.from(document.querySelectorAll(".footer-link-list a"));
const footerContactTitle = document.querySelector(".footer-contact-column h3");
const footerContactBody = document.querySelector(".footer-contact-column p");
const footerContactLabel = document.querySelector(".footer-contact-label");

const initialParams = new URLSearchParams(window.location.search);
const initialMode = initialParams.get("auth");
const initialRedirect = sanitizeRedirectTarget(initialParams.get("redirect"));

let authMode = "login";
let pendingRedirect = initialRedirect;
let lastFocusedElement = null;
let currentSession = null;
let currentAuthState = null;
let currentLocale = readStoredLocale();
const configuredAuthSiteUrl =
  typeof __AUTH_SITE_URL__ === "string" ? __AUTH_SITE_URL__.trim() : "";

const LANDING_COPY = {
  en: {
    auth: {
      closeAria: "Close",
      emailLabel: "Email",
      forgot: "Forgot password?",
      forgotInfo:
        "A dedicated reset page is not ready yet. For now, create a new account or reset the password in Supabase.",
      github: "Continue with GitHub",
      initFailed: "Sign-in initialization failed. Please try again.",
      kicker: "Travel animation studio",
      passwordLabel: "Password",
      passwordPlaceholder: {
        login: "Enter your password",
        register: "Create a password (min. 6 characters)",
      },
      status: {
        loginSuccess: "Signed in successfully. Opening the studio...",
        registerSuccessAuto:
          "Account created. 200 credits added. Taking you to the studio...",
        registerSuccessEmail:
          "Account created. Please verify your email before signing in.",
      },
      submit: {
        login: "Log in",
        register: "Create account",
      },
      submitLoading: {
        login: "Signing in...",
        register: "Creating...",
      },
      subtitle: {
        login: "Sign in to keep editing, check credits, and export videos.",
        register:
          "Create an account and get 200 credits for your first exports.",
      },
      tablistAria: "Log in or register",
      tabs: {
        login: "Log in",
        register: "Sign up",
      },
      titlePrefix: {
        login: "Welcome back",
        register: "Create account",
      },
      validation: {
        emailRegistered: "This email is already registered. Please log in instead.",
        invalidEmail: "Enter a valid email address.",
        passwordTooShort: "Password must be at least 6 characters.",
      },
    },
    brandEyebrow: "Travel Animation Studio",
    demo: {
      chip: "PREVIEW",
      currentStop: "Chongqing",
      kicker: "CURRENT STOP",
      route: "Shanghai → Urumqi",
      toolbar: ["Preview", "Export"],
    },
    documentTitle: "TrailFrame | Travel Route Animation Studio",
    features: {
      body:
        "The feature area is separated for quick scanning, then flows into a clear three-step workflow below.",
      cards: [
        {
          body:
            "Mix flights, trains, and walking in one trip and let camera pacing follow the route automatically.",
          title: "Transport aware",
        },
        {
          body:
            "Change the route and the preview updates right away, without bouncing between different screens.",
          title: "Live preview",
        },
        {
          body:
            "Chain departures, stopovers, and destinations together so the trip reads like a story instead of A to B.",
          title: "Multi-stop story",
        },
        {
          body:
            "Once the motion feels right, export the clip immediately for social posts, edits, or presentations.",
          title: "One-click export",
        },
      ],
      eyebrow: "Features",
      title: "Edit routes, preview camera motion, and export from one studio",
    },
    footer: {
      contactBody:
        "For collaboration, feedback, or a chat about route animation, reach out directly.",
      contactLabel: "Email",
      contactTitle: "Contact",
      copy:
        "Bring routes, stopovers, and emotion into one journey timeline for travel creators and content teams.",
      links: ["Features", "Workflow", "Terms", "Privacy"],
      linksTitle: "Quick links",
      metaHtml:
        "© <span class=\"js-current-year\">{year}</span> TrailFrame Studio. All rights reserved.",
    },
    header: {
      accountAria: "Open account menu",
      accountFallbackTitle: "TrailFrame account",
      dashboard: "Studio",
      localeToggleAria: "Switch to Chinese",
      login: "Log in",
      loginAria: "Open sign-in dialog",
      signOut: "Sign out",
      start: "Start now",
      workspaceAria: "Enter the studio",
    },
    hero: {
      eyebrow: "TrailFrame for travel",
      lead:
        "Add places and transport, then fold scenery, pauses, and feeling into one travel narrative.",
      meta: [
        "Live preview",
        "Transport switching",
        "Multi-stop story",
        "One-click export",
      ],
      primary: "Launch studio",
      proof:
        "Added to the inspiration stack by 5,000+ travel creators",
      secondary: "See workflow",
      titleLines: [
        "Turn every route you take",
        "into a light-stitched frame.",
      ],
    },
    htmlLang: "en",
    metaDescription:
      "TrailFrame turns your travel route into a cinematic animation with multi-stop storytelling, transport-aware pacing, and one-click export.",
    nav: {
      ariaLabel: "Primary navigation",
      items: ["Features", "Workflow"],
    },
    workflow: {
      body:
        "The steps stay clear, but the cards carry more graphic energy than a plain text checklist.",
      cards: [
        {
          body:
            "Add your start, destinations, and stopovers to shape a route with real narrative rhythm.",
          title: "Plan the route",
        },
        {
          body:
            "Choose plane, train, or car for each leg and let the motion language adapt to the transport automatically.",
          title: "Choose transport",
        },
        {
          body:
            "Preview the full camera move in the studio, then export the final clip when it feels right.",
          title: "Preview and export",
        },
      ],
      connectors: ["Resolve route", "Render clip"],
      eyebrow: "✦ Workflow",
      title: "Build your travel animation in three steps",
    },
  },
  zh: {
    auth: {
      closeAria: "关闭",
      emailLabel: "邮箱",
      forgot: "忘记密码？",
      forgotInfo:
        "重置密码页面还未单独实现，当前版本请先注册新账号或在 Supabase 控制台手动重置。",
      github: "使用 GitHub 登录 / 注册",
      initFailed: "登录初始化失败，请稍后重试。",
      kicker: "旅行动画工作室",
      passwordLabel: "密码",
      passwordPlaceholder: {
        login: "输入密码",
        register: "设置密码（至少 6 位）",
      },
      status: {
        loginSuccess: "登录成功，正在进入工作台...",
        registerSuccessAuto:
          "账号创建成功，200 积分已入账，正在进入工作台...",
        registerSuccessEmail:
          "注册成功，请先完成邮箱验证，再回来登录。",
      },
      submit: {
        login: "登录",
        register: "创建账号",
      },
      submitLoading: {
        login: "登录中...",
        register: "创建中...",
      },
      subtitle: {
        login: "登录以继续编辑、查看积分并导出视频",
        register: "注册后立即获赠 200 积分，可直接开始导出",
      },
      tablistAria: "登录注册",
      tabs: {
        login: "登录",
        register: "注册",
      },
      titlePrefix: {
        login: "欢迎回来",
        register: "创建账号",
      },
      validation: {
        emailRegistered: "该邮箱已注册，请直接登录。",
        invalidEmail: "请输入有效邮箱地址。",
        passwordTooShort: "密码至少需要 6 位。",
      },
    },
    brandEyebrow: "旅行动画工作室",
    demo: {
      chip: "预览",
      currentStop: "重庆",
      kicker: "当前站点",
      route: "上海 → 乌鲁木齐",
      toolbar: ["预览", "导出"],
    },
    documentTitle: "TrailFrame | 旅行路线动画生成器",
    features: {
      body:
        "功能区块单独呈现，适合快速浏览能力边界，再进入下面的三步工作流。",
      cards: [
        {
          body:
            "同一段旅程里混合飞机、火车和步行，镜头节奏会跟着路线切换。",
          title: "交通感知",
        },
        {
          body:
            "路线一改，预览就同步更新，不用在多个页面来回切换确认画面。",
          title: "实时预览",
        },
        {
          body:
            "支持出发地、停留点和目的地串联，让旅行不只是从 A 到 B。",
          title: "多站叙事",
        },
        {
          body:
            "确认镜头后直接导出成片，适合分享到社媒、剪辑或项目展示里。",
          title: "一键导出",
        },
      ],
      eyebrow: "功能亮点",
      title: "把路线编辑、镜头预览和导出交给同一个工作台",
    },
    footer: {
      contactBody:
        "合作、反馈，或想聊聊路线动画，欢迎直接联系我。",
      contactLabel: "邮箱",
      contactTitle: "联系开发者",
      copy:
        "把路线、停留和情绪剪进同一条旅程叙事里，为旅行创作者和内容团队准备的一站式工作台。",
      links: ["功能亮点", "工作流", "服务条款", "隐私政策"],
      linksTitle: "传送门",
      metaHtml:
        "© <span class=\"js-current-year\">{year}</span> TrailFrame Studio. 保留所有权利。",
    },
    header: {
      accountAria: "打开账户菜单",
      accountFallbackTitle: "TrailFrame 账户",
      dashboard: "工作台",
      localeToggleAria: "切换到英文",
      login: "登录",
      loginAria: "打开登录弹窗",
      signOut: "退出登录",
      start: "立即开始",
      workspaceAria: "进入工作台",
    },
    hero: {
      eyebrow: "TrailFrame for travel",
      lead:
        "输入地点、交通方式，把风景、停留和情绪都收进同一条旅程叙事。",
      meta: ["实时预览", "交通切换", "多站叙事", "一键导出"],
      primary: "快速开始",
      proof:
        "已被 5,000+ 旅行创作者加入灵感清单",
      secondary: "了解更多",
      titleLines: [
        "把走过的山水和心动",
        "折叠进每一帧的光影里。",
      ],
    },
    htmlLang: "zh-CN",
    metaDescription:
      "TrailFrame 将你的旅行路线转化为电影级动画，支持多站点叙事、交通方式识别与一键导出。",
    nav: {
      ariaLabel: "主导航",
      items: ["功能", "工作流"],
    },
    workflow: {
      body:
        "保留清晰步骤，但换成更有图形感的工作流卡片，不再只是堆文字。",
      cards: [
        {
          body:
            "添加出发地、目的地和途经点，确定一条有情绪节奏的旅行路线。",
          title: "规划路线",
        },
        {
          body:
            "为每段路程选择飞机、火车或汽车，让镜头运动自动适配你的交通方式。",
          title: "设置交通",
        },
        {
          body:
            "在工作室中实时预览镜头运动，满意后一键导出，直接放进你的项目里。",
          title: "预览导出",
        },
      ],
      connectors: ["解析路线", "生成成片"],
      eyebrow: "✦ 工作流",
      title: "三步完成你的旅行动画",
    },
  },
};

const AUTH_ERROR_TRANSLATIONS = {
  "GitHub 登录暂未在 Supabase 中启用。":
    "GitHub sign-in is not enabled in Supabase yet.",
  "密码至少需要 6 位。": "Password must be at least 6 characters.",
  "注册失败，请稍后重试。": "Sign-up failed. Please try again later.",
  "登录失败，请稍后重试。": "Sign-in failed. Please try again later.",
  "请先完成邮箱验证，再登录。":
    "Please verify your email before signing in.",
  "该邮箱已注册，请直接登录。":
    "This email is already registered. Please sign in instead.",
};

function readStoredLocale() {
  try {
    const storedLocale = window.localStorage.getItem(LANDING_LOCALE_KEY);
    return storedLocale === "en" ? "en" : "zh";
  } catch {
    return document.documentElement.dataset.locale === "en" ? "en" : "zh";
  }
}

function persistLocale(locale) {
  try {
    window.localStorage.setItem(LANDING_LOCALE_KEY, locale);
  } catch {
    // Ignore storage errors in restricted browsing contexts.
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

function getCopy() {
  return LANDING_COPY[currentLocale];
}

function setNodeText(node, text) {
  if (node) {
    node.textContent = text;
  }
}

function setNodeTexts(nodes, values) {
  nodes.forEach((node, index) => {
    setNodeText(node, values[index] ?? "");
  });
}

function setCardsText(cards, values) {
  cards.forEach((card, index) => {
    setNodeText(card.title, values[index]?.title ?? "");
    setNodeText(card.body, values[index]?.body ?? "");
  });
}

function translateAuthError(message) {
  if (currentLocale !== "en") {
    return message;
  }

  return AUTH_ERROR_TRANSLATIONS[message] ?? message;
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

  const copy = getCopy().auth;
  authSubmitBtn.disabled = loading;
  authGithubBtn.disabled = loading;
  authSubmitBtn.textContent = loading
    ? authMode === "register"
      ? copy.submitLoading.register
      : copy.submitLoading.login
    : authMode === "register"
      ? copy.submit.register
      : copy.submit.login;
}

function setAuthMode(nextMode) {
  authMode = nextMode === "register" ? "register" : "login";
  const registerView = authMode === "register";
  const copy = getCopy().auth;

  authForm?.setAttribute("data-mode", authMode);
  authTabLogin?.classList.toggle("active", !registerView);
  authTabRegister?.classList.toggle("active", registerView);
  authTabLogin?.setAttribute("aria-selected", registerView ? "false" : "true");
  authTabRegister?.setAttribute("aria-selected", registerView ? "true" : "false");

  setNodeText(authKicker, copy.kicker);
  setNodeText(
    authTitlePrefix,
    registerView ? copy.titlePrefix.register : copy.titlePrefix.login,
  );
  setNodeText(
    authSubtitle,
    registerView ? copy.subtitle.register : copy.subtitle.login,
  );

  if (authMetaHint) {
    authMetaHint.hidden = true;
    authMetaHint.textContent = "";
  }

  if (authPassword) {
    authPassword.placeholder = registerView
      ? copy.passwordPlaceholder.register
      : copy.passwordPlaceholder.login;
    authPassword.autocomplete = registerView ? "new-password" : "current-password";
    authPassword.value = "";
  }

  if (authForgotBtn) authForgotBtn.hidden = registerView;
  if (authFormMeta) authFormMeta.hidden = registerView;

  clearStatus();
  setSubmitLoading(false);
}

function syncHeaderAuthLink() {
  if (!headerAuthLink) return;

  const isSignedIn = Boolean(currentSession);
  headerAuthLink.hidden = isSignedIn;

  if (isSignedIn) return;

  const copy = getCopy().header;
  headerAuthLink.textContent = copy.login;
  headerAuthLink.dataset.authOpen = "login";
  headerAuthLink.setAttribute("aria-label", copy.loginAria);
}

function setLandingAccountMenuOpen(open) {
  if (!landingAccountMenuRoot || !landingAccountMenuButton || !landingAccountMenu) return;
  landingAccountMenuRoot.classList.toggle("is-open", open);
  landingAccountMenuButton.setAttribute("aria-expanded", open ? "true" : "false");
  landingAccountMenu.hidden = !open;
}

function closeLandingAccountMenu() {
  setLandingAccountMenuOpen(false);
}

function syncHeaderAccountMenu() {
  const copy = getCopy().header;
  const isSignedIn = Boolean(currentSession);

  // Select all workspace entry links (header start, hero primary) and hide them when signed in
  const workspaceLinks = document.querySelectorAll(".js-workspace-link");
  workspaceLinks.forEach(link => {
    link.hidden = isSignedIn;
  });

  if (!landingAccountMenuRoot || !landingAccountMenuButton || !landingAccountAvatar) return;

  landingAccountMenuRoot.hidden = !isSignedIn;
  if (!isSignedIn) {
    closeLandingAccountMenu();
    return;
  }

  const displayName =
    currentAuthState?.displayName ||
    currentSession?.user?.user_metadata?.display_name ||
    currentSession?.user?.email?.split("@")[0] ||
    "TrailFrame";

  landingAccountAvatar.textContent = getAuthInitials(currentAuthState || { displayName });
  landingAccountMenuButton.setAttribute("aria-label", copy.accountAria);
  landingAccountMenuButton.setAttribute("title", copy.accountAria);

  if (landingAccountMenuTitle) {
    landingAccountMenuTitle.textContent = displayName || copy.accountFallbackTitle;
  }
  if (landingAccountMenuSubtitle) {
    const email = currentAuthState?.email || currentSession?.user?.email || "";
    const provider = currentAuthState ? getAuthProviderLabel(currentAuthState) : "";
    landingAccountMenuSubtitle.textContent = email
      ? provider
        ? `${email} · ${provider}`
        : email
      : copy.accountFallbackTitle;
  }
  if (landingAccountSignOutBtn) {
    landingAccountSignOutBtn.textContent = copy.signOut;
  }
  if (landingWorkspaceLink) {
    landingWorkspaceLink.textContent = copy.workspaceAria;
  }
}

function syncLandingLocale() {
  const copy = getCopy();
  const year = String(new Date().getFullYear());

  document.documentElement.lang = copy.htmlLang;
  document.documentElement.dataset.locale = currentLocale;
  document.title = copy.documentTitle;
  metaDescription?.setAttribute("content", copy.metaDescription);

  brandEyebrowNodes.forEach((node) => setNodeText(node, copy.brandEyebrow));
  landingNav?.setAttribute("aria-label", copy.nav.ariaLabel);
  setNodeTexts(landingNavLinks, copy.nav.items);
  setNodeText(headerStartCta, copy.header.start);

  setNodeText(heroEyebrow, copy.hero.eyebrow);
  setNodeTexts(heroTitleLines, copy.hero.titleLines);
  setNodeText(heroLead, copy.hero.lead);
  setNodeText(heroPrimaryCta, copy.hero.primary);
  setNodeText(heroSecondaryCta, copy.hero.secondary);
  setNodeTexts(heroMetaItems, copy.hero.meta);
  setNodeText(heroProofText, copy.hero.proof);

  setNodeText(demoChip, copy.demo.chip);
  setNodeText(demoRoutePill, copy.demo.route);
  setNodeText(demoKicker, copy.demo.kicker);
  setNodeText(demoCurrentStop, copy.demo.currentStop);
  setNodeTexts(demoToolbarItems, copy.demo.toolbar);

  setNodeText(featuresEyebrow, copy.features.eyebrow);
  setNodeText(featuresTitle, copy.features.title);
  setNodeText(featuresBody, copy.features.body);
  setCardsText(featureCards, copy.features.cards);

  setNodeText(workflowEyebrow, copy.workflow.eyebrow);
  setNodeText(workflowTitle, copy.workflow.title);
  setNodeText(workflowBody, copy.workflow.body);
  setNodeTexts(workflowConnectors, copy.workflow.connectors);
  setCardsText(workflowCards, copy.workflow.cards);

  setNodeText(footerCopy, copy.footer.copy);
  if (footerMeta) {
    footerMeta.innerHTML = copy.footer.metaHtml.replace("{year}", year);
  }
  setNodeText(footerLinksHeading, copy.footer.linksTitle);
  setNodeTexts(footerLinks, copy.footer.links);
  setNodeText(footerContactTitle, copy.footer.contactTitle);
  setNodeText(footerContactBody, copy.footer.contactBody);
  setNodeText(footerContactLabel, copy.footer.contactLabel);

  authTabs?.setAttribute("aria-label", copy.auth.tablistAria);
  authCloseBtn?.setAttribute("aria-label", copy.auth.closeAria);
  setNodeText(authTabLogin, copy.auth.tabs.login);
  setNodeText(authTabRegister, copy.auth.tabs.register);
  setNodeText(authGithubLabel, copy.auth.github);

  setNodeTexts(authFieldLabels, [
    copy.auth.emailLabel,
    copy.auth.passwordLabel,
  ]);

  if (localeToggle) {
    localeToggle.setAttribute("aria-label", copy.header.localeToggleAria);
    localeToggle.setAttribute("title", copy.header.localeToggleAria);
  }

  syncHeaderAccountMenu();
}

function applyLocale(nextLocale) {
  currentLocale = nextLocale === "en" ? "en" : "zh";
  persistLocale(currentLocale);
  syncLandingLocale();
  syncHeaderAuthLink();
  setAuthMode(authMode);
  setFooterLocale(currentLocale);
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

async function refreshAuthState() {
  currentSession = await getSession();
  currentAuthState = currentSession ? buildAuthState(currentSession, null) : null;
  syncHeaderAuthLink();
  syncHeaderAccountMenu();

  if (currentSession) {
    try {
      const profile = await waitForProfile(currentSession.user.id, { attempts: 4, delayMs: 180 });
      currentAuthState = buildAuthState(currentSession, profile);
      syncHeaderAccountMenu();
    } catch (error) {
      console.error("Failed to hydrate landing auth profile", error);
    }
  }

  return currentSession;
}

function getOAuthReturnUrl() {
  const baseUrl = configuredAuthSiteUrl || window.location.origin;
  const returnUrl = new URL(window.location.pathname, baseUrl);
  returnUrl.searchParams.set("auth", "login");

  const redirectTarget = pendingRedirect || getWorkspaceTarget();
  if (redirectTarget) {
    returnUrl.searchParams.set("redirect", redirectTarget);
  }

  return returnUrl.toString();
}

localeToggle?.addEventListener("click", () => {
  applyLocale(currentLocale === "en" ? "zh" : "en");
});

landingAccountMenuButton?.addEventListener("click", () => {
  const nextExpanded = landingAccountMenuButton.getAttribute("aria-expanded") !== "true";
  setLandingAccountMenuOpen(nextExpanded);
});

landingAccountMenu?.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target?.closest("#landingAccountSignOutBtn")) return;

  signOut()
    .catch((error) => {
      console.error(error);
    })
    .finally(() => {
      currentSession = null;
      currentAuthState = null;
      closeLandingAccountMenu();
      syncHeaderAuthLink();
      syncHeaderAccountMenu();
    });
});

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
    openAuthModal("login", anchor?.getAttribute("href"));
  });
});

authTabLogin?.addEventListener("click", () => setAuthMode("login"));
authTabRegister?.addEventListener("click", () => setAuthMode("register"));
authCloseBtn?.addEventListener("click", closeAuthModal);
authClosers.forEach((closer) => closer.addEventListener("click", closeAuthModal));

authForgotBtn?.addEventListener("click", () => {
  showStatus(getCopy().auth.forgotInfo, "info");
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
    showStatus(translateAuthError(getAuthErrorMessage(error, authMode)), "error");
    setSubmitLoading(false);
  }
});

authForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = authEmail?.value.trim().toLowerCase() || "";
  const password = authPassword?.value.trim() || "";
  const authCopy = getCopy().auth;

  if (!isValidEmail(email)) {
    showStatus(authCopy.validation.invalidEmail, "error");
    authEmail?.focus();
    return;
  }

  if (password.length < 6) {
    showStatus(authCopy.validation.passwordTooShort, "error");
    authPassword?.focus();
    return;
  }

  setSubmitLoading(true);
  clearStatus();

  try {
    assertSupabaseConfigured();

    if (authMode === "register") {
      const alreadyRegistered = await isEmailRegistered(email);
      if (alreadyRegistered) {
        setAuthMode("login");
        if (authEmail) authEmail.value = email;
        showStatus(authCopy.validation.emailRegistered, "info");
        authPassword?.focus();
        return;
      }

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: getOAuthReturnUrl(),
          data: {
            display_name: email.split("@")[0]?.replace(/[._-]+/g, " ").trim() || "TrailFrame",
          },
        },
      });

      if (error) throw error;

      currentSession = data.session ?? null;
      currentAuthState = currentSession ? buildAuthState(currentSession, null) : null;
      syncHeaderAuthLink();
      syncHeaderAccountMenu();

      if (data.session) {
        showStatus(authCopy.status.registerSuccessAuto, "success");
        window.setTimeout(proceedAfterAuth, 220);
        return;
      }

      showStatus(authCopy.status.registerSuccessEmail, "success");
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
    showStatus(authCopy.status.loginSuccess, "success");
    window.setTimeout(proceedAfterAuth, 220);
  } catch (error) {
    showStatus(translateAuthError(getAuthErrorMessage(error, authMode)), "error");
    setSubmitLoading(false);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (authModal && !authModal.hidden) {
      closeAuthModal();
      return;
    }
    closeLandingAccountMenu();
  }
});

document.addEventListener("click", (event) => {
  if (!landingAccountMenuRoot || !landingAccountMenuButton || !landingAccountMenu) return;
  if (landingAccountMenu.hidden) return;
  const target = event.target instanceof Node ? event.target : null;
  if (target && landingAccountMenuRoot.contains(target)) return;
  closeLandingAccountMenu();
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

  supabase.auth.onAuthStateChange(async (_event, session) => {
    currentSession = session;
    currentAuthState = session ? buildAuthState(session, null) : null;
    syncHeaderAuthLink();
    syncHeaderAccountMenu();

    if (session) {
      try {
        const profile = await waitForProfile(session.user.id, { attempts: 3, delayMs: 160 });
        if (currentSession?.user?.id !== session.user.id) return;
        currentAuthState = buildAuthState(session, profile);
        syncHeaderAccountMenu();
      } catch (error) {
        console.error("Failed to sync landing auth state", error);
      }
    }
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

initSiteFooter();
applyLocale(currentLocale);

bootstrapAuth().catch((error) => {
  console.error(error);
  setAuthMode("login");
  showStatus(error.message || getCopy().auth.initFailed, "error");
});
