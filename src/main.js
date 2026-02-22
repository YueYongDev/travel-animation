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

let scene = null;
let playing = false;
let paused = false;
let building = false;
let arrivalTarget = null;
let detachArrivalTracker = null;

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
  generateBtn.textContent = "生成中...";
  if (scene) scene.destroy();
  if (detachArrivalTracker) {
    detachArrivalTracker();
    detachArrivalTracker = null;
  }
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
  generateBtn.textContent = "生成路线";
  paused = false;
  pauseBtn.textContent = "暂停";
}

async function run() {
  if (!scene || playing) return;
  hideArrival();
  playing = true;
  playBtn.disabled = true;
  playBtn.textContent = "播放中...";

  try {
    await scene.play((payload) => {
      const stop = payload?.stop;
      if (!stop) return;
      showArrival(stop, payload.km);
    });
  } finally {
    playing = false;
    paused = false;
    pauseBtn.textContent = "暂停";
    playBtn.disabled = false;
    playBtn.textContent = "重新播放";
  }
}

generateBtn.addEventListener("click", async () => {
  try {
    const stops = collectStops();
    const legModes = collectLegModes(stops.length - 1);
    await initScene(stops, legModes);
    playBtn.textContent = "播放";
  } catch (error) {
    building = false;
    generateBtn.disabled = false;
    generateBtn.textContent = "生成路线";
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
    pauseBtn.textContent = "继续";
  } else {
    scene.resume();
    paused = false;
    pauseBtn.textContent = "暂停";
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

initScene(
  [
    { city: "NOVA YORK", country: "UNITED STATES", lon: -74.006, lat: 40.7128 },
    { city: "KIZIMKAZI", country: "TANZANIA", lon: 39.512, lat: -6.452 },
    { city: "TOKYO", country: "JAPAN", lon: 139.6917, lat: 35.6895 },
    { city: "SINGAPORE", country: "SINGAPORE", lon: 103.8198, lat: 1.3521 }
  ],
  ["car", "plane", "plane"]
);
