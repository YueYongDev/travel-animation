import type {ResolvedStop} from "./routeSchema";

const sanitizeCountry = (value: string | undefined) => {
  return value ? value.toUpperCase() : "-";
};

const pickTitle = (query: string, payload: NominatimResult) => {
  const address = payload.address ?? {};

  return (
    address.city ??
    address.town ??
    address.village ??
    address.municipality ??
    address.county ??
    address.state ??
    query.split(",")[0]?.trim() ??
    query
  );
};

type NominatimResult = {
  address?: {
    city?: string;
    country?: string;
    county?: string;
    municipality?: string;
    state?: string;
    town?: string;
    village?: string;
  };
  display_name?: string;
  lat: string;
  lon: string;
};

export const geocodePlace = async (
  query: string,
  signal?: AbortSignal,
): Promise<ResolvedStop> => {
  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&q=${encodeURIComponent(query)}`,
    {
      headers: {
        Accept: "application/json",
      },
      signal,
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to geocode "${query}"`);
  }

  const payload = (await response.json()) as NominatimResult[];
  const first = payload[0];

  if (!first) {
    throw new Error(`Could not resolve "${query}"`);
  }

  const longitude = Number(first.lon);
  const latitude = Number(first.lat);

  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    throw new Error(`Invalid coordinates returned for "${query}"`);
  }

  return {
    country: sanitizeCountry(
      first.address?.country ?? first.display_name?.split(",").at(-1)?.trim(),
    ),
    latitude,
    longitude,
    query,
    title: pickTitle(query, first),
  };
};
