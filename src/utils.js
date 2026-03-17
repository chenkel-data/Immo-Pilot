/*
 * Utility functions
 */

import crypto from 'crypto';

/**
 * Builds a stable hash from multiple values.
 * Used as the unique listing ID.
 */
export function buildHash(...values) {
  const raw = values.map((v) => String(v ?? '')).join('|');
  return crypto.createHash('sha1').update(raw).digest('hex').slice(0, 16);
}

/**
 * Removes all line breaks from a string.
 */
export function removeNewline(s) {
  return typeof s === 'string' ? s.replace(/[\r\n]+/g, ' ') : s;
}


export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Returns the current ISO timestamp.
 */
export function now() {
  return new Date().toISOString();
}

export function normalizeAvailableFrom(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (/^(ab\s+)?sofort$/i.test(raw)) return 'sofort';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw; // already ISO

  const m = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/);
  if (!m) return raw;

  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  const isoDate = `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== isoDate ? raw : isoDate;
}

// ── Listing Field Patterns ───────────────────────────────────────────────────

/**
 * Shared regex patterns for detecting listing fields from raw strings.
 * Used by all providers to identify price, size, and room count by value shape
 */
export const LISTING_PATTERNS = {
  price: /[\d.,]+\s*€/,
  size:  /[\d.,]+\s*m²/,
  rooms: /[\d.,]+\s*Zi(?:mmer)?\.?/,  
  date:  /^\d{2}\.\d{2}\.\d{2,4}$/,};

/**
 * @param {string[]} values  – flat array of candidate strings
 * @param {string}   key     – one of 'price' | 'size' | 'rooms' | 'date'
 * @returns {string|null}
 */
export function pickByPattern(values, key) {
  const re = LISTING_PATTERNS[key];
  return values.find((v) => re.test(String(v ?? ''))) ?? null;
}

function toGermanDateKey(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Converts German relative/absolute publication strings to ISO.
 * Examples:
 *   - "vor 14 Minuten"
 *   - "vor 3 Tagen"
 *   - "Heute, 12:34"
 *   - "Gestern, 09:12"
 *   - "09.03.2026, 14:15"
 */
export function parsePublishedDate(value, baseDate = new Date()) {
  if (!value) return null;

  const raw = String(value).trim();
  if (!raw) return null;

  if (/\d{4}-\d{2}-\d{2}t/i.test(raw) || /\d{4}-\d{2}-\d{2}/.test(raw)) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  const normalized = toGermanDateKey(raw).replace(/\s+/g, ' ');
  const result = new Date(baseDate);

  if (/^(gerade eben|soeben|eben)$/.test(normalized)) {
    return result.toISOString();
  }

  const todayOrYesterdayMatch = normalized.match(/^(heute|gestern)(?:,?\s*(\d{1,2}):(\d{2}))?(?:\s*uhr)?$/i);
  if (todayOrYesterdayMatch) {
    const [, dayToken, hh = '00', mm = '00'] = todayOrYesterdayMatch;
    if (dayToken === 'gestern') {
      result.setDate(result.getDate() - 1);
    }
    result.setHours(Number(hh), Number(mm), 0, 0);
    return result.toISOString();
  }

  const relativeMatch = normalized.match(/^vor\s+(einer?|einem|\d+)\s+(sekunden?|minuten?|stunden?|tagen?|tage|tag|wochen?|monaten?|monate|monat)$/i);
  if (relativeMatch) {
    const amountRaw = relativeMatch[1];
    const amount = /^(eine[rm]?|einem)$/i.test(amountRaw) ? 1 : Number(amountRaw);
    const unit = relativeMatch[2];

    if (unit.startsWith('sek')) {
      result.setSeconds(result.getSeconds() - amount);
    } else if (unit.startsWith('min')) {
      result.setMinutes(result.getMinutes() - amount);
    } else if (unit.startsWith('std') || unit.startsWith('stund')) {
      result.setHours(result.getHours() - amount);
    } else if (unit.startsWith('tag')) {
      result.setDate(result.getDate() - amount);
    } else if (unit.startsWith('woch')) {
      result.setDate(result.getDate() - (amount * 7));
    } else if (unit.startsWith('monat')) {
      result.setMonth(result.getMonth() - amount);
    }

    return result.toISOString();
  }

  const absoluteDateMatch = normalized.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})(?:,?\s*(\d{1,2}):(\d{2}))?(?:\s*uhr)?$/i);
  if (absoluteDateMatch) {
    const [, dd, mm, yyyyRaw, hh = '00', min = '00'] = absoluteDateMatch;
    const yyyy = yyyyRaw.length === 2 ? `20${yyyyRaw}` : yyyyRaw;
    const parsed = new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min), 0, 0);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  const fallback = new Date(raw);
  if (!Number.isNaN(fallback.getTime())) return fallback.toISOString();

  return null;
}
