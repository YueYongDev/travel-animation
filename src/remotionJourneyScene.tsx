import {Player, type PlayerRef} from "@remotion/player";
import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
} from "react";
import {createRoot, type Root} from "react-dom/client";
import {TravelMapJourney} from "./compositions/TravelMapJourney";
import {
  COMPOSITION_FPS,
  COMPOSITION_HEIGHT,
  COMPOSITION_WIDTH,
  buildJourneySegments,
  getJourneyDurationInFrames,
  normalizeLegModes,
} from "./lib/journeyTiming";
import type {TransportMode, TravelMapJourneyProps} from "./lib/routeSchema";

type Stop = {
  city: string;
  country: string;
  lat: number;
  lon: number;
};

type ArrivalPayload = {
  km: number;
  stop: Stop;
};

type SceneController = {
  pause: () => void;
  play: () => void;
  seekTo: (frame: number) => void;
};

type SceneBridgeProps = {
  durationInFrames: number;
  inputProps: TravelMapJourneyProps;
};

type ScheduledEvent = {
  callback: () => void;
  delayMs: number;
  fired: boolean;
  startedAt: number;
  timeoutId: number | null;
};

const SceneBridge = forwardRef<SceneController, SceneBridgeProps>(
  ({durationInFrames, inputProps}, ref) => {
    const playerRef = useRef<PlayerRef | null>(null);

    useImperativeHandle(ref, () => {
      return {
        pause: () => playerRef.current?.pause(),
        play: () => playerRef.current?.play(),
        seekTo: (frame: number) => playerRef.current?.seekTo(frame),
      };
    }, []);

    return (
      <div className="journey-preview-host">
        <Player
          ref={playerRef}
          component={TravelMapJourney}
          compositionHeight={COMPOSITION_HEIGHT}
          compositionWidth={COMPOSITION_WIDTH}
          controls={false}
          durationInFrames={durationInFrames}
          fps={COMPOSITION_FPS}
          inputProps={inputProps}
          loop={false}
          moveToBeginningWhenEnded
          showVolumeControls={false}
          style={{height: "100%", width: "100%"}}
        />
      </div>
    );
  },
);

SceneBridge.displayName = "SceneBridge";

const getSegmentKm = (from: Stop, to: Stop) => {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const radiusKm = 6371;
  const deltaLat = toRad(to.lat - from.lat);
  const deltaLon = toRad(to.lon - from.lon);
  const startLat = toRad(from.lat);
  const endLat = toRad(to.lat);
  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(startLat) *
      Math.cos(endLat) *
      Math.sin(deltaLon / 2) *
      Math.sin(deltaLon / 2);

  return 2 * radiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const toInputProps = (
  stops: Stop[],
  legModes: readonly TransportMode[],
): TravelMapJourneyProps => {
  return {
    legModes: [...legModes],
    places: stops.map((stop) => `${stop.city}, ${stop.country}`),
    resolvedStops: stops.map((stop) => ({
      country: stop.country,
      latitude: stop.lat,
      longitude: stop.lon,
      query: `${stop.city}, ${stop.country}`,
      title: stop.city,
    })),
  };
};

const buildArrivalEvents = (
  stops: Stop[],
  legModes: readonly TransportMode[],
) => {
  const events: Array<{frame: number; payload: ArrivalPayload}> = [];
  const segments = buildJourneySegments(stops.length, legModes);

  for (let index = 0; index < stops.length - 1; index += 1) {
    const arrivalFrame = segments[index].travelEnd - 1;
    events.push({
      frame: arrivalFrame,
      payload: {
        km: getSegmentKm(stops[index], stops[index + 1]),
        stop: stops[index + 1],
      },
    });
  }

  return events;
};

const getLargestCanvas = (element: HTMLElement | null) => {
  if (!element) {
    return null;
  }

  return Array.from(element.querySelectorAll("canvas")).sort((left, right) => {
    return right.clientWidth * right.clientHeight - left.clientWidth * left.clientHeight;
  })[0] ?? null;
};

export const createRemotionJourneyScene = async (
  containerId: string,
  stops: Stop[],
  legModes: readonly TransportMode[] = [],
) => {
  const container = document.getElementById(containerId);

  if (!container) {
    throw new Error(`Missing container #${containerId}`);
  }

  const mountNode = document.createElement("div");
  mountNode.className = "journey-preview-mount";
  const arrivalCard = container.querySelector("#arrivalCard");
  if (arrivalCard) {
    container.insertBefore(mountNode, arrivalCard);
  } else {
    container.appendChild(mountNode);
  }

  const root: Root = createRoot(mountNode);
  const sceneRef = React.createRef<SceneController>();
  const normalizedLegModes = normalizeLegModes(legModes, stops.length);
  const inputProps = toInputProps(stops, normalizedLegModes);
  const durationInFrames = getJourneyDurationInFrames(
    stops.length,
    normalizedLegModes,
  );

  root.render(
    <SceneBridge
      ref={sceneRef}
      durationInFrames={durationInFrames}
      inputProps={inputProps}
    />,
  );

  let playResolve: (() => void) | null = null;
  let endTimeoutId: number | null = null;
  let scheduledEvents: ScheduledEvent[] = [];
  let remainingPlaybackMs = (durationInFrames / COMPOSITION_FPS) * 1000;
  let playStartedAt = 0;
  let isPaused = false;
  let latestArrivalHandler: ((payload: ArrivalPayload) => void) | undefined;

  const clearTimers = () => {
    if (endTimeoutId !== null) {
      window.clearTimeout(endTimeoutId);
      endTimeoutId = null;
    }

    for (const event of scheduledEvents) {
      if (event.timeoutId !== null) {
        window.clearTimeout(event.timeoutId);
        event.timeoutId = null;
      }
    }
  };

  const finishPlayback = () => {
    clearTimers();
    remainingPlaybackMs = (durationInFrames / COMPOSITION_FPS) * 1000;
    isPaused = false;
    playResolve?.();
    playResolve = null;
  };

  const scheduleTimeouts = () => {
    playStartedAt = performance.now();
    endTimeoutId = window.setTimeout(finishPlayback, remainingPlaybackMs);

    for (const event of scheduledEvents) {
      if (event.fired) {
        continue;
      }

      event.startedAt = performance.now();
      event.timeoutId = window.setTimeout(() => {
        event.fired = true;
        event.timeoutId = null;
        event.callback();
      }, event.delayMs);
    }
  };

  const resetScheduledEvents = () => {
    scheduledEvents = buildArrivalEvents(stops, normalizedLegModes).map((event) => ({
      callback: () => latestArrivalHandler?.(event.payload),
      delayMs: (event.frame / COMPOSITION_FPS) * 1000,
      fired: false,
      startedAt: 0,
      timeoutId: null,
    }));
  };

  const pause = () => {
    if (isPaused) {
      return;
    }

    sceneRef.current?.pause();
    clearTimers();
    isPaused = true;

    if (playStartedAt > 0) {
      remainingPlaybackMs = Math.max(
        0,
        remainingPlaybackMs - (performance.now() - playStartedAt),
      );
    }

    for (const event of scheduledEvents) {
      if (event.fired || event.startedAt === 0) {
        continue;
      }

      event.delayMs = Math.max(
        0,
        event.delayMs - (performance.now() - event.startedAt),
      );
    }
  };

  const resume = () => {
    if (!isPaused) {
      return;
    }

    sceneRef.current?.play();
    isPaused = false;
    scheduleTimeouts();
  };

  const getCaptureCanvas = () => {
    return getLargestCanvas(mountNode);
  };

  return {
    destroy: () => {
      clearTimers();
      root.unmount();
      mountNode.remove();
    },
    exportFrame: () => {
      return getCaptureCanvas()?.toDataURL("image/png") ?? "";
    },
    pause,
    play: (onArrival?: (payload: ArrivalPayload) => void) => {
      clearTimers();
      remainingPlaybackMs = (durationInFrames / COMPOSITION_FPS) * 1000;
      latestArrivalHandler = onArrival;
      resetScheduledEvents();
      sceneRef.current?.seekTo(0);
      sceneRef.current?.play();
      isPaused = false;
      scheduleTimeouts();

      return new Promise<void>((resolve) => {
        playResolve = resolve;
      });
    },
    resume,
    setBasemap: () => "standard",
    viewer: {
      get canvas() {
        return getCaptureCanvas();
      },
    },
  };
};
