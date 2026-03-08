import {z} from "zod";

export const travelMapJourneySchema = z.object({
  places: z
    .array(z.string().trim().min(1, "Place is required"))
    .min(2, "Add at least two places")
    .max(8, "A maximum of eight places is supported"),
});

export type TravelMapJourneyInput = z.infer<typeof travelMapJourneySchema>;

export type ResolvedStop = {
  country: string;
  latitude: number;
  longitude: number;
  query: string;
  title: string;
};

export type TravelMapJourneyResolvedProps = TravelMapJourneyInput & {
  resolvedStops: ResolvedStop[];
};

export type TravelMapJourneyProps = TravelMapJourneyInput & {
  resolvedStops?: ResolvedStop[];
};
