import * as Cesium from "cesium";
import gsap from "gsap";

const ROUTE_BASE_HEIGHT = 12000;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toCartesianFromDeg(lon, lat, h = 0) {
  return Cesium.Cartesian3.fromDegrees(lon, lat, h);
}

function makeVehicleIcon(type = "plane") {
  const emojis = {
    car: "🚗",
    train: "🚆",
    bike: "🚲",
    plane: "✈️",
    ship: "🚢",
    walk: "🚶"
  };
  const emoji = emojis[type] || emojis.plane;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='84' height='84' viewBox='0 0 84 84'>
    <circle cx='42' cy='42' r='28' fill='#ffffff' fill-opacity='0.94' stroke='#d7dbe2' stroke-width='1.25'/>
    <text x='42' y='42' text-anchor='middle' dominant-baseline='central' font-size='28'>${emoji}</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function geodesicKm(from, to) {
  const start = Cesium.Cartographic.fromDegrees(from.lon, from.lat, 0);
  const end = Cesium.Cartographic.fromDegrees(to.lon, to.lat, 0);
  return new Cesium.EllipsoidGeodesic(start, end).surfaceDistance / 1000;
}

function buildPlanePath(from, to, steps = 150) {
  const start = Cesium.Cartographic.fromDegrees(from.lon, from.lat, 0);
  const end = Cesium.Cartographic.fromDegrees(to.lon, to.lat, 0);
  const geodesic = new Cesium.EllipsoidGeodesic(start, end);
  const distanceKm = geodesic.surfaceDistance / 1000;
  const arcHeight = Cesium.Math.clamp(distanceKm * 45, 14000, 120000);
  const points = [];

  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const p = geodesic.interpolateUsingFraction(t);
    p.height = ROUTE_BASE_HEIGHT + arcHeight * Math.sin(Math.PI * t);
    points.push(Cesium.Cartesian3.fromRadians(p.longitude, p.latitude, p.height));
  }

  return points;
}

function buildRoadPathFromCoords(coords) {
  return coords.map(([lon, lat]) => toCartesianFromDeg(lon, lat, ROUTE_BASE_HEIGHT));
}

async function fetchRoadRoute(from, to) {
  const url = `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OSRM ${res.status}`);
  const data = await res.json();
  const route = data?.routes?.[0];
  if (!route?.geometry?.coordinates?.length) throw new Error("OSRM route empty");
  return {
    coords: route.geometry.coordinates,
    km: route.distance / 1000
  };
}

function lerpPosition(points, t) {
  const i = Math.floor(t);
  const frac = t - i;
  const a = points[Math.min(i, points.length - 1)];
  const b = points[Math.min(i + 1, points.length - 1)];
  return Cesium.Cartesian3.lerp(a, b, frac, new Cesium.Cartesian3());
}

function midpoint(points) {
  return points[Math.floor(points.length / 2)];
}

function getHeading(from, to) {
  const a = Cesium.Cartographic.fromCartesian(from);
  const b = Cesium.Cartographic.fromCartesian(to);
  const dLon = b.longitude - a.longitude;
  const y = Math.sin(dLon) * Math.cos(b.latitude);
  const x =
    Math.cos(a.latitude) * Math.sin(b.latitude) -
    Math.sin(a.latitude) * Math.cos(b.latitude) * Math.cos(dLon);
  return Math.atan2(y, x);
}

function calcRouteSpanKm(stops) {
  if (!stops.length) return 0;
  let minLon = stops[0].lon;
  let maxLon = stops[0].lon;
  let minLat = stops[0].lat;
  let maxLat = stops[0].lat;

  stops.forEach((s) => {
    minLon = Math.min(minLon, s.lon);
    maxLon = Math.max(maxLon, s.lon);
    minLat = Math.min(minLat, s.lat);
    maxLat = Math.max(maxLat, s.lat);
  });

  return geodesicKm({ lon: minLon, lat: minLat }, { lon: maxLon, lat: maxLat });
}

function getCameraRangeBySpanKm(spanKm) {
  const raw = spanKm * 620;
  return Cesium.Math.clamp(raw || 300000, 170000, 4800000);
}

function getCameraRangeBySegmentKm(segmentKm) {
  const raw = segmentKm * 520;
  return Cesium.Math.clamp(raw || 240000, 140000, 2400000);
}

const BASEMAP_CONFIG = {
  satellite: {
    label: "Satellite",
    url: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    maximumLevel: 7,
    brightness: 1.02,
    contrast: 0.92,
    saturation: 0.68
  },
  light: {
    label: "Light",
    url: "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    maximumLevel: 6,
    brightness: 1.03,
    contrast: 0.95,
    saturation: 0.15
  },
  dark: {
    label: "Dark",
    url: "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    maximumLevel: 6,
    brightness: 0.88,
    contrast: 1.05,
    saturation: 0.2
  },
  terrain: {
    label: "Terrain",
    url: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    maximumLevel: 7,
    brightness: 1,
    contrast: 0.98,
    saturation: 0.72
  }
};

function createBaseLayer(basemapKey = "satellite") {
  const key = Object.hasOwn(BASEMAP_CONFIG, basemapKey) ? basemapKey : "satellite";
  const config = BASEMAP_CONFIG[key];
  const layer = new Cesium.ImageryLayer(
    new Cesium.UrlTemplateImageryProvider({
      url: config.url,
      maximumLevel: config.maximumLevel
    })
  );
  layer.brightness = config.brightness;
  layer.contrast = config.contrast;
  layer.saturation = config.saturation;
  return { layer, key };
}

async function buildSegments(stops, legModes) {
  const segments = [];

  for (let i = 0; i < stops.length - 1; i += 1) {
    const from = stops[i];
    const to = stops[i + 1];
    const mode = legModes[i] || "plane";

    if (mode === "plane") {
      segments.push({
        mode,
        points: buildPlanePath(from, to, 160),
        km: geodesicKm(from, to)
      });
      continue;
    }

    try {
      const road = await fetchRoadRoute(from, to);
      segments.push({
        mode,
        points: buildRoadPathFromCoords(road.coords),
        km: road.km
      });
      continue;
    } catch {
      if (mode === "ship") {
        segments.push({
          mode,
          points: buildPlanePath(from, to, 130).map((point) => {
            const c = Cesium.Cartographic.fromCartesian(point);
            return Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, ROUTE_BASE_HEIGHT);
          }),
          km: geodesicKm(from, to)
        });
        continue;
      }

      segments.push({
        mode,
        points: buildPlanePath(from, to, mode === "plane" ? 160 : 120),
        km: geodesicKm(from, to)
      });
    }
  }

  return segments;
}

function flattenSegments(segments) {
  const ranges = [];
  const full = [];
  let cursor = 0;

  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i].points;
    if (i === 0) {
      full.push(...seg);
      ranges.push({ start: 0, end: seg.length - 1 });
      cursor = seg.length - 1;
    } else {
      full.push(...seg.slice(1));
      ranges.push({ start: cursor, end: cursor + seg.length - 1 });
      cursor += seg.length - 1;
    }
  }

  return { full, ranges };
}

export async function createGlobeScene(containerId, stops, legModes = [], options = {}) {
  const initialBasemapKey = options.basemap || "satellite";
  let { layer: baseLayer, key: currentBasemap } = createBaseLayer(initialBasemapKey);

  const viewer = new Cesium.Viewer(containerId, {
    baseLayer,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    baseLayerPicker: false,
    navigationHelpButton: false,
    animation: false,
    timeline: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    shouldAnimate: true,
    terrainProvider: new Cesium.EllipsoidTerrainProvider(),
    msaaSamples: 4
  });

  viewer.resolutionScale = 1;
  viewer.scene.fxaa = true;
  viewer.scene.postProcessStages.fxaa.enabled = true;
  viewer.scene.globe.enableLighting = true;
  viewer.scene.globe.maximumScreenSpaceError = 6;
  viewer.scene.globe.preloadAncestors = true;
  viewer.scene.globe.preloadSiblings = true;
  viewer.scene.globe.loadingDescendantLimit = 0;
  viewer.scene.globe.tileCacheSize = 500;
  viewer.scene.backgroundColor = Cesium.Color.fromCssColorString("#f5f4f2");
  viewer.scene.skyBox.show = false;
  viewer.scene.globe.showGroundAtmosphere = false;
  viewer.scene.sun.show = false;
  viewer.scene.moon.show = false;
  if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = false;

  const segments = await buildSegments(stops, legModes);
  const { full, ranges } = flattenSegments(segments);
  const activePositions = [full[0]];

  viewer.entities.add({
    polyline: {
      positions: new Cesium.CallbackProperty(() => activePositions, false),
      width: 5,
      material: new Cesium.PolylineGlowMaterialProperty({
        glowPower: 0.12,
        color: Cesium.Color.fromCssColorString("#3a4453")
      }),
      depthFailMaterial: Cesium.Color.fromCssColorString("#3a4453")
    }
  });

  const labelEntities = segments.map((seg) =>
    viewer.entities.add({
      position: midpoint(seg.points),
      label: {
        text: `+${Math.round(seg.km)} km`,
        font: "700 20px Manrope, sans-serif",
        fillColor: Cesium.Color.fromCssColorString("#1a1a1a"),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        showBackground: false,
        pixelOffset: new Cesium.Cartesian2(0, -30),
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        show: false
      }
    })
  );

  const stopMarkers = stops.map((stop, idx) =>
    viewer.entities.add({
      position: toCartesianFromDeg(stop.lon, stop.lat, 12000),
      point: {
        pixelSize: 10,
        color: Cesium.Color.fromCssColorString("#1a1a1a"),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        show: idx === 0
      },
      label: {
        text: stop.city,
        font: "700 20px Manrope, sans-serif",
        fillColor: Cesium.Color.fromCssColorString("#1a1a1a"),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        showBackground: false,
        pixelOffset: new Cesium.Cartesian2(0, -28),
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        show: idx === 0
      }
    })
  );

  const vehicle = viewer.entities.add({
    position: full[0],
    billboard: {
      image: makeVehicleIcon(legModes[0] || "plane"),
      width: 46,
      height: 46,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    }
  });

  const routeSpanKm = calcRouteSpanKm(stops);
  const baseRange = getCameraRangeBySpanKm(routeSpanKm);
  const basePitch = Cesium.Math.toRadians(-47);

  const initialHeading = getHeading(full[0], full[Math.min(4, full.length - 1)]);
  const stableHeading = Number.isFinite(initialHeading) ? initialHeading : 0;

  viewer.camera.setView({
    destination: toCartesianFromDeg(stops[0].lon, stops[0].lat, baseRange * 1.02),
    orientation: {
      heading: stableHeading,
      pitch: basePitch,
      roll: 0
    }
  });

  let timeline = null;
  let cancelled = false;
  let cameraHeading = stableHeading;
  let cameraFocus = Cesium.Cartesian3.clone(full[0]);
  let cameraRangeCurrent = baseRange;
  let cameraRangeTarget = baseRange;

  async function renderAndWait(frames = 2) {
    for (let i = 0; i < frames; i += 1) {
      viewer.scene.requestRender();
      await wait(16);
    }
  }

  async function warmupTiles() {
    const sampleCount = Cesium.Math.clamp(Math.ceil(full.length / 18), 16, 72);
    const sampled = [];

    for (let i = 0; i < sampleCount; i += 1) {
      const idx = Math.floor((i * Math.max(full.length - 1, 0)) / Math.max(sampleCount - 1, 1));
      sampled.push(full[idx]);
    }

    const passes = [sampled, [...sampled].reverse()];
    for (const pass of passes) {
      for (const pos of pass) {
        viewer.camera.lookAt(pos, new Cesium.HeadingPitchRange(cameraHeading, basePitch, cameraRangeCurrent));
        await renderAndWait(2);
      }
    }

    cameraFocus = Cesium.Cartesian3.clone(full[0]);
    viewer.camera.lookAt(full[0], new Cesium.HeadingPitchRange(cameraHeading, basePitch, cameraRangeCurrent));
    await renderAndWait(3);
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
  }

  function updateFrame(tValue) {
    const pos = lerpPosition(full, tValue);
    const end = Math.max(1, Math.floor(tValue));
    vehicle.position = pos;

    activePositions.length = 0;
    activePositions.push(...full.slice(0, end), pos);

    const lookAheadT = Math.min(tValue + 8, full.length - 1);
    const lookAhead = lerpPosition(full, lookAheadT);
    Cesium.Cartesian3.lerp(cameraFocus, lookAhead, 0.16, cameraFocus);
    cameraRangeCurrent = Cesium.Math.lerp(cameraRangeCurrent, cameraRangeTarget, 0.08);
    viewer.camera.lookAt(cameraFocus, new Cesium.HeadingPitchRange(cameraHeading, basePitch, cameraRangeCurrent));
    const nextT = Math.min(tValue + 1, full.length - 1);
    const nextPos = lerpPosition(full, nextT);
    const pathHeading = getHeading(pos, nextPos);
    if (Number.isFinite(pathHeading)) {
      vehicle.billboard.rotation = -(pathHeading - cameraHeading);
    }
  }

  function buildTimeline(onArrival) {
    const state = { t: 0 };
    const tl = gsap.timeline({ paused: true, onComplete: () => viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY) });

    for (let i = 0; i < ranges.length; i += 1) {
      const { start, end } = ranges[i];
      if (i === 0) state.t = start;
      let revealed = false;

      tl.call(() => {
        vehicle.billboard.image = makeVehicleIcon(legModes[i] || "plane");
        cameraRangeTarget = getCameraRangeBySegmentKm(segments[i].km);
        const targetIdx = i + 1;
        stopMarkers.forEach((m) => {
          m.point.show = false;
          m.label.show = false;
        });
        labelEntities.forEach((e, idx) => {
          e.label.show = false;
        });
        revealed = false;

        const marker = stopMarkers[targetIdx];
        if (marker) {
          marker.point.show = false;
          marker.label.show = false;
        }
      });

      tl.to(state, {
        t: end,
        duration: (() => {
          const pointCount = Math.max(end - start, 1);
          const durationByDistance = 1.2 + Math.sqrt(Math.max(segments[i].km, 1)) * 0.28;
          const durationByPoints = pointCount / 140;
          return Cesium.Math.clamp(Math.max(durationByDistance, durationByPoints), 3.2, 8.6);
        })(),
        ease: "none",
        onUpdate: () => {
          if (cancelled) return;
          updateFrame(state.t);

          const progress = (state.t - start) / Math.max(end - start, 1);
          if (!revealed && progress >= 0.85) {
            revealed = true;
            const targetIdx = i + 1;
            const marker = stopMarkers[targetIdx];
            if (marker) {
              marker.point.show = true;
              marker.label.show = true;
            }
            if (labelEntities[i]) {
              labelEntities[i].label.show = true;
            }
            onArrival?.({ stop: stops[targetIdx], km: segments[i].km, segment: targetIdx });
          }
        },
        onComplete: () => {
          if (revealed) return;
          revealed = true;
          const targetIdx = i + 1;
          const marker = stopMarkers[targetIdx];
          if (marker) {
            marker.point.show = true;
            marker.label.show = true;
          }
          if (labelEntities[i]) {
            labelEntities[i].label.show = true;
          }
          onArrival?.({ stop: stops[targetIdx], km: segments[i].km, segment: targetIdx });
        }
      });

      tl.to({}, { duration: 0.3, ease: "none" });
    }

    return tl;
  }

  function play(onArrival) {
    cancelled = false;
    timeline?.kill();

    activePositions.length = 0;
    activePositions.push(full[0]);
    vehicle.position = full[0];
    cameraHeading = stableHeading;
    cameraFocus = Cesium.Cartesian3.clone(full[0]);
    cameraRangeCurrent = baseRange;
    cameraRangeTarget = baseRange;
    viewer.camera.lookAt(full[0], new Cesium.HeadingPitchRange(cameraHeading, basePitch, cameraRangeCurrent));
    labelEntities.forEach((e) => {
      e.label.show = false;
    });
    stopMarkers.forEach((m, idx) => {
      m.point.show = false;
      m.label.show = false;
    });

    timeline = buildTimeline(onArrival);

    return new Promise((resolve) => {
      timeline.eventCallback("onComplete", () => {
        stopMarkers.forEach((m) => {
          m.point.show = false;
          m.label.show = false;
        });
        labelEntities.forEach((e) => {
          e.label.show = false;
        });
        viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
        resolve();
      });
      timeline.play(0);
    });
  }

  function pause() {
    timeline?.pause();
  }

  function resume() {
    timeline?.resume();
  }

  function exportFrame() {
    return viewer.canvas.toDataURL("image/png");
  }

  function setBasemap(nextBasemap) {
    const { layer: nextLayer, key } = createBaseLayer(nextBasemap);
    if (key === currentBasemap) return currentBasemap;
    viewer.imageryLayers.remove(baseLayer, true);
    viewer.imageryLayers.add(nextLayer, 0);
    baseLayer = nextLayer;
    currentBasemap = key;
    return currentBasemap;
  }

  function getBasemap() {
    return currentBasemap;
  }

  function destroy() {
    cancelled = true;
    timeline?.kill();
    viewer.destroy();
  }

  await renderAndWait(2);
  viewer.camera.lookAt(full[0], new Cesium.HeadingPitchRange(cameraHeading, basePitch, cameraRangeCurrent));
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);

  return { play, pause, resume, exportFrame, setBasemap, getBasemap, destroy, viewer };
}
