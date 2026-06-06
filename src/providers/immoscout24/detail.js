import { normalizeAvailableFrom } from '../../utils.js';

const REQUEST_HEADERS = {
  'User-Agent': 'ImmoScout_28.3_34.0_._',
  Accept: 'application/json',
};

const AVAILABLE_ATTR_LABEL = /(bezugsfrei|bezug|einzug|frei\s*ab|verfügbar\s*ab|verfuegbar\s*ab)/i;

export function getExposeIdFromUrl(url) {
  return String(url ?? '').match(/\/expose\/(\d+)/)?.[1] ?? null;
}

function cleanText(value) {
  if (value == null) return null;
  const text = String(value)
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text || null;
}

function cleanBlockText(value) {
  if (value == null) return null;
  const text = String(value)
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text || null;
}

function cleanLabel(value) {
  return cleanText(value)?.replace(/:$/, '') ?? null;
}

export function normalizeDetailAvailableFrom(value, baseDate = new Date()) {
  const normalized = normalizeAvailableFrom(value);
  if (normalized !== value) return normalized;

  const raw = cleanText(value);
  const match = raw?.match(/^(\d{1,2})\.(\d{1,2})\.$/);
  if (!match) return normalized;

  let year = baseDate.getFullYear();
  const candidate = new Date(year, Number(match[2]) - 1, Number(match[1]));
  const today = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
  if (candidate < today) year++;
  return `${year}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
}

export function extractAvailableFromText(text) {
  const value = cleanText(text);
  if (!value) return null;

  if (
    /(?:bezugsfrei|verfügbar|verfuegbar|frei|einzug|bezug|ab)\s*(?:ab\s*)?sofort/i.test(value) ||
    /sofort\s*(?:verfügbar|verfuegbar|frei|bezugsfrei)/i.test(value)
  ) {
    return 'sofort';
  }

  if (
    /(?:bezugsfrei|bezug|einzug|verfügbar|verfuegbar|frei)[^.]{0,60}nach vereinbarung/i.test(value)
  ) {
    return 'nach Vereinbarung';
  }

  const patterns = [
    /(?:bezugsfrei|bezug|einzug|verfügbar|verfuegbar|frei\s*ab|ab dem|ab|zum)\D{0,30}(\d{1,2}\.\d{1,2}\.(?:\d{2,4})?)/i,
    /(\d{1,2}\.\d{1,2}\.(?:\d{2,4})?)\s*(?:verfügbar|verfuegbar|frei|bezugsfrei)/i,
    /(?:bezugsfrei|bezug|einzug|verfügbar|verfuegbar|frei\s*ab|ab dem|ab|zum)\D{0,30}(\d{4}-\d{2}-\d{2})/i,
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match) return match[1];
  }

  return null;
}

export function extractAvailableFromExposeDetail(detail) {
  for (const section of detail?.sections ?? []) {
    for (const attr of section.attributes ?? []) {
      const label = cleanLabel(attr.label);
      const text = cleanText(attr.text);
      if (text && AVAILABLE_ATTR_LABEL.test(label)) return { value: text, source: label };
    }
  }

  for (const [sectionIndex, section] of (detail?.sections ?? []).entries()) {
    for (const key of ['title', 'text', 'subText']) {
      const found = extractAvailableFromText(section[key]);
      if (found) return { value: found, source: `sections[${sectionIndex}].${key}` };
    }
  }

  return { value: null, source: null };
}

function attributeGroups(detail) {
  return (detail?.sections ?? [])
    .filter((section) => Array.isArray(section.attributes) && section.attributes.length > 0)
    .map((section) => ({
      type: section.type ?? null,
      title: cleanText(section.title) || section.type || null,
      attributes: section.attributes.map((attr) => ({
        label: cleanLabel(attr.label),
        value:
          cleanText(attr.text) ?? cleanText(attr.value) ?? (attr.type === 'CHECK' ? true : null),
        type: attr.type ?? null,
      })),
    }));
}

function flattenAttributes(groups) {
  return groups.flatMap((group) => group.attributes);
}

function attrValue(attrs, pattern) {
  const found = attrs.find((attr) => attr.label && pattern.test(attr.label));
  return found?.value ?? null;
}

function attrBool(attrs, pattern) {
  const found = attrs.find((attr) => attr.label && pattern.test(attr.label));
  if (!found) return null;
  if (found.value === true) return 1;
  if (/^(ja|yes|true|vorhanden)$/i.test(String(found.value ?? ''))) return 1;
  if (/^(nein|no|false)$/i.test(String(found.value ?? ''))) return 0;
  return null;
}

function yesNo(value) {
  if (value == null || value === '') return null;
  if (/^(y|yes|true|1|ja)$/i.test(String(value))) return 1;
  if (/^(n|no|false|0|nein)$/i.test(String(value))) return 0;
  return null;
}

function textSection(detail, titlePattern) {
  const section = (detail?.sections ?? []).find(
    (s) => s.type === 'TEXT_AREA' && titlePattern.test(cleanText(s.title) ?? ''),
  );
  return cleanBlockText(section?.text);
}

function collectImages(detail) {
  return (detail?.sections ?? [])
    .flatMap((section) => section.media ?? [])
    .filter((item) => item.type === 'PICTURE')
    .map((item) => cleanText(item.fullImageUrl) ?? cleanText(item.previewImageUrl))
    .filter(Boolean);
}

function collectPhoneNumbers(detail) {
  return (detail?.contact?.phoneNumbers ?? [])
    .map((phone) => ({
      type: cleanText(phone.label ?? phone.type),
      text: cleanText(phone.text),
    }))
    .filter((phone) => phone.text);
}

export function parseExposeDetail(detail, { listingId = null, exposeId = null } = {}) {
  const groups = attributeGroups(detail);
  const attrs = flattenAttributes(groups);
  const targeting = detail?.adTargetingParameters ?? {};
  const tracking = detail?.tracking?.parameters ?? {};
  const mergedParams = { ...tracking, ...targeting };
  const availability = extractAvailableFromExposeDetail(detail);
  const mapSection = (detail?.sections ?? []).find((section) => section.type === 'MAP');

  return {
    listing_id: listingId,
    provider: 'immoscout24',
    expose_id: exposeId ?? cleanText(detail?.header?.id),
    source_version: 'is24-mobile-expose-v1',
    status: 'ok',
    error: null,
    available_from: normalizeDetailAvailableFrom(availability.value),
    available_from_source: availability.source,
    cold_rent: attrValue(attrs, /kaltmiete/i) ?? mergedParams.obj_baseRent ?? null,
    warm_rent: attrValue(attrs, /warmmiete|gesamtmiete/i) ?? mergedParams.obj_totalRent ?? null,
    service_charge: attrValue(attrs, /nebenkosten/i) ?? mergedParams.obj_serviceCharge ?? null,
    deposit: attrValue(attrs, /kaution|genossenschaft/i),
    price_per_sqm: attrValue(attrs, /preis\/m²|preis\/m2/i),
    floor: attrValue(attrs, /etage/i),
    bedrooms: attrValue(attrs, /schlafzimmer/i),
    bathrooms: attrValue(attrs, /badezimmer/i),
    pets: attrValue(attrs, /haustiere/i) ?? mergedParams.obj_petsAllowed ?? null,
    has_kitchen: attrBool(attrs, /einbauküche|küche/i) ?? yesNo(mergedParams.obj_hasKitchen),
    has_cellar: attrBool(attrs, /keller/i) ?? yesNo(mergedParams.obj_cellar),
    has_balcony: attrBool(attrs, /balkon/i) ?? yesNo(mergedParams.obj_balcony),
    has_garden: attrBool(attrs, /garten/i) ?? yesNo(mergedParams.obj_garden),
    has_lift: attrBool(attrs, /aufzug|lift/i) ?? yesNo(mergedParams.obj_lift),
    barrier_free: attrBool(attrs, /stufenlos|barriere/i),
    construction_year: attrValue(attrs, /baujahr/i),
    condition: attrValue(attrs, /zustand/i) ?? mergedParams.obj_condition ?? null,
    heating_type: attrValue(attrs, /heizungsart/i),
    energy_carrier: attrValue(attrs, /energieträger|energietraeger/i),
    energy_class: attrValue(attrs, /energieeffizienzklasse/i),
    energy_value: attrValue(attrs, /endenergie/i),
    description: textSection(detail, /objektbeschreibung|beschreibung/i),
    location_description: textSection(detail, /lage/i),
    address_line1: cleanText(mapSection?.addressLine1),
    address_line2: cleanText(mapSection?.addressLine2),
    lat: mapSection?.location?.lat ?? null,
    lon: mapSection?.location?.lng ?? null,
    agent_name: cleanText(detail?.contact?.contactData?.agent?.name),
    contact_phone_numbers: collectPhoneNumbers(detail),
    contact_available:
      detail?.contact?.mailButtonState === 'active' || detail?.contact?.callButtonState === 'active'
        ? 1
        : 0,
    images: collectImages(detail),
    attribute_groups: groups,
    raw_detail_json: detail,
  };
}

export async function fetchExposeDetail(exposeId, { signal } = {}) {
  const response = await fetch(`https://api.mobile.immobilienscout24.de/expose/${exposeId}`, {
    headers: REQUEST_HEADERS,
    signal,
  });

  if (!response.ok) {
    throw new Error(`IS24 detail API failed for expose ${exposeId}: HTTP ${response.status}`);
  }

  return response.json();
}

export async function fetchAndParseExposeDetail(listing, opts = {}) {
  const exposeId = getExposeIdFromUrl(listing?.link) ?? listing?.expose_id;
  if (!exposeId) throw new Error('No IS24 expose id found');

  const raw = await fetchExposeDetail(exposeId, opts);
  return parseExposeDetail(raw, { listingId: listing.id, exposeId });
}
