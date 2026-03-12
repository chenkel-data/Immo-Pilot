/*
 * Diagnoses favorites status after scraping:
 * - Which agents does the DB have?
 * - Which favorites exist, assigned to which agent?
 * - Are there orphan listings (search_config_id = NULL)?
 * - Are there duplicate links?
 * - URL matching: are favorites of the new agent the same URLs as former orphans?
 *
 * node scripts/diagnose-favorites.js
 */

import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'data', 'listings.db');

if (!fs.existsSync(DB_PATH)) {
  console.error('❌ No database found:', DB_PATH);
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH);

// ── Agents ──────────────────────────────────────────────────────────────────────
const configs = db.prepare('SELECT id, name, city FROM search_configs ORDER BY id').all();
console.log('\n=== SEARCH AGENTS ===');
if (configs.length === 0) console.log('  (none)');
configs.forEach(c => console.log(`  ID ${c.id}: ${c.name || c.city || '?'}`));

// ── Overall Stats ──────────────────────────────────────────────────────────────
const total     = db.prepare('SELECT COUNT(*) as n FROM listings').get().n;
const favTotal  = db.prepare('SELECT COUNT(*) as n FROM listings WHERE is_favorite = 1').get().n;
const blkTotal  = db.prepare('SELECT COUNT(*) as n FROM listings WHERE is_blacklisted = 1').get().n;
const orphTotal = db.prepare("SELECT COUNT(*) as n FROM listings WHERE search_config_id IS NULL").get().n;
const orphFav   = db.prepare("SELECT COUNT(*) as n FROM listings WHERE search_config_id IS NULL AND is_favorite = 1").get().n;
console.log(`\n=== TOTAL ===`);
console.log(`  Listings: ${total}  |  Favorites: ${favTotal}  |  Blacklisted: ${blkTotal}  |  Orphans: ${orphTotal} (${orphFav} of them favorites)`);

// ── Favorites per Agent ───────────────────────────────────────────────────────────
const favs = db.prepare(`
  SELECT l.id, l.title, l.search_config_id, l.first_seen, l.link,
         sc.name as agent_name, sc.city
  FROM listings l
  LEFT JOIN search_configs sc ON sc.id = l.search_config_id
  WHERE l.is_favorite = 1
  ORDER BY l.search_config_id NULLS FIRST, l.first_seen DESC
`).all();

console.log(`\n=== FAVORITES (${favs.length} total) per Agent ===`);
const byAgent = new Map();
for (const f of favs) {
    const key = f.search_config_id != null ? `Agent ${f.search_config_id} (${f.agent_name || f.city || '?'})` : '⚠️  ORPHAN (no agent)';
  if (!byAgent.has(key)) byAgent.set(key, []);
  byAgent.get(key).push(f);
}
for (const [label, list] of byAgent) {
  console.log(`\n  ${label}:`);
  for (const f of list) {
    console.log(`    [${f.id}] ${(f.title || '?').slice(0, 55).padEnd(55)} ${(f.first_seen || '').slice(0, 10)}`);
    console.log(`         ${f.link?.slice(0, 90)}`);
  }
}

// ── Duplicate Links ────────────────────────────────────────────────────────────────
const dupes = db.prepare(`
  SELECT link, COUNT(*) as cnt
  FROM listings
  GROUP BY link HAVING COUNT(*) > 1
`).all();
if (dupes.length) {
  console.log(`\n⚠️  DUPLICATE LINKS (${dupes.length}):`);
  dupes.forEach(d => console.log(`  (${d.cnt}x) ${d.link}`));
} else {
  console.log('\n✅ No duplicate links in the DB.');
}

// ── URL Matching: favorite URLs of the newest agent vs orphan URLs ────────────
if (configs.length > 0) {
  const newestAgentId = configs[configs.length - 1].id;
  const agentFavLinks = new Set(
    db.prepare('SELECT link FROM listings WHERE search_config_id = ? AND is_favorite = 1')
      .all(newestAgentId).map(r => r.link)
  );
  if (agentFavLinks.size === 0) {
      console.log(`\n  Agent ${newestAgentId}: no favorites.`);
  } else {
      // Check: did these links ever exist as an orphan or under a different agent?
    const orphanLinks = new Set(
      db.prepare("SELECT link FROM listings WHERE search_config_id IS NULL").all().map(r => r.link)
    );
    const fromOrphan = [...agentFavLinks].filter(l => orphanLinks.has(l));

      console.log(`\n=== URL MATCH: Agent ${newestAgentId} favorites vs orphans ===`);
      console.log(`  Agent ${newestAgentId} favorite links: ${agentFavLinks.size}`);
      console.log(`  Orphan links total:               ${orphanLinks.size}`);
    if (fromOrphan.length > 0) {
      console.log(`  ⚠️  ${fromOrphan.length} favorite URL(s) ALSO still exist as orphans:`);
      fromOrphan.forEach(l => console.log(`     ${l}`));
    } else {
        console.log(`  ✅ No overlap – no listing is simultaneously a favorite of the agent and an orphan.`);
    }
  }
}

console.log('');
