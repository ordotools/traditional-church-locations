CREATE TABLE IF NOT EXISTS organizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  abbreviation TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#000000',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mass_centers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  address TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  precision TEXT NOT NULL DEFAULT 'exact',
  organization_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
  source_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Every URL that's been scraped, so it can be found and re-run later without
-- having to dig it up again. Auto-recorded on each scrape; title/note are
-- filled in by hand afterward as a reminder of what that page contains.
CREATE TABLE IF NOT EXISTS saved_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL UNIQUE,
  title TEXT,
  note TEXT,
  organization_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
  last_scraped_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A pair of mass_centers a human has looked at and decided are NOT
-- duplicates of each other, so the duplicate scan stops flagging them again.
-- mass_center_id_1 is always the smaller id, so each unordered pair has one row.
CREATE TABLE IF NOT EXISTS duplicate_dismissals (
  mass_center_id_1 INTEGER NOT NULL,
  mass_center_id_2 INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (mass_center_id_1, mass_center_id_2)
);

CREATE TABLE IF NOT EXISTS scrape_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_url TEXT NOT NULL,
  organization_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
  title TEXT,
  raw_address TEXT NOT NULL,
  city TEXT,
  state TEXT,
  country TEXT,
  postal_code TEXT,
  precision TEXT NOT NULL DEFAULT 'exact',
  latitude REAL,
  longitude REAL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
