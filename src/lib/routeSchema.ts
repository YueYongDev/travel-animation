import {z} from "zod";

export const transportModes = [
  "plane",
  "high_speed_train",
  "train",
  "car",
  "ship",
  "bike",
  "walk",
] as const;

export type TransportMode = (typeof transportModes)[number];

export const travelMapJourneySchema = z.object({
  legModes: z.array(z.enum(transportModes)).optional(),
  places: z
    .array(z.string().trim().min(1, "Place is required"))
    .min(2, "Add at least two places")
    .max(15, "A maximum of fifteen places is supported"),
});

export type TravelMapJourneyInput = z.infer<typeof travelMapJourneySchema>;

export type ResolvedStop = {
  country: string;
  countryCode?: string;
  latitude: number;
  longitude: number;
  query: string;
  title: string;
};

export type TravelMapJourneyResolvedProps = TravelMapJourneyInput & {
  legModes: TransportMode[];
  resolvedStops: ResolvedStop[];
};

export type TravelMapJourneyProps = TravelMapJourneyInput & {
  legModes?: TransportMode[];
  resolvedStops?: ResolvedStop[];
  showRouteOverlay?: boolean;
  syncMapFrames?: boolean;
  focusStopIndex?: number | null;
  flyToStopIndex?: number | null;
};
