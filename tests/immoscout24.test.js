import { describe, it, expect } from 'vitest';
import {
  toApiUrl,
  validateUrl,
  inferListingTypeFromUrl,
  transformResultItem,
} from '../src/providers/immoscout24/index.js';

// ── toApiUrl – URL Conversion ─────────────────────────────────────────────────

describe('toApiUrl', () => {
  const RADIUS_URL =
    'https://www.immobilienscout24.de/Suche/radius/wohnung-mieten' +
    '?geocoordinates=49.40191;8.6803;100.0&price=600.0-1500.0';

  it('points to the mobile API endpoint', () => {
    expect(toApiUrl(RADIUS_URL)).toContain('api.mobile.immobilienscout24.de');
  });

  it('sets realestatetype=apartmentrent for wohnung-mieten', () => {
    expect(toApiUrl(RADIUS_URL)).toContain('realestatetype=apartmentrent');
  });

  it('sets searchType=radius for radius searches', () => {
    expect(toApiUrl(RADIUS_URL)).toContain('searchType=radius');
  });

  it('preserves geocoordinates with semicolon (unencoded) in query', () => {
    // The implementation appends geocoordinates raw so semicolons remain
    expect(toApiUrl(RADIUS_URL)).toContain('geocoordinates=49.40191;8.6803;100.0');
  });

  it('preserves price range', () => {
    expect(toApiUrl(RADIUS_URL)).toContain('price=600.0-1500.0');
  });

  it('maps wohnung-kaufen → apartmentbuy', () => {
    const url =
      'https://www.immobilienscout24.de/Suche/radius/wohnung-kaufen?geocoordinates=49.4;8.68;5.0';
    expect(toApiUrl(url)).toContain('realestatetype=apartmentbuy');
  });

  it('maps haus-mieten → houserent', () => {
    const url =
      'https://www.immobilienscout24.de/Suche/radius/haus-mieten?geocoordinates=49.4;8.68;5.0';
    expect(toApiUrl(url)).toContain('realestatetype=houserent');
  });

  it('maps haus-kaufen → housebuy', () => {
    const url =
      'https://www.immobilienscout24.de/Suche/radius/haus-kaufen?geocoordinates=49.4;8.68;5.0';
    expect(toApiUrl(url)).toContain('realestatetype=housebuy');
  });

  it('maps wohnen-auf-zeit → shorttermaccommodation', () => {
    const url =
      'https://www.immobilienscout24.de/Suche/radius/wohnen-auf-zeit' +
      '?geocoordinates=49.40191;8.6803;100.0&startrentaldate=2026-04-01';
    const api = toApiUrl(url);
    expect(api).toContain('realestatetype=shorttermaccommodation');
    expect(api).toContain('startrentaldate=2026-04-01');
  });

  it('uses searchType=region for non-radius searches', () => {
    const url = 'https://www.immobilienscout24.de/Suche/region/wohnung-mieten';
    expect(toApiUrl(url)).toContain('searchType=region');
  });

  it('translates sorting code "2" to "-firstactivation"', () => {
    const url =
      'https://www.immobilienscout24.de/Suche/radius/wohnung-mieten' +
      '?geocoordinates=49.4;8.68;5.0&sorting=2';
    expect(toApiUrl(url)).toContain('sorting=-firstactivation');
  });

  it('throws for a completely invalid URL', () => {
    expect(() => toApiUrl('not-a-url')).toThrow();
  });

  it('throws for an unsupported property type in the URL path', () => {
    const bad = 'https://www.immobilienscout24.de/Suche/region/bueroflaeche-mieten';
    expect(() => toApiUrl(bad)).toThrow();
  });
});

// ── validateUrl ───────────────────────────────────────────────────────────────

describe('validateUrl', () => {
  it('does not throw for a valid IS24 web URL', () => {
    const url =
      'https://www.immobilienscout24.de/Suche/radius/wohnung-mieten' +
      '?geocoordinates=49.4;8.68;5.0';
    expect(() => validateUrl(url)).not.toThrow();
  });

  it('throws for a garbage string', () => {
    expect(() => validateUrl('garbage')).toThrow();
  });

  it('throws for an unsupported listing type', () => {
    expect(() => validateUrl('https://www.immobilienscout24.de/Suche/region/abc-xyz')).toThrow();
  });
});

// ── inferListingTypeFromUrl ───────────────────────────────────────────────────

describe('inferListingTypeFromUrl', () => {
  it.each([
    ['https://www.immobilienscout24.de/Suche/radius/wohnung-mieten', 'apartmentrent'],
    ['https://www.immobilienscout24.de/Suche/region/wohnung-kaufen', 'apartmentbuy'],
    ['https://www.immobilienscout24.de/Suche/radius/haus-mieten', 'houserent'],
    ['https://www.immobilienscout24.de/Suche/radius/haus-kaufen', 'housebuy'],
    ['https://www.immobilienscout24.de/Suche/radius/wohnen-auf-zeit', 'shorttermaccommodation'],
  ])('"%s" → "%s"', (url, expected) => {
    expect(inferListingTypeFromUrl(url)).toBe(expected);
  });

  it('returns null for a non-IS24 URL', () => {
    expect(
      inferListingTypeFromUrl('https://www.kleinanzeigen.de/s-wohnung-mieten/heidelberg'),
    ).toBeNull();
  });
});

// ── transformResultItem – Field Parsing ───────────────────────────────────────

describe('transformResultItem', () => {
  // Realistic mock of a single item returned by the IS24 mobile API
  const RAW = {
    id: '553698754',
    title: '3-Zimmer Wohnung in Heidelberg',
    attributes: [
      { value: '850 €' },
      { value: '75 m²' },
      { value: '3 Zimmer' },
      { value: '01.06.26' },
    ],
    address: { line: 'Heidelberg, Baden-Württemberg', lat: 49.4, lon: 8.68 },
    published: '2026-03-15T10:00:00',
    isPrivate: false,
    titlePicture: {
      full: 'https://example.com/full.jpg',
      preview: 'https://example.com/preview.jpg',
    },
  };

  it('parses price from attributes array', () => {
    expect(transformResultItem(RAW).price).toBe('850 €');
  });

  it('parses size from attributes array', () => {
    expect(transformResultItem(RAW).size).toBe('75 m²');
  });

  it('parses rooms from attributes array', () => {
    expect(transformResultItem(RAW).rooms).toBe('3 Zimmer');
  });

  it('parses availableFrom date from attributes array', () => {
    expect(transformResultItem(RAW).availableFrom).toBe('01.06.26');
  });

  it('generates a stable 16-character id hash', () => {
    const r1 = transformResultItem(RAW);
    const r2 = transformResultItem(RAW);
    expect(r1.id).toBe(r2.id);
    expect(r1.id).toHaveLength(16);
  });

  it('builds the correct IS24 expose URL', () => {
    expect(transformResultItem(RAW).link).toBe('https://www.immobilienscout24.de/expose/553698754');
  });

  it('sets publisher to "Makler" for non-private listings', () => {
    expect(transformResultItem(RAW).publisher).toBe('Makler');
  });

  it('sets publisher to "Privat" for private listings', () => {
    expect(transformResultItem({ ...RAW, isPrivate: true }).publisher).toBe('Privat');
  });

  it('picks the full image over the preview', () => {
    expect(transformResultItem(RAW).image).toBe('https://example.com/full.jpg');
  });

  it('falls back to preview image when full is absent', () => {
    const raw = { ...RAW, titlePicture: { preview: 'https://example.com/preview.jpg' } };
    expect(transformResultItem(raw).image).toBe('https://example.com/preview.jpg');
  });

  it('parses listedAt as an ISO date string', () => {
    expect(transformResultItem(RAW).listedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('carries address line and coordinates', () => {
    const result = transformResultItem(RAW);
    expect(result.address).toBe('Heidelberg, Baden-Württemberg');
    expect(result.lat).toBe(49.4);
    expect(result.lon).toBe(8.68);
  });

  it('returns null when id is missing from the raw item', () => {
    expect(transformResultItem({ title: 'no id' })).toBeNull();
  });

  it('returns null for a null/undefined input', () => {
    expect(transformResultItem(null)).toBeNull();
    expect(transformResultItem(undefined)).toBeNull();
  });

  it('returns null fields when attributes contain no matching patterns', () => {
    const raw = { ...RAW, attributes: [{ value: 'Penthouse' }, { value: 'luxuriös' }] };
    const result = transformResultItem(raw);
    expect(result.price).toBeNull();
    expect(result.size).toBeNull();
    expect(result.rooms).toBeNull();
  });

  it('handles missing titlePicture gracefully', () => {
    const raw = { ...RAW, titlePicture: undefined };
    expect(transformResultItem(raw).image).toBeNull();
  });
});
