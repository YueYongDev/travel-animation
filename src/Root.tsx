import type {CalculateMetadataFunction} from "remotion";
import {Composition, Folder} from "remotion";
import {TravelMapJourney} from "./compositions/TravelMapJourney";
import {geocodePlace} from "./lib/geocode";
import {
  normalizeLegModes,
  COMPOSITION_FPS,
  COMPOSITION_HEIGHT,
  COMPOSITION_WIDTH,
  getJourneyDurationInFrames,
} from "./lib/journeyTiming";
import {
  type TravelMapJourneyInput,
  type TravelMapJourneyProps,
  type TravelMapJourneyResolvedProps,
  travelMapJourneySchema,
} from "./lib/routeSchema";

const calculateMetadata: CalculateMetadataFunction<TravelMapJourneyInput> = async ({
  props,
  abortSignal,
}) => {
  const legModes = normalizeLegModes(props.legModes, props.places.length);
  const resolvedStops = await Promise.all(
    props.places.map((place) => geocodePlace(place, abortSignal)),
  );
  const stopCoordinates = resolvedStops.map((stop) => ({
    lat: stop.latitude,
    lon: stop.longitude,
  }));

  return {
    defaultOutName: `${resolvedStops.map((stop) => stop.title.toLowerCase().replace(/\s+/g, "-")).join("-to-")}.mp4`,
    durationInFrames: getJourneyDurationInFrames(
      resolvedStops.length,
      legModes,
      stopCoordinates,
    ),
    props: {
      ...props,
      legModes,
      resolvedStops,
    } satisfies TravelMapJourneyResolvedProps,
  };
};

export const RemotionRoot = () => {
  return (
    <Folder name="Travel">
      <Composition
        id="TravelMapJourney"
        component={TravelMapJourney}
        durationInFrames={300}
        fps={COMPOSITION_FPS}
        width={COMPOSITION_WIDTH}
        height={COMPOSITION_HEIGHT}
        defaultProps={{
          legModes: ["plane"],
          places: ["Los Angeles, California, USA", "New York, New York, USA"],
        } satisfies TravelMapJourneyProps}
        schema={travelMapJourneySchema}
        calculateMetadata={calculateMetadata}
      />
    </Folder>
  );
};
