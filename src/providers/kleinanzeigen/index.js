/*
 * Provider: Kleinanzeigen (kleinanzeigen.de)
 *
 * Supported listing types:
 *   - miete          → rental apartments
 *   - wohnen-auf-zeit → short-term / room rentals
 *
 * Extensible: additional types like 'kauf' can be added to LISTING_TYPES.
 */

import { buildHash, parsePublishedDate, pickByPattern } from '../../utils.js';

// ── Listing Types ───────────────────────────────────────────────────────────────

const LISTING_TYPES = {
  miete: {
    id: 'miete',
    label: 'Mietwohnungen',
    urlPath: 's-wohnung-mieten',
    categoryCode: 'c203l4292',
  },
  'wohnen-auf-zeit': {
    id: 'wohnen-auf-zeit',
    label: 'Wohnen auf Zeit',
    urlPath: 's-auf-zeit-wg',
    categoryCode: 'c199l4858',
  },
};

// ── URL Builder ────────────────────────────────────────────────────────────────

/**
 * Builds the URL for page N (pagination).
 * Pattern: …/seite:N/c203l4292r100
 */
function buildPageUrl(baseUrl, pageNum) {
  if (pageNum <= 1) return baseUrl;
  const cleaned = baseUrl.replace(/\/seite:\d+/, '');
  return cleaned.replace(/\/([^/]+)$/, `/seite:${pageNum}/$1`);
}

// ── Helper Functions ────────────────────────────────────────────────────────────

/** Replaces thumbnail path and low resolution with a larger image */
function upscaleImageUrl(url) {
  return (url || '').replace('/thumbs/images/', '/images/').replace(/s-l\d+\./, 's-l640.');
}

function parseListing(raw) {
  const link = `https://www.kleinanzeigen.de${raw.link}`;
  const tagParts = (raw.tags ?? '').split('·').map((s) => s.trim());
  return {
    ...raw,
    id: buildHash(raw.id, link),
    link,
    size: pickByPattern(tagParts, 'size'),
    rooms: pickByPattern(tagParts, 'rooms'),
    image: upscaleImageUrl(raw.image),
    listedAt: parsePublishedDate(raw.listedAt),
  };
}

// ── Field Extraction ─────────────────────────────────────────────────────────────

const FIELD_EXTRACTORS = {
  id: { attr: 'data-adid', scope: '.aditem' },
  price: { text: '.aditem-main--middle--price-shipping--price' },
  tags: { text: '.aditem-main--middle--tags' },
  title: { text: '.aditem-main .text-module-begin a' },
  link: { attr: 'href', scope: '.aditem-main .text-module-begin a' },
  description: { text: '.aditem-main .aditem-main--middle--description' },
  address: { text: '.aditem-main--top--left' },
  listedAt: { text: '.aditem-main--top--right' },
  image: { attr: 'src', scope: 'img' },
  publisher: { text: '.aditem-main--bottom' },
};

// ── Crawl Config Builder ───────────────────────────────────────────────────────

/**
 * Returns a config object passed directly to the crawl engine.
 */
function getCrawlConfig(url, maxPages = 10) {
  return {
    url,
    maxPages,
    itemSelector: '#srchrslt-adtable .ad-listitem ',
    extractors: FIELD_EXTRACTORS,
    parseListing,
    buildPageUrl,
  };
}

// ── Provider Export ────────────────────────────────────────────────────────────

export const id = 'kleinanzeigen';
export const name = 'Kleinanzeigen';
export const listingTypes = Object.values(LISTING_TYPES);

/**
 * Infers the listing type from a URL by matching the URL path segment.
 */
export function inferListingTypeFromUrl(url) {
  for (const [typeId, typeConfig] of Object.entries(LISTING_TYPES)) {
    if (url.includes(`/${typeConfig.urlPath}/`) || url.includes(`/${typeConfig.urlPath}?`)) {
      return typeId;
    }
  }
  return null;
}

export { getCrawlConfig };
