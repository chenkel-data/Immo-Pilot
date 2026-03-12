/*
 * Provider Registry of all scraping providers.
 *
 * Each provider exports:
 *   - id, name, listingTypes[]
 *   - getCrawlConfig(url, maxPages)  → Playwright-based scraping (option A)
 *   - scrape(url, maxPages, opts)    → custom scraping logic (option B)
 *   - inferListingTypeFromUrl(url)   → string | null  (optional)
 */

import * as kleinanzeigen from './kleinanzeigen/index.js';
import * as immoscout24 from './immoscout24/index.js';

const providers = new Map();

function register(provider) {
  providers.set(provider.id, provider);
}

// ── Registered Providers ──────────────────────────────────────────────────────

register(kleinanzeigen);
register(immoscout24);


/**
 * Returns a provider by its ID.
 */
export function getProvider(id) {
  return providers.get(id) || null;
}

/**
 * Returns all registered providers as an array.
 */
export function getAllProviders() {
  return [...providers.values()].map((p) => ({
    id: p.id,
    name: p.name,
    listingTypes: p.listingTypes,
  }));
}

/**
 * Tries to infer the listing type from a URL.
 * Returns { providerId, listingTypeId } or null.
 */
export function inferFromUrl(url) {
  for (const [pid, provider] of providers.entries()) {
    if (typeof provider.inferListingTypeFromUrl === 'function') {
      const typeId = provider.inferListingTypeFromUrl(url);
      if (typeId) return { providerId: pid, listingTypeId: typeId };
    }
  }
  return null;
}
