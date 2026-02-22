import * as Cesium from "cesium";
import gsap from "gsap";

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toCartesianFromDeg(lon, lat, h = 0) {
  return Cesium.Cartesian3.fromDegrees(lon, lat, h);
}

function makeVehicleIcon(type = "plane") {
  const iconPaths = {
    car: `<path d="M62 58h5c1.7 0 3-1.2 3-3v-8c0-2.6-2-5-4.4-5.5C61.6 40.6 54 39 54 39s-3.8-4-6.4-6.7c-1.4-1.2-3.2-2-5.2-2H28c-1.7 0-3.2 1.2-4 2.6l-4 8.5A11 11 0 0 0 19 45v11c0 1.7 1.2 3 3 3h5" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="33" cy="58" r="5" fill="none" stroke="white" stroke-width="2.5"/><path d="M38 58h16" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round"/><circle cx="59" cy="58" r="5" fill="none" stroke="white" stroke-width="2.5"/>`,
    plane: `<path d="M55.4 60.6 50 40l10.5-10.5C64 26 65.5 20 64 17c-3-1.5-9 0-13.5 4.5L43 29l-24.6-5.4c-1.5-.3-2.7.3-3.3 1.5l-.9 1.5c-.6 1.5-.3 3 .9 3.9L30 40l-6 9H16l-3 3 9 6 6 9 3-3v-8l9-6 10.5 15.9c.9 1.2 2.4 1.5 3.9.9l1.5-.6c1.2-.9 1.8-2.1 1.5-3.6z" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`,
    ship: `<path d="M19 66c1.8 1.5 3.6 3 7.5 3 7.5 0 7.5-6 15-6 3.9 0 5.7 1.5 7.5 3 1.8 1.5 3.6 3 7.5 3 7.5 0 7.5-6 15-6 3.9 0 5.7 1.5 7.5 3" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M62.1 63A34.8 34.8 0 0 0 67 45l-27-12-27 12c0 8.7 2.8 16 8.4 23.3" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M61 42V24a6 6 0 0 0-6-6H25a6 6 0 0 0-6 6v18" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M40 33v-9" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round"/>`
  };
  const path = iconPaths[type] || iconPaths.plane;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 80 80'>
    <circle cx='40' cy='40' r='28' fill='%231a1a1a' opacity='0.85'/>
    <g transform='translate(-4,-4) scale(0.9)'>${path}</g>
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

    if (mode === "ship") {
      segments.push({
        mode,
        points: buildPlanePath(from, to, 130).map((point) => {
          const c = Cesium.Cartographic.fromCartesian(point);
          return Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, 42000);
        }),
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
      width: 6,
      material: new Cesium.PolylineGlowMaterialProperty({
        glowPower: 0.2,
        color: Cesium.Color.fromCssColorString("#555555")
      }),
      depthFailMaterial: Cesium.Color.fromCssColorString("#555555")
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
      width: 50,
      height: 50,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    }
  });

  viewer.camera.setView({
    destination: toCartesianFromDeg(6, 20, 11800000),
    orientation: {
      heading: Cesium.Math.toRadians(6),
      pitch: Cesium.Math.toRadians(-26),
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
    const range = 7200000 - breathe * 320000;
    const pitch = Cesium.Math.toRadians(-40 + breathe * 0.8);
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
  const routeMid = midpoint(full);
  viewer.camera.lookAt(
    routeMid,
    new Cesium.HeadingPitchRange(
      fixedHeading,
      Cesium.Math.toRadians(-38),
      7200000
    )
  );
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);

  return { play, pause, resume, exportFrame, destroy, viewer };
}
