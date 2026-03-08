import "mapbox-gl/dist/mapbox-gl.css";

import {useEffect, useMemo, useRef, useState} from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useDelayRender,
  useVideoConfig,
} from "remotion";
import mapboxgl, {Map} from "mapbox-gl";
import {
  OPENING_HOLD_FRAMES,
  SEGMENT_FOCUS_FRAMES,
  SEGMENT_HOLD_FRAMES,
  SEGMENT_TRAVEL_FRAMES,
} from "../lib/journeyTiming";
import type {
  ResolvedStop,
  TravelMapJourneyProps,
} from "../lib/routeSchema";

type Coordinate = [number, number];

const HIDE_FEATURES = [
  "showRoadsAndTransit",
  "showRoads",
  "showTransit",
  "showPedestrianRoads",
  "showRoadLabels",
  "showTransitLabels",
  "showPlaceLabels",
  "showPointOfInterestLabels",
  "showPointsOfInterest",
  "showAdminBoundaries",
  "showLandmarkIcons",
  "showLandmarkIconLabels",
  "show3dObjects",
  "show3dBuildings",
  "show3dTrees",
  "show3dLandmarks",
  "show3dFacades",
] as const;

const mapboxToken = process.env.REMOTION_MAPBOX_TOKEN;

if (mapboxToken) {
  mapboxgl.accessToken = mapboxToken;
}

const lerp = (start: number, end: number, progress: number) => {
  return start + (end - start) * progress;
};

const wrapLongitude = (value: number) => {
  return ((((value + 180) % 360) + 360) % 360) - 180;
};

const shortestLongitudeDelta = (start: number, end: number) => {
  let delta = end - start;
  while (delta > 180) {
    delta -= 360;
  }
  while (delta < -180) {
    delta += 360;
  }
  return delta;
};

const interpolateCoordinate = (
  start: Coordinate,
  end: Coordinate,
  progress: number,
): Coordinate => {
  const deltaLng = shortestLongitudeDelta(start[0], end[0]);

  return [
    wrapLongitude(start[0] + deltaLng * progress),
    lerp(start[1], end[1], progress),
  ];
};

const stopToCoordinate = (stop: ResolvedStop): Coordinate => {
  return [stop.longitude, stop.latitude];
};

const haversineDistanceKm = (start: Coordinate, end: Coordinate) => {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const deltaLat = toRad(end[1] - start[1]);
  const deltaLng = toRad(shortestLongitudeDelta(start[0], end[0]));
  const startLat = toRad(start[1]);
  const endLat = toRad(end[1]);

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(startLat) *
      Math.cos(endLat) *
      Math.sin(deltaLng / 2) *
      Math.sin(deltaLng / 2);

  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const getOverviewZoom = (distanceKm: number) => {
  const raw = 7.4 - Math.log(distanceKm + 1) * 0.55;
  return Math.max(2.35, Math.min(5.4, raw));
};

const getFocusZoom = (overviewZoom: number) => {
  return Math.min(9.6, overviewZoom + 3.9);
};

const getArrivalZoom = (overviewZoom: number) => {
  return Math.min(5.4, overviewZoom + 1.1);
};

const routeFeature = (
  stops: ResolvedStop[],
  segmentIndex: number,
  segmentProgress: number,
) => {
  const completed = stops.slice(0, segmentIndex + 1).map(stopToCoordinate);
  const start = stopToCoordinate(stops[segmentIndex]);
  const end = stopToCoordinate(stops[segmentIndex + 1]);
  const head = interpolateCoordinate(start, end, segmentProgress);

  return {
    type: "Feature" as const,
    properties: {},
    geometry: {
      type: "LineString" as const,
      coordinates: [...completed, head],
    },
  };
};

const buildMarkers = (stops: ResolvedStop[]) => {
  return {
    type: "FeatureCollection" as const,
    features: stops.map((stop) => ({
      type: "Feature" as const,
      properties: {
        country: stop.country,
        title: stop.title,
      },
      geometry: {
        type: "Point" as const,
        coordinates: stopToCoordinate(stop),
      },
    })),
  };
};

const buildSegmentTimeline = (segmentCount: number) => {
  const segments = [];
  let cursor = OPENING_HOLD_FRAMES;

  for (let index = 0; index < segmentCount; index += 1) {
    const focusStart = cursor;
    const focusEnd = focusStart + SEGMENT_FOCUS_FRAMES;
    const travelStart = focusEnd;
    const travelEnd = travelStart + SEGMENT_TRAVEL_FRAMES;
    const holdEnd = travelEnd + SEGMENT_HOLD_FRAMES;

    segments.push({
      focusEnd,
      focusStart,
      holdEnd,
      travelEnd,
      travelStart,
    });

    cursor = holdEnd;
  }

  return segments;
};

const MissingTokenMessage = () => {
  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        background:
          "radial-gradient(circle at top, #1e3a5f 0%, #09111d 55%, #05070b 100%)",
        color: "#f7f4ea",
        display: "flex",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        justifyContent: "center",
        padding: 96,
        textAlign: "center",
      }}
    >
      <div style={{display: "grid", gap: 18, maxWidth: 860}}>
        <div
          style={{
            fontSize: 28,
            letterSpacing: "0.18em",
            opacity: 0.7,
            textTransform: "uppercase",
          }}
        >
          Mapbox token required
        </div>
        <div
          style={{
            fontSize: 62,
            fontWeight: 700,
            lineHeight: 1.05,
          }}
        >
          Add `REMOTION_MAPBOX_TOKEN` to `.env` to preview the travel map
          journey composition.
        </div>
      </div>
    </AbsoluteFill>
  );
};

const getAnimationState = (
  frame: number,
  stops: ResolvedStop[],
) => {
  const segmentCount = stops.length - 1;
  const timeline = buildSegmentTimeline(segmentCount);

  if (frame < OPENING_HOLD_FRAMES) {
    const start = stopToCoordinate(stops[0]);
    const firstEnd = stopToCoordinate(stops[1]);
    const overviewZoom = getOverviewZoom(haversineDistanceKm(start, firstEnd));

    return {
      center: start,
      currentSegment: 0,
      pitch: 22,
      routeProgress: 0,
      zoom: getFocusZoom(overviewZoom),
    };
  }

  for (let index = 0; index < timeline.length; index += 1) {
    const segment = timeline[index];
    const start = stopToCoordinate(stops[index]);
    const end = stopToCoordinate(stops[index + 1]);
    const overviewZoom = getOverviewZoom(haversineDistanceKm(start, end));

    if (frame < segment.focusEnd) {
      const phase = interpolate(
        frame,
        [segment.focusStart, segment.focusEnd],
        [0, 1],
        {
          easing: Easing.out(Easing.cubic),
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        },
      );

      return {
        center: start,
        currentSegment: index,
        pitch: lerp(22, 0, phase),
        routeProgress: 0,
        zoom: lerp(getFocusZoom(overviewZoom), overviewZoom, phase),
      };
    }

    if (frame < segment.travelEnd) {
      const phase = interpolate(
        frame,
        [segment.travelStart, segment.travelEnd],
        [0, 1],
        {
          easing: Easing.inOut(Easing.cubic),
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        },
      );

      return {
        center: interpolateCoordinate(start, end, phase),
        currentSegment: index,
        pitch: 0,
        routeProgress: phase,
        zoom: lerp(overviewZoom, getArrivalZoom(overviewZoom), phase),
      };
    }

    if (frame < segment.holdEnd) {
      return {
        center: end,
        currentSegment: index,
        pitch: 0,
        routeProgress: 1,
        zoom: getArrivalZoom(overviewZoom),
      };
    }
  }

  const lastSegmentIndex = segmentCount - 1;
  const lastStop = stopToCoordinate(stops.at(-1)!);
  const previousStop = stopToCoordinate(stops[lastSegmentIndex]);
  const overviewZoom = getOverviewZoom(
    haversineDistanceKm(previousStop, lastStop),
  );

  return {
    center: lastStop,
    currentSegment: lastSegmentIndex,
    pitch: 0,
    routeProgress: 1,
    zoom: getArrivalZoom(overviewZoom),
  };
};

export const TravelMapJourney = ({
  resolvedStops,
}: TravelMapJourneyProps) => {
  const stops = resolvedStops ?? [];
  const frame = useCurrentFrame();
  const {width, height} = useVideoConfig();
  const ref = useRef<HTMLDivElement>(null);
  const hasConfiguredMap = Boolean(mapboxToken);
  const hasLoadedStyle = useRef(false);
  const markers = useMemo(() => buildMarkers(stops), [stops]);

  const {delayRender, continueRender, cancelRender} = useDelayRender();
  const [handle] = useState(() => delayRender("Loading map..."));
  const [map, setMap] = useState<Map | null>(null);

  const mapStyle = useMemo<React.CSSProperties>(() => {
    return {
      height,
      inset: 0,
      overflow: "hidden",
      position: "absolute",
      width,
    };
  }, [height, width]);

  useEffect(() => {
    if (!hasConfiguredMap) {
      continueRender(handle);
      return;
    }

    if (!ref.current) {
      cancelRender(new Error("Map container was not mounted."));
      return;
    }

    if (stops.length < 2) {
      continueRender(handle);
      return;
    }

    const first = stopToCoordinate(stops[0]);
    const second = stopToCoordinate(stops[1]);
    const initialOverviewZoom = getOverviewZoom(
      haversineDistanceKm(first, second),
    );

    const mapInstance = new Map({
      attributionControl: false,
      bearing: 0,
      center: first,
      container: ref.current,
      fadeDuration: 0,
      interactive: false,
      pitch: 22,
      preserveDrawingBuffer: true,
      style: "mapbox://styles/mapbox/standard",
      zoom: getFocusZoom(initialOverviewZoom),
    });

    mapInstance.on("style.load", () => {
      if (hasLoadedStyle.current) {
        return;
      }

      hasLoadedStyle.current = true;

      for (const feature of HIDE_FEATURES) {
        mapInstance.setConfigProperty("basemap", feature, false);
      }

      mapInstance.setConfigProperty("basemap", "colorMotorways", "transparent");
      mapInstance.setConfigProperty("basemap", "colorRoads", "transparent");
      mapInstance.setConfigProperty("basemap", "colorTrunks", "transparent");

      mapInstance.addSource("route", {
        type: "geojson",
        data: routeFeature(stops, 0, 0),
      });

      mapInstance.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": "#f97316",
          "line-width": 8,
        },
      });

      mapInstance.addSource("stops", {
        type: "geojson",
        data: markers,
      });

      mapInstance.addLayer({
        id: "stop-points",
        type: "circle",
        source: "stops",
        paint: {
          "circle-color": "#f97316",
          "circle-radius": 13,
          "circle-stroke-color": "#fff7ed",
          "circle-stroke-width": 4,
        },
      });

      mapInstance.addLayer({
        id: "stop-labels",
        type: "symbol",
        source: "stops",
        layout: {
          "text-anchor": "top",
          "text-field": ["get", "title"],
          "text-font": ["DIN Pro Bold", "Arial Unicode MS Bold"],
          "text-offset": [0, 0.88],
          "text-size": 40,
        },
        paint: {
          "text-color": "#fff7ed",
          "text-halo-color": "rgba(6, 11, 20, 0.9)",
          "text-halo-width": 2,
        },
      });
    });

    mapInstance.on("load", () => {
      setMap(mapInstance);
      continueRender(handle);
    });

    mapInstance.on("error", (event) => {
      if (event.error) {
        cancelRender(event.error);
      }
    });
  }, [
    cancelRender,
    continueRender,
    handle,
    hasConfiguredMap,
    markers,
    stops,
  ]);

  useEffect(() => {
    if (!map || !hasLoadedStyle.current || stops.length < 2) {
      return;
    }

    const animationHandle = delayRender("Animating map...");
    const animationState = getAnimationState(frame, stops);

    map.jumpTo({
      bearing: 0,
      center: animationState.center,
      pitch: animationState.pitch,
      zoom: animationState.zoom,
    });

    const source = map.getSource("route") as mapboxgl.GeoJSONSource | undefined;
    if (source) {
      source.setData(
        routeFeature(
          stops,
          animationState.currentSegment,
          animationState.routeProgress,
        ),
      );
    }

    map.once("idle", () => {
      continueRender(animationHandle);
    });
  }, [continueRender, delayRender, frame, map, stops]);

  if (!hasConfiguredMap) {
    return <MissingTokenMessage />;
  }

  if (stops.length < 2) {
    return (
      <AbsoluteFill
        style={{
          alignItems: "center",
          background:
            "radial-gradient(circle at top, #1e3a5f 0%, #09111d 55%, #05070b 100%)",
          color: "#f7f4ea",
          display: "flex",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          justifyContent: "center",
          textAlign: "center",
        }}
      >
        Resolving places...
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{backgroundColor: "#cbd5e1"}}>
      <div ref={ref} style={mapStyle} />
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(7, 10, 17, 0.2) 0%, rgba(7, 10, 17, 0) 20%, rgba(7, 10, 17, 0.25) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};
