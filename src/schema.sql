CREATE TABLE IF NOT EXISTS organizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  abbreviation TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#000000',
  -- Vetting status shown as a badge on the map pin: 'vetted' (recommended),
  -- 'questionable' (grey-listed), 'unknown' (not yet reviewed), 'blacklisted'
  -- (not recommended). Locations belonging to this org inherit it unless
  -- they set their own (see mass_centers.status).
  status TEXT NOT NULL DEFAULT 'unknown',
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
  -- '' (the default) means "inherit the organization's status"; set to one
  -- of 'vetted'/'questionable'/'unknown'/'blacklisted' to override it for
  -- just this location.
  status TEXT NOT NULL DEFAULT '',
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
  -- Set when status = 'conflict' or 'duplicate': the existing mass center
  -- this candidate's address/title matched (by string similarity, Jev, or
  -- post-geocode distance), awaiting a human decision on /admin/conflicts —
  -- or, for 'duplicate', kept only as an audit trail of the auto-reject.
  conflict_mass_center_id INTEGER REFERENCES mass_centers(id) ON DELETE SET NULL,
  -- Similarity score (0..1) behind that match: string-similarity score for a
  -- pre-geocode match, or Jev's probability when it was escalated there.
  duplicate_score REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- normalized-address -> resolved coordinates, so re-scraping the same site
-- never re-geocodes an address already resolved (see src/geocode.js).
CREATE TABLE IF NOT EXISTS geocode_cache (
  cache_key TEXT PRIMARY KEY,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  precision TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Daily hit counter for the public map page (see src/routes/api.js), bumped
-- once per /api/pins request. No cookies/IPs — a page-view count, not a
-- unique-visitor count.
CREATE TABLE IF NOT EXISTS page_views (
  date TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0
);

-- Single-row settings for the automatic re-scrape job (src/scrapeScheduler.js).
-- last_run_summary is a small JSON blob for display on the Scrape URL page.
CREATE TABLE IF NOT EXISTS scrape_schedule (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  interval_hours INTEGER NOT NULL DEFAULT 24,
  enabled INTEGER NOT NULL DEFAULT 0,
  last_run_at TEXT,
  last_run_summary TEXT,
  run_count INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO scrape_schedule (id) VALUES (1);

-- Per-status display settings, editable on /admin/statuses: the label shown
-- for a status (e.g. blacklisted -> "Do not attend") and whether it's shown
-- on the map popup and/or in the map legend at all.
CREATE TABLE IF NOT EXISTS status_settings (
  status TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  show_on_map INTEGER NOT NULL DEFAULT 1,
  show_in_legend INTEGER NOT NULL DEFAULT 1
);
INSERT OR IGNORE INTO status_settings (status, label) VALUES
  ('vetted', 'Vetted'),
  ('questionable', 'Questionable'),
  ('unknown', 'Unknown'),
  ('blacklisted', 'Blacklisted');
