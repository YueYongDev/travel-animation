import "./fontfaces.css";
import "./styles.css";
import { createRemotionJourneyScene } from "./remotionJourneyScene";
import {
  createPlaceSearchSessionToken,
  fetchPlaceSuggestions,
  geocodePlace,
  hasPlaceSearchProvider,
} from "./lib/geocode";
import {
  EXPORT_CREDIT_COST,
  assertSupabaseConfigured,
  buildAuthState,
  consumeCredits,
  getAuthDisplayName,
  getAuthErrorMessage,
  getAuthInitials,
  getAuthProviderLabel,
  getSession,
  signOut,
  subscribeToProfile,
  supabase,
  waitForProfile,
} from "./lib/supabaseAuth";

const playBtn = document.getElementById("playBtn");
const exportBtn = document.getElementById("exportBtn");
const speedBtn = document.getElementById("speedBtn");
const speedMenu = document.getElementById("speedMenu");
const basemapBtn = document.getElementById("basemapBtn");
const generateBtn = document.getElementById("generateBtn");
const addDestBtn = document.getElementById("addDestBtn");
const addDestHint = document.getElementById("addDestHint");
const accountMenuRoot = document.getElementById("accountMenuRoot");
const accountMenuButton = document.getElementById("accountMenuButton");
const accountMenu = document.getElementById("accountMenu");
const accountAvatar = document.getElementById("accountAvatar");
const accountLabel = document.getElementById("accountLabel");
const creditsBadge = document.getElementById("creditsBadge");
const creditsValue = document.getElementById("creditsValue");
const accountMenuTitle = document.getElementById("accountMenuTitle");
const accountMenuSubtitle = document.getElementById("accountMenuSubtitle");
const accountSignOutBtn = document.getElementById("accountSignOutBtn");
const sidebarActions = document.getElementById("sidebarActions");
const arrivalCard = document.getElementById("arrivalCard");
const arrivalCity = document.getElementById("arrivalCity");
const arrivalCountry = document.getElementById("arrivalCountry");
const arrivalKm = document.getElementById("arrivalKm");
const previewRouteLabel = document.getElementById("previewRouteLabel");
const globeContainer = document.getElementById("globeContainer");
const routeTimeline = document.getElementById("routeTimeline");
const sidebarCard = document.querySelector(".sidebar-card");
const modeToggles = document.querySelectorAll(".mode-toggle[data-select]");
const motionDebugEnabled = new URLSearchParams(window.location.search).has("motionDebug");

let scene = null;
let playing = false;
let building = false;
let sceneInitQueue = Promise.resolve();

const MODES = ["plane", "train", "car", "ship", "bike", "walk"];
const SPEED_OPTIONS = [1, 2, 4];
const MAX_ROUTE_LOCATIONS = 15;
const MODE_EMOJI = {
  plane: "✈️",
  train: "🚆",
  car: "🚗",
  ship: "🚢",
  bike: "🚲",
  walk: "🚶"
};
const geocodeCache = new Map();
const suggestionCache = new Map();
const inputSearchState = new WeakMap();
let draggedRow = null;
let dropRow = null;
let dropPosition = "after";
let latestPlaybackBlob = null;
let latestPlaybackMimeType = "";
let playbackRate = 1;
let selectedTimelineRow = null;
let authState = null;
let authSession = null;
let profileChannel = null;
let workspaceBound = false;
let motionDebugPanel = null;
let motionDebugTextarea = null;
let motionDebugLiveText = "";
let motionDebugSegmentsText = "";
let motionDebugBoundaryText = "";
const PLAY_BUTTON_REPLAY_HTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg> Replay';
const EXPORT_BUTTON_HTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Export';

function syncExportButtonState() {
  if (!exportBtn) return;
  const canExport =
    Boolean(scene) &&
    !building &&
    !playing &&
    Boolean(latestPlaybackBlob);
  exportBtn.disabled = !canExport;
  exportBtn.title = canExport ? "" : "Generate Route first, then export after the preview finishes.";
  if (!building && !playing) {
    exportBtn.innerHTML = EXPORT_BUTTON_HTML;
  }
}

function resetLatestPlayback() {
  latestPlaybackBlob = null;
  latestPlaybackMimeType = "";
  syncExportButtonState();
}

function storeLatestPlayback(blob, mimeType) {
  latestPlaybackBlob = blob;
  latestPlaybackMimeType = mimeType;
  syncExportButtonState();
}

function ensureMotionDebugPanel() {
  if (!motionDebugEnabled || motionDebugPanel) {
    return motionDebugPanel;
  }

  const panel = document.createElement("section");
  panel.className = "motion-debug-panel";
  panel.innerHTML = `
    <div class="motion-debug-panel__header">
      <strong>Motion Debug</strong>
      <button type="button" class="motion-debug-panel__copy">Copy</button>
    </div>
    <textarea class="motion-debug-panel__output" readonly spellcheck="false"></textarea>
  `;

  const copyButton = panel.querySelector(".motion-debug-panel__copy");
  const output = panel.querySelector(".motion-debug-panel__output");
  if (!copyButton || !output) {
    return null;
  }

  copyButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(output.value);
      copyButton.textContent = "Copied";
      window.setTimeout(() => {
        copyButton.textContent = "Copy";
      }, 1200);
    } catch {
      output.focus();
      output.select();
    }
  });

  motionDebugPanel = panel;
  motionDebugTextarea = output;
  document.body.appendChild(panel);
  syncMotionDebugPanel();
  return panel;
}

function syncMotionDebugPanel() {
  if (!motionDebugEnabled || !motionDebugTextarea) {
    return;
  }

  const sections = [
    motionDebugLiveText,
    motionDebugSegmentsText,
    motionDebugBoundaryText,
  ].filter(Boolean);
  motionDebugTextarea.value = sections.join("\n\n");
}

function handleMotionDebugEvent(event) {
  if (!motionDebugEnabled) {
    return;
  }

  ensureMotionDebugPanel();
  const detail = event?.detail || {};
  if (typeof detail.segmentsText === "string") {
    motionDebugSegmentsText = detail.segmentsText;
  }
  if (typeof detail.boundaryText === "string") {
    motionDebugBoundaryText = detail.boundaryText;
  }
  if (typeof detail.liveText === "string") {
    motionDebugLiveText = detail.liveText;
  }
  syncMotionDebugPanel();
}

function getRemainingCredits() {
  if (typeof authState?.credits === "number" && Number.isFinite(authState.credits)) {
    return Math.max(0, authState.credits);
  }
  return 0;
}

function getWorkspaceRedirectTarget() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function redirectToLandingAuth() {
  const redirect = encodeURIComponent(getWorkspaceRedirectTarget());
  window.location.replace(`../?auth=login&redirect=${redirect}`);
}

function formatPlaybackRate(rate) {
  return `x${Number.isInteger(rate) ? rate : rate.toFixed(1)}`;
}

function formatDistanceKm(km) {
  return `${Math.round(km).toLocaleString("en-US")} km`;
}

function getAccountDisplayName() {
  return getAuthDisplayName(authState);
}

function getAccountInitials() {
  return getAuthInitials(authState);
}

function syncAccountUI() {
  const displayName = getAccountDisplayName();
  if (accountAvatar) accountAvatar.textContent = getAccountInitials();
  if (accountLabel) accountLabel.textContent = displayName;
  const remainingCredits = getRemainingCredits();
  if (creditsBadge) {
    creditsBadge.dataset.state = remainingCredits > 0 ? "available" : "empty";
    creditsBadge.setAttribute(
      "aria-label",
      remainingCredits > 0 ? `${remainingCredits} credits remaining` : "No credits remaining",
    );
  }
  if (creditsValue) {
    creditsValue.textContent = remainingCredits > 0 ? `${remainingCredits} left` : "No credits";
  }
  if (accountMenuTitle) accountMenuTitle.textContent = `${displayName}'s Workspace`;
  if (accountMenuSubtitle) {
    accountMenuSubtitle.textContent = authState?.email
      ? `${authState.email} · ${getAuthProviderLabel(authState)}`
      : "Your routes and exports are ready.";
  }
}

function updateAuthState(nextProfile = null) {
  authState = buildAuthState(authSession, nextProfile);
  syncAccountUI();
}

async function initializeAuthState() {
  assertSupabaseConfigured();
  const session = await getSession();

  if (!session) {
    redirectToLandingAuth();
    return false;
  }

  authSession = session;
  const profile = await waitForProfile(session.user.id);
  updateAuthState(profile);

  if (profileChannel) {
    supabase.removeChannel(profileChannel);
  }

  profileChannel = subscribeToProfile(session.user.id, (nextProfile) => {
    updateAuthState(nextProfile);
  });

  return true;
}

function getExportErrorMessage(error) {
  const message = error?.message || "";
  if (message.toLowerCase().includes("insufficient credits")) {
    return `积分不足，导出一次需要 ${EXPORT_CREDIT_COST} 积分。`;
  }

  if (message.toLowerCase().includes("profile not found")) {
    return "积分档案还没初始化完成，请稍后重试并确认 Supabase SQL 脚本已执行。";
  }

  return getAuthErrorMessage(error, "login");
}

function calculateDistanceKm(from, to) {
  const toRadians = (value) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const latDelta = toRadians(to.lat - from.lat);
  const lonDelta = toRadians(to.lon - from.lon);
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);

  const haversine =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(lonDelta / 2) ** 2;

  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function getDisplayPlaceName(text) {
  return text.split(",")[0]?.trim() || text.trim();
}

function getTimelineLabels() {
  return getTimelineRows()
    .map((row) => row.querySelector('input[type="text"]')?.value.trim() || "")
    .filter(Boolean)
    .map(getDisplayPlaceName);
}

function updateRouteOverview() {
  const labels = getTimelineLabels();
  const stopCount = labels.length;

  if (!stopCount) {
    if (previewRouteLabel) previewRouteLabel.textContent = "WAITING FOR ROUTE";
    updateLegDistanceLabels();
    return;
  }

  if (stopCount === 1) {
    if (previewRouteLabel) previewRouteLabel.textContent = labels[0].toUpperCase();
    updateLegDistanceLabels();
    return;
  }

  const routeLabel = labels.join(" → ").toUpperCase();
  if (previewRouteLabel) previewRouteLabel.textContent = routeLabel;
  updateLegDistanceLabels();
}

function createTimelineRow(role, placeholder, state = {}) {
  const row = document.createElement("div");
  row.className = "timeline-row";
  row.dataset.role = role;
  row.innerHTML = `
    <span class="row-order" aria-hidden="true"></span>
    <div class="timeline-row-main">
      <div class="row-display-shell">
        <button type="button" class="row-display-card" aria-label="Edit stop">
          <strong class="row-display-title"></strong>
          <span class="row-display-meta"></span>
        </button>
        <div class="row-card-actions">
          <button type="button" class="row-card-action" data-action="edit" aria-label="Re-enter stop">
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
          </button>
          <button type="button" class="row-card-action danger" data-action="delete" aria-label="Delete stop">
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /></svg>
          </button>
        </div>
      </div>
      <div class="row-input-wrap">
        <span class="row-search-icon" aria-hidden="true">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="7"></circle>
            <path d="m20 20-3.5-3.5"></path>
          </svg>
        </span>
        <input type="text" placeholder="${placeholder}" />
        <div class="row-edit-actions">
          <button type="button" class="row-edit-confirm" aria-label="Confirm stop">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          </button>
          <button type="button" class="row-edit-cancel" aria-label="Cancel editing">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
    </div>
  `;

  const input = row.querySelector('input[type="text"]');
  if (input) {
    input.value = state.value || "";
    input.dataset.resolvedQuery = state.resolvedQuery || input.value.trim();
    if (state.coord) input.dataset.coord = state.coord;
    if (state.country) input.dataset.country = state.country;
  }

  return row;
}

function closeSpeedMenu() {
  if (!speedBtn || !speedMenu) return;
  speedBtn.setAttribute("aria-expanded", "false");
  speedMenu.hidden = true;
}

function setAccountMenuOpen(open) {
  if (!accountMenuRoot || !accountMenuButton || !accountMenu) return;
  accountMenuRoot.classList.toggle("is-open", open);
  accountMenuButton.setAttribute("aria-expanded", open ? "true" : "false");
  accountMenu.hidden = !open;
}

function closeAccountMenu() {
  setAccountMenuOpen(false);
}

function updateLegDistanceLabels() {
  const rows = getTimelineRows();
  const connectors = Array.from(routeTimeline?.querySelectorAll(".timeline-connector") || []);

  connectors.forEach((connector, index) => {
    const label = connector.querySelector(".leg-distance");
    const fromInput = rows[index]?.querySelector('input[type="text"]');
    const toInput = rows[index + 1]?.querySelector('input[type="text"]');
    const fromCoord = parseCoord(fromInput?.dataset.coord || "");
    const toCoord = parseCoord(toInput?.dataset.coord || "");

    if (!label) return;

    if (!fromCoord || !toCoord) {
      label.hidden = true;
      label.textContent = "";
      connector.classList.remove("has-distance");
      return;
    }

    label.hidden = false;
    label.textContent = formatDistanceKm(calculateDistanceKm(fromCoord, toCoord));
    connector.classList.add("has-distance");
  });
}

function updateSpeedControlUI() {
  if (speedBtn) {
    const label = speedBtn.querySelector(".speed-btn-label");
    if (label) {
      label.textContent = formatPlaybackRate(playbackRate);
    }
  }

  if (!speedMenu) return;
  speedMenu.querySelectorAll(".speed-option").forEach((option) => {
    const rate = Number(option.dataset.rate);
    const active = rate === playbackRate;
    option.classList.toggle("active", active);
    option.setAttribute("aria-checked", active ? "true" : "false");
  });
}

function setPlaybackRate(nextRate) {
  if (!SPEED_OPTIONS.includes(nextRate)) return;
  if (playbackRate === nextRate) {
    closeSpeedMenu();
    return;
  }
  playbackRate = nextRate;
  scene?.setPlaybackRate?.(playbackRate);
  resetLatestPlayback();
  updateSpeedControlUI();
  closeSpeedMenu();
}

function updateSidebarOverflowState() {
  if (!sidebarCard || !routeTimeline || !sidebarActions) return;
  sidebarCard.classList.remove("is-overflowing");
  const overflowing = sidebarCard.scrollHeight > sidebarCard.clientHeight + 1;
  sidebarCard.classList.toggle("is-overflowing", overflowing);
}

function initSidebarOverflowState() {
  if (!sidebarCard || !routeTimeline || !sidebarActions) return;

  const onChange = () => updateSidebarOverflowState();
  window.addEventListener("resize", onChange);

  if (typeof ResizeObserver !== "undefined") {
    const resizeObserver = new ResizeObserver(onChange);
    resizeObserver.observe(sidebarCard);
    resizeObserver.observe(routeTimeline);
    resizeObserver.observe(sidebarActions);
  }

  if (typeof MutationObserver !== "undefined") {
    const mutationObserver = new MutationObserver(onChange);
    mutationObserver.observe(routeTimeline, { childList: true });
  }

  if (document.fonts?.ready) {
    document.fonts.ready.then(onChange).catch(() => { });
  }

  requestAnimationFrame(onChange);
}

function syncModeButton(btn) {
  const mode = MODES.includes(btn.dataset.mode) ? btn.dataset.mode : "plane";
  btn.dataset.mode = mode;
  btn.setAttribute("aria-label", `Transport mode: ${mode}`);
  btn.setAttribute("aria-expanded", "false");
  ensureModePicker(btn);
  syncModePickerSelection(btn);
}

function ensureModePicker(btn) {
  const connector = btn.closest(".timeline-connector");
  if (!connector) return null;

  let picker = connector.querySelector(".mode-picker");
  if (!picker) {
    picker = document.createElement("div");
    picker.className = "mode-picker";
    picker.setAttribute("role", "menu");
    picker.setAttribute("aria-hidden", "true");
    picker.innerHTML = MODES.map(
      (mode) => `
        <button type="button" class="mode-option" data-mode="${mode}" role="menuitemradio" aria-checked="false" aria-label="${mode}">
          <span class="mode-option-emoji" aria-hidden="true">${MODE_EMOJI[mode] || "✈️"}</span>
        </button>
      `
    ).join("");
    connector.appendChild(picker);
  }
  return picker;
}

function syncModePickerSelection(btn) {
  const picker = ensureModePicker(btn);
  if (!picker) return;
  const current = MODES.includes(btn.dataset.mode) ? btn.dataset.mode : "plane";
  picker.querySelectorAll(".mode-option").forEach((option) => {
    const active = option.dataset.mode === current;
    option.classList.toggle("active", active);
    option.setAttribute("aria-checked", active ? "true" : "false");
  });
}

function closeAllModePickers(exceptConnector = null) {
  document.querySelectorAll(".timeline-connector .mode-picker.show").forEach((picker) => {
    const connector = picker.closest(".timeline-connector");
    if (exceptConnector && connector === exceptConnector) return;
    picker.classList.remove("show");
    picker.setAttribute("aria-hidden", "true");
    const toggle = connector?.querySelector(".mode-toggle");
    if (toggle) toggle.setAttribute("aria-expanded", "false");
  });
}

function setModeForToggle(toggle, mode) {
  const next = MODES.includes(mode) ? mode : "plane";
  toggle.dataset.mode = next;
  toggle.setAttribute("aria-label", `Transport mode: ${next}`);
  syncModePickerSelection(toggle);
}

function initModeToggles() {
  document.querySelectorAll(".mode-toggle").forEach(syncModeButton);

  if (routeTimeline) {
    routeTimeline.addEventListener("click", (event) => {
      const option = event.target.closest(".mode-option");
      if (option) {
        const connector = option.closest(".timeline-connector");
        const toggle = connector?.querySelector(".mode-toggle");
        if (toggle) setModeForToggle(toggle, option.dataset.mode);
        if (connector) connector.dataset.distanceReady = "true";
        updateLegDistanceLabels();
        closeAllModePickers();
        return;
      }

      const btn = event.target.closest(".mode-toggle");
      if (!btn) return;
      event.preventDefault();
      const connector = btn.closest(".timeline-connector");
      const picker = ensureModePicker(btn);
      if (!connector || !picker) return;

      const willOpen = !picker.classList.contains("show");
      closeAllModePickers(connector);
      picker.classList.toggle("show", willOpen);
      picker.setAttribute("aria-hidden", willOpen ? "false" : "true");
      btn.setAttribute("aria-expanded", willOpen ? "true" : "false");
    });
  }

  document.addEventListener("click", (event) => {
    if (event.target.closest(".timeline-connector")) return;
    closeAllModePickers();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    closeAllModePickers();
  });

  modeToggles.forEach((btn) => {
    const selectId = btn.dataset.select;
    const selectEl = selectId ? document.getElementById(selectId) : null;
    if (!selectEl) return;

    // Sync initial state
    const initial = selectEl.value || "plane";
    setModeForToggle(btn, initial);

    btn.addEventListener("click", () => {
      const current = btn.dataset.mode;
      const idx = MODES.indexOf(current);
      const next = MODES[(idx + 1) % MODES.length];
      setModeForToggle(btn, next);
      selectEl.value = next;
    });
  });
}

function enableInitialLegDistances() {
  routeTimeline?.querySelectorAll(".timeline-connector").forEach((connector) => {
    connector.dataset.distanceReady = "true";
  });
  updateLegDistanceLabels();
}

function parseCoord(text) {
  const [lonStr, latStr] = text.split(",").map((v) => v.trim());
  const lon = Number(lonStr);
  const lat = Number(latStr);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return { lon, lat };
}

function getSearchState(input) {
  let state = inputSearchState.get(input);
  if (state) return state;
  state = {
    timer: null,
    controller: null,
    suggestions: [],
    activeIndex: -1,
    hideTimer: null,
    sessionToken: null,
  };
  inputSearchState.set(input, state);
  return state;
}

function sanitizeCountry(value) {
  return value ? value.toUpperCase() : "-";
}

function countryCodeToFlagEmoji(countryCode) {
  const normalized = typeof countryCode === "string" ? countryCode.trim().toUpperCase() : "";
  if (!/^[A-Z]{2}$/.test(normalized)) return "🌍";

  return String.fromCodePoint(
    ...normalized.split("").map((char) => 127397 + char.charCodeAt(0)),
  );
}

function formatCountryLabel(country, countryCode = "") {
  const normalizedCountry = sanitizeCountry(country || "Awaiting confirmation");
  return `${countryCodeToFlagEmoji(countryCode)} ${normalizedCountry}`;
}

function getCityFromQuery(query) {
  const head = query.split(",")[0]?.trim();
  return head || query;
}

function getRowRoleLabel(role, index) {
  if (role === "start") return "Start";
  if (role === "end") return "Destination";
  return `Stop ${index + 1}`;
}

function getRowInput(row) {
  return row?.querySelector('input[type="text"]') || null;
}

function getResolvedRowValue(input) {
  return input?.dataset.resolvedQuery?.trim() || input?.value.trim() || "";
}

function rowHasResolvedLocation(row) {
  const input = getRowInput(row);
  return Boolean(parseCoord(input?.dataset.coord || "") && getResolvedRowValue(input));
}

function getCommittedRowState(row) {
  const input = getRowInput(row);
  if (!input) return null;

  const coord = input.dataset.committedCoord || "";
  const resolvedQuery = input.dataset.committedResolvedQuery || "";
  if (!coord || !resolvedQuery) return null;

  return {
    coord,
    country: input.dataset.committedCountry || "",
    countryCode: input.dataset.committedCountryCode || "",
    resolvedQuery,
    value: input.dataset.committedValue || resolvedQuery,
  };
}

function persistCommittedRowState(row) {
  const input = getRowInput(row);
  if (!input) return;

  const coord = input.dataset.coord || "";
  const resolvedQuery = input.dataset.resolvedQuery?.trim() || input.value.trim();
  if (!coord || !resolvedQuery) return;

  input.dataset.committedCoord = coord;
  input.dataset.committedCountry = input.dataset.country || "";
  input.dataset.committedCountryCode = input.dataset.countryCode || "";
  input.dataset.committedResolvedQuery = resolvedQuery;
  input.dataset.committedValue = resolvedQuery;
}

function restoreCommittedRowState(row) {
  const input = getRowInput(row);
  const committed = getCommittedRowState(row);
  if (!input || !committed) return false;

  input.value = committed.value;
  input.dataset.coord = committed.coord;
  input.dataset.country = committed.country;
  input.dataset.resolvedQuery = committed.resolvedQuery;
  if (committed.countryCode) {
    input.dataset.countryCode = committed.countryCode;
  } else {
    delete input.dataset.countryCode;
  }

  return true;
}

function syncSelectedTimelineRow() {
  const rows = getTimelineRows();
  if (selectedTimelineRow && !rows.includes(selectedTimelineRow)) {
    selectedTimelineRow = null;
  }

  rows.forEach((row) => {
    row.classList.toggle(
      "is-selected",
      row === selectedTimelineRow &&
        row.dataset.editing !== "true" &&
        rowHasResolvedLocation(row),
    );
  });
}

function setSelectedTimelineRow(row) {
  selectedTimelineRow = row ?? null;
  syncSelectedTimelineRow();
}

function setRowEditing(row, editing, { focus = false } = {}) {
  if (!row) return;
  row.dataset.editing = editing ? "true" : "false";
  if (editing && row === selectedTimelineRow) {
    selectedTimelineRow = null;
  }
  syncTimelineRowPresentation(row);
  syncSelectedTimelineRow();
  if (editing && focus) {
    const input = getRowInput(row);
    window.requestAnimationFrame(() => input?.focus());
  }
}

function syncTimelineRowPresentation(row, index = getTimelineRows().indexOf(row)) {
  const input = getRowInput(row);
  if (!input) return;

  const order = row.querySelector(".row-order");
  const title = row.querySelector(".row-display-title");
  const meta = row.querySelector(".row-display-meta");
  const displayCard = row.querySelector(".row-display-card");
  const deleteButton = row.querySelector('.row-card-action[data-action="delete"]');
  const editDismissButton = row.querySelector(".row-edit-cancel");
  const isResolved = rowHasResolvedLocation(row);
  const isEditing = row.dataset.editing === "true" || !isResolved;
  const committedState = getCommittedRowState(row);
  const rowValue = getResolvedRowValue(input);
  const canDelete = getTimelineRows().length > 2;

  if (order) order.textContent = String(index + 1);
  if (title) title.textContent = getCityFromQuery(rowValue || input.placeholder || "New stop");
  if (meta) {
    meta.textContent = formatCountryLabel(
      input.dataset.country || "Awaiting confirmation",
      input.dataset.countryCode || "",
    );
  }
  if (displayCard) {
    displayCard.setAttribute(
      "aria-label",
      isResolved ? `Focus ${title?.textContent || "stop"} on map` : "Confirm stop",
    );
  }

  row.classList.toggle("is-editing", isEditing);
  row.classList.toggle("is-resolved", isResolved);
  if (deleteButton instanceof HTMLButtonElement) {
    deleteButton.disabled = !canDelete;
  }
  if (editDismissButton instanceof HTMLButtonElement) {
    editDismissButton.disabled = !committedState && !canDelete;
    editDismissButton.setAttribute(
      "aria-label",
      committedState ? "Cancel editing" : "Delete stop",
    );
  }
}

function syncRouteRowsUI() {
  const rows = getTimelineRows();
  rows.forEach((row, index) => syncTimelineRowPresentation(row, index));
  syncSelectedTimelineRow();
  syncAddDestinationButtonState();
}

async function geocodeAddress(query) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return null;
  if (geocodeCache.has(normalized)) return geocodeCache.get(normalized);

  const geocoded = {
    lon: 0,
    lat: 0,
    city: "",
    country: "-",
    countryCode: "",
  };
  const resolved = await geocodePlace(query);
  if (!resolved) return null;

  geocoded.lon = resolved.longitude;
  geocoded.lat = resolved.latitude;
  geocoded.city = resolved.title || getCityFromQuery(query);
  geocoded.country = sanitizeCountry(resolved.country);
  geocoded.countryCode = resolved.countryCode || "";
  geocodeCache.set(normalized, geocoded);
  return geocoded;
}

async function fetchAddressSuggestions(query, signal, sessionToken) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  if (suggestionCache.has(normalized)) return suggestionCache.get(normalized);
  if (!hasPlaceSearchProvider()) return [];

  const suggestions = await fetchPlaceSuggestions(query, {
    signal,
    sessionToken,
    limit: 6,
  });
  suggestionCache.set(normalized, suggestions);
  return suggestions;
}

function getSuggestionContainer(input) {
  const wrap = input.closest(".row-input-wrap");
  if (!wrap) return null;
  let list = wrap.querySelector(".address-suggestions");
  if (list) return list;
  list = document.createElement("div");
  list.className = "address-suggestions";
  wrap.appendChild(list);
  return list;
}

function positionAddressSuggestions(input, list) {
  const wrap = input.closest(".row-input-wrap");
  if (!wrap || !list) return;

  const rect = wrap.getBoundingClientRect();
  const estimatedHeight = Math.min(
    Math.max(list.scrollHeight || 0, statefulSuggestionHeight(list)),
    260,
  );
  const spaceBelow = window.innerHeight - rect.bottom;
  const spaceAbove = rect.top;
  const shouldOpenUpward = spaceBelow < estimatedHeight + 24 && spaceAbove > spaceBelow;

  list.classList.toggle("open-upward", shouldOpenUpward);
}

function statefulSuggestionHeight(list) {
  return list.children.length * 52;
}

function closeAddressSuggestions(input) {
  const state = getSearchState(input);
  state.activeIndex = -1;
  state.suggestions = [];
  const list = input.closest(".row-input-wrap")?.querySelector(".address-suggestions");
  if (list) {
    list.innerHTML = "";
    list.classList.remove("show");
  }
}

async function applyAddressSuggestion(input, suggestion) {
  input.value = suggestion.label;
  delete input.dataset.coord;
  delete input.dataset.country;
  delete input.dataset.countryCode;
  delete input.dataset.resolvedQuery;
  closeAddressSuggestions(input);
  updateRouteOverview();
  updateLegDistanceLabels();
  syncRouteRowsUI();

  const row = input.closest(".timeline-row");
  if (!row) return;
  await confirmRowInput(row);
}

async function confirmRowInput(row) {
  const input = getRowInput(row);
  if (!input) return;

  const resolvedStop = await resolveStopFromInput(input);
  if (!resolvedStop) return;
  persistCommittedRowState(row);
  setRowEditing(row, false);
  syncRouteRowsUI();
  await refreshPreviewSceneFromRows({ focusRow: row });
}

function cancelRowEditing(row) {
  const input = getRowInput(row);
  if (!input) return;

  if (restoreCommittedRowState(row)) {
    setRowEditing(row, false);
  } else if (getTimelineRows().length > 2) {
    removeDestinationRow(row);
    return;
  } else {
    input.value = "";
    setRowEditing(row, true);
  }

  closeAddressSuggestions(input);
  syncRouteRowsUI();
}

function renderAddressSuggestions(input) {
  const state = getSearchState(input);
  const list = getSuggestionContainer(input);
  if (!list) return;

  if (!state.suggestions.length) {
    list.innerHTML = "";
    list.classList.remove("show");
    return;
  }

  list.innerHTML = "";
  state.suggestions.forEach((suggestion, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "address-suggestion-item";
    if (index === state.activeIndex) button.classList.add("active");
    button.textContent = suggestion.label;
    button.addEventListener("mousedown", async (event) => {
      event.preventDefault();
      try {
        await applyAddressSuggestion(input, suggestion);
      } catch (error) {
        // eslint-disable-next-line no-alert
        alert(error.message || "无法确认该地点");
      }
    });
    list.appendChild(button);
  });
  list.classList.add("show");
  positionAddressSuggestions(input, list);
}

function moveSuggestionFocus(input, direction) {
  const state = getSearchState(input);
  if (!state.suggestions.length) return;

  if (direction > 0) {
    state.activeIndex = (state.activeIndex + 1) % state.suggestions.length;
  } else {
    state.activeIndex = state.activeIndex <= 0 ? state.suggestions.length - 1 : state.activeIndex - 1;
  }
  renderAddressSuggestions(input);
}

function bindAddressSearch(input) {
  const state = getSearchState(input);

  const requestSuggestions = async () => {
    const query = input.value.trim();
    if (query.length < 2) {
      state.sessionToken = null;
      closeAddressSuggestions(input);
      return;
    }

    state.controller?.abort();
    state.sessionToken ||= createPlaceSearchSessionToken();
    const controller = new AbortController();
    state.controller = controller;

    try {
      const suggestions = await fetchAddressSuggestions(
        query,
        controller.signal,
        state.sessionToken,
      );
      if (controller.signal.aborted) return;
      state.suggestions = suggestions;
      state.activeIndex = -1;
      renderAddressSuggestions(input);
    } catch (error) {
      if (error?.name !== "AbortError") closeAddressSuggestions(input);
    }
  };

  input.addEventListener("focus", () => {
    if (state.hideTimer) {
      clearTimeout(state.hideTimer);
      state.hideTimer = null;
    }
    if (input.value.trim().length >= 2) {
      requestSuggestions();
      return;
    }
    if (state.suggestions.length) renderAddressSuggestions(input);
  });

  input.addEventListener("input", () => {
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(requestSuggestions, 220);
  });

  input.addEventListener("keydown", (event) => {
    if (!state.suggestions.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveSuggestionFocus(input, 1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveSuggestionFocus(input, -1);
      return;
    }
    if (event.key === "Enter" && state.activeIndex >= 0) {
      event.preventDefault();
      event.stopImmediatePropagation();
      void applyAddressSuggestion(input, state.suggestions[state.activeIndex]).catch((error) => {
        // eslint-disable-next-line no-alert
        alert(error.message || "无法确认该地点");
      });
      return;
    }
    if (event.key === "Escape") {
      closeAddressSuggestions(input);
    }
  });

  input.addEventListener("blur", () => {
    state.sessionToken = null;
    state.hideTimer = setTimeout(() => closeAddressSuggestions(input), 120);
  });
}

async function resolveStopFromInput(input) {
  const query = input.value.trim();
  if (!query) return null;

  const coordText = input.dataset.coord || "";
  const resolvedQuery = input.dataset.resolvedQuery || "";
  const cachedCoord = parseCoord(coordText);

  if (cachedCoord && resolvedQuery === query) {
    updateLegDistanceLabels();
    return {
      city: getCityFromQuery(query),
      country: sanitizeCountry(input.dataset.country || "-"),
      countryCode: input.dataset.countryCode || "",
      lon: cachedCoord.lon,
      lat: cachedCoord.lat
    };
  }

  const geocoded = await geocodeAddress(query);
  if (!geocoded) throw new Error(`找不到地址: ${query}`);

  input.dataset.coord = `${geocoded.lon},${geocoded.lat}`;
  input.dataset.country = geocoded.country;
  if (geocoded.countryCode) {
    input.dataset.countryCode = geocoded.countryCode;
  } else {
    delete input.dataset.countryCode;
  }
  input.dataset.resolvedQuery = query;
  updateLegDistanceLabels();
  return geocoded;
}

function bindRouteInput(input) {
  if (input.dataset.bound === "1") return;
  input.dataset.bound = "1";
  input.dataset.resolvedQuery = input.value.trim();
  if (input.dataset.coord && input.dataset.resolvedQuery) {
    persistCommittedRowState(input.closest(".timeline-row"));
  }
  bindAddressSearch(input);

  input.addEventListener("input", () => {
    if (input.value.trim() === input.dataset.resolvedQuery) return;
    delete input.dataset.coord;
    delete input.dataset.country;
    delete input.dataset.countryCode;
    updateRouteOverview();
    updateLegDistanceLabels();
    syncGenerateButtonState();
    syncRouteRowsUI();
  });

  input.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") return;
    const row = input.closest(".timeline-row");
    if (!row) return;
    event.preventDefault();
    try {
      await confirmRowInput(row);
    } catch (error) {
      // eslint-disable-next-line no-alert
      alert(error.message || "无法确认该地点");
    }
  });
}

function bindTimelineRowControls(row) {
  const displayCard = row.querySelector(".row-display-card");
  const confirmBtn = row.querySelector(".row-edit-confirm");
  const cancelBtn = row.querySelector(".row-edit-cancel");
  const editActionBtn = row.querySelector('.row-card-action[data-action="edit"]');
  const deleteActionBtn = row.querySelector('.row-card-action[data-action="delete"]');

  displayCard?.addEventListener("click", () => {
    if (!rowHasResolvedLocation(row)) {
      setRowEditing(row, true, { focus: true });
      return;
    }

    if (!focusPreviewOnRow(row)) {
      void refreshPreviewSceneFromRows({ focusRow: row });
    }
  });

  editActionBtn?.addEventListener("click", () => {
    setRowEditing(row, true, { focus: true });
  });

  deleteActionBtn?.addEventListener("click", () => {
    removeDestinationRow(row);
  });

  confirmBtn?.addEventListener("click", async () => {
    try {
      await confirmRowInput(row);
    } catch (error) {
      // eslint-disable-next-line no-alert
      alert(error.message || "无法确认该地点");
    }
  });

  cancelBtn?.addEventListener("click", () => {
    cancelRowEditing(row);
  });
}

function syncGenerateButtonState() {
  if (!generateBtn) return;
  const rowCount = getTimelineRows().length;
  const ready = rowCount >= 2;
  generateBtn.disabled = building || !ready;
  generateBtn.textContent = building ? "Generating..." : ready ? "Generate Route" : "Add one more stop";
}

function syncAddDestinationButtonState() {
  if (!(addDestBtn instanceof HTMLButtonElement)) return;
  const rows = getTimelineRows();
  const rowCount = rows.length;
  const hasPendingLocation = rows.some(
    (row) => row.dataset.editing === "true" || !rowHasResolvedLocation(row),
  );
  const canAddMore = rowCount < MAX_ROUTE_LOCATIONS && !hasPendingLocation;
  let hintText = "";

  if (hasPendingLocation) {
    hintText = "请先确认当前地点，再添加新的地点";
  } else if (rowCount >= MAX_ROUTE_LOCATIONS) {
    hintText = `最多添加 ${MAX_ROUTE_LOCATIONS} 个地点`;
  }

  addDestBtn.disabled = !canAddMore;
  addDestBtn.title = hintText;
  if (addDestHint) {
    addDestHint.textContent = hintText;
    addDestHint.hidden = !hintText;
  }
}

async function collectStops() {
  const rows = Array.from(routeTimeline?.querySelectorAll(".timeline-row") || []);
  const stops = [];

  if (rows.length > MAX_ROUTE_LOCATIONS) {
    throw new Error(`最多只能添加 ${MAX_ROUTE_LOCATIONS} 个地点`);
  }

  for (const row of rows) {
    const input = row.querySelector('input[type="text"]');
    if (!input) continue;
    bindRouteInput(input);
    const stop = await resolveStopFromInput(input);
    if (!stop) continue;
    stops.push(stop);
  }

  if (stops.length < 2) throw new Error("至少需要 2 个点位");
  updateLegDistanceLabels();
  return stops;
}

function showArrival(stop, km) {
  if (!arrivalCard || !arrivalCity || !arrivalCountry || !arrivalKm) return;
  arrivalCity.textContent = stop.city;
  arrivalCountry.textContent = stop.country || "-";
  arrivalKm.textContent = km ? `+${Math.round(km)} km` : "";
  arrivalCard.classList.add("show");
  updateArrivalCardPosition();
}

function hideArrival() {
  if (!arrivalCard) return;
  arrivalCard.classList.remove("show");
  arrivalCard.style.display = "none";
}

function updateArrivalCardPosition() {
  if (!arrivalCard) return;
  arrivalCard.style.display = "block";
  arrivalCard.style.left = "24px";
  arrivalCard.style.top = "24px";
}

function collectLegModes(legCount) {
  const modes = Array.from(routeTimeline?.querySelectorAll(".timeline-connector .mode-toggle") || []).map(
    (button) => (MODES.includes(button.dataset.mode) ? button.dataset.mode : "plane")
  );
  while (modes.length < legCount) modes.push("plane");
  return modes.slice(0, legCount);
}

function getTimelineRows() {
  return Array.from(routeTimeline?.querySelectorAll(".timeline-row") || []);
}

function readRowState(row) {
  const input = row.querySelector('input[type="text"]');
  if (!input) return null;

  return {
    committedCoord: input.dataset.committedCoord || "",
    committedCountry: input.dataset.committedCountry || "",
    committedCountryCode: input.dataset.committedCountryCode || "",
    committedResolvedQuery: input.dataset.committedResolvedQuery || "",
    committedValue: input.dataset.committedValue || "",
    value: input.value,
    coord: input.dataset.coord || "",
    country: input.dataset.country || "",
    countryCode: input.dataset.countryCode || "",
    resolvedQuery: input.dataset.resolvedQuery || input.value.trim(),
    editing: row.dataset.editing || "false",
  };
}

function writeRowState(row, state) {
  const input = row.querySelector('input[type="text"]');
  if (!input || !state) return;

  input.value = state.value;
  input.dataset.resolvedQuery = state.resolvedQuery || state.value.trim();

  if (state.coord) {
    input.dataset.coord = state.coord;
  } else {
    delete input.dataset.coord;
  }

  if (state.country) {
    input.dataset.country = state.country;
  } else {
    delete input.dataset.country;
  }

  if (state.countryCode) {
    input.dataset.countryCode = state.countryCode;
  } else {
    delete input.dataset.countryCode;
  }

  if (state.committedCoord) {
    input.dataset.committedCoord = state.committedCoord;
  } else {
    delete input.dataset.committedCoord;
  }

  if (state.committedCountry) {
    input.dataset.committedCountry = state.committedCountry;
  } else {
    delete input.dataset.committedCountry;
  }

  if (state.committedCountryCode) {
    input.dataset.committedCountryCode = state.committedCountryCode;
  } else {
    delete input.dataset.committedCountryCode;
  }

  if (state.committedResolvedQuery) {
    input.dataset.committedResolvedQuery = state.committedResolvedQuery;
  } else {
    delete input.dataset.committedResolvedQuery;
  }

  if (state.committedValue) {
    input.dataset.committedValue = state.committedValue;
  } else {
    delete input.dataset.committedValue;
  }

  row.dataset.editing = state.editing || "false";
}

function readResolvedStopFromRow(row) {
  const input = getRowInput(row);
  if (!input) return null;

  const coord = parseCoord(input.dataset.coord || "");
  const query = getResolvedRowValue(input);
  if (!coord || !query) return null;

  return {
    city: getCityFromQuery(query),
    country: sanitizeCountry(input.dataset.country || "-"),
    countryCode: input.dataset.countryCode || "",
    lat: coord.lat,
    lon: coord.lon,
  };
}

function collectResolvedStopsFromRows() {
  const stops = [];
  const rowToStopIndex = new Map();

  getTimelineRows().forEach((row) => {
    const stop = readResolvedStopFromRow(row);
    if (!stop) return;
    rowToStopIndex.set(row, stops.length);
    stops.push(stop);
  });

  return { rowToStopIndex, stops };
}

async function refreshPreviewSceneFromRows({
  focusRow = null,
  showRouteOverlay = false,
  invalidatePlaybackCache = true,
} = {}) {
  const { stops, rowToStopIndex } = collectResolvedStopsFromRows();
  if (!stops.length) return;
  if (focusRow) {
    setSelectedTimelineRow(focusRow);
  }

  const focusStopIndex = focusRow ? rowToStopIndex.get(focusRow) : null;
  const initialFocusIndex = typeof focusStopIndex === "number" ? Math.max(0, focusStopIndex - 1) : undefined;
  
  const legModes = collectLegModes(Math.max(0, stops.length - 1));
  const nextScene = await initScene(stops, legModes, {
    setBusyState: false,
    showRouteOverlay,
    focusStopIndex: initialFocusIndex,
    flyToStopIndex: focusStopIndex,
    invalidatePlaybackCache,
  });
  if (typeof focusStopIndex === "number" && !showRouteOverlay) {
    await new Promise((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(resolve);
      });
    });
    nextScene?.focusStop?.(focusStopIndex);
  }
}

function focusPreviewOnRow(row) {
  if (!scene || !row) return false;
  if (scene.showsRouteOverlay?.()) return false;

  const { rowToStopIndex } = collectResolvedStopsFromRows();
  const stopIndex = rowToStopIndex.get(row);
  if (typeof stopIndex !== "number") return false;

  setSelectedTimelineRow(row);
  scene.focusStop?.(stopIndex);
  return true;
}

function reorderRowsByIndex(fromIndex, toIndex) {
  const rows = getTimelineRows();
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
  if (fromIndex >= rows.length || toIndex >= rows.length) return;

  const states = rows.map(readRowState);
  const [moved] = states.splice(fromIndex, 1);
  if (!moved) return;
  states.splice(toIndex, 0, moved);

  rows.forEach((row, index) => writeRowState(row, states[index]));
  updateRouteOverview();
  updateLegDistanceLabels();
  syncRouteRowsUI();
  void refreshPreviewSceneFromRows();
}

function clearDropHints() {
  getTimelineRows().forEach((row) => {
    row.classList.remove("drop-before", "drop-after");
  });
}

function clearDragState() {
  clearDropHints();
  if (draggedRow) draggedRow.classList.remove("is-dragging-row");
  draggedRow = null;
  dropRow = null;
  dropPosition = "after";
}

function bindTimelineRowDrag(row) {
  row.draggable = true;
  row.classList.add("timeline-row-draggable");
  const order = row.querySelector(".row-order");
  if (!order) return;
  order.classList.add("pin-draggable");
  order.setAttribute("title", "Drag to reorder");
}

function initTimelineDragSort() {
  if (!routeTimeline) return;
  getTimelineRows().forEach(bindTimelineRowDrag);

  routeTimeline.addEventListener("dragstart", (event) => {
    if (event.target.closest("input, button, .mode-toggle")) {
      event.preventDefault();
      return;
    }
    const row = event.target.closest(".timeline-row-draggable");
    if (!row) return;

    draggedRow = row;
    row.classList.add("is-dragging-row");
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", "route-row");
    }
  });

  routeTimeline.addEventListener("dragover", (event) => {
    if (!draggedRow) return;
    const row = event.target.closest(".timeline-row");
    if (!row || row === draggedRow) return;

    event.preventDefault();
    const rect = row.getBoundingClientRect();
    const isBefore = event.clientY < rect.top + rect.height / 2;

    clearDropHints();
    row.classList.add(isBefore ? "drop-before" : "drop-after");
    dropRow = row;
    dropPosition = isBefore ? "before" : "after";
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  });

  routeTimeline.addEventListener("drop", (event) => {
    if (!draggedRow || !dropRow) return;
    event.preventDefault();

    const rows = getTimelineRows();
    const fromIndex = rows.indexOf(draggedRow);
    const dropIndex = rows.indexOf(dropRow);
    if (fromIndex < 0 || dropIndex < 0) {
      clearDragState();
      return;
    }

    let toIndex = dropIndex;
    if (dropPosition === "after") toIndex = dropIndex + 1;
    if (toIndex > fromIndex) toIndex -= 1;
    reorderRowsByIndex(fromIndex, toIndex);
    clearDragState();
  });

  routeTimeline.addEventListener("dragend", clearDragState);
}

function createWaypointRow(index) {
  return createTimelineRow("waypoint", `Waypoint ${index}`);
}

function createEndRow() {
  return createTimelineRow("end", "Destination");
}

function createTimelineConnector() {
  const connector = document.createElement("div");
  connector.className = "timeline-connector";
  connector.innerHTML = `
    <div class="connector-line" aria-hidden="true"></div>
    <button type="button" class="mode-toggle" data-mode="plane" aria-label="Transport mode: plane">
      <svg class="icon-plane" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />
      </svg>
      <svg class="icon-train" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="4" y="3" width="16" height="14" rx="2" />
        <path d="M4 11h16" />
        <path d="M8 17l-2 4" />
        <path d="M16 17l2 4" />
        <circle cx="9" cy="14" r="1" />
        <circle cx="15" cy="14" r="1" />
      </svg>
      <svg class="icon-car" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2" />
        <circle cx="7" cy="17" r="2" />
        <path d="M9 17h6" />
        <circle cx="17" cy="17" r="2" />
      </svg>
      <svg class="icon-ship" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1 .6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
        <path d="M19.38 20A11.6 11.6 0 0 0 21 14l-9-4-9 4c0 2.9.94 5.34 2.81 7.76" />
        <path d="M19 13V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6" />
        <path d="M12 10v-3" />
      </svg>
      <svg class="icon-bike" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="5.5" cy="17.5" r="3.5" />
        <circle cx="18.5" cy="17.5" r="3.5" />
        <path d="M8 17.5 11 11h4l2 6.5" />
        <path d="M10 11h-2.5" />
        <path d="M13 11 11 7h3" />
      </svg>
      <svg class="icon-walk" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="4" r="1.8" />
        <path d="M12 6.2l-2 3.6 2.6 1.5 1.7 3.6" />
        <path d="M10.5 14.8l-1.8 4.2" />
        <path d="M12.6 11.3l3-2.2" />
      </svg>
    </button>
    <div class="connector-line" aria-hidden="true"></div>
    <span class="leg-distance" hidden></span>
  `;
  const button = connector.querySelector(".mode-toggle");
  if (button) syncModeButton(button);
  return connector;
}

function syncDeleteButtons() {
  const rows = getTimelineRows();
  const canDelete = rows.length > 2;
  rows.forEach((row) => {
    row.classList.toggle("can-delete", canDelete);
  });
}

function removeDestinationRow(row) {
  if (!routeTimeline || !row) return;
  const rows = getTimelineRows();
  if (rows.length <= 2) return;

  if (selectedTimelineRow === row) {
    selectedTimelineRow = null;
  }

  const index = rows.indexOf(row);
  if (index < 0) return;

  // Remove the adjacent connector:
  // If not the first row, remove the connector BEFORE this row
  // If the first row, remove the connector AFTER this row
  const prevSibling = row.previousElementSibling;
  const nextSibling = row.nextElementSibling;

  if (prevSibling && prevSibling.classList.contains("timeline-connector")) {
    prevSibling.remove();
  } else if (nextSibling && nextSibling.classList.contains("timeline-connector")) {
    nextSibling.remove();
  }

  row.remove();

  const remainingRows = getTimelineRows();
  remainingRows.forEach((r, i) => {
    if (i === 0) {
      r.dataset.role = "start";
    } else if (i === remainingRows.length - 1) {
      r.dataset.role = "end";
    } else {
      r.dataset.role = "waypoint";
    }
  });

  syncDeleteButtons();
  updateRouteOverview();
  updateLegDistanceLabels();
  syncRouteRowsUI();
  syncGenerateButtonState();
  syncAddDestinationButtonState();
  void refreshPreviewSceneFromRows();
  requestAnimationFrame(updateSidebarOverflowState);
}

function addDestinationRow() {
  if (!routeTimeline) return;
  const rows = getTimelineRows();
  const hasPendingLocation = rows.some(
    (row) => row.dataset.editing === "true" || !rowHasResolvedLocation(row),
  );
  if (hasPendingLocation) {
    // eslint-disable-next-line no-alert
    alert("请先确认当前地点，再添加新的地点");
    syncAddDestinationButtonState();
    return;
  }
  if (rows.length >= MAX_ROUTE_LOCATIONS) {
    // eslint-disable-next-line no-alert
    alert(`最多只能添加 ${MAX_ROUTE_LOCATIONS} 个地点`);
    syncAddDestinationButtonState();
    return;
  }
  const endRow = routeTimeline.querySelector('.timeline-row[data-role="end"]');
  if (!endRow) {
    const connector = createTimelineConnector();
    const newEndRow = createEndRow();
    const insertBeforeNode = addDestBtn && addDestBtn.parentElement === routeTimeline ? addDestBtn : null;

    routeTimeline.insertBefore(connector, insertBeforeNode);
    routeTimeline.insertBefore(newEndRow, insertBeforeNode);

    const input = newEndRow.querySelector('input[type="text"]');
    bindTimelineRowDrag(newEndRow);
    if (input) {
      bindRouteInput(input);
      bindTimelineRowControls(newEndRow);
      setRowEditing(newEndRow, true, { focus: true });
    }
    syncDeleteButtons();
    updateRouteOverview();
    updateLegDistanceLabels();
    syncRouteRowsUI();
    syncGenerateButtonState();
    syncAddDestinationButtonState();
    requestAnimationFrame(updateSidebarOverflowState);
    return;
  }

  endRow.dataset.role = "waypoint";

  const connector = createTimelineConnector();
  const newEndRow = createEndRow();
  const insertBeforeNode = addDestBtn && addDestBtn.parentElement === routeTimeline ? addDestBtn : null;

  routeTimeline.insertBefore(connector, insertBeforeNode);
  routeTimeline.insertBefore(newEndRow, insertBeforeNode);

  const input = newEndRow.querySelector('input[type="text"]');
  bindTimelineRowDrag(newEndRow);
  if (input) {
    bindRouteInput(input);
    bindTimelineRowControls(newEndRow);
    setRowEditing(newEndRow, true, { focus: true });
  }
  syncDeleteButtons();
  updateRouteOverview();
  updateLegDistanceLabels();
  syncRouteRowsUI();
  syncGenerateButtonState();
  syncAddDestinationButtonState();
  requestAnimationFrame(updateSidebarOverflowState);
}

async function initScene(
  stops,
  legModes,
  {
    showRouteOverlay = true,
    setBusyState = true,
    focusStopIndex,
    flyToStopIndex,
    invalidatePlaybackCache = setBusyState,
  } = {},
) {
  const task = sceneInitQueue.catch(() => {}).then(async () => {
    if (setBusyState) {
      building = true;
      syncGenerateButtonState();
      syncExportButtonState();
    }

    try {
      if (!scene) {
        scene = await createRemotionJourneyScene(
          "globeContainer",
          stops,
          legModes,
          playbackRate,
          { showRouteOverlay, focusStopIndex, flyToStopIndex },
        );
      } else {
        scene.update?.(stops, legModes, { showRouteOverlay, focusStopIndex, flyToStopIndex });
      }

      scene.resetToStart?.();
      await scene.whenReady?.();

      if (invalidatePlaybackCache) {
        hideArrival();
        resetLatestPlayback();
      }

      return scene;
    } finally {
      if (setBusyState) {
        building = false;
        syncGenerateButtonState();
        syncExportButtonState();
      }
    }
  });

  sceneInitQueue = task.catch(() => {});
  return task;
}

function updateBasemapButtonUI() {
  if (!basemapBtn) return;
  basemapBtn.textContent = "REMOTION PREVIEW";
  basemapBtn.dataset.basemap = "preview";
  basemapBtn.disabled = true;
}

function cycleBasemap() {
  return;
}

async function run() {
  if (!scene || playing) return;
  await refreshPreviewSceneFromRows({ showRouteOverlay: true });
  await scene.whenReady?.();
  hideArrival();
  playing = true;
  syncExportButtonState();
  playBtn.disabled = true;
  playBtn.textContent = "Playing...";

  const canvas = scene.viewer?.canvas;
  const mimeType = getSupportedVideoMimeType();
  const canRecord = Boolean(canvas && typeof canvas.captureStream === "function" && mimeType);
  let recorder = null;
  let stopRecordingPromise = null;
  let recordingChunks = null;

  if (canRecord) {
    const stream = canvas.captureStream(60);
    recordingChunks = [];
    recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 8_000_000
    });
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) recordingChunks.push(event.data);
    };
    stopRecordingPromise = new Promise((resolve, reject) => {
      recorder.onerror = () => reject(new Error("自动录制失败"));
      recorder.onstop = () => resolve();
    });
    recorder.start(120);
  }

  try {
    await scene.play((payload) => {
      const stop = payload?.stop;
      if (!stop) return;
      showArrival(stop, payload.km);
    });
    hideArrival();

    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
      await stopRecordingPromise;
      storeLatestPlayback(new Blob(recordingChunks, { type: mimeType }), mimeType);
    }
  } catch (error) {
    if (recorder && recorder.state !== "inactive") recorder.stop();
    resetLatestPlayback();
    // eslint-disable-next-line no-alert
    alert(error.message || "播放失败，请重试。");
  } finally {
    playing = false;
    syncExportButtonState();
    playBtn.disabled = false;
    playBtn.innerHTML = PLAY_BUTTON_REPLAY_HTML;
    try {
      await refreshPreviewSceneFromRows({
        focusRow: selectedTimelineRow,
        showRouteOverlay: true,
      });
    } catch (error) {
      console.error("Failed to restore interactive preview after playback", error);
    }
  }
}

function getSupportedVideoMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm"
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function getVideoFileExtension(mimeType) {
  return mimeType.includes("mp4") ? "mp4" : "webm";
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function exportVideo() {
  if (!scene || playing || building) return;
  const mimeType = getSupportedVideoMimeType();
  if (!mimeType) {
    const url = scene.exportFrame();
    const a = document.createElement("a");
    a.href = url;
    a.download = `trailframe-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // eslint-disable-next-line no-alert
    alert("当前浏览器不支持视频导出，已导出 PNG 截图。");
    return;
  }

  if (!latestPlaybackBlob) {
    // eslint-disable-next-line no-alert
    alert("请先播放一次动画，再导出视频。");
    return;
  }

  if (getRemainingCredits() < EXPORT_CREDIT_COST) {
    // eslint-disable-next-line no-alert
    alert(`积分不足，导出一次需要 ${EXPORT_CREDIT_COST} 积分。`);
    return;
  }

  exportBtn.disabled = true;
  exportBtn.textContent = "Charging...";

  try {
    const creditResult = await consumeCredits(EXPORT_CREDIT_COST, "video_export");
    if (creditResult && typeof creditResult.credits === "number") {
      authState = {
        ...authState,
        credits: Math.max(0, creditResult.credits),
      };
      syncAccountUI();
    }

    exportBtn.textContent = "Exporting...";
    const usedType = latestPlaybackMimeType || mimeType;
    const ext = getVideoFileExtension(usedType);
    downloadBlob(latestPlaybackBlob, `trailframe-${Date.now()}.${ext}`);
    if (ext !== "mp4") {
      // eslint-disable-next-line no-alert
      alert("当前浏览器不支持直接导出 MP4，已导出 WebM。");
    }
  } catch (error) {
    // eslint-disable-next-line no-alert
    alert(getExportErrorMessage(error));
  } finally {
    syncExportButtonState();
  }
}

function bindWorkspaceEvents() {
  if (workspaceBound) return;
  workspaceBound = true;

  if (motionDebugEnabled) {
    ensureMotionDebugPanel();
    window.addEventListener("travel-motion-debug", handleMotionDebugEvent);
  }

  generateBtn.addEventListener("click", async () => {
    try {
      const stops = await collectStops();
      const legModes = collectLegModes(stops.length - 1);
      await initScene(stops, legModes);
      await run();
    } catch (error) {
      building = false;
      syncGenerateButtonState();
      // eslint-disable-next-line no-alert
      alert(error.message);
    }
  });

  playBtn.addEventListener("click", run);

  exportBtn.addEventListener("click", exportVideo);
  basemapBtn?.addEventListener("click", cycleBasemap);

  speedBtn?.addEventListener("click", () => {
    if (!speedMenu) return;
    const nextExpanded = speedBtn.getAttribute("aria-expanded") !== "true";
    speedBtn.setAttribute("aria-expanded", nextExpanded ? "true" : "false");
    speedMenu.hidden = !nextExpanded;
  });

  speedMenu?.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest(".speed-option");
    if (!(button instanceof HTMLButtonElement)) return;
    setPlaybackRate(Number(button.dataset.rate));
  });

  accountMenuButton?.addEventListener("click", () => {
    const nextExpanded = accountMenuButton.getAttribute("aria-expanded") !== "true";
    setAccountMenuOpen(nextExpanded);
  });

  accountMenu?.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest(".account-item")) return;
    if (target.closest("#accountSignOutBtn")) {
      signOut()
        .catch((error) => {
          console.error(error);
        })
        .finally(() => {
          redirectToLandingAuth();
        });
      return;
    }
    closeAccountMenu();
  });

  document.addEventListener("click", (event) => {
    if (!speedMenu || !speedBtn) return;
    if (speedMenu.hidden) return;
    const target = event.target instanceof Node ? event.target : null;
    if (target && (speedMenu.contains(target) || speedBtn.contains(target))) return;
    closeSpeedMenu();
  });

  document.addEventListener("click", (event) => {
    if (!accountMenu || !accountMenuButton) return;
    if (accountMenu.hidden) return;
    const target = event.target instanceof Node ? event.target : null;
    if (target && ((accountMenuRoot && accountMenuRoot.contains(target)) || accountMenuButton.contains(target))) return;
    closeAccountMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeSpeedMenu();
      closeAccountMenu();
    }
  });

  addDestBtn?.addEventListener("click", addDestinationRow);

  document.querySelectorAll('#routeTimeline .timeline-row input[type="text"]').forEach(bindRouteInput);
  document.querySelectorAll('#routeTimeline .timeline-row').forEach((row) => {
    bindTimelineRowControls(row);
  });
  syncDeleteButtons();
  initTimelineDragSort();
  initSidebarOverflowState();
  syncAccountUI();
  syncRouteRowsUI();

  window.addEventListener("beforeunload", () => {
    scene?.destroy();
    if (profileChannel) supabase?.removeChannel(profileChannel);
    if (motionDebugEnabled) {
      window.removeEventListener("travel-motion-debug", handleMotionDebugEvent);
    }
  });
  initModeToggles();
  enableInitialLegDistances();
  updateBasemapButtonUI();
  updateSpeedControlUI();
  updateRouteOverview();
  syncGenerateButtonState();
  syncAddDestinationButtonState();
  syncExportButtonState();

  initScene(
    [
      { city: "北京", country: "中国", lon: 116.4074, lat: 39.9042 },
    ],
    []
  );
}

async function bootstrapWorkspace() {
  try {
    const ready = await initializeAuthState();
    if (!ready) return;
    bindWorkspaceEvents();
    syncAccountUI();
  } catch (error) {
    console.error(error);
    // eslint-disable-next-line no-alert
    alert(error.message || "账号初始化失败，请重新登录。");
    redirectToLandingAuth();
  }
}

bootstrapWorkspace();
