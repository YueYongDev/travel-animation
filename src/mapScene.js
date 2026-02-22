import maplibregl from "maplibre-gl";
import gsap from "gsap";

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function interpolateLngLat(from, to, t) {
  return [lerp(from[0], to[0], t), lerp(from[1], to[1], t)];
}

function markerHtml(type = "plane") {
  const glyph = type === "car" ? "🚗" : "✈";
  return `<div class="vehicle-dot"><span>${glyph}</span></div>`;
}

function toLngLat(stop) {
  return [stop.lon, stop.lat];
}

export async function createMapScene(containerId, stops) {
  const style = {
    version: 8,
    sources: {
      satellite: {
        type: "raster",
        tiles: [
          "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        ],
        tileSize: 256,
        attribution: "Esri"
      }
    },
    layers: [
      {
        id: "satellite",
        type: "raster",
        source: "satellite",
        paint: {
          "raster-saturation": 0.15,
          "raster-contrast": 0.15,
          "raster-brightness-max": 0.95,
          "raster-brightness-min": 0.1
        }
      }
    ]
  };

  const map = new maplibregl.Map({
    container: containerId,
    style,
    center: [20, 22],
    zoom: 2.4,
    pitch: 58,
    bearing: -20,
    antialias: true,
    attributionControl: false
  });

  await new Promise((resolve, reject) => {
    map.on("load", resolve);
    map.on("error", reject);
  });

  const points = stops.map(toLngLat);

  map.addSource("terrainSource", {
    type: "raster-dem",
    url: "https://demotiles.maplibre.org/terrain-tiles/tiles.json",
    tileSize: 256
  });
  map.setTerrain({ source: "terrainSource", exaggeration: 1.25 });
  map.setFog({
    range: [0.8, 8],
    color: "rgba(8,16,28,0.62)",
    "high-color": "rgba(16,37,60,0.45)",
    "horizon-blend": 0.22
  });

  map.addSource("stops", {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: stops.map((stop) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [stop.lon, stop.lat] },
        properties: { city: stop.city }
      }))
    }
  });

  map.addSource("route-active", {
    type: "geojson",
    data: {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [points[0]]
      }
    }
  });

  map.addLayer({
    id: "route-active-glow",
    type: "line",
    source: "route-active",
    paint: {
      "line-color": "#39e8ff",
      "line-width": 18,
      "line-opacity": 0.24,
      "line-blur": 2.2
    }
  });

  map.addLayer({
    id: "route-active-main",
    type: "line",
    source: "route-active",
    paint: {
      "line-color": "#8af5ff",
      "line-width": 6,
      "line-opacity": 1
    }
  });

  map.addLayer({
    id: "stops-circles",
    type: "circle",
    source: "stops",
    paint: {
      "circle-color": "#22d8ff",
      "circle-radius": 6,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2
    }
  });

  const vehicleEl = document.createElement("div");
  vehicleEl.innerHTML = markerHtml(stops[0].vehicle);
  const vehicleMarker = new maplibregl.Marker({ element: vehicleEl.firstChild, anchor: "center" })
    .setLngLat(points[0])
    .addTo(map);

  const activeCoords = [points[0]];
  let runningTween = null;

  function setActiveRoute(coords) {
    const source = map.getSource("route-active");
    if (!source) return;
    source.setData({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: coords
      }
    });
  }

  async function animateSegment(startPoint, endPoint, duration = 2.8) {
    const startBearing = map.getBearing();
    const targetBearing =
      (Math.atan2(endPoint[0] - startPoint[0], endPoint[1] - startPoint[1]) * 180) / Math.PI;

    await new Promise((resolve) => {
      const state = { t: 0 };
      runningTween = gsap.to(state, {
        t: 1,
        duration,
        ease: "power1.inOut",
        onUpdate: () => {
          const current = interpolateLngLat(startPoint, endPoint, state.t);
          const coords = activeCoords.slice();
          coords.push(current);
          setActiveRoute(coords);
          vehicleMarker.setLngLat(current);

          map.jumpTo({
            center: current,
            zoom: lerp(4.1, 3.2, state.t),
            pitch: lerp(68, 62, state.t),
            bearing: lerp(startBearing, targetBearing, state.t) - 90
          });
        },
        onComplete: () => {
          activeCoords.push(endPoint);
          setActiveRoute(activeCoords);
          resolve();
        }
      });
    });
  }

  async function play() {
    if (runningTween) runningTween.kill();

    activeCoords.length = 0;
    activeCoords.push(points[0]);
    setActiveRoute(activeCoords);
    vehicleMarker.setLngLat(points[0]);

    map.jumpTo({ center: points[0], zoom: 3.2, pitch: 48, bearing: -18 });

    for (let i = 0; i < points.length - 1; i += 1) {
      const from = points[i];
      const to = points[i + 1];
      await animateSegment(from, to, 3.4);
    }
  }

  function destroy() {
    if (runningTween) runningTween.kill();
    map.remove();
  }

  return { play, destroy, map };
}
