import { describe, it, expect } from 'vitest';
import { getCrawlConfig, inferListingTypeFromUrl } from '../src/providers/kleinanzeigen/index.js';

// Grab parseListing and buildPageUrl from the crawl config
const { parseListing, buildPageUrl } = getCrawlConfig(
  'https://www.kleinanzeigen.de/s-wohnung-mieten/heidelberg/c203l4292',
);

// ── parseListing – Field Parsing ──────────────────────────────────────────────

describe('kleinanzeigen parseListing', () => {
  // Realistic mock of a scraped raw listing row
  const RAW = {
    id: '2898898898',
    price: '800 €',
    tags: '3 Zimmer · 75 m²',
    title: 'Schöne Wohnung in Heidelberg',
    link: '/s-anzeige/schoene-wohnung/2898898898',
    description: 'Ruhige Lage in der Altstadt.',
    address: 'Heidelberg, Baden-Württemberg',
    listedAt: 'Heute',
    image: 'https://img.kleinanzeigen.de/thumbs/images/s-l100.jpg',
    publisher: 'Max Mustermann',
  };

  it('extracts rooms from the dot-separated tags string', () => {
    expect(parseListing(RAW).rooms).toBe('3 Zimmer');
  });

  it('extracts size from the dot-separated tags string', () => {
    expect(parseListing(RAW).size).toBe('75 m²');
  });

  it('prepends the kleinanzeigen domain to the relative link', () => {
    expect(parseListing(RAW).link).toBe(
      'https://www.kleinanzeigen.de/s-anzeige/schoene-wohnung/2898898898',
    );
  });

  it('upscales thumbnail image URL: /thumbs/images/ → /images/', () => {
    expect(parseListing(RAW).image).toContain('/images/');
    expect(parseListing(RAW).image).not.toContain('/thumbs/images/');
  });

  it('upscales image resolution suffix: s-l100 → s-l640', () => {
    expect(parseListing(RAW).image).toContain('s-l640.');
    expect(parseListing(RAW).image).not.toContain('s-l100.');
  });

  it('generates a stable, 16-character id hash', () => {
    const r1 = parseListing(RAW);
    const r2 = parseListing(RAW);
    expect(r1.id).toBe(r2.id);
    expect(r1.id).toHaveLength(16);
  });

  it('id differs from the raw scraped id string', () => {
    // The hash must not be the plain ad id
    expect(parseListing(RAW).id).not.toBe(RAW.id);
  });

  it('parses listedAt into an ISO date string', () => {
    const result = parseListing(RAW);
    expect(typeof result.listedAt).toBe('string');
    // Should be a parseable ISO date
    expect(new Date(result.listedAt).toString()).not.toBe('Invalid Date');
  });

  it('returns null for rooms and size when tags are empty', () => {
    const result = parseListing({ ...RAW, tags: '' });
    expect(result.rooms).toBeNull();
    expect(result.size).toBeNull();
  });

  it('handles missing tags (null) without throwing', () => {
    expect(() => parseListing({ ...RAW, tags: null })).not.toThrow();
  });

  it('handles a decimal room count like "2,5 Zimmer"', () => {
    const result = parseListing({ ...RAW, tags: '2,5 Zimmer · 60 m²' });
    expect(result.rooms).toBe('2,5 Zimmer');
  });

  it('works correctly for "vor 3 Tagen" relative date', () => {
    const result = parseListing({ ...RAW, listedAt: 'vor 3 Tagen' });
    const parsed = new Date(result.listedAt);
    expect(parsed.toString()).not.toBe('Invalid Date');
    // Must be in the past
    expect(parsed.getTime()).toBeLessThan(Date.now());
  });

  it('preserves title, description, address and publisher pass-through', () => {
    const result = parseListing(RAW);
    expect(result.title).toBe(RAW.title);
    expect(result.description).toBe(RAW.description);
    expect(result.address).toBe(RAW.address);
    expect(result.publisher).toBe(RAW.publisher);
  });
});

// ── buildPageUrl – Pagination ─────────────────────────────────────────────────

describe('kleinanzeigen buildPageUrl', () => {
  const BASE = 'https://www.kleinanzeigen.de/s-wohnung-mieten/heidelberg/c203l4292';

  it('returns the base URL unchanged for page 1', () => {
    expect(buildPageUrl(BASE, 1)).toBe(BASE);
  });

  it('injects /seite:2/ before the category code for page 2', () => {
    const url = buildPageUrl(BASE, 2);
    expect(url).toContain('/seite:2/');
    expect(url).toContain('c203l4292');
  });

  it('correctly updates the page number from 2 to 3', () => {
    const page2 = buildPageUrl(BASE, 2);
    const page3 = buildPageUrl(page2, 3);
    expect(page3).toContain('/seite:3/');
    expect(page3).not.toContain('/seite:2/');
  });

  it('does not duplicate the /seite:N/ segment', () => {
    const page5 = buildPageUrl(BASE, 5);
    expect(page5.match(/seite:/g)).toHaveLength(1);
  });
});

// ── inferListingTypeFromUrl ───────────────────────────────────────────────────

describe('kleinanzeigen inferListingTypeFromUrl', () => {
  it('recognises "miete" from s-wohnung-mieten path', () => {
    expect(
      inferListingTypeFromUrl('https://www.kleinanzeigen.de/s-wohnung-mieten/heidelberg/c203l4292'),
    ).toBe('miete');
  });

  it('recognises "wohnen-auf-zeit" from s-auf-zeit-wg path', () => {
    expect(
      inferListingTypeFromUrl(
        'https://www.kleinanzeigen.de/s-auf-zeit-wg/heidelberg/c199l4858r100',
      ),
    ).toBe('wohnen-auf-zeit');
  });

  it('returns null for an unrecognised or external URL', () => {
    expect(inferListingTypeFromUrl('https://www.google.de/')).toBeNull();
    expect(
      inferListingTypeFromUrl('https://www.immobilienscout24.de/Suche/radius/wohnung-mieten'),
    ).toBeNull();
  });
});
