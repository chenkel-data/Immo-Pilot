/*
 * Crawler engine – Playwright-based scraping with pagination.
 * Fields are extracted via sourceConfig.extractors (CSS selectors).
 */

import { chromium } from 'playwright';
import { sleep } from '../utils.js';

// ── Field Extraction ────────────────────────────────────────────────────────────

async function extractField(el, spec) {
  // Read text content
  if (spec.text) {
    const target = await el.$(spec.text);
    if (!target) return null;
    const raw = await target.innerText().catch(() => null);
    if (raw == null) return null;
    return raw.replace(/\s+/g, ' ').trim();
  }

  // Read HTML attribute
  if (spec.attr) {
    const target = spec.scope ? await el.$(spec.scope) : el;
    if (!target) return null;
    const raw = await target.getAttribute(spec.attr);
    if (raw == null) return null;
    return raw.trim();
  }

  return null;
}

// ── Per-Page Extraction ─────────────────────────────────────────────────────────

async function scrapePage(page, sourceConfig) {
  const container = sourceConfig.itemSelector.trim();
  const elements = await page.$$(container);
  const listings = [];

  for (const el of elements) {
    const raw = {};
    for (const [fieldName, spec] of Object.entries(sourceConfig.extractors)) {
      try {
        raw[fieldName] = await extractField(el, spec);
      } catch {
        raw[fieldName] = null;
      }
    }

    if (!raw.id && !raw.title) continue;

    const listing = sourceConfig.parseListing ? sourceConfig.parseListing(raw) : raw;
    if (!listing) continue;
    if (sourceConfig.filter && !sourceConfig.filter(listing)) continue;

    listings.push(listing);
  }

  return listings;
}

/**
 * Scrapes listings from a source – including pagination.
 * Continues fetching pages until no next-page link is found,
 * maxPages is reached, or a duplicate page is detected heuristically (see below).
 *
 * @param {object} sourceConfig  – the config object exported by the provider
 * @param {object} [opts]        – { signal?, onProgress? }
 * @returns {Promise<object[]>}  – listings from all pages
 */
export async function crawl(sourceConfig, opts = {}) {
  const maxPages = sourceConfig.maxPages ?? 5;
  const signal = opts.signal;
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
  const knownIds = opts.knownIds || new Set();
  const EARLY_STOP_THRESHOLD = 3; // stop after N consecutive pages with no new listings

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'de-DE',
    extraHTTPHeaders: { 'Accept-Language': 'de-DE,de;q=0.9' },
  });

  const page = await context.newPage();
  const allListings = [];
  let cookieDismissed = false;

  // Duplicate detection: track listing IDs from the previous page
  let prevPageIds = new Set();
  let duplicatePageCount = 0;
  let consecutiveKnownPages = 0;

  try {
    let currentUrl = sourceConfig.url;
    let pageNum = 1;
    let effectiveMaxPages = maxPages;

    while (currentUrl && pageNum <= effectiveMaxPages) {
      if (signal?.aborted) {
        console.log('[engine] Abort signal received – stopping after', pageNum - 1, 'page(s)');
        break;
      }
      console.log(`[engine] Page ${pageNum}/${effectiveMaxPages}: ${currentUrl}`);

      await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page
        .waitForSelector(sourceConfig.itemSelector.trim().split(' ')[0], {
          timeout: 15_000,
        })
        .catch(() => {});

      await sleep(800 + Math.random() * 800);

      // Dismiss cookie banner once
      if (!cookieDismissed) {
        try {
          await page.click('#gdpr-banner-accept', { timeout: 3_000 });
          cookieDismissed = true;
        } catch {
          /* no banner */
        }
      }

      // Extract listings from this page
      const pageListings = await scrapePage(page, sourceConfig);
      console.log(`[engine]   → ${pageListings.length} listings on page ${pageNum}`);

      // ── Heuristic Duplicate Detection ──────────────────────────────────────────
      // Kleinanzeigen maps any page beyond the last page internally to the last page.
      // If ≥ X% of the current page's IDs match the previous page's IDs,
      // it counts as a duplicate page. Stop scraping after 2 consecutive duplicate pages.
      if (pageListings.length > 0 && prevPageIds.size > 0) {
        const currentIds = new Set(pageListings.map((l) => l.id));
        const matches = [...currentIds].filter((id) => prevPageIds.has(id)).length;
        const overlap = matches / currentIds.size;
        if (overlap >= 0.99) {
          duplicatePageCount++;
          console.log(
            `[engine] Page ${pageNum} duplicate (${(overlap * 100).toFixed(0)}% overlap) – count: ${duplicatePageCount}/2`,
          );
          if (duplicatePageCount >= 2) {
            console.log(
              '[engine] Max page detected heuristically – stopping scrape (duplicate page).',
            );
            break;
          }
          // Skip duplicate page – do not add listings again
          pageNum++;
          if (typeof sourceConfig.buildPageUrl === 'function') {
            currentUrl =
              pageNum <= effectiveMaxPages
                ? sourceConfig.buildPageUrl(sourceConfig.url, pageNum)
                : null;
          }
          continue;
        } else {
          duplicatePageCount = 0;
        }
        prevPageIds = currentIds;
      } else if (pageListings.length > 0) {
        prevPageIds = new Set(pageListings.map((l) => l.id));
      }

      allListings.push(...pageListings);

      // Early-stop: if all listings on this page are already known, count toward threshold.
      if (knownIds.size > 0 && pageListings.length > 0) {
        const newOnPage = pageListings.filter((l) => !knownIds.has(l.id)).length;
        if (newOnPage === 0) {
          consecutiveKnownPages++;
          console.log(
            `[engine] Page ${pageNum}: 0 new listings (${consecutiveKnownPages}/${EARLY_STOP_THRESHOLD} to stop)`,
          );
          if (consecutiveKnownPages >= EARLY_STOP_THRESHOLD) {
            console.log(
              `[engine] ⚡ Cache stop: ${EARLY_STOP_THRESHOLD} consecutive pages with no new listings – skipping remaining pages.`,
            );
            break;
          }
        } else {
          consecutiveKnownPages = 0;
        }
      }

      // Report progress (completed pages)
      try {
        onProgress && onProgress({ pageNum, maxPages: effectiveMaxPages });
      } catch {}

      // No results → no further pages available
      if (pageListings.length === 0) {
        console.log('[engine] No listings – stopping pagination.');
        break;
      }

      // Determine next page URL:
      // 1. URL builder (preferred, more reliable than DOM)
      // 2. Fallback: DOM pagination link
      if (typeof sourceConfig.buildPageUrl === 'function') {
        const nextNum = pageNum + 1;
        currentUrl =
          nextNum <= effectiveMaxPages
            ? sourceConfig.buildPageUrl(sourceConfig.url, nextNum)
            : null;
      } else {
        currentUrl = await page.evaluate(() => {
          const selectors = [
            'a[data-testid="srp-pagination-forward"]',
            '.pagination-next a',
            'a.pagination-next',
            '#srchrslt-pagination .pagination-next a',
          ];
          for (const sel of selectors) {
            // eslint-disable-next-line no-undef
            const el = document.querySelector(sel);
            if (el?.href) return el.href;
          }
          return null;
        });
      }

      pageNum++;

      if (currentUrl && pageNum <= effectiveMaxPages) {
        if (signal?.aborted) break;
        await sleep(1200 + Math.random() * 800);
      }
    }

    console.log(`[engine] Total: ${allListings.length} listings across ${pageNum - 1} page(s)`);
    return allListings;
  } finally {
    await browser.close();
  }
}
