import { describe, it, expect } from 'vitest';
import {
  buildHash,
  pickByPattern,
  parsePublishedDate,
  normalizeAvailableFrom,
} from '../src/utils.js';

// ── buildHash ─────────────────────────────────────────────────────────────────

describe('buildHash', () => {
  it('returns a 16-character hex string', () => {
    expect(buildHash('provider', '12345')).toHaveLength(16);
    expect(buildHash('provider', '12345')).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is deterministic – same inputs produce identical output', () => {
    expect(buildHash('immoscout24', '553698754')).toBe(buildHash('immoscout24', '553698754'));
  });

  it('produces different hashes for different inputs', () => {
    expect(buildHash('a')).not.toBe(buildHash('b'));
    expect(buildHash('x', '1')).not.toBe(buildHash('x', '2'));
  });

  it('handles null and undefined without throwing', () => {
    expect(() => buildHash(null, undefined)).not.toThrow();
    expect(buildHash(null, undefined)).toHaveLength(16);
  });
});

// ── pickByPattern ─────────────────────────────────────────────────────────────

describe('pickByPattern', () => {
  const candidates = ['850 €', '75 m²', '3 Zimmer', 'Heidelberg'];

  it('picks price pattern (€)', () => {
    expect(pickByPattern(candidates, 'price')).toBe('850 €');
  });

  it('picks size pattern (m²)', () => {
    expect(pickByPattern(candidates, 'size')).toBe('75 m²');
  });

  it('picks rooms pattern (Zimmer)', () => {
    expect(pickByPattern(candidates, 'rooms')).toBe('3 Zimmer');
  });

  it('matches abbreviated form "2,5 Zi."', () => {
    expect(pickByPattern(['2,5 Zi.'], 'rooms')).toBe('2,5 Zi.');
  });

  it('matches prices with dot thousands separator', () => {
    expect(pickByPattern(['1.200 €'], 'price')).toBe('1.200 €');
  });

  it('returns null when no candidate matches', () => {
    expect(pickByPattern(['Altstadt', 'Heidelberg'], 'price')).toBeNull();
  });

  it('returns null for empty array', () => {
    expect(pickByPattern([], 'size')).toBeNull();
  });

  it('returns the first match when multiple candidates qualify', () => {
    // First price wins
    expect(pickByPattern(['500 €', '800 €'], 'price')).toBe('500 €');
  });
});

// ── parsePublishedDate ────────────────────────────────────────────────────────

describe('parsePublishedDate', () => {
  // Fixed reference time: noon UTC on 18 March 2026
  const BASE = new Date('2026-03-18T12:00:00.000Z');
  const parse = (v) => parsePublishedDate(v, BASE);

  it('returns null for null input', () => expect(parse(null)).toBeNull());
  it('returns null for empty string', () => expect(parse('')).toBeNull());

  it('passes through an existing ISO timestamp unchanged', () => {
    const iso = '2026-03-15T10:00:00.000Z';
    expect(parse(iso)).toBe(iso);
  });

  it('"gerade eben" → exactly the base time', () => {
    expect(parse('gerade eben')).toBe(BASE.toISOString());
  });

  it('"soeben" → base time', () => {
    expect(parse('soeben')).toBe(BASE.toISOString());
  });

  it('"Heute, 14:30" → today, local 14:30', () => {
    const result = new Date(parse('Heute, 14:30'));
    // setHours uses local time, so getHours() matches what we set
    expect(result.getHours()).toBe(14);
    expect(result.getMinutes()).toBe(30);
  });

  it('"Gestern, 09:00" → yesterday, local 09:00', () => {
    const result = new Date(parse('Gestern, 09:00'));
    const yesterday = new Date(BASE);
    yesterday.setDate(yesterday.getDate() - 1);
    expect(result.getDate()).toBe(yesterday.getDate());
    expect(result.getHours()).toBe(9);
  });

  it('"Heute" without time → today', () => {
    const result = new Date(parse('Heute'));
    expect(result.getDate()).toBe(BASE.getDate());
  });

  it('"vor 3 Tagen" → 3 days before base', () => {
    const result = new Date(parse('vor 3 Tagen'));
    const expected = new Date(BASE);
    expected.setDate(expected.getDate() - 3);
    expect(result.getDate()).toBe(expected.getDate());
    expect(result.getMonth()).toBe(expected.getMonth());
  });

  it('"vor einem Tag" → 1 day before base', () => {
    const result = new Date(parse('vor einem Tag'));
    const expected = new Date(BASE);
    expected.setDate(expected.getDate() - 1);
    expect(result.getDate()).toBe(expected.getDate());
  });

  it('"vor 14 Minuten" → 14 minutes before base', () => {
    const result = new Date(parse('vor 14 Minuten'));
    const expected = new Date(BASE);
    expected.setMinutes(expected.getMinutes() - 14);
    // Allow 1-second tolerance for any tiny rounding
    expect(Math.abs(result.getTime() - expected.getTime())).toBeLessThan(1000);
  });

  it('"vor 2 Stunden" → 2 hours before base', () => {
    const result = new Date(parse('vor 2 Stunden'));
    const expected = new Date(BASE);
    expected.setHours(expected.getHours() - 2);
    expect(result.getTime()).toBe(expected.getTime());
  });

  it('"vor einer Woche" → 7 days before base', () => {
    const result = new Date(parse('vor einer Woche'));
    const expected = new Date(BASE);
    expected.setDate(expected.getDate() - 7);
    expect(result.getDate()).toBe(expected.getDate());
  });

  it('"vor einem Monat" → 1 month before base', () => {
    const result = new Date(parse('vor einem Monat'));
    const expected = new Date(BASE);
    expected.setMonth(expected.getMonth() - 1);
    expect(result.getMonth()).toBe(expected.getMonth());
  });

  it('"09.03.2026, 14:15" → exact local datetime', () => {
    const result = new Date(parse('09.03.2026, 14:15'));
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth() + 1).toBe(3);
    expect(result.getDate()).toBe(9);
    expect(result.getHours()).toBe(14);
    expect(result.getMinutes()).toBe(15);
  });

  it('"09.03.26" (short year) → parsed as 2026', () => {
    const result = new Date(parse('09.03.26'));
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth() + 1).toBe(3);
    expect(result.getDate()).toBe(9);
  });
});

// ── normalizeAvailableFrom ────────────────────────────────────────────────────

describe('normalizeAvailableFrom', () => {
  it.each([
    ['sofort', 'sofort'],
    ['Sofort', 'sofort'],
    ['ab sofort', 'sofort'],
    ['Ab Sofort', 'sofort'],
    ['2026-04-01', '2026-04-01'], // already ISO – pass through
    ['01.04.2026', '2026-04-01'], // German long year
    ['01.04.26', '2026-04-01'], // German short year
  ])('normalizes "%s" → "%s"', (input, expected) => {
    expect(normalizeAvailableFrom(input)).toBe(expected);
  });

  it('returns null for empty string', () => {
    expect(normalizeAvailableFrom('')).toBeNull();
  });

  it('returns null for null', () => {
    expect(normalizeAvailableFrom(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(normalizeAvailableFrom(undefined)).toBeNull();
  });

  it('returns the raw string for unrecognized formats', () => {
    expect(normalizeAvailableFrom('nach Absprache')).toBe('nach Absprache');
    expect(normalizeAvailableFrom('Q2 2026')).toBe('Q2 2026');
  });
});
