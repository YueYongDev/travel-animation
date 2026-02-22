import * as Cesium from "cesium";
import gsap from "gsap";

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toCartesianFromDeg(lon, lat, h = 0) {
  return Cesium.Cartesian3.fromDegrees(lon, lat, h);
}

function makeVehicleIcon(type = "plane") {
  const emoji = type === "car" ? "🚗" : "✈️";
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96' viewBox='0 0 96 96'>
    <circle cx='48' cy='48' r='27' fill='#ff2a94'/>
    <text x='48' y='59' text-anchor='middle' font-size='34'>${emoji}</text>
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
  const points = [];

  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const p = geodesic.interpolateUsingFraction(t);
    p.height = 110000 + 760000 * Math.sin(Math.PI * t);
    points.push(Cesium.Cartesian3.fromRadians(p.longitude, p.latitude, p.height));
  }

  return points;
}

function buildRoadPathFromCoords(coords) {
  return coords.map(([lon, lat]) => toCartesianFromDeg(lon, lat, 9000));
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
    } catch {
      segments.push({
        mode,
        points: buildPlanePath(from, to, 120),
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

export async function createGlobeScene(containerId, stops, legModes = []) {
  const baseLayer = new Cesium.ImageryLayer(
    new Cesium.UrlTemplateImageryProvider({
      url: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Physical_Map/MapServer/tile/{z}/{y}/{x}",
      subdomains: ["a", "b", "c", "d"],
      credit: "Esri",
      maximumLevel: 19
    })
  );
  baseLayer.brightness = 1.04;
  baseLayer.contrast = 0.86;
  baseLayer.saturation = 0.34;

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

  viewer.resolutionScale = Math.min(window.devicePixelRatio || 1, 2);
  viewer.scene.fxaa = true;
  viewer.scene.postProcessStages.fxaa.enabled = true;
  viewer.scene.globe.enableLighting = true;
  viewer.scene.globe.maximumScreenSpaceError = 1;
  viewer.scene.globe.preloadAncestors = true;
  viewer.scene.globe.preloadSiblings = true;
  viewer.scene.globe.tileCacheSize = 500;
  viewer.scene.backgroundColor = Cesium.Color.fromCssColorString("#eef3f7");
  if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = false;

  const segments = await buildSegments(stops, legModes);
  const { full, ranges } = flattenSegments(segments);
  const activePositions = [full[0]];

  viewer.entities.add({
    polyline: {
      positions: new Cesium.CallbackProperty(() => activePositions, false),
      width: 6,
      material: new Cesium.PolylineGlowMaterialProperty({
        glowPower: 0.18,
        color: Cesium.Color.fromCssColorString("#ff2a94")
      }),
      depthFailMaterial: Cesium.Color.fromCssColorString("#ff6fb9")
    }
  });

  const labelEntities = segments.map((seg) =>
    viewer.entities.add({
      position: midpoint(seg.points),
      label: {
        text: `+${Math.round(seg.km)} km`,
        font: "700 22px Manrope, sans-serif",
        fillColor: Cesium.Color.fromCssColorString("#f4fbff"),
        outlineColor: Cesium.Color.fromCssColorString("#314659"),
        outlineWidth: 4,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString("rgba(26,43,60,0.56)"),
        pixelOffset: new Cesium.Cartesian2(0, -34),
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
        pixelSize: 9,
        color: Cesium.Color.fromCssColorString("#ff2a94"),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        show: idx === 0
      },
      label: {
        text: stop.city,
        font: "700 18px Manrope, sans-serif",
        fillColor: Cesium.Color.fromCssColorString("#ffffff"),
        outlineColor: Cesium.Color.fromCssColorString("#30465a"),
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString("rgba(26,43,60,0.42)"),
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
      width: 50,
      height: 50,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    }
  });

  viewer.camera.setView({
    destination: toCartesianFromDeg(stops[0].lon, stops[0].lat, 3600000),
    orientation: {
      heading: Cesium.Math.toRadians(8),
      pitch: Cesium.Math.toRadians(-62),
      roll: 0
    }
  });

  let timeline = null;
  let cancelled = false;
  const fixedHeading = getHeading(full[0], full[Math.min(4, full.length - 1)]);

  async function warmupTiles() {
    const samples = Math.min(14, full.length);
    for (let i = 0; i < samples; i += 1) {
      const idx = Math.floor((i * (full.length - 1)) / Math.max(samples - 1, 1));
      const pos = full[idx];
      viewer.camera.setView({
        destination: pos,
        orientation: {
          heading: fixedHeading,
          pitch: Cesium.Math.toRadians(-63),
          roll: 0
        }
      });
      viewer.scene.requestRender();
      await wait(18);
    }
  }

  function updateFrame(tValue) {
    const pos = lerpPosition(full, tValue);
    const end = Math.max(1, Math.floor(tValue));
    vehicle.position = pos;

    activePositions.length = 0;
    activePositions.push(...full.slice(0, end), pos);

    const next = full[Math.min(end + 1, full.length - 1)];
    const breathe = Math.sin(tValue * 0.04) * 0.5 + 0.5;
    const range = 2920000 - breathe * 140000;
    const pitch = Cesium.Math.toRadians(-63 + breathe * 0.6);
    viewer.camera.lookAt(pos, new Cesium.HeadingPitchRange(fixedHeading, pitch, range));

    const winA = viewer.scene.cartesianToCanvasCoordinates(pos);
    const winB = viewer.scene.cartesianToCanvasCoordinates(next);
    if (winA && winB) {
      vehicle.billboard.rotation = Math.atan2(winB.y - winA.y, winB.x - winA.x);
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
        duration: 3.35,
        ease: "power2.inOut",
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

  function destroy() {
    cancelled = true;
    timeline?.kill();
    viewer.destroy();
  }

  await warmupTiles();
  viewer.camera.flyTo({
    destination: toCartesianFromDeg(stops[0].lon, stops[0].lat, 3600000),
    orientation: {
      heading: Cesium.Math.toRadians(8),
      pitch: Cesium.Math.toRadians(-62),
      roll: 0
    },
    duration: 0
  });

  return { play, pause, resume, exportFrame, destroy, viewer };
}
