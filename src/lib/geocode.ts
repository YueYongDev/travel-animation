import type {ResolvedStop} from "./routeSchema";

declare const __MAPBOX_ACCESS_TOKEN__: string;

export type PlaceSuggestion = {
  label: string;
};

type MapboxContextEntry = {
  name?: string;
  country_code?: string;
};

type MapboxFeatureProperties = {
  context?: {
    country?: MapboxContextEntry;
    place?: MapboxContextEntry;
    region?: MapboxContextEntry;
  };
  full_address?: string;
  name?: string;
  name_preferred?: string;
};

type MapboxFeature = {
  geometry?: {
    coordinates?: [number, number];
  };
  properties?: MapboxFeatureProperties;
};

type MapboxGeocodeResponse = {
  features?: MapboxFeature[];
};

type MapboxSuggestItem = {
  full_address?: string;
  name?: string;
  name_preferred?: string;
  place_formatted?: string;
};

type MapboxSuggestResponse = {
  suggestions?: MapboxSuggestItem[];
};

const buildRuntimeToken = () => {
  const buildTimeToken =
    typeof __MAPBOX_ACCESS_TOKEN__ === "string"
      ? __MAPBOX_ACCESS_TOKEN__.trim()
      : "";

  if (buildTimeToken) return buildTimeToken;

  const runtimeToken =
    typeof process !== "undefined" &&
    typeof process.env?.REMOTION_MAPBOX_TOKEN === "string"
      ? process.env.REMOTION_MAPBOX_TOKEN.trim()
      : "";

  return runtimeToken;
};

const mapboxAccessToken = buildRuntimeToken();
const SEARCH_BOX_TYPES = "city,place,locality,region,country";
const GEOCODE_TYPES = "place,locality,region,country";

const normalizeCountry = (value?: string) => {
  return value ? value.toUpperCase() : "-";
};

const getCityFromQuery = (query: string) => {
  return query.split(",")[0]?.trim() || query.trim();
};

const getFeatureTitle = (feature: MapboxFeature, query: string) => {
  return (
    feature.properties?.context?.place?.name ||
    feature.properties?.name_preferred ||
    feature.properties?.name ||
    getCityFromQuery(query)
  );
};

const getFeatureCountry = (feature: MapboxFeature) => {
  return normalizeCountry(feature.properties?.context?.country?.name);
};

const getFeatureCountryCode = (feature: MapboxFeature) => {
  return feature.properties?.context?.country?.country_code?.toUpperCase() || "";
};

const getSuggestionLabel = (item: MapboxSuggestItem) => {
  return (
    item.full_address ||
    item.place_formatted ||
    item.name_preferred ||
    item.name ||
    ""
  ).trim();
};

const createMapboxUrl = (pathname: string) => {
  const url = new URL(pathname, "https://api.mapbox.com");
  url.searchParams.set("access_token", mapboxAccessToken);
  return url;
};

export const hasPlaceSearchProvider = () => {
  return Boolean(mapboxAccessToken);
};

export const createPlaceSearchSessionToken = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `search-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

export const fetchPlaceSuggestions = async (
  query: string,
  {
    signal,
    sessionToken,
    limit = 6,
  }: {
    signal?: AbortSignal;
    sessionToken?: string;
    limit?: number;
  } = {},
): Promise<PlaceSuggestion[]> => {
  const normalized = query.trim();
  if (!normalized) return [];
  if (!mapboxAccessToken) {
    throw new Error("缺少 Mapbox 搜索 Token。请配置 VITE_MAPBOX_ACCESS_TOKEN。");
  }

  const url = createMapboxUrl("/search/searchbox/v1/suggest");
  url.searchParams.set("q", normalized);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("language", "zh,en");
  url.searchParams.set("types", SEARCH_BOX_TYPES);
  url.searchParams.set(
    "session_token",
    sessionToken || createPlaceSearchSessionToken(),
  );

  const response = await fetch(url, {signal});
  if (!response.ok) {
    throw new Error("地点联想服务暂时不可用，请稍后重试。");
  }

  const payload = (await response.json()) as MapboxSuggestResponse;
  const items = Array.isArray(payload.suggestions) ? payload.suggestions : [];

  return items
    .map((item) => ({label: getSuggestionLabel(item)}))
    .filter((item) => item.label);
};

export const geocodePlace = async (
  query: string,
  signal?: AbortSignal,
): Promise<ResolvedStop> => {
  const normalized = query.trim();
  if (!normalized) {
    throw new Error("Place is required");
  }
  if (!mapboxAccessToken) {
    throw new Error("缺少 Mapbox 搜索 Token。请配置 VITE_MAPBOX_ACCESS_TOKEN。");
  }

  const url = createMapboxUrl("/search/geocode/v6/forward");
  url.searchParams.set("q", normalized);
  url.searchParams.set("limit", "1");
  url.searchParams.set("language", "zh,en");
  url.searchParams.set("autocomplete", "false");
  url.searchParams.set("types", GEOCODE_TYPES);

  const response = await fetch(url, {signal});
  if (!response.ok) {
    throw new Error(`Failed to geocode "${query}"`);
  }

  const payload = (await response.json()) as MapboxGeocodeResponse;
  const first = Array.isArray(payload.features) ? payload.features[0] : null;

  if (!first) {
    throw new Error(`Could not resolve "${query}"`);
  }

  const longitude = Number(first.geometry?.coordinates?.[0]);
  const latitude = Number(first.geometry?.coordinates?.[1]);

  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    throw new Error(`Invalid coordinates returned for "${query}"`);
  }

  return {
    country: getFeatureCountry(first),
    countryCode: getFeatureCountryCode(first),
    latitude,
    longitude,
    query,
    title: getFeatureTitle(first, normalized),
  };
};
