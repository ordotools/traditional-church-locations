const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// In production (Coolify), DATA_DIR should point at a mounted persistent
// volume so the SQLite file survives redeploys — see README "Deploying".
const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'db.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// CREATE TABLE IF NOT EXISTS won't add columns to a table that already
// existed before this migration was written, so add any missing ones here.
const MIGRATIONS = [
  ['mass_centers', 'precision', "TEXT NOT NULL DEFAULT 'exact'"],
  ['mass_centers', 'country', 'TEXT'],
  ['mass_centers', 'status', "TEXT NOT NULL DEFAULT ''"],
  ['organizations', 'status', "TEXT NOT NULL DEFAULT 'unknown'"],
  ['scrape_candidates', 'title', 'TEXT'],
  ['scrape_candidates', 'city', 'TEXT'],
  ['scrape_candidates', 'state', 'TEXT'],
  ['scrape_candidates', 'country', 'TEXT'],
  ['scrape_candidates', 'postal_code', 'TEXT'],
  ['scrape_candidates', 'precision', "TEXT NOT NULL DEFAULT 'exact'"],
  ['scrape_candidates', 'conflict_mass_center_id', 'INTEGER REFERENCES mass_centers(id) ON DELETE SET NULL'],
  ['scrape_candidates', 'duplicate_score', 'REAL'],
  ['scrape_schedule', 'run_count', 'INTEGER NOT NULL DEFAULT 0'],
];
for (const [table, column, definition] of MIGRATIONS) {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!existing.some((col) => col.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// source_location_decisions gained organization_id as part of its unique key
// (see schema.sql) — ALTER TABLE can add the column but can't change a UNIQUE
// constraint, so a database that already had this table needs it rebuilt.
// Existing rows get the -1 "no organization on record" sentinel; a decision
// that was previously org-specific will re-surface once for re-review after
// this runs, then gets remembered under the new, org-aware key.
if (!db.prepare("PRAGMA table_info(source_location_decisions)").all().some((col) => col.name === 'organization_id')) {
  db.exec(`
    CREATE TABLE source_location_decisions_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_url TEXT NOT NULL,
      normalized_address TEXT NOT NULL,
      normalized_title TEXT NOT NULL DEFAULT '',
      organization_id INTEGER NOT NULL DEFAULT -1,
      raw_address TEXT,
      title TEXT,
      status TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (source_url, normalized_address, normalized_title, organization_id)
    );
    INSERT INTO source_location_decisions_new (id, source_url, normalized_address, normalized_title, raw_address, title, status, updated_at)
      SELECT id, source_url, normalized_address, normalized_title, raw_address, title, status, updated_at FROM source_location_decisions;
    DROP TABLE source_location_decisions;
    ALTER TABLE source_location_decisions_new RENAME TO source_location_decisions;
  `);
}

module.exports = db;
