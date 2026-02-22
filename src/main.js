import * as Cesium from "cesium";
import "./styles.css";
import { createGlobeScene } from "./globeScene";

const playBtn = document.getElementById("playBtn");
const pauseBtn = document.getElementById("pauseBtn");
const exportBtn = document.getElementById("exportBtn");
const generateBtn = document.getElementById("generateBtn");
const arrivalCard = document.getElementById("arrivalCard");
const arrivalCity = document.getElementById("arrivalCity");
const arrivalCountry = document.getElementById("arrivalCountry");
const arrivalKm = document.getElementById("arrivalKm");
const globeContainer = document.getElementById("globeContainer");
const modeToggles = document.querySelectorAll(".mode-toggle[data-select]");

let scene = null;
let playing = false;
let paused = false;
let building = false;
let arrivalTarget = null;
let detachArrivalTracker = null;

const MODES = ["car", "plane", "ship"];

function initModeToggles() {
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

function collectStops() {
  const rows = [
    ["startName", "startCountry", "startCoord"],
    ["via1Name", "via1Country", "via1Coord"],
    ["via2Name", "via2Country", "via2Coord"],
    ["endName", "endCountry", "endCoord"]
  ];

  const stops = [];
  for (const [nameId, countryId, coordId] of rows) {
    const name = document.getElementById(nameId).value.trim();
    const country = document.getElementById(countryId).value.trim();
    const coordText = document.getElementById(coordId).value.trim();
    if (!name || !coordText) continue;

    const coord = parseCoord(coordText);
    if (!coord) throw new Error(`坐标格式错误: ${name} (${coordText})，请用 经度,纬度`);

    stops.push({ city: name, country: country || "-", lon: coord.lon, lat: coord.lat });
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
  const modes = [];
  for (let i = 0; i < legCount; i += 1) {
    const el = document.getElementById(`legMode${i + 1}`);
    modes.push(el ? el.value : "plane");
  }
  return modes;
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

generateBtn.addEventListener("click", async () => {
  try {
    const stops = collectStops();
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

exportBtn.addEventListener("click", () => {
  if (!scene) return;
  const url = scene.exportFrame();
  const a = document.createElement("a");
  a.href = url;
  a.download = `trailframe-${Date.now()}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
});

window.addEventListener("beforeunload", () => scene?.destroy());
window.addEventListener("beforeunload", () => detachArrivalTracker?.());
initModeToggles();

initScene(
  [
    { city: "NEW YORK", country: "UNITED STATES", lon: -74.006, lat: 40.7128 },
    { city: "KIZIMKAZI", country: "TANZANIA", lon: 39.512, lat: -6.452 }
  ],
  ["plane"]
);
