import { getCachedMapLocation, upsertMapLocationCache } from '../db/database.js';
import {
  addressLooksRegional,
  cleanMapAddress,
  mapAddressCandidates,
  mapLocationFromCoordinates,
  selectBestNominatimLocation,
} from '../utils/mapLocation.js';

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_USER_AGENT =
  process.env.NOMINATIM_USER_AGENT ?? 'Immo-Pilot/1.0 local detail map resolver';
const MISS_CACHE_SOURCE = 'nominatim-v3';

let lastNominatimRequestAt = 0;
let nominatimQueue = Promise.resolve();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function detailAddress(detail, listing) {
  const parts = [detail?.address_line1, detail?.address_line2].map(cleanMapAddress).filter(Boolean);
  if (parts.length > 0) return parts.join(', ');
  return cleanMapAddress(listing?.address);
}

function buildNominatimUrl(query) {
  const url = new URL(NOMINATIM_URL);
  url.search = new URLSearchParams({
    format: 'jsonv2',
    q: query,
    polygon_geojson: addressLooksRegional(query) ? '1' : '0',
    addressdetails: '1',
    limit: '5',
    countrycodes: 'de',
  });
  return url;
}

async function queuedNominatimSearch(query) {
  const run = nominatimQueue.then(async () => {
    const waitMs = 1100 - (Date.now() - lastNominatimRequestAt);
    if (waitMs > 0) await sleep(waitMs);
    lastNominatimRequestAt = Date.now();

    const response = await fetch(buildNominatimUrl(query), {
      headers: {
        'User-Agent': NOMINATIM_USER_AGENT,
        'Accept-Language': 'de-DE,de;q=0.9',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(6000),
    });

    if (!response.ok) throw new Error(`Nominatim failed: HTTP ${response.status}`);
    return response.json();
  });

  nominatimQueue = run.catch(() => {});
  return run;
}

async function resolveAddressLocation(address) {
  for (const query of mapAddressCandidates(address)) {
    const cached = getCachedMapLocation(query);
    if (cached?.status === 'ok') return cached;
    if (cached?.status === 'miss' && (cached.source === MISS_CACHE_SOURCE || addressLooksRegional(query))) {
      continue;
    }

    const rows = await queuedNominatimSearch(query);
    const location = selectBestNominatimLocation(rows, query);
    if (location) {
      upsertMapLocationCache(location);
      return location;
    }

    upsertMapLocationCache({ query, status: 'miss', source: MISS_CACHE_SOURCE });
  }

  return null;
}

export async function resolveListingMapLocation(listing, detail) {
  const address = detailAddress(detail, listing);
  const coordinateLocation = mapLocationFromCoordinates({
    lat: detail?.lat ?? listing?.lat,
    lon: detail?.lon ?? listing?.lon,
    address,
    source: detail?.lat != null && detail?.lon != null ? 'detail' : 'listing',
  });
  if (coordinateLocation?.precision === 'exact') return coordinateLocation;

  if (!address) return coordinateLocation;
  try {
    if (!coordinateLocation || addressLooksRegional(address)) {
      const addressLocation = await resolveAddressLocation(address);
      if (addressLocation) return addressLocation;
    }
    return coordinateLocation ?? (await resolveAddressLocation(address));
  } catch (err) {
    console.warn(`[map] Geocoding failed for "${address}": ${err.message}`);
    return coordinateLocation ?? null;
  }
}
