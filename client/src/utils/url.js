/**
 * URL utility functions for client-side detection of provider and listing type.
 */

// ── ImmobilienScout24 ─────────────────────────────────────────────────────────

const IS24_SLUG_CATEGORIES = [
  { type: 'apartmentrent',          slug: 'wohnung-mieten' },
  { type: 'apartmentbuy',           slug: 'wohnung-kaufen' },
  { type: 'houserent',              slug: 'haus-mieten' },
  { type: 'housebuy',               slug: 'haus-kaufen' },
  { type: 'shorttermaccommodation', slug: 'wohnen-auf-zeit' },
];

function resolveIS24TypeFromSlug(slug) {
  return IS24_SLUG_CATEGORIES.find((e) => e.slug === slug)?.type ?? null;
}

// ── Kleinanzeigen ─────────────────────────────────────────────────────────────

const URL_LISTING_TYPE_MAP = [
  { pattern: 's-wohnung-mieten',  type: 'miete',           provider: 'kleinanzeigen' },
  { pattern: 's-auf-zeit-wg',     type: 'wohnen-auf-zeit', provider: 'kleinanzeigen' },
];


/**
 * Infers listing type and provider from a URL.
 * Returns { type, provider } or null.
 */
export function inferListingTypeFromUrl(url) {
  if (!url) return null;

  // ImmobilienScout24 Web-URL (/Suche/…)
  if (url.includes('immobilienscout24.de/Suche/')) {
    try {
      const parsed = new URL(url);
      const segments = parsed.pathname.split('/').filter(Boolean);
      const lastSeg = segments.at(-1);
      const type = resolveIS24TypeFromSlug(lastSeg);
      if (type) return { type, provider: 'immoscout24' };
    } catch { /* ignore */ }
  }

  // Kleinanzeigen
  for (const entry of URL_LISTING_TYPE_MAP) {
    if (url.includes(`/${entry.pattern}/`) || url.includes(`/${entry.pattern}?`)) {
      return { type: entry.type, provider: entry.provider };
    }
  }

  return null;
}
