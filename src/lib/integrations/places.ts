import { getEnv } from '../env';
import { createLogger } from '../logger';
import { normalizePhone, normalizeUrl } from '../normalize';
import { getIntegrationSecrets, markIntegrationSync, recordIntegrationFailure } from './store';

const log = createLogger('places');

/**
 * Local company discovery via the Google Places API (New).
 *
 * This is the "not every qualified company is hiring" engine: it finds
 * businesses by industry and geography using an official, paid, terms-compliant
 * API rather than scraping map or directory pages.
 */

export type DiscoveredPlace = {
  externalId: string;
  name: string;
  websiteUrl: string | null;
  phone: string | null;
  addressLine: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  primaryType: string | null;
  businessStatus: string | null;
  reviewCount: number | null;
  reviewRating: number | null;
  mapsUri: string | null;
};

type PlacesResponse = {
  places?: Array<{
    id: string;
    displayName?: { text?: string };
    websiteUri?: string;
    nationalPhoneNumber?: string;
    internationalPhoneNumber?: string;
    formattedAddress?: string;
    addressComponents?: Array<{ longText?: string; shortText?: string; types?: string[] }>;
    location?: { latitude?: number; longitude?: number };
    primaryType?: string;
    businessStatus?: string;
    userRatingCount?: number;
    rating?: number;
    googleMapsUri?: string;
  }>;
};

const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.websiteUri',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.formattedAddress',
  'places.addressComponents',
  'places.location',
  'places.primaryType',
  'places.businessStatus',
  'places.userRatingCount',
  'places.rating',
  'places.googleMapsUri',
].join(',');

async function apiKey(): Promise<string | null> {
  const secrets = await getIntegrationSecrets('GOOGLE_PLACES');
  return secrets?.apiKey ?? getEnv().GOOGLE_PLACES_API_KEY ?? null;
}

export async function isPlacesConfigured(): Promise<boolean> {
  return (await apiKey()) !== null;
}

export type PlacesSearchParams = {
  /** e.g. "custom home builder" */
  query: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
  maxResults?: number;
};

export async function searchPlaces(params: PlacesSearchParams): Promise<DiscoveredPlace[]> {
  const key = await apiKey();
  if (!key) {
    log.info('Places API not configured — skipping local discovery');
    return [];
  }

  const body = {
    textQuery: params.query,
    maxResultCount: Math.min(params.maxResults ?? 20, 20),
    languageCode: 'en',
    regionCode: 'CA',
    locationBias: {
      circle: {
        center: { latitude: params.latitude, longitude: params.longitude },
        // The API caps the bias radius at 50km.
        radius: Math.min(params.radiusKm, 50) * 1000,
      },
    },
  };

  try {
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    if (!res.ok) throw new Error(`Places API ${res.status}: ${text.slice(0, 400)}`);
    const json = JSON.parse(text) as PlacesResponse;

    await markIntegrationSync('GOOGLE_PLACES');

    return (json.places ?? []).map((place) => {
      const components = place.addressComponents ?? [];
      const find = (type: string, short = false) => {
        const c = components.find((x) => x.types?.includes(type));
        return (short ? c?.shortText : c?.longText) ?? null;
      };
      return {
        externalId: place.id,
        name: place.displayName?.text ?? 'Unknown business',
        websiteUrl: normalizeUrl(place.websiteUri ?? null),
        phone: normalizePhone(place.internationalPhoneNumber ?? place.nationalPhoneNumber ?? null),
        addressLine: place.formattedAddress ?? null,
        city: find('locality') ?? find('postal_town') ?? null,
        province: find('administrative_area_level_1', true),
        postalCode: find('postal_code'),
        latitude: place.location?.latitude ?? null,
        longitude: place.location?.longitude ?? null,
        primaryType: place.primaryType ?? null,
        businessStatus: place.businessStatus ?? null,
        reviewCount: place.userRatingCount ?? null,
        reviewRating: place.rating ?? null,
        mapsUri: place.googleMapsUri ?? null,
      };
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('places search failed', { query: params.query, message });
    await recordIntegrationFailure('GOOGLE_PLACES', 'search_failed', message);
    return [];
  }
}

export async function testPlacesConnection(): Promise<{ ok: boolean; message: string }> {
  const key = await apiKey();
  if (!key) return { ok: false, message: 'No Places API key configured.' };
  try {
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'places.id,places.displayName',
      },
      body: JSON.stringify({ textQuery: 'plumbing company Toronto', maxResultCount: 1 }),
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, message: `Places API ${res.status}: ${text.slice(0, 300)}` };
    const json = JSON.parse(text) as PlacesResponse;
    return { ok: true, message: `Places API responded with ${json.places?.length ?? 0} result(s).` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
