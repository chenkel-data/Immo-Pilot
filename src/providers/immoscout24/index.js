/*
 * Provider: ImmobilienScout24 (immobilienscout24.de)
 *
 * Accesses the ImmobilienScout24 mobile API.
 * Browser URLs are automatically transformed into API endpoints.
 *
 * Supported property types:
 *   - apartmentrent          → Wohnung mieten
 *   - apartmentbuy           → Wohnung kaufen
 *   - houserent              → Haus mieten
 *   - housebuy               → Haus kaufen
 *   - shorttermaccommodation → Wohnen auf Zeit
 */

import {
  buildHash,
  LISTING_PATTERNS,
  parsePublishedDate,
  pickByPattern,
  sleep,
} from '../../utils.js';

// Set LOG_RAW_VS_PARSED=1 to enable per-listing debug output.
const LOG_RAW_VS_PARSED =
  process.env.LOG_RAW_VS_PARSED === '1' || process.env.LOG_RAW_VS_PARSED === 'true';

// ── Error Class ─────────────────────────────────────────────────────────────

class Is24ProviderError extends Error {
  constructor(message, context = {}) {
    super(message);
    this.name = 'Is24ProviderError';
    this.context = context;
  }
}

// ── Property Types ──────────────────────────────────────────────────────────

const PROPERTY_KINDS = [
  { key: 'apartmentrent', label: 'Wohnung mieten' },
  { key: 'apartmentbuy', label: 'Wohnung kaufen' },
  { key: 'houserent', label: 'Haus mieten' },
  { key: 'housebuy', label: 'Haus kaufen' },
  { key: 'shorttermaccommodation', label: 'Wohnen auf Zeit' },
];

const KNOWN_PROPERTY_KEYS = new Set(PROPERTY_KINDS.map((k) => k.key));

// ── Path Routing ────────────────────────────────────────────────────────────

const PATH_ROUTES = [
  { suffix: 'wohnung-mieten', kind: 'apartmentrent' },
  { suffix: 'wohnung-kaufen', kind: 'apartmentbuy' },
  { suffix: 'haus-mieten', kind: 'houserent' },
  { suffix: 'haus-kaufen', kind: 'housebuy' },
  { suffix: 'wohnen-auf-zeit', kind: 'shorttermaccommodation' },
];

function findRoute(suffix) {
  return PATH_ROUTES.find((r) => r.suffix === suffix) ?? null;
}

// ── Parameter Processing ────────────────────────────────────────────────────

const PASSTHROUGH_KEYS = new Set([
  'price',
  'pricetype',
  'numberofrooms',
  'livingspace',
  'geocoordinates',
  'geocodes',
  'sorting',
  'fulltext',
  'apartmenttypes',
  'floor',
  'newbuilding',
  'equipment',
  'petsallowedtypes',
  'constructionyear',
  'energyefficiencyclasses',
  'exclusioncriteria',
  'heatingtypes',
  'haspromotion',
  'startrentaldate',
]);

// Sort codes: Web UI uses numeric IDs, the API uses named identifiers
const SORT_LABELS = { 1: 'standard', 2: '-firstactivation' };

function resolveSortCode(code) {
  return SORT_LABELS[code] ?? code;
}

// ── URL Conversion ──────────────────────────────────────────────────────────

/**
 * Extracts geo information from the path segments of an IS24 URL.
 * @param {string[]} segments
 * @returns {{ isRadius: boolean, path: string, segments: string[] }}
 */
function extractGeoInfo(segments) {
  const cleaned = segments.filter((s) => s.toLowerCase() !== 'suche');
  const isRadius = cleaned.includes('radius');
  return {
    isRadius,
    path: '/' + cleaned.join('/'),
    segments: cleaned,
  };
}

/**
 * Reads the allowed query parameters from a parsed URL.
 *
 * @param {URLSearchParams} searchParams
 * @returns {object}
 */
function extractParams(searchParams) {
  const params = {};
  for (const [k, v] of searchParams) {
    if (PASSTHROUGH_KEYS.has(k)) params[k] = v;
  }
  return params;
}

/**
 * Parses a web URL into a structured search object.
 * Throws Is24ProviderError for invalid format or unsupported search type.
 *
 * @param {string} webUrl
 * @returns {{ type: string, geo: { isRadius: boolean, path: string, segments: string[] }, params: object }}
 */
function parseSearchFromUrl(webUrl) {
  let parsed;
  try {
    parsed = new URL(webUrl);
  } catch {
    throw new Is24ProviderError(`Ungültige URL: "${webUrl}"`);
  }

  const parts = parsed.pathname.split('/').filter(Boolean);
  const route = findRoute(parts.at(-1));

  if (!route) {
    throw new Is24ProviderError(
      'Spezielle Filter werden nicht unterstützt. ' +
        'Bitte verwende eine Standard-Suche (Wohnung/Haus mieten oder kaufen, Wohnen auf Zeit).',
    );
  }

  return {
    type: route.kind,
    geo: extractGeoInfo(parts.slice(0, -1)),
    params: extractParams(parsed.searchParams),
  };
}

/**
 * Builds the mobile API URL from a search object.
 *
 * @param {{ type: string, geo: object, params: object }} search
 * @returns {string}
 */
function buildApiEndpoint(search) {
  const fields = {
    searchType: search.geo.isRadius ? 'radius' : 'region',
    realestatetype: search.type,
  };

  if (!search.geo.isRadius && search.geo.segments.length > 0) {
    fields.geocodes = search.geo.path;
  }

  const { geocoordinates: rawCoords, ...rest } = search.params;
  for (const [key, val] of Object.entries(rest)) {
    fields[key] = key === 'sorting' ? resolveSortCode(val) : val;
  }

  const pairs = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v == null || v === '') continue;
    const s = Array.isArray(v) ? v.join(',') : String(v);
    pairs.push(`${encodeURIComponent(k)}=${encodeURIComponent(s)}`);
  }
  if (rawCoords) pairs.push(`geocoordinates=${rawCoords}`);

  return `https://api.mobile.immobilienscout24.de/search/list?${pairs.join('&')}`;
}

/**
 * Converts an ImmobilienScout24 web URL into a mobile API URL.
 *
 * @param {string} webUrl
 * @returns {string} Mobile API URL
 */
export function toApiUrl(webUrl) {
  return buildApiEndpoint(parseSearchFromUrl(webUrl));
}

/**
 * Validates an IS24 URL (no return value).
 * Throws Is24ProviderError for invalid or unsupported URLs.
 * Called server-side when saving a configuration.
 */
export function validateUrl(url) {
  toApiUrl(url);
}

// ── API Fetching ───────────────────────────────────────────────────────────────

const REQUEST_HEADERS = {
  'User-Agent': 'ImmoScout_28.3_34.0_._',
  Accept: 'application/json',
};

async function requestPage(baseEndpoint, pageIdx, log = console.log) {
  const endpoint = `${baseEndpoint}&pagenumber=${pageIdx}`;
  log(`[immoscout24] Seite ${pageIdx}: ${endpoint}`);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: REQUEST_HEADERS,
  });

  if (!response.ok) {
    const userMessage =
      response.status >= 400 && response.status < 500
        ? `Diese Such-URL wird nicht unterstützt. Bitte verwende eine Standard-Suche ohne Kartenausschnitt oder spezielle Filter.`
        : `API nicht erreichbar (HTTP ${response.status}). Bitte später erneut versuchen.`;
    throw new Is24ProviderError(userMessage, { page: pageIdx, status: response.status });
  }

  return response.json();
}

export function transformResultItem(raw) {
  if (!raw?.id) return null;

  const attrs = raw.attributes ?? [];
  const attrValues = attrs.map((a) => String(a.value ?? ''));
  const link = `https://www.immobilienscout24.de/expose/${raw.id}`;

  return {
    id: buildHash('immoscout24', String(raw.id)),
    title: raw.title ?? '',
    price: pickByPattern(attrValues, 'price'),
    size: pickByPattern(attrValues, 'size'),
    rooms: pickByPattern(attrValues, 'rooms'),
    availableFrom: pickByPattern(attrValues, 'date'),
    address: raw.address?.line ?? null,
    description: null,
    publisher: raw.isPrivate ? 'Privat' : 'Makler',
    link,
    image: raw.titlePicture?.full ?? raw.titlePicture?.preview ?? null,
    listedAt: parsePublishedDate(raw.published),
    lat: raw.address?.lat ?? null,
    lon: raw.address?.lon ?? null,
  };
}

export function logRawVsParsed(raw, parsed, log = console.log) {
  const attrs = raw.attributes ?? [];
  const sep = '─'.repeat(60);
  const hasWarn = attrs.some((a) => {
    const v = String(a.value ?? '');
    return !Object.values(LISTING_PATTERNS).some((re) => re.test(v));
  });

  log(`[immoscout24] ┌ ${sep}`);
  log(`[immoscout24] │  ${raw.title || '(kein Titel)'}`);
  log(
    `[immoscout24] │  Expose-ID  : ${raw.id}  →  https://www.immobilienscout24.de/expose/${raw.id}`,
  );
  log(`[immoscout24] │  Anbieter   : ${raw.isPrivate ? 'Privat' : 'Makler'}`);
  log(`[immoscout24] │  Adresse    : ${raw.address?.line ?? '–'}`);
  log(`[immoscout24] │  Veröff.    : ${raw.published ?? '–'}`);
  log(`[immoscout24] │  ── Rohe Attribute → Erkennung ──────────────────────────`);
  for (let i = 0; i < attrs.length; i++) {
    const val = String(attrs[i]?.value ?? '');
    const matched = Object.entries(LISTING_PATTERNS)
      .filter(([, re]) => re.test(val))
      .map(([k]) => k);
    const tag = matched.length ? matched.join('/') : '⚠  nicht erkannt';
    log(`[immoscout24] │    attrs[${i}] = "${val}"  →  ${tag}`);
  }
  log(`[immoscout24] │  ── Parsed ───────────────────────────────────────────────`);
  log(`[immoscout24] │    Preis   : ${parsed.price ?? '–'}`);
  log(`[immoscout24] │    Größe   : ${parsed.size ?? '–'}`);
  log(`[immoscout24] │    Zimmer  : ${parsed.rooms ?? (hasWarn ? '– (⚠ fehlend)' : '–')}`);
  log(`[immoscout24] │    Einzug  : ${parsed.availableFrom ?? '–'}`);
  log(`[immoscout24] └ ${sep}`);
}

// Returns both normalized listings and the raw API items for debugging.
function collectListingsFromResponse(payload) {
  const rawItems = (payload.resultListItems ?? [])
    .filter((entry) => entry.type === 'EXPOSE_RESULT')
    .map((entry) => entry.item)
    .filter(Boolean);
  const listings = rawItems
    .map((raw) => {
      const parsed = transformResultItem(raw);
      if (parsed && LOG_RAW_VS_PARSED) logRawVsParsed(raw, parsed);
      return parsed;
    })
    .filter(Boolean);
  return { listings, rawItems };
}

// ── Main Function: scrape() ─────────────────────────────────────────────────

/**
 * Scrapes listings from ImmobilienScout24 via the mobile API.
 *
 * @param {string} inputUrl        – Web URL or mobile API URL
 * @param {number} maxPages        – Maximum number of pages
 * @param {{ signal?: AbortSignal, onProgress?: Function }} opts
 * @returns {Promise<object[]>}    – Normalized listings
 */
export async function scrape(inputUrl, maxPages = 10, opts = {}) {
  const { pages } = await scrapePages(inputUrl, maxPages, opts);
  return pages.flatMap((page) => page.listings);
}

/**
 * Scrapes listings from ImmobilienScout24 via the mobile API and keeps
 * the results grouped by page for debugging and tests.
 *
 * @param {string} inputUrl
 * @param {number} maxPages
 * @param {{ signal?: AbortSignal, onProgress?: Function, log?: Function }} opts
 * @returns {Promise<{ mobileUrl: string, hitCount: number|string, pageCount: number, targetPages: number, pages: Array<{ pageNum: number, listings: object[] }> }>}
 */
export async function scrapePages(inputUrl, maxPages = 10, opts = {}) {
  const { signal, onProgress, log = console.log } = opts;

  // Detect if already an API URL
  const isApiEndpoint = inputUrl.includes('api.mobile.immobilienscout24.de');
  const apiBase = isApiEndpoint ? inputUrl : toApiUrl(inputUrl);

  if (!isApiEndpoint) {
    log(`[immoscout24] Web-URL konvertiert → ${apiBase}`);
  }

  if (signal?.aborted) {
    return {
      mobileUrl: apiBase,
      hitCount: 0,
      pageCount: 0,
      targetPages: 0,
      pages: [],
    };
  }

  // Fetch first page (contains paging metadata)
  const firstPage = await requestPage(apiBase, 1, log);
  const pageCount = firstPage.numberOfPages ?? 1;
  const hitCount = firstPage.totalResults ?? '?';
  const targetPages = Math.min(maxPages, pageCount);
  const pages = [];

  log(`[immoscout24] Treffer: ${hitCount}  |  Seiten: ${pageCount}  |  Abruf: 1–${targetPages}`);
  pages.push({ pageNum: 1, ...collectListingsFromResponse(firstPage) });
  onProgress?.({ pageNum: 1, maxPages: targetPages });

  for (let p = 2; p <= targetPages; p++) {
    if (signal?.aborted) {
      log(`[immoscout24] Abbruch nach Seite ${p - 1}`);
      break;
    }

    await sleep(600 + Math.random() * 600);

    const pageData = await requestPage(apiBase, p, log);
    pages.push({ pageNum: p, ...collectListingsFromResponse(pageData) });
    onProgress?.({ pageNum: p, maxPages: targetPages });
  }

  const results = pages.flatMap((p) => p.listings);
  log(`[immoscout24] ${results.length} Listings über ${pages.length} Seite(n).`);

  return {
    mobileUrl: apiBase,
    hitCount,
    pageCount,
    targetPages,
    pages,
  };
}

// ── Provider Exports ────────────────────────────────────────────────────────

export const id = 'immoscout24';
export const name = 'ImmobilienScout24';
export const listingTypes = PROPERTY_KINDS.map(({ key, label }) => ({ id: key, label }));

/**
 * Infers the property type from an IS24 URL.
 */
export function inferListingTypeFromUrl(url) {
  if (!url.includes('immobilienscout24.de')) return null;

  // Web URL: resolve suffix via routing table
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    const tail = parts[parts.length - 1];
    const route = findRoute(tail);
    if (route) return route.kind;
  } catch {
    /* ignore */
  }

  // Mobile API URL: read realestatetype parameter
  try {
    const parsed = new URL(url);
    const rt = parsed.searchParams.get('realestatetype');
    if (rt && KNOWN_PROPERTY_KEYS.has(rt)) return rt;
  } catch {
    /* ignore */
  }

  return 'apartmentrent';
}
