const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, '..', 'data');
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
  ['scrape_candidates', 'title', 'TEXT'],
  ['scrape_candidates', 'city', 'TEXT'],
  ['scrape_candidates', 'state', 'TEXT'],
  ['scrape_candidates', 'precision', "TEXT NOT NULL DEFAULT 'exact'"],
];
for (const [table, column, definition] of MIGRATIONS) {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!existing.some((col) => col.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

module.exports = db;
