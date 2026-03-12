import "mapbox-gl/dist/mapbox-gl.css";

import type { CSSProperties } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  useDelayRender,
  useVideoConfig,
} from "remotion";
import mapboxgl, { Map } from "mapbox-gl";
import { subscribePreviewFocus } from "../lib/previewFocusBus";
import {
  TRANSPORT_SPRITE_SIZE,
  TRANSPORT_SPRITE_FORWARD_BEARING,
  createTransportVehicleImage,
} from "../lib/transportVehicleSprite";
import {
  DEFAULT_TRANSPORT_MODE,
  OPENING_HOLD_FRAMES,
  type JourneyStopCoordinate,
  buildJourneySegments,
  getTransportProfile,
  normalizeLegModes,
} from "../lib/journeyTiming";
import { transportModes } from "../lib/routeSchema";
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

type ScreenPoint = {
  x: number;
  y: number;
};

type AttachedTrailOverlay = {
  coordinates: Coordinate[];
  headCoordinate: Coordinate;
  rotation: number;
  visible: boolean;
};

type OverlaySyncInput = {
  attachedTrail: AttachedTrailOverlay | null;
  attachedTrailPathNode: SVGPathElement | null;
  mapInstance: Map;
  stopLabelNodes: Array<HTMLDivElement | null>;
  stops: ResolvedStop[];
  vehicleCoordinate: { coordinate: Coordinate; rotation: number } | null;
  vehicleNode: HTMLDivElement | null;
};

const STOP_LABEL_FONT_STACK = [
  "\"Zhuque Fangsong\"",
  "\"朱雀仿宋\"",
  "\"Source Han Serif SC\"",
  "\"Noto Serif CJK SC\"",
  "\"Songti SC\"",
  "\"STSong\"",
  "\"SimSun\"",
  "sans-serif",
].join(", ");
const STOP_LABEL_MAX_WIDTH = 360;
const STOP_LABEL_Y_OFFSET_PX = 18;

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

const ROUTE_HANDOFF_PROGRESS = 0.12;

const mapboxToken = process.env.REMOTION_MAPBOX_TOKEN;

if (mapboxToken) {
  mapboxgl.accessToken = mapboxToken;
  if (typeof window !== "undefined") {
    mapboxgl.prewarm();
  }
}

const lerp = (start: number, end: number, progress: number) => {
  return start + (end - start) * progress;
};

const clamp = (value: number, min: number, max: number) => {
  return Math.min(max, Math.max(min, value));
};

const normalizeDegrees = (value: number) => {
  return ((((value % 360) + 360) % 360) + 360) % 360;
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

const getBearing = (start: Coordinate, end: Coordinate) => {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const toDeg = (value: number) => (value * 180) / Math.PI;
  const lng1 = toRad(start[0]);
  const lng2 = toRad(start[0] + shortestLongitudeDelta(start[0], end[0]));
  const lat1 = toRad(start[1]);
  const lat2 = toRad(end[1]);
  const y = Math.sin(lng2 - lng1) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(lng2 - lng1);

  return normalizeDegrees(toDeg(Math.atan2(y, x)));
};

const getOverviewZoom = (distanceKm: number, mode: TransportMode) => {
  const raw = 7.4 - Math.log(distanceKm + 1) * 0.55;
  const modeBias: Record<TransportMode, number> = {
    bike: 2.1,
    car: 1.45,
    plane: 0.45,
    ship: 0.15,
    train: 1.1,
    high_speed_train: 0.8,
    walk: 2.5,
  };

  return clamp(raw + modeBias[mode], 2.15, 8.7);
};

const easeOutCubic = (value: number) => {
  const clamped = clamp(value, 0, 1);
  return 1 - (1 - clamped) ** 3;
};

const smoothstep = (value: number) => {
  const clamped = clamp(value, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
};

const getCurveDirectionSign = (start: Coordinate, end: Coordinate) => {
  const seed = Math.sin(
    (start[0] * 12.9898 + start[1] * 78.233 + end[0] * 37.719 + end[1] * 45.164) *
    0.05,
  );
  return seed >= 0 ? 1 : -1;
};

const shortestAngleDelta = (start: number, end: number) => {
  let delta = normalizeDegrees(end) - normalizeDegrees(start);
  while (delta > 180) {
    delta -= 360;
  }
  while (delta < -180) {
    delta += 360;
  }
  return delta;
};

const mixAngle = (start: number, end: number, progress: number) => {
  return normalizeDegrees(start + shortestAngleDelta(start, end) * clamp(progress, 0, 1));
};

type TransportMotionStyle = {
  arrivalBlendStart: number;
  curveCap: number;
  curveDistanceKm: number;
  curveMultiplier: number;
  entryProgress: number;
  focusLeadProgress: number;
  headFollowMix: number;
  launchWindow: number;
  lookAheadMix: number;
  midpointPull: number;
  minSamples: number;
  rotationBridgeWindow: number;
  stabilizeMix: number;
  travelEasing: (input: number) => number;
  zoomBridgeWindow: number;
};

const TRANSPORT_MOTION_STYLES: Record<TransportMode, TransportMotionStyle> = {
  bike: {
    arrivalBlendStart: 1,
    curveCap: 0.24,
    curveDistanceKm: 420,
    curveMultiplier: 0.11,
    entryProgress: 0.004,
    focusLeadProgress: 0.12,
    headFollowMix: 0.92,
    launchWindow: 0.04,
    lookAheadMix: 0.32,
    midpointPull: 0.08,
    minSamples: 40,
    rotationBridgeWindow: 0.12,
    stabilizeMix: 0.54,
    travelEasing: Easing.linear,
    zoomBridgeWindow: 0.5,
  },
  car: {
    arrivalBlendStart: 1,
    curveCap: 0.52,
    curveDistanceKm: 900,
    curveMultiplier: 0.16,
    entryProgress: 0.004,
    focusLeadProgress: 0.1,
    headFollowMix: 0.9,
    launchWindow: 0.04,
    lookAheadMix: 0.36,
    midpointPull: 0.1,
    minSamples: 42,
    rotationBridgeWindow: 0.14,
    stabilizeMix: 0.58,
    travelEasing: Easing.linear,
    zoomBridgeWindow: 0.5,
  },
  plane: {
    arrivalBlendStart: 0,
    curveCap: 0,
    curveDistanceKm: 1,
    curveMultiplier: 0,
    entryProgress: 0,
    focusLeadProgress: 0,
    headFollowMix: 0.4,
    launchWindow: 0,
    lookAheadMix: 0.58,
    midpointPull: 1,
    minSamples: 72,
    rotationBridgeWindow: 0,
    stabilizeMix: 0.78,
    travelEasing: Easing.linear,
    zoomBridgeWindow: 0.2,
  },
  ship: {
    arrivalBlendStart: 1,
    curveCap: 1.8,
    curveDistanceKm: 1600,
    curveMultiplier: 0.2,
    entryProgress: 0.003,
    focusLeadProgress: 0.065,
    headFollowMix: 0.82,
    launchWindow: 0.05,
    lookAheadMix: 0.38,
    midpointPull: 0.3,
    minSamples: 64,
    rotationBridgeWindow: 0.18,
    stabilizeMix: 0.62,
    travelEasing: Easing.linear,
    zoomBridgeWindow: 0.55,
  },
  train: {
    arrivalBlendStart: 1,
    curveCap: 0.34,
    curveDistanceKm: 1200,
    curveMultiplier: 0.12,
    entryProgress: 0.003,
    focusLeadProgress: 0.08,
    headFollowMix: 0.88,
    launchWindow: 0.04,
    lookAheadMix: 0.42,
    midpointPull: 0.06,
    minSamples: 46,
    rotationBridgeWindow: 0.18,
    stabilizeMix: 0.7,
    travelEasing: Easing.linear,
    zoomBridgeWindow: 0.55,
  },
  high_speed_train: {
    arrivalBlendStart: 1,
    curveCap: 0.28,
    curveDistanceKm: 1800,
    curveMultiplier: 0.1,
    entryProgress: 0.002,
    focusLeadProgress: 0.12,
    headFollowMix: 0.85,
    launchWindow: 0.03,
    lookAheadMix: 0.48,
    midpointPull: 0.05,
    minSamples: 54,
    rotationBridgeWindow: 0.2,
    stabilizeMix: 0.75,
    travelEasing: Easing.linear,
    zoomBridgeWindow: 0.6,
  },
  walk: {
    arrivalBlendStart: 1,
    curveCap: 0.16,
    curveDistanceKm: 260,
    curveMultiplier: 0.08,
    entryProgress: 0.004,
    focusLeadProgress: 0.14,
    headFollowMix: 0.94,
    launchWindow: 0.04,
    lookAheadMix: 0.28,
    midpointPull: 0.05,
    minSamples: 38,
    rotationBridgeWindow: 0.12,
    stabilizeMix: 0.5,
    travelEasing: Easing.linear,
    zoomBridgeWindow: 0.5,
  },
};

const isMotionDebugEnabled = () => {
  if (typeof window === "undefined") {
    return false;
  }

  const runtimeFlag = (window as typeof window & { __TRAVEL_MOTION_DEBUG__?: boolean })
    .__TRAVEL_MOTION_DEBUG__;

  return runtimeFlag === true || window.location.search.includes("motionDebug=1");
};

const formatCoordinateDebug = (coordinate: Coordinate) => {
  return coordinate.map((value) => Number(value.toFixed(5))).join(", ");
};

const formatMotionDebugRows = (
  title: string,
  rows: Array<Record<string, number | string>>,
) => {
  if (rows.length === 0) {
    return `${title}\n(empty)`;
  }

  const keys = Object.keys(rows[0]);
  const lines = [title, keys.join("\t")];

  for (const row of rows) {
    lines.push(
      keys
        .map((key) => String(row[key] ?? "").replace(/\s+/g, " ").trim())
        .join("\t"),
    );
  }

  return lines.join("\n");
};

const emitMotionDebug = (detail: {
  boundaryText?: string;
  liveText?: string;
  segmentsText?: string;
}) => {
  if (typeof window === "undefined") {
    return;
  }

  const event = new CustomEvent("travel-motion-debug", { detail });
  window.dispatchEvent(event);

  try {
    if (window.top && window.top !== window) {
      window.top.dispatchEvent(new CustomEvent("travel-motion-debug", { detail }));
    }
  } catch {
    // Ignore cross-frame access errors and keep local window dispatch.
  }
};

const resamplePathUniformly = (coordinates: Coordinate[], sampleCount: number): Coordinate[] => {
  if (coordinates.length < 2) return coordinates;
  let totalDistance = 0;
  const cumulativeDistances = [0];
  for (let i = 1; i < coordinates.length; i++) {
    totalDistance += haversineDistanceKm(coordinates[i - 1], coordinates[i]);
    cumulativeDistances.push(totalDistance);
  }
  
  if (totalDistance === 0) return coordinates;

  const resampled: Coordinate[] = [coordinates[0]];
  const step = totalDistance / sampleCount;

  let currentDist = step;
  let index = 1;

  for (let i = 1; i < sampleCount; i++) {
    while (index < cumulativeDistances.length - 1 && cumulativeDistances[index] < currentDist) {
      index++;
    }
    const distPrev = cumulativeDistances[index - 1];
    const distNext = cumulativeDistances[index];
    const segmentLength = distNext - distPrev;
    const progress = segmentLength === 0 ? 0 : (currentDist - distPrev) / segmentLength;
    resampled.push(mixCoordinate(coordinates[index - 1], coordinates[index], progress));
    currentDist += step;
  }
  
  resampled.push(coordinates[coordinates.length - 1]);
  return resampled;
};

const buildBezierPath = (
  start: Coordinate,
  end: Coordinate,
  mode: TransportMode,
  distanceKm: number,
) => {
  const profile = getTransportProfile(mode);
  const endLng = start[0] + shortestLongitudeDelta(start[0], end[0]);
  const motionStyle = TRANSPORT_MOTION_STYLES[mode];

  if (mode === "plane") {
    const coordinates: Coordinate[] = [];

    for (let index = 0; index <= profile.sampleCount; index += 1) {
      const progress = index / profile.sampleCount;
      coordinates.push([
        lerp(start[0], endLng, progress),
        lerp(start[1], end[1], progress),
      ]);
    }

    return coordinates;
  }

  const averageLat = ((start[1] + end[1]) / 2) * (Math.PI / 180);
  const lngScale = Math.max(Math.cos(averageLat), 0.25);
  const deltaLng = (endLng - start[0]) * lngScale;
  const deltaLat = end[1] - start[1];
  const planarDistance = Math.hypot(deltaLng, deltaLat);
  const midpoint: Coordinate = [
    lerp(start[0], endLng, 0.5),
    lerp(start[1], end[1], 0.5),
  ];
  const normalLng = planarDistance > 0.0001 ? -deltaLat / planarDistance / lngScale : 0;
  const normalLat = planarDistance > 0.0001 ? deltaLng / planarDistance : 0;
  const curveScale = clamp(distanceKm / motionStyle.curveDistanceKm, 0.12, 1);
  const curveOffset = Math.min(
    planarDistance * profile.curveStrength * motionStyle.curveMultiplier * curveScale,
    motionStyle.curveCap,
  );
  const curveSign = getCurveDirectionSign(start, end);
  const control: Coordinate = [
    midpoint[0] + normalLng * curveOffset * curveSign,
    midpoint[1] + normalLat * curveOffset * curveSign,
  ];
  const coordinates: Coordinate[] = [];
  const sampleCount = Math.max(profile.sampleCount, motionStyle.minSamples);
  const oversampleCount = sampleCount * 4; // Generate extra points to resample smoothly

  for (let index = 0; index <= oversampleCount; index += 1) {
    const progress = index / oversampleCount;
    const inverse = 1 - progress;
    coordinates.push([
      inverse * inverse * start[0] + 2 * inverse * progress * control[0] + progress * progress * endLng,
      inverse * inverse * start[1] + 2 * inverse * progress * control[1] + progress * progress * end[1],
    ]);
  }

  return resamplePathUniformly(coordinates, sampleCount);
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

const getPathBearing = (path: Coordinate[], progress: number) => {
  if (path.length < 2) {
    return 0;
  }

  const samplingDelta = Math.max(1 / (path.length - 1), 0.016);
  const from = getPathPoint(path, clamp(progress - samplingDelta, 0, 1));
  const to = getPathPoint(path, clamp(progress + samplingDelta, 0, 1));

  if (from[0] === to[0] && from[1] === to[1]) {
    return getBearing(path[path.length - 2] ?? path[0], path[path.length - 1] ?? path[0]);
  }

  return getBearing(from, to);
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

const HEAD_BADGE_RENDER_SIZE: Record<TransportMode, number> = {
  bike: 1.08,
  car: 0.46,
  plane: 1.02,
  ship: 1.12,
  train: 0.34,
  high_speed_train: 0.9,
  walk: 0.9,
};

const HEAD_BADGE_SCALE = createModeExpression((mode) => {
  return HEAD_BADGE_RENDER_SIZE[mode];
});

const PLANE_RENDER_PX = TRANSPORT_SPRITE_SIZE * HEAD_BADGE_RENDER_SIZE.plane * 0.5;
const PLANE_TRAIL_TAIL_OFFSET_PX = (55 / TRANSPORT_SPRITE_SIZE) * PLANE_RENDER_PX;
const PLANE_TRAIL_COLOR = getTransportProfile("plane").activeColor;
const PLANE_TRAIL_WIDTH = getTransportProfile("plane").lineWidth;

const usesAttachedTrail = (mode: TransportMode) => {
  return mode === "plane";
};

const getActiveRouteRevealLead = (mode: TransportMode) => {
  if (mode === "plane") {
    return 0;
  }

  if (mode === "ship") {
    return 0.006;
  }

  return 0;
};

const buildSvgPathData = (points: ScreenPoint[]) => {
  if (points.length === 0) {
    return "";
  }

  const [firstPoint, ...restPoints] = points;
  return [
    `M ${firstPoint.x.toFixed(2)} ${firstPoint.y.toFixed(2)}`,
    ...restPoints.map((point) => `L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`),
  ].join(" ");
};

const getHeadProgress = (progress: number, phase: AnimationPhase) => {
  if (phase === "opening" || phase === "settle") {
    return 0;
  }

  if (phase === "hold" || phase === "end") {
    return 1;
  }

  return clamp(progress, 0, 1);
};

const getHeadCoordinate = (
  segment: JourneySegment,
  progress: number,
  phase: AnimationPhase,
) => {
  const headProgress = getHeadProgress(progress, phase);

  if (headProgress <= 0) {
    return segment.start;
  }

  if (headProgress >= 1) {
    return segment.end;
  }

  return getPathPoint(segment.path, headProgress);
};

const getActiveSegmentCoordinates = (
  segment: JourneySegment,
  progress: number,
  phase: AnimationPhase,
) => {
  const headProgress = getHeadProgress(progress, phase);

  if (phase === "focus" || phase === "travel") {
    return getPartialPath(segment.path, headProgress);
  }

  if (phase === "hold" || phase === "end") {
    return segment.path;
  }

  return [segment.start, segment.start];
};

const getPlaneTrailTailPoint = (
  headPoint: ScreenPoint,
  rotation: number,
): ScreenPoint => {
  const radians = (rotation * Math.PI) / 180;

  return {
    x: headPoint.x - Math.cos(radians) * PLANE_TRAIL_TAIL_OFFSET_PX,
    y: headPoint.y - Math.sin(radians) * PLANE_TRAIL_TAIL_OFFSET_PX,
  };
};

const imageDataToDataUrl = (imageData: ImageData): string => {
  const canvas = document.createElement("canvas");
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const context = canvas.getContext("2d");
  if (!context) { return ""; }
  context.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
};

const staticVehicleSpriteFiles: Partial<Record<TransportMode, string>> = {
  car: "transport/car.svg",
  train: "transport/train.svg",
};

const vehicleSpriteUrlCache: Partial<Record<TransportMode, string>> = {};

const getVehicleSpriteUrl = (mode: TransportMode): string => {
  const cached = vehicleSpriteUrlCache[mode];
  if (cached) { return cached; }

  const staticSpriteFile = staticVehicleSpriteFiles[mode];
  if (staticSpriteFile) {
    const url = staticFile(staticSpriteFile);
    vehicleSpriteUrlCache[mode] = url;
    return url;
  }

  const imageData = createTransportVehicleImage(mode);
  const url = imageDataToDataUrl(imageData);
  vehicleSpriteUrlCache[mode] = url;
  return url;
};

type VehicleOverlayState = {
  mode: TransportMode;
  rotation: number;
  visible: boolean;
  x: number;
  y: number;
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

const getStopLabelText = (stop: ResolvedStop) => {
  const rawTitle = (stop.title || stop.query || "").trim();
  if (!rawTitle) {
    return stop.country || "";
  }

  const removablePrefixes = [stop.country, "中华人民共和国"]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));

  for (const prefix of removablePrefixes) {
    if (rawTitle.startsWith(prefix) && rawTitle.length > prefix.length + 1) {
      return rawTitle.slice(prefix.length).trim();
    }
  }

  return rawTitle;
};

const syncProjectedOverlays = ({
  attachedTrail,
  attachedTrailPathNode,
  mapInstance,
  stopLabelNodes,
  stops,
  vehicleCoordinate,
  vehicleNode,
}: OverlaySyncInput) => {
  for (let index = 0; index < stops.length; index += 1) {
    const labelNode = stopLabelNodes[index];
    const stop = stops[index];
    if (!labelNode || !stop) {
      continue;
    }

    const pos = mapInstance.project(wrapCoordinate(stopToCoordinate(stop)));
    labelNode.style.transform =
      `translate(${pos.x}px, ${pos.y}px) translate(-50%, ${STOP_LABEL_Y_OFFSET_PX}px)`;
    labelNode.style.opacity = "1";
  }

  if (vehicleCoordinate && vehicleNode) {
    const pos = mapInstance.project(wrapCoordinate(vehicleCoordinate.coordinate));
    vehicleNode.style.transform =
      `translate(${pos.x}px, ${pos.y}px) translate(-50%, -50%) rotate(${vehicleCoordinate.rotation}deg)`;
  }

  if (!attachedTrailPathNode) {
    return;
  }

  if (!attachedTrail?.visible || attachedTrail.coordinates.length < 2) {
    attachedTrailPathNode.setAttribute("d", "");
    attachedTrailPathNode.style.opacity = "0";
    return;
  }

  const projectedPoints = attachedTrail.coordinates.map((coordinate) => {
    const point = mapInstance.project(wrapCoordinate(coordinate));
    return { x: point.x, y: point.y };
  });
  const headPoint = mapInstance.project(wrapCoordinate(attachedTrail.headCoordinate));
  const trailPoints = [
    ...projectedPoints.slice(0, -1),
    getPlaneTrailTailPoint(
      { x: headPoint.x, y: headPoint.y },
      attachedTrail.rotation,
    ),
  ];

  attachedTrailPathNode.setAttribute("d", buildSvgPathData(trailPoints));
  attachedTrailPathNode.style.opacity = "1";
};

const buildCompletedRoutes = (
  segments: JourneySegment[],
  currentSegment: number,
  progress: number,
  phase: AnimationPhase,
) => {
  const previousSegment = currentSegment > 0 ? segments[currentSegment - 1] : null;
  const shouldHoldPreviousActive =
    currentSegment > 0 &&
    !usesAttachedTrail(previousSegment?.mode ?? DEFAULT_TRANSPORT_MODE) &&
    (phase === "focus" || phase === "travel") &&
    progress < ROUTE_HANDOFF_PROGRESS;
  const completedSegmentCount = shouldHoldPreviousActive
    ? Math.max(0, currentSegment - 1)
    : currentSegment;

  return {
    type: "FeatureCollection" as const,
    features: segments.slice(0, completedSegmentCount).map((segment) => ({
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
  const rendersActiveRouteInOverlay = usesAttachedTrail(segment.mode);
  const previousSegment = currentSegment > 0 ? segments[currentSegment - 1] : null;
  const routeRevealLead = getActiveRouteRevealLead(segment.mode);
  const routeProgress = isPreviewTravel
    ? clamp(progress + routeRevealLead, 0, 1)
    : progress;
  const shouldHoldPreviousActive =
    currentSegment > 0 &&
    isPreviewTravel &&
    !usesAttachedTrail(previousSegment?.mode ?? DEFAULT_TRANSPORT_MODE) &&
    progress < ROUTE_HANDOFF_PROGRESS;
  const coordinates =
    isPreviewTravel
      ? getPartialPath(segment.path, routeProgress)
      : phase === "hold" || phase === "end"
        ? segment.path
        : [segment.start, segment.start];

  return {
    type: "FeatureCollection" as const,
    features: [
      ...(shouldHoldPreviousActive
        ? [
          {
            type: "Feature" as const,
            properties: {
              mode: segments[currentSegment - 1]?.mode ?? segment.mode,
            },
            geometry: {
              type: "LineString" as const,
              coordinates: segments[currentSegment - 1]?.path ?? [segment.start, segment.start],
            },
          },
        ]
        : []),
      ...(!rendersActiveRouteInOverlay
        ? [
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
        ]
        : []),
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

  const routeProgress =
    getHeadProgress(progress, phase);
  const coordinate = getHeadCoordinate(segment, progress, phase);
  const rotation = getHeadRotation(segments, currentSegment, routeProgress, phase);

  return {
    type: "FeatureCollection" as const,
    features: [
      {
        type: "Feature" as const,
        properties: {
          badge: getTransportBadgeId(segment.mode),
          mode: segment.mode,
          rotation,
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
  segmentIndex: number,
  progress: number,
): Coordinate => {
  const clamped = clamp(progress, 0, 1);
  return getPathPoint(segment.path, clamped);
};

const getTravelEasing = (segment: JourneySegment) => {
  return TRANSPORT_MOTION_STYLES[segment.mode].travelEasing;
};

const getTravelStartProgress = (
  segment: JourneySegment,
  segmentIndex: number,
) => {
  if (segmentIndex > 0) {
    return TRANSPORT_MOTION_STYLES[segment.mode].entryProgress;
  }

  return TRANSPORT_MOTION_STYLES[segment.mode].focusLeadProgress;
};

const getFocusProgressLimits = (
  segment: JourneySegment,
  segmentIndex: number,
) => {
  const focusLeadProgress = getTravelStartProgress(segment, segmentIndex);
  const focusStartProgress =
    segmentIndex === 0 ? 0 : Math.min(focusLeadProgress * 0.22, focusLeadProgress);
  const focusEndProgress =
    segmentIndex === 0
      ? focusLeadProgress
      : Math.min(Math.max(focusLeadProgress, focusStartProgress + 0.06), 0.24);

  return { focusStartProgress, focusEndProgress };
};

const getTravelProgress = (
  frame: number,
  segment: JourneySegment,
  segmentIndex: number,
  _segmentCount: number,
) => {
  const lastTravelFrame = Math.max(segment.travelStart, segment.travelEnd - 1);
  const { focusEndProgress } = getFocusProgressLimits(segment, segmentIndex);

  return interpolate(
    frame,
    [segment.travelStart, lastTravelFrame],
    [focusEndProgress, 1],
    {
      easing: getTravelEasing(segment),
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );
};

const getTravelState = (
  segment: JourneySegment,
  segmentIndex: number,
  _segmentCount: number,
  progress: number,
  previousSegment?: JourneySegment,
): TravelState => {
  const travelStartPitch = segmentIndex === 0 ? segment.profile.travelPitch : 0;
  const motionStyle = TRANSPORT_MOTION_STYLES[segment.mode];
  const travelPitchWave =
    segmentIndex === 0
      ? segment.profile.midPitchWave
      : Math.max(segment.profile.midPitchWave * 0.7, 1.2);
  const baseZoom = clamp(
    lerp(segment.travelStartZoom, segment.arrivalZoom, progress) +
    Math.sin(Math.PI * progress) * segment.profile.midZoomWave,
    2.1,
    11.6,
  );
  const zoomBridge =
    segmentIndex > 0 && previousSegment && motionStyle.zoomBridgeWindow > 0
      ? smoothstep(clamp(progress / motionStyle.zoomBridgeWindow, 0, 1))
      : 1;
  const zoom = previousSegment
    ? lerp(previousSegment.arrivalZoom, baseZoom, zoomBridge)
    : baseZoom;

  return {
    center: getTravelCameraCenter(segment, segmentIndex, progress),
    pitch: Math.max(
      0,
      lerp(travelStartPitch, 0, progress) +
      Math.sin(Math.PI * progress) * travelPitchWave,
    ),
    zoom,
  };
};

const getHeadRotation = (
  segments: JourneySegment[],
  segmentIndex: number,
  progress: number,
  phase: AnimationPhase,
) => {
  const segment = segments[segmentIndex];
  if (!segment) {
    return 0;
  }

  const currentRotation = normalizeDegrees(
    getPathBearing(segment.path, progress) - TRANSPORT_SPRITE_FORWARD_BEARING,
  );
  const previousSegment = segmentIndex > 0 ? segments[segmentIndex - 1] : null;
  const motionStyle = TRANSPORT_MOTION_STYLES[segment.mode];

  if (
    !previousSegment ||
    phase === "opening" ||
    phase === "settle" ||
    phase === "hold" ||
    phase === "end" ||
    motionStyle.rotationBridgeWindow <= 0
  ) {
    return currentRotation;
  }

  const previousRotation = normalizeDegrees(
    getPathBearing(previousSegment.path, 1) - TRANSPORT_SPRITE_FORWARD_BEARING,
  );
  const bridge = smoothstep(clamp(progress / motionStyle.rotationBridgeWindow, 0, 1));

  return mixAngle(previousRotation, currentRotation, bridge);
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
      <div style={{ display: "grid", gap: 18, maxWidth: 860 }}>
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
        firstSegment.profile.focusPitch + 2,
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
      const focusEasing =
        index === 0 ? Easing.bezier(0.22, 0.86, 0.22, 1) : Easing.bezier(0.16, 0.6, 0.2, 1);
      const phase = interpolate(frame, [segment.focusStart, segment.focusEnd], [0, 1], {
        easing: focusEasing,
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
      const { focusStartProgress, focusEndProgress } = getFocusProgressLimits(segment, index);
      const focusTravelStartState = getTravelState(
        segment,
        index,
        segments.length,
        focusStartProgress,
        previousSegment,
      );
      const focusTravelEndState = getTravelState(
        segment,
        index,
        segments.length,
        focusEndProgress,
        previousSegment,
      );

      return {
        center:
          index === 0
            ? mixCoordinate(segment.start, focusTravelEndState.center, phase)
            : mixCoordinate(focusTravelStartState.center, focusTravelEndState.center, phase),
        currentSegment: index,
        phase: "focus",
        pitch:
          index === 0
            ? lerp(focusStartPitch, focusTravelEndState.pitch, phase)
            : lerp(focusTravelStartState.pitch, focusTravelEndState.pitch, phase),
        routeProgress: lerp(focusStartProgress, focusEndProgress, phase),
        zoom:
          index === 0
            ? lerp(focusStartZoom, focusTravelEndState.zoom, phase)
            : lerp(focusTravelStartState.zoom, focusTravelEndState.zoom, phase),
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
        previousSegment,
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
        previousSegment,
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

const getSingleStopView = (stop: ResolvedStop): TravelState => {
  return {
    center: wrapCoordinate(stopToCoordinate(stop)),
    pitch: 0,
    zoom: 8.8,
  };
};

const getPreviewFocusState = (
  stopIndex: number,
  segments: JourneySegment[],
  stops: ResolvedStop[],
): TravelState => {
  const clampedIndex = Math.max(0, Math.min(stopIndex, stops.length - 1));
  const fallbackStop = stops[clampedIndex] ?? stops[0];

  if (!fallbackStop) {
    return fallbackStop ? getSingleStopView(fallbackStop) : { center: [0, 0], pitch: 0, zoom: 2.8 };
  }

  const previousSegment = clampedIndex > 0 ? segments[clampedIndex - 1] : null;
  const nextSegment = segments[clampedIndex] ?? null;
  const zoomCandidates = [
    nextSegment?.travelStartZoom,
    nextSegment?.focusZoom,
    previousSegment
      ? clamp(previousSegment.arrivalZoom + 1.15, previousSegment.arrivalZoom + 0.5, 7.4)
      : null,
    nextSegment?.overviewZoom,
    6.0,
  ].filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const pitchCandidates = [
    nextSegment ? Math.min(Math.max(nextSegment.profile.focusPitch - 1.5, 14), 26) : null,
    previousSegment ? Math.min(Math.max(previousSegment.profile.focusPitch * 0.72, 12), 22) : null,
    16,
  ].filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const zoom = clamp(zoomCandidates[0] ?? 6.0, 5.4, 7.4);
  const pitch = clamp(pitchCandidates[0] ?? 16, 8, 26);

  return {
    center: wrapCoordinate(stopToCoordinate(fallbackStop)),
    pitch,
    zoom,
  };
};

const getDebugHeadState = (
  segments: JourneySegment[],
  state: AnimationState,
) => {
  const segment = segments[state.currentSegment];

  if (!segment) {
    return null;
  }

  const routeProgress =
    getHeadProgress(state.routeProgress, state.phase);
  const coordinate = getHeadCoordinate(segment, state.routeProgress, state.phase);
  const rotation = normalizeDegrees(
    getHeadRotation(
      segments,
      state.currentSegment,
      routeProgress,
      state.phase,
    ),
  );

  return {
    coordinate,
    rotation,
  };
};

const getDebugRouteTipState = (
  segments: JourneySegment[],
  state: AnimationState,
) => {
  const segment = segments[state.currentSegment];

  if (!segment) {
    return null;
  }

  const isPreviewTravel =
    state.phase === "travel" || (state.phase === "focus" && state.routeProgress > 0.0001);
  const routeProgress = isPreviewTravel
    ? clamp(
      state.routeProgress + getActiveRouteRevealLead(segment.mode),
      0,
      1,
    )
    : state.phase === "hold" || state.phase === "end"
      ? 1
      : state.routeProgress;

  return {
    coordinate:
      segment.mode === "plane"
        ? getHeadCoordinate(segment, state.routeProgress, state.phase)
        : state.phase === "opening" || state.phase === "settle"
          ? segment.start
          : state.phase === "hold" || state.phase === "end"
            ? segment.end
            : getPathPoint(segment.path, routeProgress),
  };
};

export const TravelMapJourney = ({
  legModes,
  onFrameSettled,
  previewSceneId,
  resolvedStops,
  showRouteOverlay = true,
  syncMapFrames = false,
  focusStopIndex,
  flyToStopIndex,
}: TravelMapJourneyProps & {
  onFrameSettled?: (frame: number) => void;
  previewSceneId?: string;
}) => {
  const stops = resolvedStops ?? [];
  const normalizedLegModes = useMemo(() => {
    return normalizeLegModes(legModes, stops.length);
  }, [legModes, stops.length]);
  const journeySegments = useMemo(() => {
    return buildJourneyPlan(stops, normalizedLegModes);
  }, [normalizedLegModes, stops]);
  const markers = useMemo(() => buildMarkers(stops), [stops]);
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const ref = useRef<HTMLDivElement>(null);
  const hasConfiguredMap = Boolean(mapboxToken);
  const hasLoadedStyle = useRef(false);
  const didContinueInitialRender = useRef(false);
  const mapRef = useRef<Map | null>(null);
  const motionDebugRowsRef = useRef<Array<Record<string, number | string>>>([]);
  const motionDebugLastCenterRef = useRef<Coordinate | null>(null);
  const motionDebugLastFrameRef = useRef<number>(-1);
  const attachedTrailGeoRef = useRef<AttachedTrailOverlay | null>(null);
  const attachedTrailPathRef = useRef<SVGPathElement>(null);
  const stopLabelRefs = useRef<Array<HTMLDivElement | null>>([]);
  const vehicleDivRef = useRef<HTMLDivElement>(null);
  const vehicleGeoRef = useRef<{ coordinate: Coordinate; rotation: number } | null>(null);
  const [vehicleOverlay, setVehicleOverlay] = useState<{ mode: TransportMode; visible: boolean }>({
    mode: "plane",
    visible: false,
  });

  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const [handle] = useState(() => delayRender("Loading map..."));
  const [map, setMap] = useState<Map | null>(null);
  const introReveal = 1;
  const mapBlur = 0;
  const mapScale = 1;
  const mapOpacity = 1;
  const veilOpacity = 0;

  const mapStyle = useMemo<CSSProperties>(() => {
    return {
      height,
      inset: 0,
      overflow: "hidden",
      position: "absolute",
      width,
    };
  }, [height, width]);

  const routeAnimationState = useMemo(() => {
    return journeySegments.length > 0 ? getAnimationState(frame, journeySegments) : null;
  }, [frame, journeySegments]);

  useEffect(() => {
    if (!isMotionDebugEnabled()) {
      return;
    }

    const rows = journeySegments.map((segment, index) => {
      const previousSegment = journeySegments[index - 1];

      return {
        arrivalZoom: Number(segment.arrivalZoom.toFixed(3)),
        boundaryZoomDelta: previousSegment
          ? Number((segment.travelStartZoom - previousSegment.arrivalZoom).toFixed(3))
          : 0,
        end: segment.end.map((value) => Number(value.toFixed(4))).join(", "),
        mode: segment.mode,
        pathEnd:
          segment.path.at(-1)?.map((value) => Number(value.toFixed(4))).join(", ") ?? "",
        pathMid:
          segment.path[Math.floor(segment.path.length / 2)]
            ?.map((value) => Number(value.toFixed(4)))
            .join(", ") ?? "",
        pathStart: segment.path[0]?.map((value) => Number(value.toFixed(4))).join(", "),
        segment: index,
        start: segment.start.map((value) => Number(value.toFixed(4))).join(", "),
        travelStartZoom: Number(segment.travelStartZoom.toFixed(3)),
      };
    });

    emitMotionDebug({
      segmentsText: formatMotionDebugRows("[travel-motion] segments", rows),
    });
  }, [journeySegments]);

  useEffect(() => {
    if (!isMotionDebugEnabled() || journeySegments.length < 2) {
      return;
    }

    const rows: Array<Record<string, number | string>> = [];

    for (let index = 0; index < journeySegments.length - 1; index += 1) {
      const currentSegment = journeySegments[index];
      const transitionFrame = currentSegment.travelEnd;
      let previousCenter: Coordinate | null = null;

      for (let frameIndex = transitionFrame - 3; frameIndex <= transitionFrame + 3; frameIndex += 1) {
        if (frameIndex < 0) {
          continue;
        }

        const state = getAnimationState(frameIndex, journeySegments);
        const head = getDebugHeadState(journeySegments, state);
        const routeTip = getDebugRouteTipState(journeySegments, state);
        const centerDeltaKm = previousCenter
          ? haversineDistanceKm(previousCenter, state.center)
          : 0;
        const headOffsetKm = head
          ? haversineDistanceKm(state.center, head.coordinate)
          : 0;
        const routeTipOffsetKm =
          head && routeTip
            ? haversineDistanceKm(head.coordinate, routeTip.coordinate)
            : 0;

        rows.push({
          center: formatCoordinateDebug(state.center),
          centerDeltaKm: Number(centerDeltaKm.toFixed(3)),
          frame: frameIndex,
          head: head ? formatCoordinateDebug(head.coordinate) : "",
          headOffsetKm: Number(headOffsetKm.toFixed(3)),
          phase: state.phase,
          pitch: Number(state.pitch.toFixed(3)),
          rotation: head ? Number(head.rotation.toFixed(2)) : "",
          routeTipOffsetKm: Number(routeTipOffsetKm.toFixed(3)),
          routeProgress: Number(state.routeProgress.toFixed(4)),
          segment: state.currentSegment,
          transition: `${index}->${index + 1}`,
          zoom: Number(state.zoom.toFixed(3)),
        });

        previousCenter = state.center;
      }
    }

    emitMotionDebug({
      boundaryText: formatMotionDebugRows("[travel-motion] boundary frames", rows),
    });
  }, [journeySegments]);

  useEffect(() => {
    if (!isMotionDebugEnabled()) {
      return;
    }

    if (!routeAnimationState) {
      motionDebugRowsRef.current = [];
      motionDebugLastCenterRef.current = null;
      motionDebugLastFrameRef.current = -1;
      emitMotionDebug({
        liveText: formatMotionDebugRows("[travel-motion] live frames", []),
      });
      return;
    }

    if (frame <= motionDebugLastFrameRef.current) {
      motionDebugRowsRef.current = [];
      motionDebugLastCenterRef.current = null;
    }

    const head = getDebugHeadState(journeySegments, routeAnimationState);
    const routeTip = getDebugRouteTipState(journeySegments, routeAnimationState);
    const centerDeltaKm = motionDebugLastCenterRef.current
      ? haversineDistanceKm(motionDebugLastCenterRef.current, routeAnimationState.center)
      : 0;
    const headOffsetKm = head
      ? haversineDistanceKm(routeAnimationState.center, head.coordinate)
      : 0;
    const routeTipOffsetKm =
      head && routeTip
        ? haversineDistanceKm(head.coordinate, routeTip.coordinate)
        : 0;
    const segment = journeySegments[routeAnimationState.currentSegment];
    const nextRows = [
      ...motionDebugRowsRef.current.slice(-11),
      {
        center: formatCoordinateDebug(routeAnimationState.center),
        centerDeltaKm: Number(centerDeltaKm.toFixed(3)),
        frame,
        head: head ? formatCoordinateDebug(head.coordinate) : "",
        headOffsetKm: Number(headOffsetKm.toFixed(3)),
        mode: segment?.mode ?? "",
        phase: routeAnimationState.phase,
        pitch: Number(routeAnimationState.pitch.toFixed(3)),
        rotation: head ? Number(head.rotation.toFixed(2)) : "",
        routeTipOffsetKm: Number(routeTipOffsetKm.toFixed(3)),
        routeProgress: Number(routeAnimationState.routeProgress.toFixed(4)),
        segment: routeAnimationState.currentSegment,
        zoom: Number(routeAnimationState.zoom.toFixed(3)),
      },
    ];

    motionDebugRowsRef.current = nextRows;
    motionDebugLastCenterRef.current = routeAnimationState.center;
    motionDebugLastFrameRef.current = frame;

    emitMotionDebug({
      liveText: formatMotionDebugRows("[travel-motion] live frames", nextRows),
    });
  }, [frame, journeySegments, routeAnimationState]);

  useEffect(() => {
    if (!hasConfiguredMap) {
      continueRender(handle);
      return;
    }

    if (!ref.current) {
      cancelRender(new Error("Map container was not mounted."));
      return;
    }

    if (mapRef.current || stops.length === 0) {
      continueRender(handle);
      return;
    }

    const initialView = (() => {
      if (!showRouteOverlay && typeof focusStopIndex === "number" && stops[focusStopIndex]) {
        return getPreviewFocusState(focusStopIndex, journeySegments, stops);
      }
      return journeySegments.length > 0
        ? getAnimationState(0, journeySegments)
        : getSingleStopView(stops[0]);
    })();

    const mapInstance = new Map({
      attributionControl: false,
      bearing: 0,
      center: wrapCoordinate(initialView.center),
      container: ref.current,
      fadeDuration: 0,
      interactive: false,
      maxTileCacheSize: 512,
      minTileCacheSize: 256,
      pitch: initialView.pitch,
      preserveDrawingBuffer: true,
      style: "mapbox://styles/mapbox/standard",
      zoom: initialView.zoom,
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
          mapInstance.addImage(badgeId, createTransportVehicleImage(mode), {
            pixelRatio: 2,
          });
        }
      }

      mapInstance.addSource("completed-routes", {
        type: "geojson",
        data: buildCompletedRoutes([], 0, 0, "opening"),
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
        data: buildActiveRoute([], 0, 0, "opening"),
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

      // Vehicle head is rendered as a React HTML overlay (not a Mapbox
      // symbol layer) to avoid the async symbol-placement lag that causes
      // the vehicle icon to desync from the route line.

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

    });

    mapInstance.on("load", () => {
      mapRef.current = mapInstance;

      const updateMovingOverlays = () => {
        syncProjectedOverlays({
          attachedTrail: attachedTrailGeoRef.current,
          attachedTrailPathNode: attachedTrailPathRef.current,
          mapInstance,
          stopLabelNodes: stopLabelRefs.current,
          stops,
          vehicleCoordinate: vehicleGeoRef.current,
          vehicleNode: vehicleDivRef.current,
        });
      };

      mapInstance.on("move", updateMovingOverlays);
      mapInstance.on("render", updateMovingOverlays);
      mapInstance.on("moveend", updateMovingOverlays);
      setMap(mapInstance);

      if (!showRouteOverlay && typeof flyToStopIndex === "number" && stops[flyToStopIndex]) {
        const targetState = getPreviewFocusState(flyToStopIndex, journeySegments, stops);
        mapInstance.easeTo({
          bearing: 0,
          center: wrapCoordinate(targetState.center),
          duration: 900,
          easing: (value) => 1 - (1 - value) ** 3,
          essential: true,
          pitch: targetState.pitch,
          zoom: targetState.zoom,
        });
      }

      if (!didContinueInitialRender.current) {
        didContinueInitialRender.current = true;
        continueRender(handle);
      }
    });

    mapInstance.on("error", (event) => {
      if (event.error) {
        cancelRender(event.error);
      }
    });
  }, [
    cancelRender,
    continueRender,
    flyToStopIndex,
    focusStopIndex,
    handle,
    hasConfiguredMap,
    journeySegments,
    showRouteOverlay,
    stops,
    stops.length,
  ]);

  useEffect(() => {
    return () => {
      hasLoadedStyle.current = false;
      mapRef.current?.remove();
      mapRef.current = null;
      setMap(null);
    };
  }, []);

  useLayoutEffect(() => {
    if (!map || !hasLoadedStyle.current || stops.length === 0) {
      return;
    }

    const shouldSyncFrame = syncMapFrames;
    const animationHandle = shouldSyncFrame ? delayRender("Animating map...") : null;
    let settled = false;
    let fallbackTimeoutId: number | null = null;
    let observedRender = false;
    const shouldWaitForTiles = shouldSyncFrame || frame === 0;
    const previewFocusState =
      !showRouteOverlay && typeof focusStopIndex === "number" && stops[focusStopIndex]
        ? getPreviewFocusState(focusStopIndex, journeySegments, stops)
        : null;
    const cameraState = previewFocusState ?? routeAnimationState ?? getSingleStopView(stops[0]);

    const finalizeFrame = () => {
      if (settled) {
        return;
      }

      settled = true;
      if (fallbackTimeoutId !== null) {
        window.clearTimeout(fallbackTimeoutId);
        fallbackTimeoutId = null;
      }
      if (animationHandle !== null) {
        continueRender(animationHandle);
      }
      onFrameSettled?.(frame);
    };

    const finalizeAfterPaint = () => {
      window.requestAnimationFrame(() => {
        finalizeFrame();
      });
    };

    const maybeFinalizeSyncedFrame = () => {
      if (settled || !observedRender || !map.loaded()) {
        return;
      }

      if (shouldWaitForTiles && !map.areTilesLoaded()) {
        return;
      }

      finalizeAfterPaint();
    };

    const handleFrameRender = () => {
      observedRender = true;
      maybeFinalizeSyncedFrame();
    };

    map.jumpTo({
      bearing: 0,
      center: wrapCoordinate(cameraState.center),
      pitch: cameraState.pitch,
      zoom: cameraState.zoom,
    });

    const stopsSource = map.getSource("stops") as
      | mapboxgl.GeoJSONSource
      | undefined;
    stopsSource?.setData(markers);

    const completedRoutes = map.getSource("completed-routes") as
      | mapboxgl.GeoJSONSource
      | undefined;
    completedRoutes?.setData(
      showRouteOverlay && routeAnimationState
        ? buildCompletedRoutes(
          journeySegments,
          routeAnimationState.currentSegment,
          routeAnimationState.routeProgress,
          routeAnimationState.phase,
        )
        : buildCompletedRoutes([], 0, 0, "opening"),
    );

    const activeRoute = map.getSource("active-route") as
      | mapboxgl.GeoJSONSource
      | undefined;
    activeRoute?.setData(
      showRouteOverlay && routeAnimationState
        ? buildActiveRoute(
          journeySegments,
          routeAnimationState.currentSegment,
          routeAnimationState.routeProgress,
          routeAnimationState.phase,
        )
        : buildActiveRoute([], 0, 0, "opening"),
    );

    // Position vehicle overlay data, render loop will project screen pos
    if (showRouteOverlay && routeAnimationState) {
      const headGeo = buildHeadPoint(
        journeySegments,
        routeAnimationState.currentSegment,
        routeAnimationState.routeProgress,
        routeAnimationState.phase,
      );
      const headFeature = headGeo.features[0];
      if (headFeature) {
        const coords = headFeature.geometry.coordinates as Coordinate;
        const segment = journeySegments[routeAnimationState.currentSegment];
        const keepVehicleUpright = segment?.mode === "car" || segment?.mode === "train";
        attachedTrailGeoRef.current =
          segment?.mode === "plane"
            ? {
              coordinates: getActiveSegmentCoordinates(
                segment,
                routeAnimationState.routeProgress,
                routeAnimationState.phase,
              ),
              headCoordinate: getHeadCoordinate(
                segment,
                routeAnimationState.routeProgress,
                routeAnimationState.phase,
              ),
              rotation: (headFeature.properties.rotation as number) ?? 0,
              visible:
                routeAnimationState.phase === "travel" ||
                (routeAnimationState.phase === "focus" && routeAnimationState.routeProgress > 0.0001) ||
                routeAnimationState.phase === "hold" ||
                routeAnimationState.phase === "end",
            }
            : null;
        vehicleGeoRef.current = {
          coordinate: coords,
          rotation: keepVehicleUpright ? 0 : ((headFeature.properties.rotation as number) ?? 0),
        };
        setVehicleOverlay((prev) => {
          if (prev.mode !== segment?.mode || !prev.visible) {
             return { mode: segment?.mode ?? "plane", visible: true };
          }
          return prev;
        });
      } else {
        attachedTrailGeoRef.current = null;
        vehicleGeoRef.current = null;
        setVehicleOverlay((prev) => prev.visible ? { ...prev, visible: false } : prev);
      }
    } else {
      attachedTrailGeoRef.current = null;
      vehicleGeoRef.current = null;
      setVehicleOverlay((prev) => prev.visible ? { ...prev, visible: false } : prev);
    }

    syncProjectedOverlays({
      attachedTrail: attachedTrailGeoRef.current,
      attachedTrailPathNode: attachedTrailPathRef.current,
      mapInstance: map,
      stopLabelNodes: stopLabelRefs.current,
      stops,
      vehicleCoordinate: vehicleGeoRef.current,
      vehicleNode: vehicleDivRef.current,
    });

    if (!shouldSyncFrame) {
      map.triggerRepaint();
      window.requestAnimationFrame(() => {
        syncProjectedOverlays({
          attachedTrail: attachedTrailGeoRef.current,
          attachedTrailPathNode: attachedTrailPathRef.current,
          mapInstance: map,
          stopLabelNodes: stopLabelRefs.current,
          stops,
          vehicleCoordinate: vehicleGeoRef.current,
          vehicleNode: vehicleDivRef.current,
        });
      });
      fallbackTimeoutId = window.setTimeout(finalizeFrame, 32);

      return () => {
        if (fallbackTimeoutId !== null) {
          window.clearTimeout(fallbackTimeoutId);
        }
      };
    }

    map.on("render", handleFrameRender);
    map.triggerRepaint();
    window.requestAnimationFrame(() => {
      syncProjectedOverlays({
        attachedTrail: attachedTrailGeoRef.current,
        attachedTrailPathNode: attachedTrailPathRef.current,
        mapInstance: map,
        stopLabelNodes: stopLabelRefs.current,
        stops,
        vehicleCoordinate: vehicleGeoRef.current,
        vehicleNode: vehicleDivRef.current,
      });
    });
    maybeFinalizeSyncedFrame();

    fallbackTimeoutId = window.setTimeout(finalizeFrame, shouldWaitForTiles ? 1200 : 180);

    return () => {
      if (fallbackTimeoutId !== null) {
        window.clearTimeout(fallbackTimeoutId);
      }
      map.off("render", handleFrameRender);
    };
  }, [
    continueRender,
    delayRender,
    frame,
    journeySegments,
    map,
    markers,
    onFrameSettled,
    focusStopIndex,
    showRouteOverlay,
    syncMapFrames,
    stops,
  ]);

  useEffect(() => {
    if (!map || !hasLoadedStyle.current || !previewSceneId || showRouteOverlay || stops.length === 0) {
      return;
    }

    return subscribePreviewFocus((payload) => {
      if (payload.sceneId !== previewSceneId) {
        return;
      }

      const targetState = getPreviewFocusState(
        payload.stopIndex,
        journeySegments,
        stops,
      );

      map.easeTo({
        bearing: 0,
        center: wrapCoordinate(targetState.center),
        duration: 900,
        easing: (value) => 1 - (1 - value) ** 3,
        essential: true,
        pitch: targetState.pitch,
        zoom: targetState.zoom,
      });
    });
  }, [journeySegments, map, previewSceneId, showRouteOverlay, stops]);

  if (!hasConfiguredMap) {
    return <MissingTokenMessage />;
  }

  if (stops.length === 0) {
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

  const vehicleSpriteUrl = useMemo(() => getVehicleSpriteUrl(vehicleOverlay.mode), [vehicleOverlay.mode]);
  const stopLabelTexts = useMemo(() => {
    return stops.map((stop) => getStopLabelText(stop));
  }, [stops]);
  const vehicleRenderPx = TRANSPORT_SPRITE_SIZE * (HEAD_BADGE_RENDER_SIZE[vehicleOverlay.mode] ?? 1) * 0.5;
  const vehicleImageFilter = vehicleOverlay.mode === "car" || vehicleOverlay.mode === "train"
    ? "drop-shadow(0 6px 10px rgba(15, 23, 42, 0.18))"
    : undefined;

  return (
    <AbsoluteFill style={{ backgroundColor: "#cbd5e1" }}>
      <div
        style={{
          ...mapStyle,
          filter: `blur(${mapBlur}px) saturate(${interpolate(introReveal, [0, 1], [0.88, 1])})`,
          opacity: mapOpacity,
          transform: `scale(${mapScale})`,
          transformOrigin: "center center",
        }}
      >
        <div ref={ref} style={mapStyle} />
        <svg
          aria-hidden
          style={{
            height: "100%",
            inset: 0,
            overflow: "visible",
            pointerEvents: "none",
            position: "absolute",
            width: "100%",
            zIndex: 9,
          }}
          viewBox={`0 0 ${width} ${height}`}
        >
          <path
            ref={attachedTrailPathRef}
            d=""
            fill="none"
            stroke={PLANE_TRAIL_COLOR}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={PLANE_TRAIL_WIDTH}
            style={{
              filter: "drop-shadow(0 2px 4px rgba(124, 45, 18, 0.18))",
              opacity: 0,
            }}
          />
        </svg>
        <div
          aria-hidden
          style={{
            inset: 0,
            overflow: "visible",
            pointerEvents: "none",
            position: "absolute",
            zIndex: 8,
          }}
        >
          {stops.map((stop, index) => (
            <div
              key={`${stop.longitude}-${stop.latitude}-${stopLabelTexts[index] ?? index}`}
              ref={(node) => {
                stopLabelRefs.current[index] = node;
              }}
              style={{
                color: "#18202b",
                filter: "drop-shadow(0 2px 4px rgba(248, 244, 236, 0.28))",
                fontFamily: STOP_LABEL_FONT_STACK,
                fontSize: 19,
                fontWeight: 400,
                left: 0,
                letterSpacing: "0.01em",
                lineHeight: 1.12,
                maxWidth: STOP_LABEL_MAX_WIDTH,
                opacity: 0,
                position: "absolute",
                textAlign: "center",
                textWrap: "balance",
                textShadow: "0 1px 0 rgba(248, 244, 236, 0.96), 0 -1px 0 rgba(248, 244, 236, 0.96), 1px 0 0 rgba(248, 244, 236, 0.96), -1px 0 0 rgba(248, 244, 236, 0.96), 1px 1px 0 rgba(248, 244, 236, 0.84), -1px 1px 0 rgba(248, 244, 236, 0.84), 1px -1px 0 rgba(248, 244, 236, 0.84), -1px -1px 0 rgba(248, 244, 236, 0.84), 0 4px 10px rgba(12, 18, 28, 0.08)",
                top: 0,
                transform: "translate(-9999px, -9999px)",
                transformOrigin: "top center",
                whiteSpace: "normal",
                width: "max-content",
                wordBreak: "keep-all",
                zIndex: 8,
              }}
            >
              <span
                style={{
                  position: "relative",
                }}
              >
                {stopLabelTexts[index]}
              </span>
            </div>
          ))}
        </div>
        {vehicleOverlay.visible && vehicleSpriteUrl && (
          <div
            ref={vehicleDivRef}
            style={{
              height: vehicleRenderPx,
              width: vehicleRenderPx,
              opacity: 0.98,
              pointerEvents: "none",
              position: "absolute",
              left: 0,
              top: 0,
              transformOrigin: "center center",
              willChange: "transform",
              zIndex: 10,
            }}
          >
            <Img
              src={vehicleSpriteUrl}
              alt=""
              style={{
                display: "block",
                height: "100%",
                objectFit: "contain",
                filter: vehicleImageFilter,
                width: "100%",
              }}
            />
          </div>
        )}
      </div>
      <AbsoluteFill
        style={{
          background: [
            "radial-gradient(circle at 50% 42%, rgba(180, 225, 255, 0.4) 0%, rgba(180, 225, 255, 0.12) 26%, rgba(6, 11, 20, 0) 56%)",
            "linear-gradient(180deg, rgba(247, 244, 234, 0.82) 0%, rgba(210, 230, 245, 0.24) 42%, rgba(7, 10, 17, 0.18) 100%)",
          ].join(", "),
          opacity: veilOpacity,
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(7, 10, 17, 0.2) 0%, rgba(7, 10, 17, 0) 20%, rgba(7, 10, 17, 0.25) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};
