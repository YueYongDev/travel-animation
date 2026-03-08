import type {TransportMode} from "./routeSchema";

export const COMPOSITION_FPS = 30;
export const COMPOSITION_WIDTH = 1920;
export const COMPOSITION_HEIGHT = 1080;
export const OPENING_HOLD_FRAMES = 18;
export const END_HOLD_FRAMES = 24;
export const DEFAULT_TRANSPORT_MODE: TransportMode = "plane";

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
    travelFrames: 96,
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
    travelFrames: 86,
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
    midPitchWave: 4.5,
    midZoomWave: -0.6,
    sampleCount: 72,
    travelFrames: 104,
    travelLead: 0.14,
    travelPitch: 12,
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
    travelFrames: 96,
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
    travelFrames: 82,
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
    travelFrames: 108,
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
  return TRANSPORT_PROFILES[mode] ?? TRANSPORT_PROFILES[DEFAULT_TRANSPORT_MODE];
};

export const buildJourneySegments = (
  stopCount: number,
  legModes?: readonly TransportMode[],
) => {
  const modes = normalizeLegModes(legModes, stopCount);
  const segments = [];
  let cursor = OPENING_HOLD_FRAMES;

  for (let index = 0; index < modes.length; index += 1) {
    const mode = modes[index];
    const profile = getTransportProfile(mode);
    const focusFrames = index === 0 ? profile.focusFrames : 0;
    const holdFrames = index === modes.length - 1 ? profile.holdFrames : 0;
    const focusStart = cursor;
    const focusEnd = focusStart + focusFrames;
    const travelStart = focusEnd;
    const travelEnd = travelStart + profile.travelFrames;
    const holdEnd = travelEnd + holdFrames;

    segments.push({
      focusEnd,
      focusStart,
      holdEnd,
      mode,
      profile,
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
) => {
  const segments = buildJourneySegments(stopCount, legModes);
  const lastHoldEnd = segments.at(-1)?.holdEnd ?? OPENING_HOLD_FRAMES;

  return lastHoldEnd + END_HOLD_FRAMES;
};
