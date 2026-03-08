import "mapbox-gl/dist/mapbox-gl.css";

import type {CSSProperties} from "react";
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
  DEFAULT_TRANSPORT_MODE,
  OPENING_HOLD_FRAMES,
  type JourneyStopCoordinate,
  buildJourneySegments,
  getTransportProfile,
  normalizeLegModes,
} from "../lib/journeyTiming";
import {transportModes} from "../lib/routeSchema";
import type {
  ResolvedStop,
  TransportMode,
  TravelMapJourneyProps,
} from "../lib/routeSchema";

type Coordinate = [number, number];

type JourneySegment = {
  arrivalZoom: number;
  distanceKm: number;
  end: Coordinate;
  focusEnd: number;
  focusStart: number;
  focusZoom: number;
  holdEnd: number;
  mode: TransportMode;
  overviewZoom: number;
  path: Coordinate[];
  profile: ReturnType<typeof getTransportProfile>;
  settleFrames: number;
  start: Coordinate;
  travelEnd: number;
  travelStart: number;
  travelStartZoom: number;
};

type AnimationPhase = "opening" | "focus" | "settle" | "travel" | "hold" | "end";

type AnimationState = {
  center: Coordinate;
  currentSegment: number;
  phase: AnimationPhase;
  pitch: number;
  routeProgress: number;
  zoom: number;
};

type TravelState = {
  center: Coordinate;
  pitch: number;
  zoom: number;
};

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

const ACTIVE_ROUTE_REVEAL_LEAD = 0.018;
const BADGE_SIZE = 128;
const TRANSPORT_EMOJIS: Record<TransportMode, string> = {
  bike: "🚲",
  car: "🚗",
  plane: "✈️",
  ship: "🚢",
  train: "🚆",
  walk: "🚶",
};

const mapboxToken = process.env.REMOTION_MAPBOX_TOKEN;

if (mapboxToken) {
  mapboxgl.accessToken = mapboxToken;
}

const lerp = (start: number, end: number, progress: number) => {
  return start + (end - start) * progress;
};

const clamp = (value: number, min: number, max: number) => {
  return Math.min(max, Math.max(min, value));
};

const getTransportBadgeId = (mode: TransportMode) => {
  return `transport-badge-${mode}`;
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

const mixCoordinate = (
  start: Coordinate,
  end: Coordinate,
  progress: number,
): Coordinate => {
  return [
    lerp(start[0], end[0], progress),
    lerp(start[1], end[1], progress),
  ];
};

const wrapCoordinate = (coordinate: Coordinate): Coordinate => {
  return [wrapLongitude(coordinate[0]), clamp(coordinate[1], -84, 84)];
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

const getOverviewZoom = (distanceKm: number, mode: TransportMode) => {
  const raw = 7.4 - Math.log(distanceKm + 1) * 0.55;
  const modeBias: Record<TransportMode, number> = {
    bike: 2.1,
    car: 1.45,
    plane: -0.2,
    ship: 0.15,
    train: 1.1,
    walk: 2.5,
  };

  return clamp(raw + modeBias[mode], 2.15, 8.7);
};

const buildBezierPath = (
  start: Coordinate,
  end: Coordinate,
  mode: TransportMode,
  _distanceKm: number,
) => {
  const profile = getTransportProfile(mode);
  const endLng = start[0] + shortestLongitudeDelta(start[0], end[0]);
  const coordinates: Coordinate[] = [];

  for (let index = 0; index <= profile.sampleCount; index += 1) {
    const progress = index / profile.sampleCount;
    coordinates.push([
      lerp(start[0], endLng, progress),
      lerp(start[1], end[1], progress),
    ]);
  }

  return coordinates;
};

const buildJourneyPlan = (
  stops: ResolvedStop[],
  legModes: readonly TransportMode[],
) => {
  if (stops.length < 2) {
    return [] as JourneySegment[];
  }

  const stopCoordinates: JourneyStopCoordinate[] = stops.map((stop) => ({
    lat: stop.latitude,
    lon: stop.longitude,
  }));
  const timeline = buildJourneySegments(stops.length, legModes, stopCoordinates);
  const plan: JourneySegment[] = [];

  for (let index = 0; index < timeline.length; index += 1) {
    const segment = timeline[index];
    const start = stopToCoordinate(stops[index]);
    const end = stopToCoordinate(stops[index + 1]);
    const distanceKm = haversineDistanceKm(start, end);
    const overviewZoom = getOverviewZoom(distanceKm, segment.mode);
    const focusZoom = clamp(
      overviewZoom + segment.profile.focusZoomBoost,
      overviewZoom + 0.45,
      11.4,
    );
    const travelStartZoom = clamp(
      overviewZoom + segment.profile.travelStartZoomDelta,
      overviewZoom,
      focusZoom,
    );
    const arrivalZoom = clamp(
      overviewZoom + segment.profile.arrivalZoomDelta,
      overviewZoom,
      10.8,
    );

    plan.push({
      ...segment,
      arrivalZoom,
      distanceKm,
      end,
      focusZoom,
      overviewZoom,
      path: buildBezierPath(start, end, segment.mode, distanceKm),
      start,
      travelStartZoom,
    });
  }

  return plan;
};

const getPathPoint = (path: Coordinate[], progress: number): Coordinate => {
  if (path.length === 0) {
    return [0, 0];
  }

  if (path.length === 1) {
    return path[0];
  }

  const clamped = clamp(progress, 0, 1);
  const position = clamped * (path.length - 1);
  const index = Math.floor(position);
  const nextIndex = Math.min(index + 1, path.length - 1);
  const localProgress = position - index;

  return mixCoordinate(path[index], path[nextIndex], localProgress);
};

const getPartialPath = (path: Coordinate[], progress: number) => {
  if (path.length < 2) {
    return path;
  }

  const clamped = clamp(progress, 0, 1);
  const position = clamped * (path.length - 1);
  const index = Math.floor(position);
  const partial = path.slice(0, Math.max(index + 1, 1));
  const head = getPathPoint(path, clamped);

  if (partial.length === 0) {
    return [path[0], head];
  }

  const lastPoint = partial[partial.length - 1];
  if (lastPoint[0] !== head[0] || lastPoint[1] !== head[1]) {
    partial.push(head);
  }

  if (partial.length === 1) {
    partial.push(head);
  }

  return partial;
};

const createModeExpression = (
  transform: (mode: TransportMode) => number | string,
) => {
  return [
    "match",
    ["get", "mode"],
    ...transportModes.flatMap((mode) => [mode, transform(mode)]),
    transform(DEFAULT_TRANSPORT_MODE),
  ] as unknown as mapboxgl.Expression;
};

const ACTIVE_ROUTE_COLOR = createModeExpression((mode) => {
  return getTransportProfile(mode).activeColor;
});

const ACTIVE_ROUTE_WIDTH = createModeExpression((mode) => {
  return getTransportProfile(mode).lineWidth;
});

const COMPLETED_ROUTE_WIDTH = createModeExpression((mode) => {
  return Math.max(3.6, getTransportProfile(mode).lineWidth * 0.68);
});

const HEAD_BADGE_SCALE = createModeExpression((mode) => {
  return clamp(0.82 + (getTransportProfile(mode).lineWidth - 5.5) * 0.04, 0.82, 0.96);
});

const createTransportBadgeImage = (mode: TransportMode) => {
  const canvas = document.createElement("canvas");
  canvas.width = BADGE_SIZE;
  canvas.height = BADGE_SIZE;

  const context = canvas.getContext("2d");
  if (!context) {
    return new ImageData(BADGE_SIZE, BADGE_SIZE);
  }

  const emoji = TRANSPORT_EMOJIS[mode];
  const center = BADGE_SIZE / 2;
  const radius = 44;

  context.clearRect(0, 0, BADGE_SIZE, BADGE_SIZE);
  context.shadowColor = "rgba(6, 11, 20, 0.22)";
  context.shadowBlur = 12;
  context.shadowOffsetY = 6;
  context.beginPath();
  context.arc(center, center, radius, 0, Math.PI * 2);
  context.fillStyle = "#fff7ed";
  context.fill();
  context.shadowColor = "transparent";
  context.lineWidth = 3;
  context.strokeStyle = "rgba(15, 23, 42, 0.16)";
  context.stroke();
  context.font =
    '60px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", system-ui, sans-serif';
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "#111827";
  context.fillText(emoji, center, center + 2);

  return context.getImageData(0, 0, BADGE_SIZE, BADGE_SIZE);
};

const buildMarkers = (stops: ResolvedStop[]) => {
  return {
    type: "FeatureCollection" as const,
    features: stops.map((stop, index) => ({
      type: "Feature" as const,
      properties: {
        country: stop.country,
        isEnd: index === stops.length - 1,
        isStart: index === 0,
        title: stop.title,
      },
      geometry: {
        type: "Point" as const,
        coordinates: wrapCoordinate(stopToCoordinate(stop)),
      },
    })),
  };
};

const buildCompletedRoutes = (
  segments: JourneySegment[],
  currentSegment: number,
) => {
  return {
    type: "FeatureCollection" as const,
    features: segments.slice(0, currentSegment).map((segment) => ({
      type: "Feature" as const,
      properties: {
        mode: segment.mode,
      },
      geometry: {
        type: "LineString" as const,
        coordinates: segment.path,
      },
    })),
  };
};

const buildActiveRoute = (
  segments: JourneySegment[],
  currentSegment: number,
  progress: number,
  phase: AnimationPhase,
) => {
  const segment = segments[currentSegment];

  if (!segment) {
    return {
      type: "FeatureCollection" as const,
      features: [],
    };
  }

  const isPreviewTravel =
    phase === "travel" || (phase === "focus" && progress > 0.0001);
  const routeProgress = isPreviewTravel
    ? clamp(progress + ACTIVE_ROUTE_REVEAL_LEAD, 0, 1)
    : progress;
  const coordinates =
    isPreviewTravel
      ? getPartialPath(segment.path, routeProgress)
      : phase === "hold" || phase === "end"
        ? segment.path
        : [segment.start, segment.start];

  return {
    type: "FeatureCollection" as const,
    features: [
      {
        type: "Feature" as const,
        properties: {
          mode: segment.mode,
        },
        geometry: {
          type: "LineString" as const,
          coordinates,
        },
      },
    ],
  };
};

const buildHeadPoint = (
  segments: JourneySegment[],
  currentSegment: number,
  progress: number,
  phase: AnimationPhase,
) => {
  const segment = segments[currentSegment];

  if (!segment) {
    return {
      type: "FeatureCollection" as const,
      features: [],
    };
  }

  const coordinate =
    phase === "opening" || phase === "settle"
      ? segment.start
      : phase === "focus" || phase === "travel"
        ? getPathPoint(segment.path, progress)
        : segment.end;

  return {
    type: "FeatureCollection" as const,
    features: [
      {
        type: "Feature" as const,
        properties: {
          badge: getTransportBadgeId(segment.mode),
          mode: segment.mode,
        },
        geometry: {
          type: "Point" as const,
          coordinates: wrapCoordinate(coordinate),
        },
      },
    ],
  };
};

const getTravelCameraCenter = (
  segment: JourneySegment,
  progress: number,
): Coordinate => {
  const clamped = clamp(progress, 0, 1);
  const head = getPathPoint(segment.path, clamped);
  const lookAhead = getPathPoint(
    segment.path,
    clamp(clamped + segment.profile.travelLead, 0, 1),
  );
  const tail = getPathPoint(
    segment.path,
    clamp(clamped - Math.max(segment.profile.travelLead * 0.85, 0.03), 0, 1),
  );
  const midpoint = getPathPoint(segment.path, 0.5);
  const leadCenter = mixCoordinate(head, lookAhead, 0.58);
  const stabilizedCenter = mixCoordinate(tail, leadCenter, 0.78);
  const pull = segment.profile.centerPull * Math.sin(Math.PI * clamped);

  return mixCoordinate(
    mixCoordinate(stabilizedCenter, midpoint, pull),
    segment.end,
    clamped * clamped,
  );
};

const getTravelEasing = (segmentIndex: number, segmentCount: number) => {
  if (segmentCount === 1) {
    return Easing.inOut(Easing.sin);
  }

  if (segmentIndex === segmentCount - 1) {
    return Easing.out(Easing.sin);
  }

  return Easing.linear;
};

const getTravelProgress = (
  frame: number,
  segment: JourneySegment,
  segmentIndex: number,
  segmentCount: number,
) => {
  const lastTravelFrame = Math.max(segment.travelStart, segment.travelEnd - 1);

  return interpolate(
    frame,
    [segment.travelStart, lastTravelFrame],
    [0, 1],
    {
      easing: getTravelEasing(segmentIndex, segmentCount),
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );
};

const getTravelState = (
  segment: JourneySegment,
  segmentIndex: number,
  segmentCount: number,
  progress: number,
): TravelState => {
  const travelStartPitch = segmentIndex === 0 ? segment.profile.travelPitch : 0;
  const travelPitchWave =
    segmentIndex === 0
      ? segment.profile.midPitchWave
      : Math.max(segment.profile.midPitchWave * 0.7, 1.2);

  return {
    center: getTravelCameraCenter(segment, progress),
    pitch: Math.max(
      0,
      lerp(travelStartPitch, 0, progress) +
        Math.sin(Math.PI * progress) * travelPitchWave,
    ),
    zoom: clamp(
      lerp(segment.travelStartZoom, segment.arrivalZoom, progress) +
        Math.sin(Math.PI * progress) * segment.profile.midZoomWave,
      2.1,
      11.6,
    ),
  };
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
  segments: JourneySegment[],
): AnimationState => {
  const firstSegment = segments[0];

  if (!firstSegment) {
    return {
      center: [0, 0],
      currentSegment: 0,
      phase: "opening",
      pitch: 0,
      routeProgress: 0,
      zoom: 2.8,
    };
  }

  if (frame < OPENING_HOLD_FRAMES) {
    const phase = interpolate(frame, [0, OPENING_HOLD_FRAMES], [0, 1], {
      easing: Easing.out(Easing.cubic),
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });

    return {
      center: firstSegment.start,
      currentSegment: 0,
      phase: "opening",
      pitch: lerp(
        firstSegment.profile.focusPitch + 6,
        firstSegment.profile.focusPitch,
        phase,
      ),
      routeProgress: 0,
      zoom: lerp(
        Math.min(firstSegment.focusZoom + 0.78, 11.8),
        firstSegment.focusZoom,
        phase,
      ),
    };
  }

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const previousSegment = segments[index - 1];
    const focusStartZoom =
      index === 0 ? segment.focusZoom : previousSegment.arrivalZoom;
    const focusStartPitch = index === 0 ? segment.profile.focusPitch : 0;

    if (frame < segment.focusEnd) {
      const phase = interpolate(frame, [segment.focusStart, segment.focusEnd], [0, 1], {
        easing: Easing.bezier(0.22, 0.86, 0.22, 1),
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });

      return {
        center: mixCoordinate(
          segment.start,
          getTravelCameraCenter(segment, 0),
          phase,
        ),
        currentSegment: index,
        phase: "focus",
        pitch: lerp(focusStartPitch, segment.profile.travelPitch, phase),
        routeProgress: 0,
        zoom: lerp(focusStartZoom, segment.travelStartZoom, phase),
      };
    }

    if (segment.settleFrames > 0 && frame < segment.travelStart) {
      const settleStartFrame = segment.travelStart - segment.settleFrames;
      const settleEndFrame = Math.max(settleStartFrame, segment.travelStart - 1);
      const settle = interpolate(frame, [settleStartFrame, settleEndFrame], [0, 1], {
        easing: Easing.inOut(Easing.sin),
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
      const settledTravelState = getTravelState(
        segment,
        index,
        segments.length,
        0,
      );

      return {
        center: mixCoordinate(segment.start, settledTravelState.center, settle),
        currentSegment: index,
        phase: "settle",
        pitch: lerp(0, settledTravelState.pitch, settle),
        routeProgress: 0,
        zoom: lerp(focusStartZoom, settledTravelState.zoom, settle),
      };
    }

    if (frame < segment.travelEnd) {
      const phase = getTravelProgress(frame, segment, index, segments.length);
      const currentTravelState = getTravelState(
        segment,
        index,
        segments.length,
        phase,
      );

      return {
        center: currentTravelState.center,
        currentSegment: index,
        phase: "travel",
        pitch: currentTravelState.pitch,
        routeProgress: phase,
        zoom: currentTravelState.zoom,
      };
    }

    if (frame < segment.holdEnd) {
      return {
        center: segment.end,
        currentSegment: index,
        phase: "hold",
        pitch: 0,
        routeProgress: 1,
        zoom: segment.arrivalZoom,
      };
    }
  }

  const lastSegment = segments[segments.length - 1];

  return {
    center: lastSegment.end,
    currentSegment: segments.length - 1,
    phase: "end",
    pitch: 0,
    routeProgress: 1,
    zoom: lastSegment.arrivalZoom,
  };
};

export const TravelMapJourney = ({
  legModes,
  resolvedStops,
}: TravelMapJourneyProps) => {
  const stops = resolvedStops ?? [];
  const normalizedLegModes = useMemo(() => {
    return normalizeLegModes(legModes, stops.length);
  }, [legModes, stops.length]);
  const journeySegments = useMemo(() => {
    return buildJourneyPlan(stops, normalizedLegModes);
  }, [normalizedLegModes, stops]);
  const markers = useMemo(() => buildMarkers(stops), [stops]);
  const frame = useCurrentFrame();
  const {width, height} = useVideoConfig();
  const ref = useRef<HTMLDivElement>(null);
  const hasConfiguredMap = Boolean(mapboxToken);
  const hasLoadedStyle = useRef(false);

  const {delayRender, continueRender, cancelRender} = useDelayRender();
  const [handle] = useState(() => delayRender("Loading map..."));
  const [map, setMap] = useState<Map | null>(null);

  const mapStyle = useMemo<CSSProperties>(() => {
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

    if (journeySegments.length === 0) {
      continueRender(handle);
      return;
    }

    const initialState = getAnimationState(0, journeySegments);

    const mapInstance = new Map({
      attributionControl: false,
      bearing: 0,
      center: wrapCoordinate(initialState.center),
      container: ref.current,
      fadeDuration: 0,
      interactive: false,
      pitch: initialState.pitch,
      preserveDrawingBuffer: true,
      style: "mapbox://styles/mapbox/standard",
      zoom: initialState.zoom,
    });

    mapInstance.on("style.load", () => {
      if (hasLoadedStyle.current) {
        return;
      }

      hasLoadedStyle.current = true;

      for (const feature of HIDE_FEATURES) {
        mapInstance.setConfigProperty("basemap", feature, false);
      }

      mapInstance.setConfigProperty("basemap", "colorMotorways", "rgba(0, 0, 0, 0)");
      mapInstance.setConfigProperty("basemap", "colorRoads", "rgba(0, 0, 0, 0)");
      mapInstance.setConfigProperty("basemap", "colorTrunks", "rgba(0, 0, 0, 0)");

      for (const mode of transportModes) {
        const badgeId = getTransportBadgeId(mode);
        if (!mapInstance.hasImage(badgeId)) {
          mapInstance.addImage(badgeId, createTransportBadgeImage(mode), {
            pixelRatio: 2,
          });
        }
      }

      mapInstance.addSource("completed-routes", {
        type: "geojson",
        data: buildCompletedRoutes(journeySegments, 0),
      });

      mapInstance.addLayer({
        id: "completed-routes-line",
        type: "line",
        source: "completed-routes",
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": ACTIVE_ROUTE_COLOR,
          "line-opacity": 0.34,
          "line-width": COMPLETED_ROUTE_WIDTH,
        },
      });

      mapInstance.addSource("active-route", {
        type: "geojson",
        data: buildActiveRoute(journeySegments, 0, 0, "opening"),
      });

      mapInstance.addLayer({
        id: "active-route-line",
        type: "line",
        source: "active-route",
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": ACTIVE_ROUTE_COLOR,
          "line-width": ACTIVE_ROUTE_WIDTH,
        },
      });

      mapInstance.addSource("head-point", {
        type: "geojson",
        data: buildHeadPoint(journeySegments, 0, 0, "opening"),
      });

      mapInstance.addLayer({
        id: "head-badge-layer",
        type: "symbol",
        source: "head-point",
        layout: {
          "icon-allow-overlap": true,
          "icon-anchor": "center",
          "icon-ignore-placement": true,
          "icon-image": ["get", "badge"],
          "icon-pitch-alignment": "viewport",
          "icon-size": HEAD_BADGE_SCALE,
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
          "circle-color": "#fff7ed",
          "circle-radius": [
            "case",
            ["boolean", ["get", "isStart"], false],
            7,
            ["boolean", ["get", "isEnd"], false],
            7,
            5.5,
          ],
          "circle-stroke-color": "#09111d",
          "circle-stroke-width": 2,
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
          "text-offset": [0, 0.58],
          "text-size": 21,
        },
        paint: {
          "text-color": "#fff7ed",
          "text-halo-color": "rgba(6, 11, 20, 0.9)",
          "text-halo-width": 1.6,
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
    journeySegments,
    markers,
  ]);

  useEffect(() => {
    if (!map || !hasLoadedStyle.current || journeySegments.length === 0) {
      return;
    }

    const animationHandle = delayRender("Animating map...");
    const animationState = getAnimationState(frame, journeySegments);

    map.jumpTo({
      bearing: 0,
      center: wrapCoordinate(animationState.center),
      pitch: animationState.pitch,
      zoom: animationState.zoom,
    });

    const completedRoutes = map.getSource("completed-routes") as
      | mapboxgl.GeoJSONSource
      | undefined;
    completedRoutes?.setData(
      buildCompletedRoutes(journeySegments, animationState.currentSegment),
    );

    const activeRoute = map.getSource("active-route") as
      | mapboxgl.GeoJSONSource
      | undefined;
    activeRoute?.setData(
      buildActiveRoute(
        journeySegments,
        animationState.currentSegment,
        animationState.routeProgress,
        animationState.phase,
      ),
    );

    const headPoint = map.getSource("head-point") as
      | mapboxgl.GeoJSONSource
      | undefined;
    headPoint?.setData(
      buildHeadPoint(
        journeySegments,
        animationState.currentSegment,
        animationState.routeProgress,
        animationState.phase,
      ),
    );

    map.once("idle", () => {
      continueRender(animationHandle);
    });
  }, [continueRender, delayRender, frame, journeySegments, map]);

  if (!hasConfiguredMap) {
    return <MissingTokenMessage />;
  }

  if (journeySegments.length === 0) {
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
