import {Player, type PlayerRef} from "@remotion/player";
import React, {
  forwardRef,
  useEffect,
  useMemo,
  useState,
  useImperativeHandle,
  useRef,
} from "react";
import {createRoot, type Root} from "react-dom/client";
import {TravelMapJourney} from "./compositions/TravelMapJourney";
import {emitPreviewFocus} from "./lib/previewFocusBus";
import {
  COMPOSITION_FPS,
  COMPOSITION_HEIGHT,
  COMPOSITION_WIDTH,
  type JourneyStopCoordinate,
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
  focusStop: (stopIndex: number) => void;
  getCurrentFrame: () => number;
  pause: () => void;
  play: () => void;
  setPlaybackRate: (rate: number) => void;
  seekTo: (frame: number) => void;
};

type SceneBridgeProps = {
  durationInFrames: number;
  initialPlaybackRate: number;
  inputProps: TravelMapJourneyProps & {
    onFrameSettled?: (frame: number) => void;
    previewSceneId?: string;
  };
};

type ScheduledEvent = {
  callback: () => void;
  frame: number;
  fired: boolean;
  timeoutId: number | null;
};

const SceneBridge = forwardRef<SceneController, SceneBridgeProps>(
  ({durationInFrames, initialPlaybackRate, inputProps}, ref) => {
    const playerRef = useRef<PlayerRef | null>(null);
    const hostRef = useRef<HTMLDivElement | null>(null);
    const [playbackRate, setPlaybackRate] = useState(initialPlaybackRate);
    const [containerSize, setContainerSize] = useState({
      height: COMPOSITION_HEIGHT,
      width: COMPOSITION_WIDTH,
    });

    useEffect(() => {
      const element = hostRef.current;
      if (!element || typeof ResizeObserver === "undefined") {
        return;
      }

      const updateSize = () => {
        setContainerSize({
          height: Math.max(1, element.clientHeight),
          width: Math.max(1, element.clientWidth),
        });
      };

      updateSize();

      const observer = new ResizeObserver(updateSize);
      observer.observe(element);

      return () => observer.disconnect();
    }, []);

    const coverScale = useMemo(() => {
      return Math.max(
        containerSize.width / COMPOSITION_WIDTH,
        containerSize.height / COMPOSITION_HEIGHT,
      );
    }, [containerSize.height, containerSize.width]);

    useImperativeHandle(ref, () => {
      return {
        focusStop: () => undefined,
        getCurrentFrame: () => playerRef.current?.getCurrentFrame() ?? 0,
        pause: () => playerRef.current?.pause(),
        play: () => playerRef.current?.play(),
        setPlaybackRate: (rate: number) => setPlaybackRate(rate),
        seekTo: (frame: number) => playerRef.current?.seekTo(frame),
      };
    }, []);

    return (
      <div ref={hostRef} className="journey-preview-host">
        <div
          style={{
            height: COMPOSITION_HEIGHT,
            left: "50%",
            position: "absolute",
            top: "50%",
            transform: `translate(-50%, -50%) scale(${coverScale})`,
            transformOrigin: "center center",
            width: COMPOSITION_WIDTH,
          }}
        >
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
            playbackRate={playbackRate}
            showVolumeControls={false}
            style={{height: COMPOSITION_HEIGHT, width: COMPOSITION_WIDTH}}
          />
        </div>
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
  showRouteOverlay: boolean,
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
    showRouteOverlay,
  };
};

const buildArrivalEvents = (
  stops: Stop[],
  legModes: readonly TransportMode[],
) => {
  const events: Array<{frame: number; payload: ArrivalPayload}> = [];
  const stopCoordinates: JourneyStopCoordinate[] = stops.map((stop) => ({
    lat: stop.lat,
    lon: stop.lon,
  }));
  const segments = buildJourneySegments(
    stops.length,
    legModes,
    stopCoordinates,
  );

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
  playbackRate = 1,
  {showRouteOverlay = true}: {showRouteOverlay?: boolean} = {},
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
  let currentStops = stops;
  let currentLegModes = normalizeLegModes(legModes, stops.length);
  let currentShowRouteOverlay = showRouteOverlay;
  let currentSyncMapFrames = false;
  let currentStopCoordinates: JourneyStopCoordinate[] = stops.map((stop) => ({
    lat: stop.lat,
    lon: stop.lon,
  }));
  let currentJourneySegments = buildJourneySegments(
    stops.length,
    currentLegModes,
    currentStopCoordinates,
  );
  let currentDurationInFrames = getJourneyDurationInFrames(
    stops.length,
    currentLegModes,
    currentStopCoordinates,
  );
  const previewSceneId = `preview-scene-${Math.random().toString(36).slice(2, 10)}`;
  let renderGeneration = 0;
  let frameWaiters: Array<{
    frame: number;
    generation: number;
    resolve: () => void;
  }> = [];
  const settledFramesByGeneration = new Map<number, Set<number>>();

  const resolveFrameWaiters = (generation: number, frame: number) => {
    const settledFrames = settledFramesByGeneration.get(generation) ?? new Set<number>();
    settledFrames.add(frame);
    settledFramesByGeneration.set(generation, settledFrames);

    frameWaiters = frameWaiters.filter((waiter) => {
      if (waiter.generation !== generation || waiter.frame !== frame) {
        return true;
      }

      waiter.resolve();
      return false;
    });
  };

  const waitForFrameSettled = (frame: number) => {
    const generation = renderGeneration;
    const settledFrames = settledFramesByGeneration.get(generation);
    if (settledFrames?.has(frame)) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      frameWaiters.push({frame, generation, resolve});
    });
  };

  const renderScene = () => {
    renderGeneration += 1;
    const currentGeneration = renderGeneration;

    root.render(
      <SceneBridge
        ref={sceneRef}
        durationInFrames={currentDurationInFrames}
        initialPlaybackRate={playbackRate}
        inputProps={{
          ...toInputProps(
            currentStops,
            currentLegModes,
            currentShowRouteOverlay,
          ),
          syncMapFrames: currentSyncMapFrames,
          onFrameSettled: (frame) => resolveFrameWaiters(currentGeneration, frame),
          previewSceneId,
        }}
      />,
    );
  };

  renderScene();

  let playResolve: (() => void) | null = null;
  let endTimeoutId: number | null = null;
  let scheduledEvents: ScheduledEvent[] = [];
  let isPaused = false;
  let isPlaying = false;
  let latestArrivalHandler: ((payload: ArrivalPayload) => void) | undefined;
  let currentPlaybackRate = playbackRate;
  let focusAnimationFrameId: number | null = null;

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

  const getCurrentFrame = () => {
    return Math.floor(sceneRef.current?.getCurrentFrame() ?? 0);
  };

  const stopFocusAnimation = () => {
    if (focusAnimationFrameId !== null) {
      window.cancelAnimationFrame(focusAnimationFrameId);
      focusAnimationFrameId = null;
    }
  };

  const focusStop = (stopIndex: number) => {
    if (!currentStops.length) {
      return;
    }

    const clampedIndex = Math.max(0, Math.min(stopIndex, currentStops.length - 1));
    pause();
    stopFocusAnimation();
    emitPreviewFocus({
      sceneId: previewSceneId,
      stopIndex: clampedIndex,
    });
  };

  const getDelayFromFrame = (frame: number, fromFrame: number) => {
    const remainingFrames = Math.max(0, frame - fromFrame);
    return (remainingFrames / COMPOSITION_FPS / currentPlaybackRate) * 1000;
  };

  const finishPlayback = () => {
    clearTimers();
    isPaused = false;
    isPlaying = false;
    playResolve?.();
    playResolve = null;
  };

  const scheduleTimeouts = (fromFrame: number) => {
    endTimeoutId = window.setTimeout(
      finishPlayback,
      getDelayFromFrame(currentDurationInFrames, fromFrame),
    );

    for (const event of scheduledEvents) {
      if (event.fired) {
        continue;
      }

      if (event.frame <= fromFrame) {
        event.fired = true;
        event.callback();
        continue;
      }

      event.timeoutId = window.setTimeout(() => {
        event.fired = true;
        event.timeoutId = null;
        event.callback();
      }, getDelayFromFrame(event.frame, fromFrame));
    }
  };

  const resetScheduledEvents = () => {
    scheduledEvents = buildArrivalEvents(currentStops, currentLegModes).map((event) => ({
      callback: () => latestArrivalHandler?.(event.payload),
      frame: event.frame,
      fired: false,
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
    isPlaying = false;
  };

  const resume = () => {
    if (!isPaused) {
      return;
    }

    sceneRef.current?.play();
    isPaused = false;
    isPlaying = true;
    scheduleTimeouts(getCurrentFrame());
  };

  const getCaptureCanvas = () => {
    return getLargestCanvas(mountNode);
  };

  return {
    destroy: () => {
      stopFocusAnimation();
      clearTimers();
      settledFramesByGeneration.clear();
      frameWaiters = [];
      root.unmount();
      mountNode.remove();
    },
    exportFrame: () => {
      return getCaptureCanvas()?.toDataURL("image/png") ?? "";
    },
    pause,
    play: async (onArrival?: (payload: ArrivalPayload) => void) => {
      if (!currentSyncMapFrames) {
        currentSyncMapFrames = true;
        renderScene();
      }
      await waitForFrameSettled(0);
      clearTimers();
      latestArrivalHandler = onArrival;
      resetScheduledEvents();
      sceneRef.current?.seekTo(0);
      sceneRef.current?.play();
      isPaused = false;
      isPlaying = true;
      scheduleTimeouts(0);

      return new Promise<void>((resolve) => {
        playResolve = resolve;
      });
    },
    resetToStart: () => {
      stopFocusAnimation();
      clearTimers();
      isPaused = false;
      isPlaying = false;
      playResolve = null;
      currentSyncMapFrames = false;
      sceneRef.current?.pause();
      sceneRef.current?.seekTo(0);
      window.requestAnimationFrame(() => {
        sceneRef.current?.pause();
        sceneRef.current?.seekTo(0);
      });
    },
    resume,
    setPlaybackRate: (rate: number) => {
      currentPlaybackRate = rate;
      sceneRef.current?.setPlaybackRate(rate);

      if (!isPlaying || isPaused) {
        return;
      }

      clearTimers();
      scheduleTimeouts(getCurrentFrame());
    },
    whenReady: () => waitForFrameSettled(0),
    update: (
      nextStops: Stop[],
      nextLegModes: readonly TransportMode[] = [],
      options: {showRouteOverlay?: boolean} = {},
    ) => {
      stopFocusAnimation();
      clearTimers();
      isPaused = false;
      isPlaying = false;
      playResolve = null;
      currentSyncMapFrames = false;
      currentStops = nextStops;
      currentLegModes = normalizeLegModes(nextLegModes, nextStops.length);
      currentShowRouteOverlay =
        typeof options.showRouteOverlay === "boolean"
          ? options.showRouteOverlay
          : currentShowRouteOverlay;
      currentStopCoordinates = nextStops.map((stop) => ({
        lat: stop.lat,
        lon: stop.lon,
      }));
      currentJourneySegments = buildJourneySegments(
        nextStops.length,
        currentLegModes,
        currentStopCoordinates,
      );
      currentDurationInFrames = getJourneyDurationInFrames(
        nextStops.length,
        currentLegModes,
        currentStopCoordinates,
      );
      renderScene();
    },
    focusStop,
    showsRouteOverlay: () => currentShowRouteOverlay,
    setBasemap: () => "standard",
    viewer: {
      get canvas() {
        return getCaptureCanvas();
      },
    },
  };
};
