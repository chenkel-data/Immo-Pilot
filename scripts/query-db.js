/*
 * Interactive DB inspect script.
 * Displays the contents of the local SQLite database in the console.
 *
 * Usage:
 *   node scripts/query-db.js              → overview + last 10 listings
 *   node scripts/query-db.js listings     → all listings (table)
 *   node scripts/query-db.js all          → all listings (compact)
 *   node scripts/query-db.js runs         → scraping history
 *   node scripts/query-db.js sql "SELECT title, price FROM listings LIMIT 5"
 */

import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'data', 'listings.db');

if (!fs.existsSync(DB_PATH)) {
  console.error(`\n❌ No database found at: ${DB_PATH}`);
  console.error('   → Start the scraper first with: npm run test:scraper\n');
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH);
const cmd = process.argv[2] || 'overview';
const sqlArg = process.argv[3];

// ── Helper Functions ──────────────────────────────────────────────────────────────

function table(rows, columns) {
  if (!rows.length) { console.log('  (no entries)\n'); return; }
  const cols = columns || Object.keys(rows[0]);
  // Determine column widths
  const widths = cols.map((c) =>
    Math.min(50, Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length)))
  );
  const line = widths.map((w) => '─'.repeat(w + 2)).join('┼');
  const header = cols.map((c, i) => ` ${c.padEnd(widths[i])} `).join('│');

  console.log('┌' + widths.map((w) => '─'.repeat(w + 2)).join('┬') + '┐');
  console.log('│' + header + '│');
  console.log('├' + line + '┤');
  rows.forEach((row) => {
    const cells = cols.map((c, i) => {
      const v = String(row[c] ?? '').replace(/\n/g, ' ').slice(0, widths[i]);
      return ` ${v.padEnd(widths[i])} `;
    });
    console.log('│' + cells.join('│') + '│');
  });
  console.log('└' + widths.map((w) => '─'.repeat(w + 2)).join('┴') + '┘');
}

function fmt(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
}

// ── Commands ───────────────────────────────────────────────────────────────────

if (cmd === 'overview' || cmd === 'o') {
  const totalListings  = db.prepare(`SELECT COUNT(*) AS n FROM listings`).get().n;
  const unseenListings = db.prepare(`SELECT COUNT(*) AS n FROM listings WHERE is_seen = 0`).get().n;
  const favorites      = db.prepare(`SELECT COUNT(*) AS n FROM listings WHERE is_favorite = 1`).get().n;
  const totalRuns      = db.prepare(`SELECT COUNT(*) AS n FROM scrape_runs`).get().n;
  const lastRun        = db.prepare(`SELECT * FROM scrape_runs ORDER BY started_at DESC LIMIT 1`).get();

  console.log('\n📊 Database overview');
  console.log('═══════════════════════════════════════');
  console.log(`  File           : ${DB_PATH}`);
  console.log(`  Listings total : ${totalListings}`);
  console.log(`  Unseen         : ${unseenListings}`);
  console.log(`  Favorites      : ${favorites}`);
  console.log(`  Scrape runs    : ${totalRuns}`);
  if (lastRun) {
      console.log(`  Last run        : ${fmt(lastRun.started_at)} → ${lastRun.status} (${lastRun.total_count} total, ${lastRun.new_count} new)`);
  }
  console.log('');

  console.log('🏠 Last 10 listings:');
  const rows = db.prepare(`
    SELECT id, title, price, size, address, first_seen
    FROM listings
    ORDER BY first_seen DESC LIMIT 10
  `).all().map((r) => ({ ...r, first_seen: fmt(r.first_seen) }));
  table(rows, ['title', 'price', 'size', 'address', 'first_seen']);
  console.log(`\n  Tip: node scripts/query-db.js listings   → show all`);
  console.log(`       node scripts/query-db.js sql "SELECT ..."  → custom query\n`);

} else if (cmd === 'listings' || cmd === 'l') {
  const rows = db.prepare(`
    SELECT id, title, price, size, rooms, publisher, address,
           CASE WHEN is_seen=1 THEN '✓' ELSE '○' END AS seen,
           CASE WHEN is_favorite=1 THEN '⭐' ELSE '' END AS fav,
           first_seen
    FROM listings
    ORDER BY first_seen DESC
  `).all().map((r) => ({ ...r, first_seen: fmt(r.first_seen) }));
  console.log(`\n🏠 Listings (${rows.length}):\n`);
  table(rows, ['title', 'price', 'size', 'rooms', 'publisher', 'address', 'seen', 'fav', 'first_seen']);
  console.log('');

} else if (cmd === 'all') {
  const rows = db.prepare(`
    SELECT id, title, price,
           first_seen, last_seen
    FROM listings ORDER BY first_seen DESC
  `).all().map((r) => ({ ...r, first_seen: fmt(r.first_seen), last_seen: fmt(r.last_seen) }));
  console.log(`\n🏠 All listings (${rows.length}):\n`);
  table(rows, ['title', 'price', 'first_seen', 'last_seen']);
  console.log('');

} else if (cmd === 'runs' || cmd === 'r') {
  const rows = db.prepare(`SELECT * FROM scrape_runs ORDER BY started_at DESC LIMIT 30`).all()
    .map((r) => {
      const dur = r.ended_at
        ? Math.round((new Date(r.ended_at) - new Date(r.started_at)) / 1000) + 's'
        : '…';
      return { source: r.source, started: fmt(r.started_at), duration: dur, status: r.status, new: r.new_count, total: r.total_count, error: r.error ?? '' };
    });
  console.log(`\n🔄 Scraping History (${rows.length} runs):\n`);
  table(rows, ['source', 'started', 'duration', 'status', 'new', 'total', 'error']);
  console.log('');

} else if (cmd === 'sql') {
  if (!sqlArg) {
      console.error('❌ No SQL provided. Example:\n  node scripts/query-db.js sql "SELECT title, price FROM listings LIMIT 5"\n');
    process.exit(1);
  }
  console.log(`\n🗄️  SQL: ${sqlArg}\n`);
  try {
    const rows = db.prepare(sqlArg).all();
    table(rows);
  } catch (err) {
      console.error('❌ SQL error:', err.message);
  }
  console.log('');

} else {
  console.log('\nAvailable commands:');
  console.log('  node scripts/query-db.js              → Overview');
  console.log('  node scripts/query-db.js listings     → all listings');
  console.log('  node scripts/query-db.js all          → all listings (compact)');
  console.log('  node scripts/query-db.js runs         → scraping history');
  console.log('  node scripts/query-db.js sql "SELECT title, price FROM listings LIMIT 5"\n');
}
