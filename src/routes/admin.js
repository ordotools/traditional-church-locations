const express = require('express');
const db = require('../db');
const { geocodeAddress, geocodeCascade } = require('../geocode');
const geocodeQueue = require('../geocodeQueue');
const duplicates = require('../duplicates');
const candidatePipeline = require('../candidatePipeline');
const scrapeScheduler = require('../scrapeScheduler');
const { checkCredentials, requireAuth } = require('../auth');

const router = express.Router();

const STATUSES = require('../statuses');
function normalizeOrgStatus(status) {
  return STATUSES.includes(status) ? status : 'unknown';
}
function normalizeLocationStatus(status) {
  return STATUSES.includes(status) ? status : '';
}

// --- Auth ----------------------------------------------------------------
// Registered before the requireAuth gate below so login itself stays reachable.

router.get('/login', (req, res) => {
  if (req.session.loggedIn) return res.redirect('/admin');
  res.render('admin/login', { error: null });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!checkCredentials(username, password)) {
    return res.render('admin/login', { error: 'Incorrect username or password.' });
  }
  req.session.loggedIn = true;
  res.redirect('/admin');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

router.use(requireAuth);

// Nav badge counts, active-link state, and the scrape-status footer bar —
// computed once per request so every page (not just Scrape URL) can show
// what needs attention and whether a scheduled scrape is running. Duplicates
// is left out of the badges — finding them is an O(n^2) title-similarity
// scan, too expensive to run on every page load (see src/duplicates.js).
router.use((req, res, next) => {
  res.locals.currentPath = req.path;
  // req.path is relative to this router's mount point (e.g. '/mass-centers')
  // — fine for the nav's isActive() string match above, but the status bar
  // below needs a real fetchable URL, hence the '/admin' prefix restored here.
  res.locals.currentFullPath = req.baseUrl + req.path;
  res.locals.reviewCount = db.prepare("SELECT COUNT(*) AS n FROM scrape_candidates WHERE status = 'pending'").get().n;
  res.locals.geolocationCount = db.prepare("SELECT COUNT(*) AS n FROM scrape_candidates WHERE status = 'approved'").get().n;
  res.locals.conflictCount = db.prepare("SELECT COUNT(*) AS n FROM scrape_candidates WHERE status = 'conflict'").get().n;
  res.locals.scrapeStatus = scrapeScheduler.getStatus();
  next();
});

// Manual lat/lng override, used when geocoding an address fails or is imprecise
// (OpenStreetMap has gaps, especially for rural roads).
function parseManualCoords(latitude, longitude) {
  if (!latitude && !longitude) return null;
  const lat = parseFloat(latitude);
  const lng = parseFloat(longitude);
  if (Number.isNaN(lat) || Number.isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new Error('Latitude/longitude must be numbers (lat: -90 to 90, lng: -180 to 180).');
  }
  return { latitude: lat, longitude: lng };
}

function getOrganizations() {
  return db.prepare('SELECT * FROM organizations ORDER BY name').all();
}

// Always returns one row per STATUSES entry, in that order, even if
// status_settings is somehow missing one (schema.sql seeds all four, but
// this keeps the admin page and API from breaking if a row is ever deleted).
function getStatusSettings() {
  const bySlug = new Map(db.prepare('SELECT * FROM status_settings').all().map((row) => [row.status, row]));
  return STATUSES.map(
    (status) => bySlug.get(status) || { status, label: status, show_on_map: 1, show_in_legend: 1 }
  );
}

function getMassCenters() {
  return db
    .prepare(
      `SELECT mc.*, o.name AS organization_name, o.abbreviation AS organization_abbreviation,
              COALESCE(NULLIF(mc.status, ''), o.status, 'unknown') AS effective_status
       FROM mass_centers mc LEFT JOIN organizations o ON o.id = mc.organization_id
       ORDER BY mc.title`
    )
    .all();
}

function getCandidatesByStatus(status) {
  return db
    .prepare(
      `SELECT sc.*, o.name AS organization_name, o.abbreviation AS organization_abbreviation
       FROM scrape_candidates sc LEFT JOIN organizations o ON o.id = sc.organization_id
       WHERE sc.status = ?
       ORDER BY sc.created_at DESC`
    )
    .all(status);
}

// Normalizes the checkbox array from a bulk-action form: a single checked
// box posts as a plain string rather than a one-item array.
function idsFromBody(body) {
  if (!body.ids) return [];
  return (Array.isArray(body.ids) ? body.ids : [body.ids]).map(Number);
}

// --- Dashboard ---------------------------------------------------------

router.get('/', (req, res) => {
  const massCenterCount = db.prepare('SELECT COUNT(*) AS n FROM mass_centers').get().n;
  const organizationCount = db.prepare('SELECT COUNT(*) AS n FROM organizations').get().n;

  const byOrganization = db
    .prepare(
      `SELECT o.name, o.color, COUNT(mc.id) AS n
       FROM organizations o LEFT JOIN mass_centers mc ON mc.organization_id = o.id
       GROUP BY o.id ORDER BY n DESC`
    )
    .all();

  // COALESCE covers pins added before the country column existed, or never
  // re-geocoded since — see README/ROADMAP on backfill.
  const byCountry = db
    .prepare(
      `SELECT COALESCE(country, 'Unknown') AS country, COUNT(*) AS n
       FROM mass_centers GROUP BY country ORDER BY n DESC LIMIT 15`
    )
    .all();

  const byPrecision = db.prepare('SELECT precision, COUNT(*) AS n FROM mass_centers GROUP BY precision ORDER BY n DESC').all();

  const byMonth = db
    .prepare(
      `SELECT strftime('%Y-%m', created_at) AS month, COUNT(*) AS n
       FROM mass_centers GROUP BY month ORDER BY month DESC LIMIT 12`
    )
    .all()
    .reverse();

  const pageViews = {
    today: db.prepare("SELECT count FROM page_views WHERE date = date('now')").get()?.count || 0,
    last7Days: db.prepare("SELECT COALESCE(SUM(count), 0) AS n FROM page_views WHERE date >= date('now', '-6 days')").get().n,
    last30Days: db.prepare("SELECT COALESCE(SUM(count), 0) AS n FROM page_views WHERE date >= date('now', '-29 days')").get().n,
    total: db.prepare('SELECT COALESCE(SUM(count), 0) AS n FROM page_views').get().n,
  };

  res.render('admin/dashboard', { massCenterCount, organizationCount, byOrganization, byCountry, byPrecision, byMonth, pageViews });
});

// --- Organizations -------------------------------------------------------

router.get('/organizations', (req, res) => {
  const organizations = getOrganizations();
  res.render('admin/organizations', { organizations, statuses: STATUSES, error: null });
});

router.post('/organizations', (req, res) => {
  const { name, abbreviation, color, status } = req.body;
  if (!name || !abbreviation) {
    return res.render('admin/organizations', {
      organizations: getOrganizations(),
      statuses: STATUSES,
      error: 'Name and abbreviation are required.',
    });
  }
  db.prepare('INSERT INTO organizations (name, abbreviation, color, status) VALUES (?, ?, ?, ?)').run(
    name.trim(),
    abbreviation.trim(),
    color || '#000000',
    normalizeOrgStatus(status)
  );
  res.redirect('/admin/organizations');
});

router.get('/organizations/:id/edit', (req, res) => {
  const organization = db.prepare('SELECT * FROM organizations WHERE id = ?').get(req.params.id);
  if (!organization) return res.status(404).send('Not found');
  res.render('admin/organization_edit', { organization, statuses: STATUSES, error: null });
});

router.post('/organizations/:id', (req, res) => {
  const { name, abbreviation, color, status } = req.body;
  if (!name || !abbreviation) {
    return res.render('admin/organization_edit', {
      organization: { ...req.body, id: req.params.id },
      statuses: STATUSES,
      error: 'Name and abbreviation are required.',
    });
  }
  db.prepare('UPDATE organizations SET name = ?, abbreviation = ?, color = ?, status = ? WHERE id = ?').run(
    name.trim(),
    abbreviation.trim(),
    color || '#000000',
    normalizeOrgStatus(status),
    req.params.id
  );
  res.redirect('/admin/organizations');
});

router.post('/organizations/:id/delete', (req, res) => {
  db.prepare('DELETE FROM organizations WHERE id = ?').run(req.params.id);
  res.redirect('/admin/organizations');
});

// --- Status display settings ----------------------------------------------
// Per-status label + map/legend visibility, consumed by the public map via
// GET /api/status-settings (src/routes/api.js).

router.get('/statuses', (req, res) => {
  res.render('admin/statuses', { statuses: getStatusSettings(), error: null });
});

router.post('/statuses', (req, res) => {
  const upsert = db.prepare(
    `INSERT INTO status_settings (status, label, show_on_map, show_in_legend) VALUES (?, ?, ?, ?)
     ON CONFLICT(status) DO UPDATE SET label = excluded.label, show_on_map = excluded.show_on_map,
       show_in_legend = excluded.show_in_legend`
  );
  STATUSES.forEach((status) => {
    const label = (req.body[`label_${status}`] || '').trim() || status;
    upsert.run(status, label, req.body[`show_on_map_${status}`] ? 1 : 0, req.body[`show_in_legend_${status}`] ? 1 : 0);
  });
  res.redirect('/admin/statuses');
});

// --- Mass centers --------------------------------------------------------

router.get('/mass-centers', (req, res) => {
  res.render('admin/mass_centers', {
    massCenters: getMassCenters(),
    organizations: getOrganizations(),
    statuses: STATUSES,
    error: null,
  });
});

router.post('/mass-centers', async (req, res) => {
  const { title, address, organization_id, latitude, longitude, status } = req.body;
  if (!title || !address) {
    return res.render('admin/mass_centers', {
      massCenters: getMassCenters(),
      organizations: getOrganizations(),
      statuses: STATUSES,
      error: 'Title and address are required.',
    });
  }
  try {
    const manualCoords = parseManualCoords(latitude, longitude);
    const coords = manualCoords || (await geocodeAddress(address));
    if (!coords) {
      return res.render('admin/mass_centers', {
        massCenters: getMassCenters(),
        organizations: getOrganizations(),
        statuses: STATUSES,
        error: `Could not find coordinates for "${address}". You can enter latitude/longitude manually below instead.`,
      });
    }
    db.prepare(
      `INSERT INTO mass_centers (title, address, latitude, longitude, organization_id, country, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      title.trim(),
      address.trim(),
      coords.latitude,
      coords.longitude,
      organization_id || null,
      coords.country || null,
      normalizeLocationStatus(status)
    );
    res.redirect('/admin/mass-centers');
  } catch (err) {
    res.render('admin/mass_centers', {
      massCenters: getMassCenters(),
      organizations: getOrganizations(),
      statuses: STATUSES,
      error: err.message,
    });
  }
});

router.get('/mass-centers/:id/edit', (req, res) => {
  const massCenter = db
    .prepare(
      `SELECT mc.*, o.status AS organization_status
       FROM mass_centers mc LEFT JOIN organizations o ON o.id = mc.organization_id
       WHERE mc.id = ?`
    )
    .get(req.params.id);
  if (!massCenter) return res.status(404).send('Not found');
  const notice =
    req.query.regeocoded === '1'
      ? `Address changed — re-geocoded to ${massCenter.latitude.toFixed(5)}, ${massCenter.longitude.toFixed(5)}.`
      : null;
  res.render('admin/mass_center_edit', {
    massCenter,
    organizations: getOrganizations(),
    statuses: STATUSES,
    error: null,
    notice,
  });
});

router.post('/mass-centers/bulk-delete', (req, res) => {
  const ids = idsFromBody(req.body);
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(`DELETE FROM mass_centers WHERE id IN (${placeholders})`).run(...ids);
  }
  res.redirect('/admin/mass-centers');
});

router.post('/mass-centers/:id', async (req, res) => {
  const { title, address, organization_id, latitude: manualLat, longitude: manualLng, status } = req.body;
  const existing = db.prepare('SELECT * FROM mass_centers WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).send('Not found');

  try {
    let { latitude, longitude, country } = existing;
    const manualCoords = parseManualCoords(manualLat, manualLng);
    const addressChanged = address.trim() !== existing.address;
    if (manualCoords) {
      ({ latitude, longitude } = manualCoords);
    } else if (addressChanged) {
      const coords = await geocodeAddress(address);
      if (!coords) {
        return res.render('admin/mass_center_edit', {
          massCenter: { ...existing, title, address, organization_id, status },
          organizations: getOrganizations(),
          statuses: STATUSES,
          error: `Could not find coordinates for "${address}". You can enter latitude/longitude manually below instead.`,
          notice: null,
        });
      }
      ({ latitude, longitude, country } = coords);
    }
    db.prepare(
      `UPDATE mass_centers SET title = ?, address = ?, latitude = ?, longitude = ?, organization_id = ?, country = ?, status = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      title.trim(),
      address.trim(),
      latitude,
      longitude,
      organization_id || null,
      country || null,
      normalizeLocationStatus(status),
      req.params.id
    );
    res.redirect(
      addressChanged && !manualCoords ? `/admin/mass-centers/${req.params.id}/edit?regeocoded=1` : '/admin/mass-centers'
    );
  } catch (err) {
    res.render('admin/mass_center_edit', {
      massCenter: { ...existing, title, address, organization_id, status },
      organizations: getOrganizations(),
      statuses: STATUSES,
      error: err.message,
      notice: null,
    });
  }
});

router.post('/mass-centers/:id/delete', (req, res) => {
  db.prepare('DELETE FROM mass_centers WHERE id = ?').run(req.params.id);
  res.redirect('/admin/mass-centers');
});

// --- Scraping --------------------------------------------------------------

function getSavedSources() {
  return db
    .prepare(
      `SELECT ss.*, o.name AS organization_name, o.abbreviation AS organization_abbreviation
       FROM saved_sources ss LEFT JOIN organizations o ON o.id = ss.organization_id
       ORDER BY ss.last_scraped_at IS NULL, ss.last_scraped_at DESC`
    )
    .all();
}

router.get('/scrape', (req, res) => {
  res.render('admin/scrape', {
    organizations: getOrganizations(),
    sources: getSavedSources(),
    error: null,
  });
});

router.post('/scrape', async (req, res) => {
  const { url, organization_id } = req.body;
  if (!url) {
    return res.render('admin/scrape', {
      organizations: getOrganizations(),
      sources: getSavedSources(),
      error: 'URL is required.',
    });
  }
  try {
    const { count, aiWarning } = await candidatePipeline.runScrape(url, organization_id);
    if (!count) {
      return res.render('admin/scrape', {
        organizations: getOrganizations(),
        sources: getSavedSources(),
        error: 'No addresses were found on that page.',
      });
    }
    res.redirect(`/admin/review${aiWarning ? `?ai_warning=${encodeURIComponent(aiWarning)}` : ''}`);
  } catch (err) {
    res.render('admin/scrape', {
      organizations: getOrganizations(),
      sources: getSavedSources(),
      error: err.message,
    });
  }
});

// Re-runs a previously saved source by id, reusing its stored URL/organization.
router.post('/scrape/sources/:id/run', async (req, res) => {
  const source = db.prepare('SELECT * FROM saved_sources WHERE id = ?').get(req.params.id);
  if (!source) return res.status(404).send('Not found');
  try {
    const { count, aiWarning } = await candidatePipeline.runScrape(source.url, source.organization_id);
    if (!count) {
      return res.render('admin/scrape', {
        organizations: getOrganizations(),
        sources: getSavedSources(),
        error: `No addresses were found on ${source.url}.`,
      });
    }
    res.redirect(`/admin/review${aiWarning ? `?ai_warning=${encodeURIComponent(aiWarning)}` : ''}`);
  } catch (err) {
    res.render('admin/scrape', {
      organizations: getOrganizations(),
      sources: getSavedSources(),
      error: err.message,
    });
  }
});

// --- Automatic re-scraping -------------------------------------------------
// User-defined schedule that re-runs every saved source unattended (see
// src/scrapeScheduler.js), dedupes against what's already known, geocodes
// what's new, and auto-resolves it the same way "Confirm All" does.

router.post('/scrape/schedule', (req, res) => {
  scrapeScheduler.updateSchedule({ enabled: req.body.enabled === 'on', intervalHours: req.body.interval_hours });
  res.redirect('/admin/scrape');
});

router.post('/scrape/schedule/run', (req, res) => {
  scrapeScheduler.triggerRun();
  res.redirect('/admin/scrape');
});

// Updates a saved source's title/note/organization — the reminder of what
// that page contains, and which org to file its listings under next time.
router.post('/scrape/sources/:id', (req, res) => {
  const { title, note, organization_id } = req.body;
  db.prepare('UPDATE saved_sources SET title = ?, note = ?, organization_id = ? WHERE id = ?').run(
    (title || '').trim() || null,
    (note || '').trim() || null,
    organization_id || null,
    req.params.id
  );
  res.redirect('/admin/scrape');
});

router.post('/scrape/sources/:id/delete', (req, res) => {
  db.prepare('DELETE FROM saved_sources WHERE id = ?').run(req.params.id);
  res.redirect('/admin/scrape');
});

// --- Stage 1: raw scrape review ---------------------------------------------
// Freshly scraped candidates land here first (status 'pending'), before any
// geocoding is attempted. A human skims titles/addresses/orgs for obvious
// scraper mistakes (wrong org, garbled text, junk rows) and either approves
// them into the geolocation queue below or deletes them, individually or in
// bulk — nothing reaches the map without passing through both queues.

router.get('/review', (req, res) => {
  res.render('admin/review', { candidates: getCandidatesByStatus('pending'), error: null, notice: req.query.ai_warning || null });
});

router.post('/review/bulk', (req, res) => {
  const ids = idsFromBody(req.body);
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    const newStatus = req.body.action === 'approve' ? 'approved' : 'rejected';
    db.prepare(`UPDATE scrape_candidates SET status = ? WHERE status = 'pending' AND id IN (${placeholders})`).run(
      newStatus,
      ...ids
    );
  }
  res.redirect('/admin/review');
});

// --- Stage 2: geolocation queue ---------------------------------------------
// Candidates approved above (status 'approved') get geocoded — individually
// on confirm, or all at once via the background job — and turned into real
// map pins once a human confirms the resulting location.

router.get('/candidates', (req, res) => {
  res.render('admin/candidates', { candidates: getCandidatesByStatus('approved'), error: null, queue: geocodeQueue.getStatus() });
});

router.post('/candidates/geocode-all', (req, res) => {
  geocodeQueue.startGeocodingAllPending();
  res.redirect('/admin/candidates');
});

router.post('/candidates/bulk-delete', (req, res) => {
  const ids = idsFromBody(req.body);
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(`UPDATE scrape_candidates SET status = 'rejected' WHERE status = 'approved' AND id IN (${placeholders})`).run(
      ...ids
    );
  }
  res.redirect('/admin/candidates');
});

// Confirms every approved candidate that's already geocoded and titled, in
// one go (see candidatePipeline.resolveReadyCandidates — same logic the
// scheduler uses for an unattended run).
router.post('/candidates/confirm-all', async (req, res) => {
  await candidatePipeline.resolveReadyCandidates();
  res.redirect('/admin/candidates');
});

router.post('/candidates/:id/confirm', async (req, res) => {
  const { title, address, latitude: manualLat, longitude: manualLng } = req.body;
  const candidate = db.prepare('SELECT * FROM scrape_candidates WHERE id = ?').get(req.params.id);
  if (!candidate) return res.status(404).send('Not found');

  const renderError = (error) =>
    res.render('admin/candidates', { candidates: getCandidatesByStatus('approved'), error, queue: geocodeQueue.getStatus() });

  if (!title) return renderError('A title is required to confirm a pin.');
  if (!address) return renderError('An address is required to confirm a pin.');

  let coords;
  let precision = candidate.precision;
  try {
    coords = parseManualCoords(manualLat, manualLng);
  } catch (err) {
    return renderError(err.message);
  }

  // If the address was corrected, any previously geocoded coordinates (or
  // failure) belonged to the old text — persist the correction and re-geocode.
  const addressChanged = address.trim() !== candidate.raw_address;
  if (addressChanged) {
    db.prepare('UPDATE scrape_candidates SET raw_address = ? WHERE id = ?').run(address.trim(), req.params.id);
  }

  if (!coords && !addressChanged && candidate.latitude !== null) {
    coords = { latitude: candidate.latitude, longitude: candidate.longitude };
  }

  if (!coords) {
    // Pre-geocode dedup gate: skip the Nominatim call if this candidate is
    // (or is probably) a duplicate of something already on the map — see
    // candidatePipeline.gateForGeocoding. A rejected/flagged candidate is
    // updated in place, so just bounce back to the queue.
    const survivors = await candidatePipeline.gateForGeocoding([{ ...candidate, raw_address: address.trim() }]);
    if (!survivors.length) return res.redirect('/admin/candidates');

    // Not geocoded yet (or address just changed) — geocode now, on demand,
    // so confirming one at a time never has to wait for the background job.
    // Falls back through city/state/country if the full address can't be
    // found (Nominatim has real coverage gaps) instead of just failing.
    try {
      const result = await geocodeCascade({
        address: address.trim(),
        postalCode: candidate.postal_code,
        city: candidate.city,
        state: candidate.state,
        country: candidate.country,
      });
      if (!result) return renderError('This address could not be geocoded. Correct it above, or enter latitude/longitude manually.');
      coords = result.coords;
      precision = result.precision;
    } catch (err) {
      return renderError(err.message);
    }
  }

  // Check against existing pins before publishing — same organization at the
  // same address is a re-scrape, not a new location (see duplicates.js).
  const resolved = {
    raw_address: address.trim(),
    latitude: coords.latitude,
    longitude: coords.longitude,
    precision,
    organization_id: candidate.organization_id,
    source_url: candidate.source_url,
  };
  const match = duplicates.findMassCenterMatch(resolved);
  if (match && !match.sameOrg) {
    db.prepare(
      "UPDATE scrape_candidates SET status = 'conflict', conflict_mass_center_id = ? WHERE id = ?"
    ).run(match.massCenter.id, req.params.id);
    return res.redirect('/admin/candidates');
  }
  if (match) {
    candidatePipeline.refreshMassCenterFromCandidate(match.massCenter, resolved);
  } else {
    db.prepare(
      `INSERT INTO mass_centers (title, address, latitude, longitude, precision, organization_id, source_url, country)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(title.trim(), address.trim(), coords.latitude, coords.longitude, precision, candidate.organization_id, candidate.source_url, candidate.country || null);
  }
  db.prepare("UPDATE scrape_candidates SET status = 'confirmed' WHERE id = ?").run(req.params.id);
  res.redirect('/admin/candidates');
});

router.post('/candidates/:id/reject', (req, res) => {
  db.prepare("UPDATE scrape_candidates SET status = 'rejected' WHERE id = ?").run(req.params.id);
  res.redirect('/admin/candidates');
});

// --- Conflicts ---------------------------------------------------------
// Candidates that matched an existing pin's address/location under a
// different organization (set by the confirm routes above via
// duplicates.findMassCenterMatch) — held here instead of auto-publishing,
// since it could mean the location changed hands or two organizations share
// a building, and either way a human should decide before it reaches the map.

// A conflict flagged by the pre-geocode dedup gate (string similarity or
// Jev, before Nominatim ever ran — see candidatePipeline.gateForGeocoding)
// has no coordinates yet. Both actions below need real coordinates (to
// insert or update a mass_centers row, which requires them), so geocode on
// demand here rather than during the background job — most of these get
// rejected without ever needing a pin, so this way only the survivors that
// a human actually confirms pay for a Nominatim call.
async function ensureCandidateGeocoded(candidate) {
  if (candidate.latitude != null) return candidate;
  const result = await geocodeCascade({
    address: candidate.raw_address,
    postalCode: candidate.postal_code,
    city: candidate.city,
    state: candidate.state,
    country: candidate.country,
  });
  if (!result) throw new Error('This address could not be geocoded. Edit it from the Scrape Review queue, then retry.');
  db.prepare('UPDATE scrape_candidates SET latitude = ?, longitude = ?, precision = ? WHERE id = ?').run(
    result.coords.latitude,
    result.coords.longitude,
    result.precision,
    candidate.id
  );
  return { ...candidate, latitude: result.coords.latitude, longitude: result.coords.longitude, precision: result.precision };
}

function getConflictCandidates() {
  return db
    .prepare(
      `SELECT sc.*, o.name AS organization_name, o.abbreviation AS organization_abbreviation,
              mc.title AS existing_title, mc.address AS existing_address, mc.precision AS existing_precision,
              eo.name AS existing_organization_name
       FROM scrape_candidates sc
       LEFT JOIN organizations o ON o.id = sc.organization_id
       LEFT JOIN mass_centers mc ON mc.id = sc.conflict_mass_center_id
       LEFT JOIN organizations eo ON eo.id = mc.organization_id
       WHERE sc.status = 'conflict'
       ORDER BY sc.created_at DESC`
    )
    .all();
}

router.get('/conflicts', (req, res) => {
  res.render('admin/conflicts', { candidates: getConflictCandidates(), error: null });
});

// Genuinely a different place (e.g. two organizations sharing a building) —
// publish it as its own pin, and remember the pair so it never re-flags.
router.post('/conflicts/:id/not-duplicate', async (req, res) => {
  let candidate = db.prepare("SELECT * FROM scrape_candidates WHERE id = ? AND status = 'conflict'").get(req.params.id);
  if (!candidate) return res.status(404).send('Not found');
  try {
    candidate = await ensureCandidateGeocoded(candidate);
  } catch (err) {
    return res.render('admin/conflicts', { candidates: getConflictCandidates(), error: err.message });
  }
  const info = db
    .prepare(
      `INSERT INTO mass_centers (title, address, latitude, longitude, precision, organization_id, source_url, country)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(candidate.title.trim(), candidate.raw_address, candidate.latitude, candidate.longitude, candidate.precision, candidate.organization_id, candidate.source_url, candidate.country || null);
  duplicates.dismissPair(candidate.conflict_mass_center_id, info.lastInsertRowid);
  db.prepare("UPDATE scrape_candidates SET status = 'confirmed' WHERE id = ?").run(candidate.id);
  res.redirect('/admin/conflicts');
});

// Same place — the organization changed (or was wrong to begin with); update
// the existing pin from this candidate's data and drop the candidate.
router.post('/conflicts/:id/update-existing', async (req, res) => {
  let candidate = db.prepare("SELECT * FROM scrape_candidates WHERE id = ? AND status = 'conflict'").get(req.params.id);
  if (!candidate) return res.status(404).send('Not found');
  try {
    candidate = await ensureCandidateGeocoded(candidate);
  } catch (err) {
    return res.render('admin/conflicts', { candidates: getConflictCandidates(), error: err.message });
  }
  db.prepare(
    `UPDATE mass_centers SET title = ?, address = ?, latitude = ?, longitude = ?, precision = ?, organization_id = ?,
       source_url = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    candidate.title.trim(),
    candidate.raw_address,
    candidate.latitude,
    candidate.longitude,
    candidate.precision,
    candidate.organization_id,
    candidate.source_url,
    candidate.conflict_mass_center_id
  );
  db.prepare("UPDATE scrape_candidates SET status = 'confirmed' WHERE id = ?").run(candidate.id);
  res.redirect('/admin/conflicts');
});

router.post('/conflicts/:id/reject', (req, res) => {
  db.prepare("UPDATE scrape_candidates SET status = 'rejected' WHERE id = ? AND status = 'conflict'").run(req.params.id);
  res.redirect('/admin/conflicts');
});

// --- Duplicate detection ----------------------------------------------------
// Flags confirmed mass centers that geocode very close together or share a
// near-identical title (see ROADMAP "Duplicate detection"), so they can be
// compared and accepted as separate, rejected as the same place picking one
// side, or merged field-by-field.

router.get('/duplicates', (req, res) => {
  res.render('admin/duplicates', { pairs: duplicates.findDuplicatePairs(), organizations: getOrganizations(), error: null });
});

// Not actually duplicates — stop flagging this pair.
router.post('/duplicates/:idA/:idB/dismiss', (req, res) => {
  duplicates.dismissPair(Number(req.params.idA), Number(req.params.idB));
  res.redirect('/admin/duplicates');
});

// Same place — keep one record as-is and delete the other.
router.post('/duplicates/:idA/:idB/keep/:keepId', (req, res) => {
  const idA = Number(req.params.idA);
  const idB = Number(req.params.idB);
  const keepId = Number(req.params.keepId);
  const deleteId = keepId === idA ? idB : idA;
  db.prepare('DELETE FROM mass_centers WHERE id = ?').run(deleteId);
  res.redirect('/admin/duplicates');
});

// Same place, but combine fields from both before deleting the loser.
router.post('/duplicates/:idA/:idB/merge', (req, res) => {
  const idA = Number(req.params.idA);
  const idB = Number(req.params.idB);
  const keepId = Number(req.body.keep_id);
  const deleteId = keepId === idA ? idB : idA;
  if (keepId !== idA && keepId !== idB) return res.status(400).send('Invalid merge target.');

  const { title, address, organization_id, latitude, longitude } = req.body;
  try {
    const coords = parseManualCoords(latitude, longitude);
    if (!coords) return res.status(400).send('Latitude/longitude are required.');
    db.prepare(
      `UPDATE mass_centers SET title = ?, address = ?, latitude = ?, longitude = ?, organization_id = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(title.trim(), address.trim(), coords.latitude, coords.longitude, organization_id || null, keepId);
    db.prepare('DELETE FROM mass_centers WHERE id = ?').run(deleteId);
    res.redirect('/admin/duplicates');
  } catch (err) {
    res.render('admin/duplicates', {
      pairs: duplicates.findDuplicatePairs(),
      organizations: getOrganizations(),
      error: err.message,
    });
  }
});

module.exports = router;
