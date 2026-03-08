export const COMPOSITION_FPS = 30;
export const COMPOSITION_WIDTH = 1920;
export const COMPOSITION_HEIGHT = 1080;
export const OPENING_HOLD_FRAMES = 18;
export const SEGMENT_FOCUS_FRAMES = 54;
export const SEGMENT_TRAVEL_FRAMES = 96;
export const SEGMENT_HOLD_FRAMES = 15;
export const END_HOLD_FRAMES = 24;

export const getJourneyDurationInFrames = (stopCount: number) => {
  const segmentCount = Math.max(stopCount - 1, 1);

  return (
    OPENING_HOLD_FRAMES +
    segmentCount *
      (SEGMENT_FOCUS_FRAMES + SEGMENT_TRAVEL_FRAMES + SEGMENT_HOLD_FRAMES) +
    END_HOLD_FRAMES
  );
};
