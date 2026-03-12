import type { TransportMode } from "./routeSchema";

export const COMPOSITION_FPS = 30;
export const COMPOSITION_WIDTH = 1920;
export const COMPOSITION_HEIGHT = 1080;
export const OPENING_HOLD_FRAMES = 2;
export const END_HOLD_FRAMES = 24;
export const DEFAULT_TRANSPORT_MODE: TransportMode = "plane";
const TRAVEL_FRAME_MULTIPLIER = 0.78;
const FIRST_SEGMENT_FOCUS_MULTIPLIER = 0.5;
type Coordinate = [number, number];

export type JourneyStopCoordinate = {
  lat: number;
  lon: number;
};

type TransportProfile = {
  activeColor: string;
  arrivalZoomDelta: number;
  centerPull: number;
  curveStrength: number;
  focusFrames: number;
  focusPitch: number;
  focusZoomBoost: number;
  holdFrames: number;
  lineWidth: number;
  midPitchWave: number;
  midZoomWave: number;
  sampleCount: number;
  travelFrames: number;
  travelLead: number;
  travelPitch: number;
  travelStartZoomDelta: number;
};

export const TRANSPORT_PROFILES: Record<TransportMode, TransportProfile> = {
  bike: {
    activeColor: "#65a30d",
    arrivalZoomDelta: 2.25,
    centerPull: 0.06,
    curveStrength: 0.08,
    focusFrames: 28,
    focusPitch: 10,
    focusZoomBoost: 4.8,
    holdFrames: 10,
    lineWidth: 6,
    midPitchWave: 1.5,
    midZoomWave: 0.18,
    sampleCount: 32,
    travelFrames: 88,
    travelLead: 0.03,
    travelPitch: 5,
    travelStartZoomDelta: 1.75,
  },
  car: {
    activeColor: "#ef4444",
    arrivalZoomDelta: 2.05,
    centerPull: 0.08,
    curveStrength: 0.1,
    focusFrames: 30,
    focusPitch: 12,
    focusZoomBoost: 4.1,
    holdFrames: 10,
    lineWidth: 6.5,
    midPitchWave: 2,
    midZoomWave: 0.14,
    sampleCount: 36,
    travelFrames: 79,
    travelLead: 0.04,
    travelPitch: 5.5,
    travelStartZoomDelta: 1.45,
  },
  plane: {
    activeColor: "#f97316",
    arrivalZoomDelta: 0.7,
    centerPull: 0.28,
    curveStrength: 1,
    focusFrames: 40,
    focusPitch: 30,
    focusZoomBoost: 4.25,
    holdFrames: 8,
    lineWidth: 8,
    midPitchWave: 3.6,
    midZoomWave: -0.6,
    sampleCount: 72,
    travelFrames: 96,
    travelLead: 0.14,
    travelPitch: 9,
    travelStartZoomDelta: 0.2,
  },
  ship: {
    activeColor: "#0f766e",
    arrivalZoomDelta: 0.95,
    centerPull: 0.2,
    curveStrength: 0.55,
    focusFrames: 36,
    focusPitch: 20,
    focusZoomBoost: 3.2,
    holdFrames: 12,
    lineWidth: 7.5,
    midPitchWave: 3,
    midZoomWave: -0.3,
    sampleCount: 64,
    travelFrames: 90,
    travelLead: 0.09,
    travelPitch: 8,
    travelStartZoomDelta: 0.55,
  },
  train: {
    activeColor: "#2563eb",
    arrivalZoomDelta: 1.7,
    centerPull: 0.1,
    curveStrength: 0.14,
    focusFrames: 30,
    focusPitch: 14,
    focusZoomBoost: 3.5,
    holdFrames: 10,
    lineWidth: 6.5,
    midPitchWave: 2.2,
    midZoomWave: 0.08,
    sampleCount: 40,
    travelFrames: 75,
    travelLead: 0.05,
    travelPitch: 6,
    travelStartZoomDelta: 1.2,
  },
  walk: {
    activeColor: "#a16207",
    arrivalZoomDelta: 2.45,
    centerPull: 0.05,
    curveStrength: 0.04,
    focusFrames: 28,
    focusPitch: 8,
    focusZoomBoost: 5.1,
    holdFrames: 12,
    lineWidth: 5.5,
    midPitchWave: 1.2,
    midZoomWave: 0.24,
    sampleCount: 28,
    travelFrames: 98,
    travelLead: 0.02,
    travelPitch: 4,
    travelStartZoomDelta: 2.1,
  },
};

export const SEGMENT_FOCUS_FRAMES = TRANSPORT_PROFILES.plane.focusFrames;
export const SEGMENT_TRAVEL_FRAMES = TRANSPORT_PROFILES.plane.travelFrames;
export const SEGMENT_HOLD_FRAMES = TRANSPORT_PROFILES.plane.holdFrames;

export const normalizeLegModes = (
  legModes: readonly TransportMode[] | undefined,
  stopCount: number,
) => {
  const segmentCount = Math.max(stopCount - 1, 1);
  const normalized: TransportMode[] = [];

  for (let index = 0; index < segmentCount; index += 1) {
    normalized.push(legModes?.[index] ?? DEFAULT_TRANSPORT_MODE);
  }

  return normalized;
};

export const getTransportProfile = (mode: TransportMode) => {
  const profile = TRANSPORT_PROFILES[mode] ?? TRANSPORT_PROFILES[DEFAULT_TRANSPORT_MODE];

  return {
    ...profile,
    travelFrames: Math.max(24, Math.round(profile.travelFrames * TRAVEL_FRAME_MULTIPLIER)),
  };
};

const clamp = (value: number, min: number, max: number) => {
  return Math.min(max, Math.max(min, value));
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

const toCoordinate = (coordinate: JourneyStopCoordinate | undefined): Coordinate | null => {
  if (!coordinate) {
    return null;
  }

  return [coordinate.lon, coordinate.lat];
};

const getCameraSettleFrames = ({
  index,
  legModes,
  stopCoordinates,
}: {
  index: number;
  legModes: readonly TransportMode[];
  stopCoordinates: readonly JourneyStopCoordinate[] | undefined;
}) => {
  void index;
  void legModes;
  void stopCoordinates;

  return 0;
};

export const buildJourneySegments = (
  stopCount: number,
  legModes?: readonly TransportMode[],
  stopCoordinates?: readonly JourneyStopCoordinate[],
) => {
  const modes = normalizeLegModes(legModes, stopCount);
  const segments = [];
  let cursor = OPENING_HOLD_FRAMES;

  for (let index = 0; index < modes.length; index += 1) {
    const mode = modes[index];
    const profile = getTransportProfile(mode);
    const WAYPOINT_TRANSITION_FRAMES = 0;
    const focusFrames =
      index === 0
        ? Math.max(4, Math.round(profile.focusFrames * FIRST_SEGMENT_FOCUS_MULTIPLIER))
        : WAYPOINT_TRANSITION_FRAMES;
    const settleFrames = getCameraSettleFrames({
      index,
      legModes: modes,
      stopCoordinates,
    });
    const holdFrames = index === modes.length - 1 ? profile.holdFrames : 0;
    const focusStart = cursor;
    const focusEnd = focusStart + focusFrames;
    const travelStart = focusEnd + settleFrames;
    const travelEnd = travelStart + profile.travelFrames;
    const holdEnd = travelEnd + holdFrames;

    segments.push({
      focusEnd,
      focusStart,
      holdEnd,
      mode,
      profile,
      settleFrames,
      travelEnd,
      travelStart,
    });

    cursor = holdEnd;
  }

  return segments;
};

export const getJourneyDurationInFrames = (
  stopCount: number,
  legModes?: readonly TransportMode[],
  stopCoordinates?: readonly JourneyStopCoordinate[],
) => {
  const segments = buildJourneySegments(stopCount, legModes, stopCoordinates);
  const lastHoldEnd = segments.at(-1)?.holdEnd ?? OPENING_HOLD_FRAMES;

  return lastHoldEnd + END_HOLD_FRAMES;
};
