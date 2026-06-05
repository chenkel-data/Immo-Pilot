import { describe, it, expect } from 'vitest';
import { getCrawlConfig, inferListingTypeFromUrl } from '../src/providers/kleinanzeigen/index.js';
import {
  getAdIdFromUrl,
  parseKleinanzeigenDetailHtml,
} from '../src/providers/kleinanzeigen/detail.js';

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

// ── detail page parsing ──────────────────────────────────────────────────────

describe('kleinanzeigen detail parser', () => {
  const HTML = `
    <article>
      <meta property="og:latitude" content="50.1354734" />
      <meta property="og:longitude" content="8.6718962" />
      <h1 id="viewad-title">Schöne Wohnung</h1>
      <h2 id="viewad-price">700 €</h2>
      <span id="viewad-locality">60320 Frankfurt am Main - Westend</span>
      <div class="splitlinebox" id="viewad-details">
        <div class="addetailslist">
          <li class="addetailslist--detail">
            Art der Unterkunft<span class="addetailslist--detail--value">Privatzimmer</span>
          </li>
          <li class="addetailslist--detail">
            Mietart<span class="addetailslist--detail--value">unbefristet</span>
          </li>
          <li class="addetailslist--detail">
            Wohnfläche<span class="addetailslist--detail--value">18 m²</span>
          </li>
          <li class="addetailslist--detail">
            Zimmer<span class="addetailslist--detail--value">3</span>
          </li>
          <li class="addetailslist--detail">
            Verfügbar ab<span class="addetailslist--detail--value">April 2026</span>
          </li>
        </div>
      </div>
      <div class="splitlinebox" id="viewad-configuration">
        <ul class="checktaglist">
          <li class="checktag">WLAN</li>
          <li class="checktag">Keller</li>
          <li class="checktag">Spülmaschine</li>
          <li class="checktag">Stufenloser Zugang</li>
        </ul>
      </div>
      <p id="viewad-description-text">Ab dem 01.04. frei.<br /><br />500€ Kaution.<br />Weitere Zeile.</p>
      <span class="userprofile-vip"><a>Semih K</a></span>
      <script type="application/ld+json">
        {"@context":"https://schema.org","@type":"ImageObject","contentUrl":"https://img.kleinanzeigen.de/api/v1/prod-ads/images/aa/test?rule=$_59.JPG"}
      </script>
      <script>
        Belen.Search.ViewAdView.init({
          contactPosterEnabled: true,
          hasVisiblePhoneNumber: false,
          loginRequiredForPhoneNumber: true,
          adPhoneNumber: '',
          adId:'3364804426'
        });
      </script>
    </article>
  `;

  it('extracts the ad id from a Kleinanzeigen URL', () => {
    expect(
      getAdIdFromUrl(
        'https://www.kleinanzeigen.de/s-anzeige/schoene-wohnung/3364804426-199-4308',
      ),
    ).toBe('3364804426');
  });

  it('parses detail attributes, features and normalized availability', () => {
    const detail = parseKleinanzeigenDetailHtml(HTML, {
      listingId: 'listing-1',
      url: 'https://www.kleinanzeigen.de/s-anzeige/schoene-wohnung/3364804426-199-4308',
    });

    expect(detail.provider).toBe('kleinanzeigen');
    expect(detail.expose_id).toBe('3364804426');
    expect(detail.available_from).toBe('2026-04-01');
    expect(detail.available_from_source).toBe('attribute:Verfügbar ab');
    expect(detail.warm_rent).toBe('700 €');
    expect(detail.deposit).toBe('500€');
    expect(detail.description).toBe('Ab dem 01.04. frei.\n\n500€ Kaution.\nWeitere Zeile.');
    expect(detail.address_line1).toBe('60320 Frankfurt am Main - Westend');
    expect(detail.lat).toBe(50.1354734);
    expect(detail.lon).toBe(8.6718962);
    expect(detail.agent_name).toBe('Semih K');
    expect(detail.has_cellar).toBe(1);
    expect(detail.has_kitchen).toBe(1);
    expect(detail.barrier_free).toBe(1);
    expect(detail.attribute_groups[0].attributes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Wohnfläche', value: '18 m²' }),
        expect.objectContaining({ label: 'Zimmer', value: '3' }),
      ]),
    );
    expect(detail.images).toHaveLength(1);
  });

  it('keeps coordinates null when the page does not expose map metadata', () => {
    const html = HTML.replace('<meta property="og:latitude" content="50.1354734" />', '').replace(
      '<meta property="og:longitude" content="8.6718962" />',
      '',
    );
    const detail = parseKleinanzeigenDetailHtml(html);
    expect(detail.lat).toBeNull();
    expect(detail.lon).toBeNull();
  });

  it('does not expose a hidden/login-required phone number', () => {
    const detail = parseKleinanzeigenDetailHtml(HTML);
    expect(detail.contact_phone_numbers).toEqual([]);
    expect(detail.raw_detail_json.login_required_for_phone).toBe(true);
  });

  it('extracts a visible phone number when the page exposes one', () => {
    const html = HTML.replace('hasVisiblePhoneNumber: false', 'hasVisiblePhoneNumber: true').replace(
      "adPhoneNumber: ''",
      "adPhoneNumber: '+49 151 12345678'",
    );
    const detail = parseKleinanzeigenDetailHtml(html);
    expect(detail.contact_phone_numbers).toEqual([{ type: 'Telefon', text: '+49 151 12345678' }]);
  });
});
