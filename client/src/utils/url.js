/**
 * URL utility functions for client-side detection of provider and listing type.
 */


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

  // Kleinanzeigen
  for (const entry of URL_LISTING_TYPE_MAP) {
    if (url.includes(`/${entry.pattern}/`) || url.includes(`/${entry.pattern}?`)) {
      return { type: entry.type, provider: entry.provider };
    }
  }

  return null;
}
