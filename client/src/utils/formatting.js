/**
 * Utility functions for formatting.
 */

/**
 * Parses a price or area specification to a number.
 */
export function parseNum(str) {
  if (!str) return null;
  const m = String(str).replace(/\./g, '').match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

/**
 * Formats an ISO date as a human-readable relative date (German locale).
 * - < 1h:    "Vor 23 Minuten"
 * - < 12h:   "Vor 3 Stunden"
 * - < 24h:   "Heute, 14:33"
 * - Yesterday: "Gestern, 09:12"
 * - Older:   "7. März 2026" (date only, time irrelevant after > 1 day)
 */
export function formatListingDate(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (isNaN(date.getTime())) return null;

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffH   = Math.floor(diffMs / 3600000);

  if (diffMs < 0) {
    // Future date (should not happen) → fall through to absolute
  } else if (diffMin < 2) {
    return 'Gerade eben';
  } else if (diffMin < 60) {
    return `Vor ${diffMin} Minute${diffMin === 1 ? '' : 'n'}`;
  } else if (diffH < 12) {
    return `Vor ${diffH} Stunde${diffH === 1 ? '' : 'n'}`;
  } else {
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterdayStart = new Date(todayStart.getTime() - 86400000);

    if (date >= todayStart) {
      return `Heute, ${hh}:${mm}`;
    }
    if (date >= yesterdayStart) {
      return `Gestern, ${hh}:${mm}`;
    }
  }

  // Older than yesterday → date only, no time
  return date.toLocaleDateString('de-DE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Validates whether an image URL is usable.
 */
export function isValidImageUrl(imageUrl) {
  if (!imageUrl) return false;
  if (imageUrl.startsWith('//')) return false;
  if (imageUrl.includes('placeholder')) return false;
  if (imageUrl.startsWith('data:')) return false;
  return true;
}
