import { normalizeAvailableFrom } from '../../utils.js';

const REQUEST_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept-Language': 'de-DE,de;q=0.9',
  Accept: 'text/html',
};

const MONTHS = {
  januar: '01',
  februar: '02',
  maerz: '03',
  märz: '03',
  april: '04',
  mai: '05',
  juni: '06',
  juli: '07',
  august: '08',
  september: '09',
  oktober: '10',
  november: '11',
  dezember: '12',
};

export function getAdIdFromUrl(url) {
  return String(url ?? '').match(/\/(\d+)-\d+-\d+(?:[/?#]|$)/)?.[1] ?? null;
}

function cleanText(value) {
  if (value == null) return null;
  const text = decodeHtml(String(value))
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text || null;
}

function cleanBlockText(value) {
  if (value == null) return null;
  const text = decodeHtml(String(value))
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text || null;
}

function stripTags(value) {
  return cleanText(
    String(value ?? '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p\s*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  );
}

function stripBlockTags(value) {
  return cleanBlockText(
    String(value ?? '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p\s*>/gi, '\n\n')
      .replace(/<[^>]+>/g, ' '),
  );
}

function decodeHtml(value) {
  return String(value ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function extractFirst(html, pattern) {
  const match = html.match(pattern);
  return match ? stripTags(match[1]) : null;
}

function extractFirstBlock(html, pattern) {
  const match = html.match(pattern);
  return match ? stripBlockTags(match[1]) : null;
}

function metaPropertyContent(html, property) {
  for (const match of html.matchAll(/<meta\s+[^>]*>/gi)) {
    const tag = match[0];
    const tagProperty = tag.match(/\bproperty=["']([^"']+)["']/i)?.[1];
    if (tagProperty !== property) continue;
    const content = tag.match(/\bcontent=["']([^"']*)["']/i)?.[1];
    return cleanText(content);
  }
  return null;
}

function numberValue(value) {
  const text = cleanText(value);
  if (!text) return null;
  const number = Number(text.replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}

function sectionHtml(html, id) {
  const start = html.indexOf(`id="${id}"`);
  if (start < 0) return '';
  const next = html.indexOf('id="viewad-', start + id.length);
  return html.slice(start, next > start ? next : start + 12000);
}

function extractAttributes(html) {
  const details = sectionHtml(html, 'viewad-details');
  const attributes = [];
  const pattern =
    /<li[^>]*class="[^"]*addetailslist--detail[^"]*"[^>]*>([\s\S]*?)<span[^>]*class="[^"]*addetailslist--detail--value[^"]*"[^>]*>([\s\S]*?)<\/span>[\s\S]*?<\/li>/gi;

  for (const match of details.matchAll(pattern)) {
    const label = stripTags(match[1])?.replace(/:$/, '');
    const value = stripTags(match[2]);
    if (label && value) attributes.push({ label, value, type: 'TEXT' });
  }

  return attributes;
}

function extractFeatures(html) {
  const config = sectionHtml(html, 'viewad-configuration');
  return [...config.matchAll(/<li[^>]*class="[^"]*checktag[^"]*"[^>]*>([\s\S]*?)<\/li>/gi)]
    .map((match) => stripTags(match[1]))
    .filter(Boolean);
}

function extractImages(html) {
  const urls = new Set();

  for (const match of html.matchAll(/<script type="application\/ld\+json">\s*({[\s\S]*?})\s*<\/script>/gi)) {
    try {
      const parsed = JSON.parse(decodeHtml(match[1]));
      if (parsed?.['@type'] === 'ImageObject' && parsed.contentUrl) urls.add(parsed.contentUrl);
      if (Array.isArray(parsed?.image)) parsed.image.forEach((url) => urls.add(url));
      else if (typeof parsed?.image === 'string') urls.add(parsed.image);
    } catch {}
  }

  for (const match of html.matchAll(/data-imgsrc="([^"]+)"/g)) urls.add(decodeHtml(match[1]));
  for (const match of html.matchAll(/https:\/\/img\.kleinanzeigen\.de\/api\/v1\/prod-ads\/images\/[^"'\s<]+/g)) {
    urls.add(decodeHtml(match[0]));
  }

  return [...urls]
    .filter((url) => url.startsWith('http') && !url.includes('placeholder'))
    .map((url) => url.replace(/s-l\d+\./, 's-l1600.'))
    .filter((url, index, arr) => arr.indexOf(url) === index)
    .slice(0, 20);
}

function attrValue(attrs, pattern) {
  return attrs.find((attr) => pattern.test(attr.label))?.value ?? null;
}

function hasFeature(features, pattern) {
  return features.some((feature) => pattern.test(feature));
}

function yesNoFeature(features, pattern) {
  return hasFeature(features, pattern) ? 1 : null;
}

function normalizeKleinanzeigenAvailableFrom(value, baseDate = new Date()) {
  const normalized = normalizeAvailableFrom(value);
  if (normalized !== value) return normalized;

  const raw = cleanText(value);
  if (!raw) return null;
  if (/nach vereinbarung|auf anfrage/i.test(raw)) return raw;

  const monthYear = raw.match(
    /^(januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)\s+(\d{4})$/i,
  );
  if (monthYear) return `${monthYear[2]}-${MONTHS[monthYear[1].toLowerCase()]}-01`;

  const yearlessDate = raw.match(/^(\d{1,2})\.(\d{1,2})\.$/);
  if (yearlessDate) {
    let year = baseDate.getFullYear();
    const candidate = new Date(year, Number(yearlessDate[2]) - 1, Number(yearlessDate[1]));
    const today = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
    if (candidate < today) year++;
    return `${year}-${yearlessDate[2].padStart(2, '0')}-${yearlessDate[1].padStart(2, '0')}`;
  }

  return raw;
}

function extractAvailableFrom(description, attrs) {
  const direct = attrValue(attrs, /verfügbar ab|verfuegbar ab|bezugsfrei|bezug|einzug/i);
  if (direct) return { value: direct, source: 'attribute:Verfügbar ab' };

  const text = cleanText(description);
  if (!text) return { value: null, source: null };
  if (/(?:ab\s*)?sofort/i.test(text)) return { value: 'sofort', source: 'description' };

  const dateMatch = text.match(
    /(?:verfügbar|verfuegbar|bezugsfrei|einzug|frei|ab dem|ab|zum)\D{0,30}(\d{1,2}\.\d{1,2}\.(?:\d{2,4})?)/i,
  );
  if (dateMatch) return { value: dateMatch[1], source: 'description' };

  return { value: null, source: null };
}

function extractDescriptionValue(description, pattern) {
  return cleanText(description)?.match(pattern)?.[1]?.trim() ?? null;
}

function extractPhoneNumbers(html) {
  const initPhone = html.match(/adPhoneNumber:\s*'([^']*)'/)?.[1];
  const hasVisiblePhone = /hasVisiblePhoneNumber:\s*true/.test(html);
  if (initPhone && hasVisiblePhone) return [{ type: 'Telefon', text: decodeHtml(initPhone) }];
  return [];
}

export function parseKleinanzeigenDetailHtml(html, { listingId = null, adId = null, url = null } = {}) {
  const attrs = extractAttributes(html);
  const features = extractFeatures(html);
  const description = extractFirstBlock(
    html,
    /<p[^>]*id="viewad-description-text"[^>]*>([\s\S]*?)<\/p>/i,
  );
  const availability = extractAvailableFrom(description, attrs);
  const price = extractFirst(html, /<h2[^>]*id="viewad-price"[^>]*>([\s\S]*?)<\/h2>/i);
  const pageAdId =
    adId ??
    getAdIdFromUrl(url) ??
    html.match(/adId:\s*'(\d+)'/)?.[1] ??
    extractFirst(html, /<div[^>]*id="viewad-ad-id-box"[\s\S]*?<li>(\d+)<\/li>/i);
  const lat = numberValue(metaPropertyContent(html, 'og:latitude'));
  const lon = numberValue(metaPropertyContent(html, 'og:longitude'));

  const attributeGroups = [
    {
      type: 'DETAILS',
      title: 'Details',
      attributes: attrs,
    },
  ];
  if (features.length > 0) {
    attributeGroups.push({
      type: 'FEATURES',
      title: 'Ausstattung',
      attributes: features.map((feature) => ({ label: feature, value: true, type: 'CHECK' })),
    });
  }

  return {
    listing_id: listingId,
    provider: 'kleinanzeigen',
    expose_id: pageAdId,
    source_version: 'kleinanzeigen-html-v1',
    status: 'ok',
    error: null,
    available_from: normalizeKleinanzeigenAvailableFrom(availability.value),
    available_from_source: availability.source,
    cold_rent: attrValue(attrs, /kaltmiete/i),
    warm_rent: attrValue(attrs, /warmmiete|gesamtmiete/i) ?? price,
    service_charge:
      attrValue(attrs, /nebenkosten/i) ??
      extractDescriptionValue(description, /Nebenkosten[:\s-]+([^.\n\r]+)/i),
    deposit:
      attrValue(attrs, /kaution/i) ??
      extractDescriptionValue(description, /(?:Kaution|Mietkaution)[:\s-]+([\d.,]+\s*€?)/i) ??
      extractDescriptionValue(description, /([\d.,]+\s*€?)\s*(?:Kaution|Mietkaution)/i),
    price_per_sqm: attrValue(attrs, /preis\/m²|preis\/m2/i),
    floor: attrValue(attrs, /etage/i),
    bedrooms: attrValue(attrs, /schlafzimmer/i),
    bathrooms: attrValue(attrs, /badezimmer/i),
    pets: attrValue(attrs, /haustiere/i),
    has_kitchen:
      yesNoFeature(features, /einbauküche|küche/i) ??
      yesNoFeature(features, /kühlschrank|kuehlschrank|backofen|herd|spülmaschine|spuelmaschine/i),
    has_cellar: yesNoFeature(features, /keller/i),
    has_balcony: yesNoFeature(features, /balkon/i) ?? (/balkon/i.test(description ?? '') ? 1 : null),
    has_garden: yesNoFeature(features, /garten/i),
    has_lift: yesNoFeature(features, /aufzug|lift/i),
    barrier_free: yesNoFeature(features, /stufenlos|barriere/i),
    construction_year: attrValue(attrs, /baujahr/i),
    condition: attrValue(attrs, /zustand/i),
    heating_type: attrValue(attrs, /heizung/i),
    energy_carrier: attrValue(attrs, /energieträger|energietraeger/i),
    energy_class: attrValue(attrs, /energieeffizienzklasse/i),
    energy_value: attrValue(attrs, /endenergie/i),
    description,
    location_description: null,
    address_line1:
      extractFirst(html, /<span[^>]*id="viewad-locality"[^>]*>([\s\S]*?)<\/span>/i) ??
      extractFirst(html, /<div[^>]*class="[^"]*map--address[^"]*"[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i),
    address_line2: null,
    lat,
    lon,
    agent_name: extractFirst(
      html,
      /<span[^>]*class="[^"]*userprofile-vip[^"]*"[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i,
    ),
    contact_phone_numbers: extractPhoneNumbers(html),
    contact_available: /contactPosterEnabled:\s*true/.test(html) ? 1 : null,
    images: extractImages(html),
    attribute_groups: attributeGroups,
    raw_detail_json: {
      url,
      ad_id: pageAdId,
      title: extractFirst(html, /<h1[^>]*id="viewad-title"[^>]*>([\s\S]*?)<\/h1>/i),
      price,
      lat,
      lon,
      attributes: attrs,
      features,
      login_required_for_phone: /loginRequiredForPhoneNumber:\s*true/.test(html),
      has_visible_phone_number: /hasVisiblePhoneNumber:\s*true/.test(html),
    },
  };
}

export async function fetchKleinanzeigenDetailHtml(url, { signal } = {}) {
  if (!url) throw new Error('No Kleinanzeigen listing URL found');
  const response = await fetch(url, {
    headers: REQUEST_HEADERS,
    signal,
  });

  if (!response.ok) {
    throw new Error(`Kleinanzeigen detail page failed: HTTP ${response.status}`);
  }

  return response.text();
}

export async function fetchAndParseKleinanzeigenDetail(listing, opts = {}) {
  const html = await fetchKleinanzeigenDetailHtml(listing?.link, opts);
  return parseKleinanzeigenDetailHtml(html, {
    listingId: listing.id,
    adId: getAdIdFromUrl(listing.link),
    url: listing.link,
  });
}
