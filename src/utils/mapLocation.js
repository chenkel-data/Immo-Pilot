const HIDDEN_ADDRESS_PATTERNS = [
  /die vollst(?:ä|ae)ndige adresse der immobilie erh(?:ä|ae)ltst du vom anbieter\.?/gi,
  /die genaue adresse (?:der immobilie )?erh(?:ä|ae)ltst du vom anbieter\.?/gi,
  /\((?:unvollst(?:ä|ae)ndige adresse|adresse nicht vollständig)\)/gi,
];

const DISTANCE_PATTERN = /\(\s*\d+(?:[,.]\d+)?\s*km\s*\)/gi;
const POSTCODE_PATTERN = /\b\d{5}\b/;
const LETTER_PATTERN = /[A-Za-zÄÖÜäöüß]/;
const HOUSE_NUMBER_PATTERN = /(?:^|[\s/-])[1-9]\d{0,4}[a-z]?\b/i;
const HOUSE_NUMBER_TOKEN_PATTERN = /^[1-9]\d{0,4}[a-z]?$/i;

const REGIONAL_TYPES = new Set([
  'postcode',
  'postal_code',
  'city_district',
  'district',
  'suburb',
  'neighbourhood',
  'neighborhood',
  'quarter',
  'borough',
]);

const CITY_TYPES = new Set(['city', 'town', 'village', 'municipality']);
const EXACT_TYPES = new Set(['house', 'building', 'residential', 'apartments']);
const STREET_TYPES = new Set(['road', 'street']);
const ROAD_ADDRESS_KEYS = ['road', 'pedestrian', 'footway', 'path', 'cycleway'];
const COMPONENT_STOPWORDS = new Set(['am', 'an', 'der', 'die', 'das', 'den', 'dem', 'des', 'im', 'in']);

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function cleanMapAddress(value) {
  let text = String(value ?? '');
  for (const pattern of HIDDEN_ADDRESS_PATTERNS) text = text.replace(pattern, ' ');
  return text
    .replace(DISTANCE_PATTERN, ' ')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/,\s*,+/g, ',')
    .replace(/^[,\s]+|[,\s]+$/g, '')
    .trim();
}

function splitAddressParts(address) {
  return cleanMapAddress(address)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !/^(deutschland|germany|baden-württemberg|baden-wuerttemberg)$/i.test(part));
}

function withoutPostcode(value) {
  return cleanMapAddress(value).replace(POSTCODE_PATTERN, '').trim();
}

function firstAddressPart(address) {
  return cleanMapAddress(address).split(',')[0]?.trim() ?? '';
}

function firstPartHasHouseNumber(address) {
  const firstPart = firstAddressPart(address);
  return (
    LETTER_PATTERN.test(firstPart) &&
    !POSTCODE_PATTERN.test(firstPart) &&
    HOUSE_NUMBER_PATTERN.test(firstPart)
  );
}

function normalizeForMatch(value) {
  return cleanMapAddress(value)
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/\bstr\./g, 'strasse')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizedTokens(value) {
  const normalized = normalizeForMatch(value);
  return normalized ? normalized.split(' ').filter(Boolean) : [];
}

function componentTokens(value) {
  return normalizedTokens(value).filter((token) => !COMPONENT_STOPWORDS.has(token));
}

function queryContainsComponent(query, component) {
  const normalizedQuery = normalizeForMatch(query);
  const normalizedComponent = normalizeForMatch(component);
  if (!normalizedQuery || !normalizedComponent) return false;
  if (normalizedQuery.includes(normalizedComponent)) return true;

  const queryTokens = new Set(normalizedTokens(query));
  const tokens = componentTokens(component);
  return tokens.length > 0 && tokens.every((token) => queryTokens.has(token));
}

function queryContainsHouseNumber(query, houseNumber) {
  const houseNumberTokens = normalizedTokens(houseNumber);
  if (houseNumberTokens.length === 0) return false;

  const firstPartTokens = new Set(normalizedTokens(firstAddressPart(query)));
  return houseNumberTokens.some(
    (token) => HOUSE_NUMBER_TOKEN_PATTERN.test(token) && firstPartTokens.has(token),
  );
}

export function mapAddressCandidates(address) {
  const cleaned = cleanMapAddress(address);
  if (!cleaned) return [];

  const parts = splitAddressParts(cleaned);
  const firstPart = parts[0] ?? cleaned;
  const city = parts.length > 1 ? parts[parts.length - 1] : null;
  const intent = queryIntent(cleaned);

  if (intent.hasHouseNumber) {
    return unique([cleaned, firstPart && city ? `${firstPart}, ${city}` : null]);
  }

  const postcode = cleaned.match(POSTCODE_PATTERN)?.[0] ?? null;
  const district = withoutPostcode(firstPart);
  const slashDistricts = district.includes('/')
    ? district.split('/').map((part) => cleanMapAddress(part))
    : [];

  return unique([
    cleaned,
    district && city ? `${district}, ${city}` : null,
    ...slashDistricts.map((part) => (city ? `${part}, ${city}` : part)),
    postcode && city ? `${postcode} ${city}` : null,
    city,
  ]);
}

export function validCoordinate(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function queryIntent(query) {
  const cleaned = cleanMapAddress(query);
  const postcode = cleaned.match(POSTCODE_PATTERN)?.[0] ?? null;
  const hasHouseNumberInFirstPart = firstPartHasHouseNumber(cleaned);
  return {
    cleaned,
    postcode,
    hasHouseNumber: hasHouseNumberInFirstPart,
    hasRealHouseNumber: hasHouseNumberInFirstPart,
    isRegional:
      !hasHouseNumberInFirstPart && (Boolean(postcode) || cleaned.includes('/') || cleaned.includes(',')),
  };
}

export function addressLooksRegional(address) {
  return queryIntent(address).isRegional;
}

function precisionForResult(row, intent) {
  const type = String(row?.addresstype ?? row?.type ?? '').toLowerCase();
  if (!type) return null;

  const road = firstAddressValue(row, ROAD_ADDRESS_KEYS);
  const houseNumber = row?.address?.house_number;
  const matchesRoad = road ? queryContainsComponent(intent.cleaned, road) : false;
  const matchesHouseNumber = houseNumber
    ? queryContainsHouseNumber(intent.cleaned, houseNumber)
    : false;

  if (matchesRoad && matchesHouseNumber && EXACT_TYPES.has(type)) return 'exact';
  if (matchesRoad && (STREET_TYPES.has(type) || EXACT_TYPES.has(type))) return 'street';
  if (intent.hasHouseNumber) return null;
  if (REGIONAL_TYPES.has(type)) return type === 'postcode' || type === 'postal_code' ? 'postcode' : 'district';
  if (CITY_TYPES.has(type)) return 'city';
  return null;
}

function firstAddressValue(row, keys) {
  for (const key of keys) {
    const value = row?.address?.[key];
    if (value) return String(value);
  }
  return null;
}

function parseBbox(value) {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const [south, north, west, east] = value.map(Number);
  if (![south, north, west, east].every(Number.isFinite)) return null;
  return { south, north, west, east };
}

function regionalGeometry(row) {
  const type = row?.geojson?.type;
  if (type === 'Polygon' || type === 'MultiPolygon') return row.geojson;
  return null;
}

function precisionUsesArea(precision) {
  return precision === 'postcode' || precision === 'district' || precision === 'city';
}

function precisionRank(precision) {
  return {
    exact: 50,
    street: 40,
    district: 30,
    postcode: 25,
    city: 10,
  }[precision] ?? 0;
}

export function mapLocationFromCoordinates({ lat, lon, address = null, label = null, source = 'provider' }) {
  const parsedLat = validCoordinate(lat);
  const parsedLon = validCoordinate(lon);
  if (
    parsedLat === null ||
    parsedLon === null ||
    parsedLat < -90 ||
    parsedLat > 90 ||
    parsedLon < -180 ||
    parsedLon > 180
  ) {
    return null;
  }

  const cleanedAddress = cleanMapAddress(address);
  const approximate =
    !queryIntent(cleanedAddress).hasRealHouseNumber || /(?:^|[\s,])0(?:[\s,]|$)/.test(cleanedAddress);

  return {
    status: 'ok',
    source,
    query: cleanedAddress || null,
    label: label || cleanedAddress || `${parsedLat.toFixed(5)}, ${parsedLon.toFixed(5)}`,
    precision: approximate ? 'street' : 'exact',
    lat: parsedLat,
    lon: parsedLon,
    bbox: null,
    geometry_geojson: null,
  };
}

export function mapLocationFromNominatimResult(row, query) {
  const intent = queryIntent(query);
  const precision = precisionForResult(row, intent);
  if (!precision) return null;

  const lat = validCoordinate(row?.lat);
  const lon = validCoordinate(row?.lon);
  if (lat === null || lon === null) return null;
  const useArea = precisionUsesArea(precision);

  return {
    status: 'ok',
    source: 'nominatim',
    query: intent.cleaned,
    label: row.display_name ?? intent.cleaned,
    precision,
    lat,
    lon,
    bbox: useArea ? parseBbox(row.boundingbox) : null,
    geometry_geojson: useArea ? regionalGeometry(row) : null,
  };
}

export function selectBestNominatimLocation(rows, query) {
  const candidates = (rows ?? [])
    .map((row) => mapLocationFromNominatimResult(row, query))
    .filter(Boolean)
    .map((location) => ({
      location,
      score:
        precisionRank(location.precision) +
        (location.geometry_geojson ? 8 : 0) +
        (location.bbox ? 3 : 0),
    }))
    .sort((a, b) => b.score - a.score);

  return candidates[0]?.location ?? null;
}
