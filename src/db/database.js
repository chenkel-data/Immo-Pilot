/*
 * SQLite database layer – uses node:sqlite (Node.js built-in, requires v22.5+)
 */

import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { normalizeAvailableFrom } from '../utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR = path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DB_DIR, 'listings.db');

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// ── Core Schema ────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS listings (
    id          TEXT PRIMARY KEY,
    source      TEXT NOT NULL,
    title       TEXT NOT NULL,
    price       TEXT,
    size        TEXT,
    rooms       TEXT,
    address     TEXT,
    description TEXT,
    publisher   TEXT,
    link        TEXT NOT NULL,
    image       TEXT,
    is_seen     INTEGER NOT NULL DEFAULT 0,
    is_favorite INTEGER NOT NULL DEFAULT 0,
    first_seen  TEXT NOT NULL,
    last_seen   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS scrape_runs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    source     TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at   TEXT,
    status     TEXT NOT NULL DEFAULT 'running',
    new_count  INTEGER DEFAULT 0,
    total_count INTEGER DEFAULT 0,
    error      TEXT
  );

  CREATE TABLE IF NOT EXISTS search_configs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    provider     TEXT NOT NULL DEFAULT 'kleinanzeigen',
    listing_type TEXT NOT NULL DEFAULT 'miete',
    max_pages    INTEGER NOT NULL DEFAULT 10,
    extra_params TEXT DEFAULT '{}',
    enabled      INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS blacklist (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id TEXT,
    url        TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(listing_id)
  );

  CREATE TABLE IF NOT EXISTS listing_agents (
    listing_id       TEXT NOT NULL,
    search_config_id INTEGER NOT NULL,
    PRIMARY KEY (listing_id, search_config_id),
    FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE,
    FOREIGN KEY (search_config_id) REFERENCES search_configs(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS listing_details (
    listing_id            TEXT PRIMARY KEY,
    provider              TEXT NOT NULL,
    expose_id             TEXT,
    fetched_at            TEXT NOT NULL,
    source_version        TEXT,
    status                TEXT NOT NULL DEFAULT 'ok',
    error                 TEXT,
    available_from        TEXT,
    available_from_source TEXT,
    cold_rent             TEXT,
    warm_rent             TEXT,
    service_charge        TEXT,
    deposit               TEXT,
    price_per_sqm         TEXT,
    floor                 TEXT,
    bedrooms              TEXT,
    bathrooms             TEXT,
    pets                  TEXT,
    has_kitchen           INTEGER,
    has_cellar            INTEGER,
    has_balcony           INTEGER,
    has_garden            INTEGER,
    has_lift              INTEGER,
    barrier_free          INTEGER,
    construction_year     TEXT,
    condition             TEXT,
    heating_type          TEXT,
    energy_carrier        TEXT,
    energy_class          TEXT,
    energy_value          TEXT,
    description           TEXT,
    location_description  TEXT,
    address_line1         TEXT,
    address_line2         TEXT,
    lat                   REAL,
    lon                   REAL,
    agent_name            TEXT,
    contact_phone_numbers TEXT,
    contact_available     INTEGER,
    images                TEXT,
    attribute_groups      TEXT,
    raw_detail_json       TEXT,
    FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE
  );
`);

// ── Migrations for existing DBs ───────────────────────────────────────────

const safeAlter = (sql) => {
  try {
    db.exec(sql);
  } catch (_) {}
};

// listings table additions
safeAlter('ALTER TABLE listings ADD COLUMN rooms TEXT');
safeAlter('ALTER TABLE listings ADD COLUMN publisher TEXT');
safeAlter('ALTER TABLE listings ADD COLUMN listed_at TEXT');
safeAlter('ALTER TABLE listings ADD COLUMN images TEXT');
safeAlter("ALTER TABLE listings ADD COLUMN provider TEXT DEFAULT 'kleinanzeigen'");
safeAlter("ALTER TABLE listings ADD COLUMN listing_type TEXT DEFAULT 'miete'");
safeAlter('ALTER TABLE listings ADD COLUMN search_config_id INTEGER');
safeAlter('ALTER TABLE listings ADD COLUMN is_blacklisted INTEGER DEFAULT 0');

// scrape_runs table additions
safeAlter('ALTER TABLE scrape_runs ADD COLUMN provider TEXT');
safeAlter('ALTER TABLE scrape_runs ADD COLUMN listing_type TEXT');
safeAlter('ALTER TABLE scrape_runs ADD COLUMN search_config_id INTEGER');

// search_configs table additions
safeAlter("ALTER TABLE search_configs ADD COLUMN name TEXT DEFAULT ''");
safeAlter('ALTER TABLE search_configs DROP COLUMN city');
safeAlter('ALTER TABLE search_configs DROP COLUMN radius');

// listings blacklist timestamp
safeAlter('ALTER TABLE listings ADD COLUMN blacklisted_at TEXT');
safeAlter('ALTER TABLE listings ADD COLUMN available_from TEXT');
safeAlter('ALTER TABLE listings ADD COLUMN favorited_at TEXT');
safeAlter('ALTER TABLE listings ADD COLUMN scrape_rank INTEGER');

// listing_agents per-agent rank (sort order of provider)
safeAlter('ALTER TABLE listing_agents ADD COLUMN scrape_rank INTEGER');

// per-agent: tracks which scrape run last actively scraped this listing (for partition sort)
safeAlter('ALTER TABLE listing_agents ADD COLUMN last_scraped_run_id INTEGER');

// Index for fast link-based deduplication
db.exec('CREATE INDEX IF NOT EXISTS idx_listings_link ON listings(link)');

// Index for fast agent lookups on the junction table
db.exec('CREATE INDEX IF NOT EXISTS idx_listing_agents_config ON listing_agents(search_config_id)');

// Index for ordering or inspecting detail fetch timestamps
db.exec('CREATE INDEX IF NOT EXISTS idx_listing_details_fetched ON listing_details(fetched_at)');

// Migration: populate listing_agents from existing search_config_id values
{
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO listing_agents (listing_id, search_config_id)
       SELECT id, search_config_id FROM listings
       WHERE search_config_id IS NOT NULL
         AND search_config_id IN (SELECT id FROM search_configs)`,
    )
    .run();
  if (result.changes > 0)
    console.log(`[db] ${result.changes} listing-agent link(s) migrated to listing_agents table.`);
}

// Migration: set search_config_id = NULL for orphaned listings (deleted agents)
{
  const result = db
    .prepare(
      'UPDATE listings SET search_config_id = NULL WHERE search_config_id IS NOT NULL AND search_config_id NOT IN (SELECT id FROM search_configs)',
    )
    .run();
  if (result.changes > 0)
    console.log(`[db] ${result.changes} orphaned listing(s) cleaned up (deleted agents).`);
}

// Upgrade image URLs of all existing listings to full resolution (one-time migration)
{
  const rows = db.prepare('SELECT id, image FROM listings WHERE image IS NOT NULL').all();
  const upgrade = (u) => u.replace('/thumbs/images/', '/images/').replace(/s-l\d+\./, 's-l1600.');
  const stmt = db.prepare('UPDATE listings SET image = ? WHERE id = ?');
  let count = 0;
  for (const row of rows) {
    const upgraded = upgrade(row.image);
    if (upgraded !== row.image) {
      stmt.run(upgraded, row.id);
      count++;
    }
  }
  if (count > 0) console.log(`[db] ${count} image URL(s) upgraded to s-l1600.`);
}

// Normalize available_from values to ISO where possible
{
  const rows = db
    .prepare('SELECT id, available_from FROM listings WHERE available_from IS NOT NULL')
    .all();
  const stmt = db.prepare('UPDATE listings SET available_from = ? WHERE id = ?');
  let count = 0;
  for (const row of rows) {
    const normalized = normalizeAvailableFrom(row.available_from);
    if (normalized !== row.available_from) {
      stmt.run(normalized, row.id);
      count++;
    }
  }
  if (count > 0) console.log(`[db] ${count} available_from value(s) normalized.`);
}

// ── Search Configs ──────────────────────────────────────────────────────────

export function createSearchConfig({
  provider = 'kleinanzeigen',
  listingType = 'miete',
  maxPages = 10,
  extraParams = {},
  name = '',
}) {
  const res = db
    .prepare(
      `
    INSERT INTO search_configs (provider, listing_type, max_pages, extra_params, name)
    VALUES (?, ?, ?, ?, ?)
  `,
    )
    .run(provider, listingType, maxPages, JSON.stringify(extraParams), name);
  return getSearchConfigById(Number(res.lastInsertRowid));
}

export function getAllSearchConfigs() {
  return db.prepare('SELECT * FROM search_configs ORDER BY created_at DESC').all();
}

export function getEnabledSearchConfigs() {
  return db.prepare('SELECT * FROM search_configs WHERE enabled = 1 ORDER BY id ASC').all();
}

function getSearchConfigById(id) {
  return db.prepare('SELECT * FROM search_configs WHERE id = ?').get(id);
}

export function updateSearchConfig(id, data) {
  const cfg = getSearchConfigById(id);
  if (!cfg) throw new Error(`SearchConfig ${id} nicht gefunden`);
  const fields = [];
  const params = [];
  for (const [k, v] of Object.entries(data)) {
    const col =
      k === 'listingType'
        ? 'listing_type'
        : k === 'maxPages'
          ? 'max_pages'
          : k === 'extraParams'
            ? 'extra_params'
            : k;
    if (
      ['provider', 'listing_type', 'max_pages', 'extra_params', 'enabled', 'name'].includes(col)
    ) {
      fields.push(`${col} = ?`);
      params.push(col === 'extra_params' ? JSON.stringify(v) : v);
    }
  }
  if (fields.length === 0) return cfg;
  params.push(id);
  db.prepare(`UPDATE search_configs SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return getSearchConfigById(id);
}

export function deleteSearchConfig(id) {
  // Remove junction entries for this agent
  db.prepare('DELETE FROM listing_agents WHERE search_config_id = ?').run(id);
  // Delete listings with no remaining agent associations and not pinned
  db.prepare(
    `DELETE FROM listings
     WHERE is_favorite = 0 AND is_blacklisted = 0
       AND id NOT IN (SELECT listing_id FROM listing_agents)`,
  ).run();
  // Delete scrape run history for this agent
  db.prepare('DELETE FROM scrape_runs WHERE search_config_id = ?').run(id);
  // Delete the config itself
  db.prepare('DELETE FROM search_configs WHERE id = ?').run(id);
}

// ── Blacklist ────────────────────────────────────────────────────────────────

export function blacklistListing(listingId) {
  const listing = getListingById(listingId);
  if (!listing) throw new Error('Listing nicht gefunden');
  db.prepare('INSERT OR IGNORE INTO blacklist (listing_id, url) VALUES (?, ?)').run(
    listingId,
    listing.link,
  );
  db.prepare(
    "UPDATE listings SET is_blacklisted = 1, is_favorite = 0, favorited_at = NULL, blacklisted_at = datetime('now') WHERE id = ?",
  ).run(listingId);
  return { ok: true, wasFavorite: listing.is_favorite === 1 };
}

export function unblacklistListing(listingId) {
  db.prepare('DELETE FROM blacklist WHERE listing_id = ?').run(listingId);
  db.prepare('UPDATE listings SET is_blacklisted = 0 WHERE id = ?').run(listingId);
  return { ok: true };
}

export function isUrlBlacklisted(url) {
  const row = db.prepare('SELECT 1 FROM blacklist WHERE url = ? LIMIT 1').get(url);
  return !!row;
}

export function getBlacklistCount() {
  const row = db.prepare('SELECT COUNT(*) as cnt FROM blacklist').get();
  return row?.cnt ?? 0;
}

export function clearAllFavorites() {
  db.prepare(
    'UPDATE listings SET is_favorite = 0, favorited_at = NULL WHERE is_favorite = 1',
  ).run();
}

export function clearFavoritesByConfig(searchConfigId) {
  db.prepare(
    `UPDATE listings SET is_favorite = 0, favorited_at = NULL
     WHERE is_favorite = 1
       AND id IN (SELECT listing_id FROM listing_agents WHERE search_config_id = ?)`,
  ).run(searchConfigId);
}

export function clearAllBlacklist() {
  db.exec('DELETE FROM blacklist');
  db.prepare('UPDATE listings SET is_blacklisted = 0 WHERE is_blacklisted = 1').run();
}

export function clearBlacklistByConfig(searchConfigId) {
  db.prepare(
    `DELETE FROM blacklist WHERE listing_id IN (
       SELECT listing_id FROM listing_agents WHERE search_config_id = ?
     )`,
  ).run(searchConfigId);
  db.prepare(
    `UPDATE listings SET is_blacklisted = 0
     WHERE is_blacklisted = 1
       AND id IN (SELECT listing_id FROM listing_agents WHERE search_config_id = ?)`,
  ).run(searchConfigId);
}

// ── Stats ────────────────────────────────────────────────────────────────────

export function getStats() {
  const total =
    db.prepare('SELECT COUNT(*) as cnt FROM listings WHERE is_blacklisted = 0').get()?.cnt ?? 0;
  const unseen =
    db
      .prepare('SELECT COUNT(*) as cnt FROM listings WHERE is_blacklisted = 0 AND is_seen = 0')
      .get()?.cnt ?? 0;
  const favorites =
    db
      .prepare('SELECT COUNT(*) as cnt FROM listings WHERE is_favorite = 1 AND is_blacklisted = 0')
      .get()?.cnt ?? 0;
  const blacklisted =
    db.prepare('SELECT COUNT(*) as cnt FROM listings WHERE is_blacklisted = 1').get()?.cnt ?? 0;
  return { total, unseen, favorites, blacklisted };
}

// ── Listings ─────────────────────────────────────────────────────────────────

export function upsertListing(l) {
  l.available_from = normalizeAvailableFrom(l.available_from);

  // Check URL blacklist
  if (l.link && isUrlBlacklisted(l.link)) {
    l.is_blacklisted = 1;
  }

  db.prepare(
    `
    INSERT INTO listings (id, source, provider, listing_type, title, price, size, rooms, address, description, publisher, link, image, is_blacklisted, listed_at, available_from, first_seen, last_seen, scrape_rank)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      price           = excluded.price,
      size            = excluded.size,
      rooms           = COALESCE(excluded.rooms, rooms),
      address         = excluded.address,
      description     = excluded.description,
      publisher       = COALESCE(excluded.publisher, publisher),
      image           = excluded.image,
      listed_at       = COALESCE(excluded.listed_at, listed_at),
      available_from  = COALESCE(excluded.available_from, available_from),
      last_seen       = excluded.last_seen,
      scrape_rank     = excluded.scrape_rank
  `,
  ).run(
    l.id,
    l.source ?? l.provider ?? 'kleinanzeigen',
    l.provider ?? 'kleinanzeigen',
    l.listing_type ?? 'miete',
    l.title,
    l.price ?? null,
    l.size ?? null,
    l.rooms ?? null,
    l.address ?? null,
    l.description ?? null,
    l.publisher ?? null,
    l.link,
    l.image ?? null,
    l.is_blacklisted ?? 0,
    l.listed_at ?? null,
    l.available_from ?? null,
    l.first_seen,
    l.last_seen,
    l.scrape_rank ?? null,
  );

  // Create/update junction entry for the agent that scraped this listing,
  // storing the per-agent scrape_rank so each agent has its own sort order (and does not overwrite others for shared listings).
  if (l.search_config_id) {
    db.prepare(
      `INSERT INTO listing_agents (listing_id, search_config_id, scrape_rank, last_scraped_run_id)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(listing_id, search_config_id) DO UPDATE SET
         scrape_rank = excluded.scrape_rank,
         last_scraped_run_id = excluded.last_scraped_run_id`,
    ).run(l.id, l.search_config_id, l.scrape_rank ?? null, l.run_id ?? null);
  }
}

export function setListingImages(id, images) {
  db.prepare('UPDATE listings SET images = ? WHERE id = ?').run(JSON.stringify(images), id);
}

export function markSeen(id) {
  return db.prepare('UPDATE listings SET is_seen = 1 WHERE id = ?').run(id);
}

export function markUnseen(id) {
  return db.prepare('UPDATE listings SET is_seen = 0 WHERE id = ?').run(id);
}

export function markAllSeen() {
  return db.prepare('UPDATE listings SET is_seen = 1').run();
}

export function toggleFavorite(id) {
  const listing = getListingById(id);
  if (!listing) return null;
  if (listing.is_blacklisted) {
    db.prepare('DELETE FROM blacklist WHERE listing_id = ?').run(id);
    db.prepare(
      "UPDATE listings SET is_favorite = 1, is_blacklisted = 0, favorited_at = datetime('now') WHERE id = ?",
    ).run(id);
  } else if (listing.is_favorite) {
    db.prepare('UPDATE listings SET is_favorite = 0, favorited_at = NULL WHERE id = ?').run(id);
  } else {
    db.prepare(
      "UPDATE listings SET is_favorite = 1, favorited_at = datetime('now') WHERE id = ?",
    ).run(id);
  }
  return getListingById(id);
}

export function getListings({
  onlyUnseen = false,
  onlyFavorites = false,
  listingType = null,
  provider = null,
  searchConfigId = null,
  hideBlacklisted = true,
  showBlacklisted = false,
  includeBlacklisted = false,
  blacklistKeywords = [],
} = {}) {
  const conditions = [];
  const params = [];
  let joinClause = '';

  // Filter by agent via junction table
  if (searchConfigId) {
    joinClause = 'INNER JOIN listing_agents la ON la.listing_id = l.id AND la.search_config_id = ?';
    params.push(searchConfigId);
  }

  if (onlyUnseen) conditions.push('l.is_seen = 0');
  if (onlyFavorites) conditions.push('l.is_favorite = 1');
  if (showBlacklisted) conditions.push('l.is_blacklisted = 1');
  else if (!includeBlacklisted && hideBlacklisted) conditions.push('l.is_blacklisted = 0');
  if (listingType) {
    conditions.push('l.listing_type = ?');
    params.push(listingType);
  }
  if (provider) {
    conditions.push('l.provider = ?');
    params.push(provider);
  }

  for (const term of blacklistKeywords) {
    conditions.push(
      "(LOWER(COALESCE(l.title,'')) NOT LIKE LOWER(?) AND LOWER(COALESCE(l.description,'')) NOT LIKE LOWER(?) AND LOWER(COALESCE(l.publisher,'')) NOT LIKE LOWER(?))",
    );
    params.push(`%${term}%`, `%${term}%`, `%${term}%`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  // When filtering by a specific agent, sort by newest run first, then by provider rank within that run
  let orderBy;
  if (searchConfigId) {
    orderBy = 'la.last_scraped_run_id DESC NULLS LAST, la.scrape_rank ASC NULLS LAST';
  } else {
    orderBy = 'l.scrape_rank ASC NULLS LAST';
  }

  const sql = `
    SELECT l.*,
      (SELECT GROUP_CONCAT(la2.search_config_id) FROM listing_agents la2 WHERE la2.listing_id = l.id) as agent_ids
    FROM listings l
    ${joinClause}
    ${where}
    ORDER BY ${orderBy}
  `;
  const rows = db.prepare(sql).all(...params);
  return rows.map((r) => ({
    ...r,
    agent_ids: r.agent_ids ? r.agent_ids.split(',').map(Number) : [],
  }));
}

export function getListingById(id) {
  const row = db
    .prepare(
      `SELECT l.*,
        (SELECT GROUP_CONCAT(la.search_config_id) FROM listing_agents la WHERE la.listing_id = l.id) as agent_ids
       FROM listings l WHERE l.id = ?`,
    )
    .get(id);
  if (!row) return null;
  return { ...row, agent_ids: row.agent_ids ? row.agent_ids.split(',').map(Number) : [] };
}

function jsonString(value) {
  return value == null ? null : JSON.stringify(value);
}

function jsonValue(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeDetailRow(row) {
  if (!row) return null;
  return {
    ...row,
    contact_phone_numbers: jsonValue(row.contact_phone_numbers, []),
    images: jsonValue(row.images, []),
    attribute_groups: jsonValue(row.attribute_groups, []),
    raw_detail_json: jsonValue(row.raw_detail_json, null),
  };
}

export function upsertListingDetail(detail) {
  const fetchedAt = detail.fetched_at ?? new Date().toISOString();

  db.prepare(
    `
    INSERT INTO listing_details (
      listing_id, provider, expose_id, fetched_at, source_version, status, error,
      available_from, available_from_source,
      cold_rent, warm_rent, service_charge, deposit, price_per_sqm,
      floor, bedrooms, bathrooms, pets,
      has_kitchen, has_cellar, has_balcony, has_garden, has_lift, barrier_free,
      construction_year, condition, heating_type, energy_carrier, energy_class, energy_value,
      description, location_description, address_line1, address_line2, lat, lon,
      agent_name, contact_phone_numbers, contact_available, images, attribute_groups, raw_detail_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(listing_id) DO UPDATE SET
      provider              = excluded.provider,
      expose_id             = excluded.expose_id,
      fetched_at            = excluded.fetched_at,
      source_version        = excluded.source_version,
      status                = excluded.status,
      error                 = excluded.error,
      available_from        = excluded.available_from,
      available_from_source = excluded.available_from_source,
      cold_rent             = excluded.cold_rent,
      warm_rent             = excluded.warm_rent,
      service_charge        = excluded.service_charge,
      deposit               = excluded.deposit,
      price_per_sqm         = excluded.price_per_sqm,
      floor                 = excluded.floor,
      bedrooms              = excluded.bedrooms,
      bathrooms             = excluded.bathrooms,
      pets                  = excluded.pets,
      has_kitchen           = excluded.has_kitchen,
      has_cellar            = excluded.has_cellar,
      has_balcony           = excluded.has_balcony,
      has_garden            = excluded.has_garden,
      has_lift              = excluded.has_lift,
      barrier_free          = excluded.barrier_free,
      construction_year     = excluded.construction_year,
      condition             = excluded.condition,
      heating_type          = excluded.heating_type,
      energy_carrier        = excluded.energy_carrier,
      energy_class          = excluded.energy_class,
      energy_value          = excluded.energy_value,
      description           = excluded.description,
      location_description  = excluded.location_description,
      address_line1         = excluded.address_line1,
      address_line2         = excluded.address_line2,
      lat                   = excluded.lat,
      lon                   = excluded.lon,
      agent_name            = excluded.agent_name,
      contact_phone_numbers = excluded.contact_phone_numbers,
      contact_available     = excluded.contact_available,
      images                = excluded.images,
      attribute_groups      = excluded.attribute_groups,
      raw_detail_json       = excluded.raw_detail_json
  `,
  ).run(
    detail.listing_id,
    detail.provider ?? 'immoscout24',
    detail.expose_id ?? null,
    fetchedAt,
    detail.source_version ?? null,
    detail.status ?? 'ok',
    detail.error ?? null,
    detail.available_from ?? null,
    detail.available_from_source ?? null,
    detail.cold_rent ?? null,
    detail.warm_rent ?? null,
    detail.service_charge ?? null,
    detail.deposit ?? null,
    detail.price_per_sqm ?? null,
    detail.floor ?? null,
    detail.bedrooms ?? null,
    detail.bathrooms ?? null,
    detail.pets ?? null,
    detail.has_kitchen ?? null,
    detail.has_cellar ?? null,
    detail.has_balcony ?? null,
    detail.has_garden ?? null,
    detail.has_lift ?? null,
    detail.barrier_free ?? null,
    detail.construction_year ?? null,
    detail.condition ?? null,
    detail.heating_type ?? null,
    detail.energy_carrier ?? null,
    detail.energy_class ?? null,
    detail.energy_value ?? null,
    detail.description ?? null,
    detail.location_description ?? null,
    detail.address_line1 ?? null,
    detail.address_line2 ?? null,
    detail.lat ?? null,
    detail.lon ?? null,
    detail.agent_name ?? null,
    jsonString(detail.contact_phone_numbers ?? []),
    detail.contact_available ?? null,
    jsonString(detail.images ?? []),
    jsonString(detail.attribute_groups ?? []),
    jsonString(detail.raw_detail_json ?? null),
  );

  if (
    /^\d{4}-\d{2}-\d{2}$/.test(detail.available_from ?? '') ||
    detail.available_from === 'sofort'
  ) {
    db.prepare('UPDATE listings SET available_from = COALESCE(available_from, ?) WHERE id = ?').run(
      detail.available_from,
      detail.listing_id,
    );
  }

  if (Array.isArray(detail.images) && detail.images.length > 0) {
    db.prepare('UPDATE listings SET images = COALESCE(images, ?) WHERE id = ?').run(
      jsonString(detail.images),
      detail.listing_id,
    );
  }
}

export function markListingDetailError({
  listingId,
  provider = 'immoscout24',
  exposeId = null,
  error,
}) {
  db.prepare(
    `
    INSERT INTO listing_details (listing_id, provider, expose_id, fetched_at, status, error)
    VALUES (?, ?, ?, ?, 'error', ?)
    ON CONFLICT(listing_id) DO UPDATE SET
      provider   = excluded.provider,
      expose_id  = excluded.expose_id,
      fetched_at = excluded.fetched_at,
      status     = 'error',
      error      = excluded.error
  `,
  ).run(listingId, provider, exposeId, new Date().toISOString(), error ?? null);
}

export function getListingDetailById(listingId) {
  const row = db.prepare('SELECT * FROM listing_details WHERE listing_id = ?').get(listingId);
  return normalizeDetailRow(row);
}

export function resetAll() {
  db.exec('DELETE FROM listing_agents');
  db.exec('DELETE FROM listings');
  db.exec('DELETE FROM scrape_runs');
  db.exec('DELETE FROM blacklist');
  db.exec('VACUUM');
}

export function purgeListingsKeepPinned() {
  db.exec('DELETE FROM listings WHERE is_favorite = 0 AND is_blacklisted = 0');
  db.exec('VACUUM');
}

export function purgeListingsByConfig(searchConfigId) {
  // Remove junction for non-pinned listings of this agent
  db.prepare(
    `DELETE FROM listing_agents
     WHERE search_config_id = ?
       AND listing_id IN (
         SELECT id FROM listings WHERE is_favorite = 0 AND is_blacklisted = 0
       )`,
  ).run(searchConfigId);
  // Delete listings with no remaining agent associations and not pinned
  db.prepare(
    `DELETE FROM listings
     WHERE is_favorite = 0 AND is_blacklisted = 0
       AND id NOT IN (SELECT listing_id FROM listing_agents)`,
  ).run();
}

export function getExistingIds(provider, listingType, searchConfigId = null) {
  if (searchConfigId) {
    // Use junction table for agent-specific lookup
    const conditions = ['la.search_config_id = ?'];
    const params = [searchConfigId];
    if (provider) {
      conditions.push('l.provider = ?');
      params.push(provider);
    }
    if (listingType) {
      conditions.push('l.listing_type = ?');
      params.push(listingType);
    }
    return db
      .prepare(
        `SELECT l.id FROM listings l
         INNER JOIN listing_agents la ON la.listing_id = l.id
         WHERE ${conditions.join(' AND ')}`,
      )
      .all(...params)
      .map((r) => r.id);
  }
  const conditions = [];
  const params = [];
  if (provider) {
    conditions.push('provider = ?');
    params.push(provider);
  }
  if (listingType) {
    conditions.push('listing_type = ?');
    params.push(listingType);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return db
    .prepare(`SELECT id FROM listings ${where}`)
    .all(...params)
    .map((r) => r.id);
}

/** Returns all known listing IDs for a provider (any agent). Used for scrape caching. */
export function getAllKnownIds(provider) {
  return db
    .prepare('SELECT id FROM listings WHERE provider = ?')
    .all(provider)
    .map((r) => r.id);
}

export function getStatsPerConfig() {
  return db
    .prepare(
      `SELECT
        la.search_config_id,
        SUM(CASE WHEN l.is_blacklisted = 0 THEN 1 ELSE 0 END) as total,
        SUM(CASE WHEN l.is_blacklisted = 0 AND l.is_seen = 0 THEN 1 ELSE 0 END) as unseen,
        SUM(CASE WHEN l.is_favorite = 1 AND l.is_blacklisted = 0 THEN 1 ELSE 0 END) as favorites,
        SUM(CASE WHEN l.is_blacklisted = 1 THEN 1 ELSE 0 END) as blacklisted
      FROM listing_agents la
      INNER JOIN listings l ON l.id = la.listing_id
      GROUP BY la.search_config_id`,
    )
    .all();
}

// Stats for detached listings (no agent associations) – favorites of deleted agents
export function getOrphanStats() {
  const row = db
    .prepare(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN is_seen = 0 THEN 1 ELSE 0 END) as unseen,
        SUM(CASE WHEN is_favorite = 1 THEN 1 ELSE 0 END) as favorites
      FROM listings
      WHERE id NOT IN (SELECT listing_id FROM listing_agents)
        AND is_blacklisted = 0`,
    )
    .get();
  return { total: row?.total ?? 0, unseen: row?.unseen ?? 0, favorites: row?.favorites ?? 0 };
}

// ── Scrape-Runs ───────────────────────────────────────────────────────────────

export function startScrapeRun(source, startedAt, { provider, listingType, searchConfigId } = {}) {
  const res = db
    .prepare(
      `
    INSERT INTO scrape_runs (source, started_at, status, provider, listing_type, search_config_id)
    VALUES (?, ?, 'running', ?, ?, ?)
  `,
    )
    .run(source, startedAt, provider ?? source, listingType ?? null, searchConfigId ?? null);
  return Number(res.lastInsertRowid);
}

export function finishScrapeRun(runId, { endedAt, status, newCount, totalCount, error }) {
  db.prepare(
    `
    UPDATE scrape_runs SET ended_at = ?, status = ?, new_count = ?, total_count = ?, error = ?
    WHERE id = ?
  `,
  ).run(endedAt, status, newCount, totalCount, error ?? null, runId);
}

export function getRecentRuns(limit = 20) {
  return db.prepare('SELECT * FROM scrape_runs ORDER BY started_at DESC LIMIT ?').all(limit);
}

export default db;
