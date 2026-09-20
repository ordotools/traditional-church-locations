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
  ['scrape_schedule', 'run_count', 'INTEGER NOT NULL DEFAULT 0'],
];
for (const [table, column, definition] of MIGRATIONS) {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!existing.some((col) => col.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

module.exports = db;
