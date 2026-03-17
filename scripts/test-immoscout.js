/**
 * Test script: ImmobilienScout24 Provider
 *
 * Uses the provider functions from src/providers/immoscout24/index.js.
 *
 * Usage:
 *   node scripts/test-immoscout.js [<url>] [--max-pages=<n>] [--md[=<path>]]
 */

import fs from 'fs/promises';
import path from 'path';
import { toApiUrl, scrapePages, logRawVsParsed } from '../src/providers/immoscout24/index.js';

// ─── Konfiguration ──────────────────────────────────────────────────────────
const MAX_PAGES       = 1;
const DEFAULT_MD_PATH = 'immoscout-test-output.md';

const TEST_URL =
  'https://www.immobilienscout24.de/Suche/radius/wohnen-auf-zeit?centerofsearchaddress=Heidelberg;;;;;;&price=600.0-1500.0&geocoordinates=49.40191;8.6803;100.0&sorting=2&enteredFrom=result_list';
// ────────────────────────────────────────────────────────────────────────────

// ── Args ─────────────────────────────────────────────────────────────────────
const argv  = process.argv.slice(2);
const flags = Object.fromEntries(
  argv
    .filter((a) => a.startsWith('--'))
    .map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.length ? v.join('=') : true]; }),
);
const inputUrl = argv.find((a) => !a.startsWith('--')) ?? TEST_URL;
const maxPages = Number.isFinite(+flags['max-pages']) && +flags['max-pages'] > 0
  ? +flags['max-pages']
  : MAX_PAGES;
const mdPath   = flags.md === true ? DEFAULT_MD_PATH : (flags.md || null);

// ── Logger ───────────────────────────────────────────────────────────────────
const lines = [];
function print(line = '') { console.log(line); lines.push(line); }

// ── Main ─────────────────────────────────────────────────────────────────────
print('\n── Immoscout Web → Mobile API URL ────────────────────────────────');
print(`WEB:    ${inputUrl}`);

try {
  const isApiUrl  = inputUrl.includes('api.mobile.immobilienscout24.de');
  const mobileUrl = isApiUrl ? inputUrl : toApiUrl(inputUrl);
  print(`MOBILE: ${mobileUrl}`);

  const webParams    = Object.fromEntries(new URL(inputUrl).searchParams);
  const mobileParams = Object.fromEntries(new URL(mobileUrl).searchParams);

  print('\n── Parameter-Mapping ─────────────────────────────────────────────');
  print('Web Query-Params (gefiltert):');
  for (const [k, v] of Object.entries(webParams)) {
    if (k !== 'enteredFrom') print(`  ${k.padEnd(25)} → ${v}`);
  }
  print('\nMobile Query-Params:');
  for (const [k, v] of Object.entries(mobileParams)) {
    print(`  ${k.padEnd(25)}   ${v}`);
  }

  print('\n── Scraping läuft... ─────────────────────────────────────────────');

  const { hitCount, pageCount, targetPages, pages } = await scrapePages(inputUrl, maxPages, { log: () => {} });
  print(`Treffer: ${hitCount}  |  Seiten gesamt: ${pageCount}  |  Abruf: 1–${targetPages}`);

  let totalListings = 0;
  for (const { pageNum, listings, rawItems } of pages) {
    totalListings += listings.length;
    print(`\n${'═'.repeat(66)}`);
    print(`  Seite ${pageNum}/${targetPages}  •  ${listings.length} Inserate`);
    print('═'.repeat(66));

    if (!listings.length) {
      print('  (keine Inserate auf dieser Seite)');
      continue;
    }

    for (let i = 0; i < listings.length; i++) {
      print('');
      logRawVsParsed(rawItems[i], listings[i], print);
    }
  }

  print(`\n${'═'.repeat(66)}`);
  print(`  GESAMT: ${totalListings} Inserate über ${pages.length} Seite(n)`);
  print('═'.repeat(66));

  if (mdPath) {
    const abs = path.resolve(mdPath);
    await fs.writeFile(abs, `# ImmoScout24 Test Output\n\n\`\`\`text\n${lines.join('\n')}\n\`\`\`\n`, 'utf8');
    print(`\nMarkdown-Report geschrieben: ${abs}`);
  }

} catch (err) {
  print(`\nFehler: ${err.message}`);
}

print('──────────────────────────────────────────────────────────────────\n');
