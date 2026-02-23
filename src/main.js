import * as Cesium from "cesium";
import "./styles.css";
import { createGlobeScene } from "./globeScene";

const playBtn = document.getElementById("playBtn");
const pauseBtn = document.getElementById("pauseBtn");
const exportBtn = document.getElementById("exportBtn");
const generateBtn = document.getElementById("generateBtn");
const addDestBtn = document.getElementById("addDestBtn");
const sidebarActions = document.getElementById("sidebarActions");
const arrivalCard = document.getElementById("arrivalCard");
const arrivalCity = document.getElementById("arrivalCity");
const arrivalCountry = document.getElementById("arrivalCountry");
const arrivalKm = document.getElementById("arrivalKm");
const globeContainer = document.getElementById("globeContainer");
const routeTimeline = document.getElementById("routeTimeline");
const sidebarCard = document.querySelector(".sidebar-card");
const modeToggles = document.querySelectorAll(".mode-toggle[data-select]");

let scene = null;
let playing = false;
let paused = false;
let building = false;
let arrivalTarget = null;
let detachArrivalTracker = null;

const MODES = ["car", "train", "bike", "plane", "ship"];
const geocodeCache = new Map();
const suggestionCache = new Map();
const inputSearchState = new WeakMap();
let draggedRow = null;
let dropRow = null;
let dropPosition = "after";

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
    document.fonts.ready.then(onChange).catch(() => {});
  }

  requestAnimationFrame(onChange);
}

function syncModeButton(btn) {
  const mode = MODES.includes(btn.dataset.mode) ? btn.dataset.mode : "car";
  btn.dataset.mode = mode;
  btn.setAttribute("aria-label", `Transport mode: ${mode}`);
}

function initModeToggles() {
  document.querySelectorAll(".mode-toggle").forEach(syncModeButton);

  if (routeTimeline) {
    routeTimeline.addEventListener("click", (event) => {
      const btn = event.target.closest(".mode-toggle");
      if (!btn) return;
      const current = btn.dataset.mode;
      const idx = MODES.indexOf(current);
      const next = MODES[(idx + 1) % MODES.length];
      btn.dataset.mode = next;
      btn.setAttribute("aria-label", `Transport mode: ${next}`);
    });
  }

  modeToggles.forEach((btn) => {
    const selectId = btn.dataset.select;
    const selectEl = selectId ? document.getElementById(selectId) : null;
    if (!selectEl) return;

    // Sync initial state
    const initial = selectEl.value || "car";
    btn.dataset.mode = initial;
    btn.setAttribute("aria-label", `Transport mode: ${initial}`);

    btn.addEventListener("click", () => {
      const current = btn.dataset.mode;
      const idx = MODES.indexOf(current);
      const next = MODES[(idx + 1) % MODES.length];
      btn.dataset.mode = next;
      btn.setAttribute("aria-label", `Transport mode: ${next}`);
      selectEl.value = next;
    });
  });
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
  state = { timer: null, controller: null, suggestions: [], activeIndex: -1, hideTimer: null };
  inputSearchState.set(input, state);
  return state;
}

function sanitizeCountry(value) {
  return value ? value.toUpperCase() : "-";
}

function getCityFromQuery(query) {
  const head = query.split(",")[0]?.trim();
  return head || query;
}

function getGeocoderCity(result, query) {
  const address = result.address || {};
  return (
    address.city ||
    address.town ||
    address.village ||
    address.municipality ||
    address.county ||
    address.state ||
    getCityFromQuery(query)
  );
}

function getGeocoderCountry(result) {
  const country = result.address?.country || result.display_name?.split(",").at(-1)?.trim() || "-";
  return sanitizeCountry(country);
}

async function geocodeAddress(query) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return null;
  if (geocodeCache.has(normalized)) return geocodeCache.get(normalized);

  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&q=${encodeURIComponent(query)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error("地址服务暂时不可用，请稍后重试");

  const payload = await response.json();
  if (!Array.isArray(payload) || payload.length === 0) return null;

  const first = payload[0];
  const lon = Number(first.lon);
  const lat = Number(first.lat);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;

  const geocoded = {
    lon,
    lat,
    city: getGeocoderCity(first, query),
    country: getGeocoderCountry(first)
  };
  geocodeCache.set(normalized, geocoded);
  return geocoded;
}

function mapSuggestion(item, fallbackQuery = "") {
  const lon = Number(item.lon);
  const lat = Number(item.lat);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;

  const city = getGeocoderCity(item, fallbackQuery || item.display_name || "");
  const country = getGeocoderCountry(item);
  const label = [city, country === "-" ? "" : country].filter(Boolean).join(", ") || item.display_name || fallbackQuery;

  return { label, city, country, lon, lat };
}

async function fetchAddressSuggestions(query, signal) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  if (suggestionCache.has(normalized)) return suggestionCache.get(normalized);

  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&q=${encodeURIComponent(query)}`;
  const response = await fetch(url, { signal });
  if (!response.ok) return [];
  const payload = await response.json();
  if (!Array.isArray(payload)) return [];

  const suggestions = payload.map((item) => mapSuggestion(item, query)).filter(Boolean);
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

function applyAddressSuggestion(input, suggestion) {
  input.value = suggestion.label;
  input.dataset.coord = `${suggestion.lon},${suggestion.lat}`;
  input.dataset.country = suggestion.country;
  input.dataset.resolvedQuery = suggestion.label;
  closeAddressSuggestions(input);
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
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      applyAddressSuggestion(input, suggestion);
    });
    list.appendChild(button);
  });
  list.classList.add("show");
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
      closeAddressSuggestions(input);
      return;
    }

    state.controller?.abort();
    const controller = new AbortController();
    state.controller = controller;

    try {
      const suggestions = await fetchAddressSuggestions(query, controller.signal);
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
      applyAddressSuggestion(input, state.suggestions[state.activeIndex]);
      return;
    }
    if (event.key === "Escape") {
      closeAddressSuggestions(input);
    }
  });

  input.addEventListener("blur", () => {
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
    return {
      city: getCityFromQuery(query),
      country: sanitizeCountry(input.dataset.country || "-"),
      lon: cachedCoord.lon,
      lat: cachedCoord.lat
    };
  }

  const geocoded = await geocodeAddress(query);
  if (!geocoded) throw new Error(`找不到地址: ${query}`);

  input.dataset.coord = `${geocoded.lon},${geocoded.lat}`;
  input.dataset.country = geocoded.country;
  input.dataset.resolvedQuery = query;
  return geocoded;
}

function bindRouteInput(input) {
  if (input.dataset.bound === "1") return;
  input.dataset.bound = "1";
  input.dataset.resolvedQuery = input.value.trim();
  bindAddressSearch(input);

  input.addEventListener("input", () => {
    if (input.value.trim() === input.dataset.resolvedQuery) return;
    delete input.dataset.coord;
    delete input.dataset.country;
  });
}

async function collectStops() {
  const rows = Array.from(routeTimeline?.querySelectorAll(".timeline-row") || []);
  const stops = [];

  for (const row of rows) {
    const input = row.querySelector('input[type="text"]');
    if (!input) continue;
    bindRouteInput(input);
    const stop = await resolveStopFromInput(input);
    if (!stop) continue;
    stops.push(stop);
  }

  if (stops.length < 2) throw new Error("至少需要 2 个点位");
  return stops;
}

function showArrival(stop, km) {
  if (!arrivalCard || !arrivalCity || !arrivalCountry || !arrivalKm) return;
  arrivalCity.textContent = stop.city;
  arrivalCountry.textContent = stop.country || "-";
  arrivalKm.textContent = km ? `+${Math.round(km)} km` : "";
  arrivalTarget = Number.isFinite(stop.lon) && Number.isFinite(stop.lat) ? { lon: stop.lon, lat: stop.lat } : null;
  arrivalCard.classList.add("show");
  updateArrivalCardPosition();
}

function hideArrival() {
  if (!arrivalCard) return;
  arrivalCard.classList.remove("show");
  arrivalCard.style.display = "none";
  arrivalTarget = null;
}

function updateArrivalCardPosition() {
  if (!scene || !arrivalCard || !globeContainer || !arrivalTarget) return;
  const viewer = scene.viewer;
  if (!viewer) return;

  const target = Cesium.Cartesian3.fromDegrees(arrivalTarget.lon, arrivalTarget.lat, 12000);
  const win = viewer.scene.cartesianToCanvasCoordinates(target);
  if (!win || !Number.isFinite(win.x) || !Number.isFinite(win.y)) {
    arrivalCard.style.display = "none";
    return;
  }

  const rect = globeContainer.getBoundingClientRect();
  const x = Math.max(16, Math.min(win.x, rect.width - 16));
  const y = Math.max(16, Math.min(win.y, rect.height - 16));

  arrivalCard.style.display = "block";
  arrivalCard.style.left = `${x}px`;
  arrivalCard.style.top = `${y}px`;
}

function collectLegModes(legCount) {
  const modes = Array.from(routeTimeline?.querySelectorAll(".timeline-connector .mode-toggle") || []).map(
    (button) => (MODES.includes(button.dataset.mode) ? button.dataset.mode : "car")
  );
  while (modes.length < legCount) modes.push("car");
  return modes.slice(0, legCount);
}

function getTimelineRows() {
  return Array.from(routeTimeline?.querySelectorAll(".timeline-row") || []);
}

function readRowState(row) {
  const input = row.querySelector('input[type="text"]');
  if (!input) return null;

  return {
    value: input.value,
    coord: input.dataset.coord || "",
    country: input.dataset.country || "",
    resolvedQuery: input.dataset.resolvedQuery || input.value.trim()
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
  const pin = row.querySelector(".pin");
  if (!pin) return;
  pin.classList.add("pin-draggable");
  pin.setAttribute("title", "Drag to reorder");
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
  const row = document.createElement("div");
  row.className = "timeline-row";
  row.dataset.role = "waypoint";
  row.innerHTML = `
    <span class="pin" aria-hidden="true"></span>
    <div class="row-input-wrap">
      <input type="text" placeholder="Waypoint ${index}" />
    </div>
  `;
  return row;
}

function createEndRow() {
  const row = document.createElement("div");
  row.className = "timeline-row";
  row.dataset.role = "end";
  row.innerHTML = `
    <span class="pin end-pin" aria-hidden="true"></span>
    <div class="row-input-wrap">
      <input type="text" placeholder="Destination" />
    </div>
  `;
  return row;
}

function createTimelineConnector() {
  const connector = document.createElement("div");
  connector.className = "timeline-connector";
  connector.innerHTML = `
    <div class="connector-line" aria-hidden="true"></div>
    <button type="button" class="mode-toggle" data-mode="car" aria-label="Transport mode: car">
      <svg class="icon-car" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2" />
        <circle cx="7" cy="17" r="2" />
        <path d="M9 17h6" />
        <circle cx="17" cy="17" r="2" />
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
      <svg class="icon-bike" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="5.5" cy="17.5" r="3.5" />
        <circle cx="18.5" cy="17.5" r="3.5" />
        <path d="M8 17.5 11 11h4l2 6.5" />
        <path d="M10 11h-2.5" />
        <path d="M13 11 11 7h3" />
      </svg>
      <svg class="icon-plane" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />
      </svg>
      <svg class="icon-ship" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1 .6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
        <path d="M19.38 20A11.6 11.6 0 0 0 21 14l-9-4-9 4c0 2.9.94 5.34 2.81 7.76" />
        <path d="M19 13V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6" />
        <path d="M12 10v-3" />
      </svg>
    </button>
    <div class="connector-line" aria-hidden="true"></div>
  `;
  const button = connector.querySelector(".mode-toggle");
  if (button) syncModeButton(button);
  return connector;
}

function addDestinationRow() {
  if (!routeTimeline) return;
  const endRow = routeTimeline.querySelector('.timeline-row[data-role="end"]');
  if (!endRow) return;

  endRow.dataset.role = "waypoint";
  const endPin = endRow.querySelector(".pin");
  if (endPin) endPin.classList.remove("end-pin");

  const connector = createTimelineConnector();
  const newEndRow = createEndRow();

  routeTimeline.appendChild(connector);
  routeTimeline.appendChild(newEndRow);

  const input = newEndRow.querySelector('input[type="text"]');
  bindTimelineRowDrag(newEndRow);
  if (input) {
    bindRouteInput(input);
    input.focus();
  }
  requestAnimationFrame(updateSidebarOverflowState);
}

async function initScene(stops, legModes) {
  if (building) return;
  building = true;
  generateBtn.disabled = true;
  generateBtn.textContent = "Generating...";
  if (detachArrivalTracker) {
    detachArrivalTracker();
    detachArrivalTracker = null;
  }
  if (scene) scene.destroy();
  scene = await createGlobeScene("globeContainer", stops, legModes);
  const viewerRef = scene.viewer;
  const onPostRender = () => updateArrivalCardPosition();
  viewerRef.scene.postRender.addEventListener(onPostRender);
  detachArrivalTracker = () => {
    viewerRef.scene.postRender.removeEventListener(onPostRender);
  };

  hideArrival();
  building = false;
  generateBtn.disabled = false;
  generateBtn.textContent = "Generate Route";
  paused = false;
  pauseBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Pause';
}

async function run() {
  if (!scene || playing) return;
  hideArrival();
  playing = true;
  playBtn.disabled = true;
  playBtn.textContent = "Playing…";

  try {
    await scene.play((payload) => {
      const stop = payload?.stop;
      if (!stop) return;
      showArrival(stop, payload.km);
    });
  } finally {
    playing = false;
    paused = false;
    pauseBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Pause';
    playBtn.disabled = false;
    playBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg> Replay';
  }
}

function getSupportedVideoMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
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
  const canvas = scene.viewer?.canvas;
  const mimeType = getSupportedVideoMimeType();

  if (!canvas || typeof canvas.captureStream !== "function" || !mimeType) {
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

  exportBtn.disabled = true;
  exportBtn.textContent = "Exporting…";
  playBtn.disabled = true;
  pauseBtn.disabled = true;

  const stream = canvas.captureStream(60);
  const chunks = [];
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 8_000_000
  });

  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) chunks.push(event.data);
  };

  const done = new Promise((resolve, reject) => {
    recorder.onerror = () => reject(new Error("视频导出失败"));
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType });
      resolve(blob);
    };
  });

  hideArrival();
  playing = true;
  paused = false;
  playBtn.textContent = "Playing…";
  pauseBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Pause';

  try {
    recorder.start(120);
    await scene.play((payload) => {
      const stop = payload?.stop;
      if (!stop) return;
      showArrival(stop, payload.km);
    });
    await new Promise((resolve) => setTimeout(resolve, 120));
    recorder.stop();

    const blob = await done;
    downloadBlob(blob, `trailframe-${Date.now()}.webm`);
  } catch (error) {
    if (recorder.state !== "inactive") recorder.stop();
    // eslint-disable-next-line no-alert
    alert(error.message || "视频导出失败，请重试。");
  } finally {
    playing = false;
    paused = false;
    exportBtn.disabled = false;
    pauseBtn.disabled = false;
    playBtn.disabled = false;
    exportBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Export';
    playBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg> Replay';
    pauseBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Pause';
  }
}

generateBtn.addEventListener("click", async () => {
  try {
    const stops = await collectStops();
    const legModes = collectLegModes(stops.length - 1);
    await initScene(stops, legModes);
    playBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="6 3 20 12 6 21 6 3"/></svg> Play';
  } catch (error) {
    building = false;
    generateBtn.disabled = false;
    generateBtn.textContent = "Generate Route";
    // eslint-disable-next-line no-alert
    alert(error.message);
  }
});

playBtn.addEventListener("click", run);

pauseBtn.addEventListener("click", () => {
  if (!scene || !playing) return;
  if (!paused) {
    scene.pause();
    paused = true;
    pauseBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="6 3 20 12 6 21 6 3"/></svg> Resume';
  } else {
    scene.resume();
    paused = false;
    pauseBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Pause';
  }
});

exportBtn.addEventListener("click", exportVideo);

addDestBtn?.addEventListener("click", addDestinationRow);

document.querySelectorAll('#routeTimeline .timeline-row input[type="text"]').forEach(bindRouteInput);
initTimelineDragSort();
initSidebarOverflowState();

window.addEventListener("beforeunload", () => scene?.destroy());
window.addEventListener("beforeunload", () => detachArrivalTracker?.());
initModeToggles();

initScene(
  [
    { city: "NEW YORK", country: "UNITED STATES", lon: -74.006, lat: 40.7128 },
    { city: "KIZIMKAZI", country: "TANZANIA", lon: 39.512, lat: -6.452 }
  ],
  ["car"]
);
