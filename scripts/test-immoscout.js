/**
 * Test script: ImmobilienScout24 Provider
 *
 * Uses the provider from src/providers/immoscout24/index.js directly.
 *
 * Usage:
 *   node scripts/test-immoscout.js "https://www.immobilienscout24.de/Suche/radius/wohnen-auf-zeit?..."
 *   or set the URL directly in TEST_URL below.
 */

import { toApiUrl, scrape } from '../src/providers/immoscout24/index.js';

// ─── Konfiguration ──────────────────────────────────────────────────────────
const MAX_PAGES = 1;

const TEST_URL =
  "https://www.immobilienscout24.de/Suche/radius/wohnen-auf-zeit?centerofsearchaddress=Heidelberg;;;;;;&geocoordinates=49.40191;8.6803;50.0&sorting=2&enteredFrom=result_list";
// ────────────────────────────────────────────────────────────────────────────

const inputUrl = process.argv[2] ?? TEST_URL;

console.log('\n── Immoscout Web → Mobile API URL ────────────────────────────────');
console.log('WEB:   ', inputUrl);

try {
  const mobileUrl = toApiUrl(inputUrl);
  console.log('MOBILE:', mobileUrl);

  // Parameter comparison
  const webParams    = Object.fromEntries(new URL(inputUrl).searchParams);
  const mobileParams = Object.fromEntries(new URL(mobileUrl).searchParams);

  console.log('\n── Parameter-Mapping ─────────────────────────────────────────────');
  console.log('Web Query-Params (gefiltert):');
  for (const [k, v] of Object.entries(webParams)) {
    if (k !== 'enteredFrom') console.log(`  ${k.padEnd(25)} → ${v}`);
  }
  console.log('\nMobile Query-Params:');
  for (const [k, v] of Object.entries(mobileParams)) {
    console.log(`  ${k.padEnd(25)}   ${v}`);
  }

  console.log('\n── Scraping läuft... ─────────────────────────────────────────────');

  const listings = await scrape(inputUrl, MAX_PAGES);

  console.log(`\n${'═'.repeat(66)}`);
  console.log(`  ${listings.length} Inserate (MAX_PAGES=${MAX_PAGES})`);
  console.log('═'.repeat(66));

  for (const l of listings) {
    console.log(`\n  ┌─ ${l.title || '(kein Titel)'}`);
    console.log(`  │  ID       : ${l.id}`);
    console.log(`  │  Anbieter : ${l.publisher ?? '–'}`);
    console.log(`  │  Preis    : ${l.price ?? '–'}`);
    console.log(`  │  Größe    : ${l.size ?? '–'}`);
    console.log(`  │  Zimmer   : ${l.rooms ?? '–'}`);
    console.log(`  │  Adresse  : ${l.address ?? '–'}`);
    if (l.lat && l.lon) {
      console.log(`  │  Koordin. : ${l.lat}, ${l.lon}  → https://maps.google.com/?q=${l.lat},${l.lon}`);
    }
    console.log(`  │  Veröff.  : ${l.listedAt ?? '–'}`);
    if (l.image) console.log(`  │  Vorschau : ${l.image}`);
    console.log(`  └─ Link     : ${l.link}`);
  }

  if (listings.length === 0) console.log('  (keine Inserate gefunden)');

  console.log(`\n${'═'.repeat(66)}`);
  console.log(`  GESAMT: ${listings.length} Inserate`);
  console.log('═'.repeat(66));

} catch (err) {
  console.error('\nFehler:', err.message);
}

console.log('──────────────────────────────────────────────────────────────────\n');
