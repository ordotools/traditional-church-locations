const express = require('express');
const db = require('../db');
const { geocodeAddress, geocodeCascade } = require('../geocode');
const { scrapeCandidates } = require('../scraper');
const geocodeQueue = require('../geocodeQueue');
const duplicates = require('../duplicates');
const { checkCredentials, requireAuth } = require('../auth');

const router = express.Router();

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

// Nav badge counts and active-link state, computed once per request so every
// page (not just the dashboard) can show what needs attention. Duplicates is
// left out — finding them is an O(n^2) title-similarity scan, too expensive
// to run on every page load (see src/duplicates.js).
router.use((req, res, next) => {
  res.locals.currentPath = req.path;
  res.locals.reviewCount = db.prepare("SELECT COUNT(*) AS n FROM scrape_candidates WHERE status = 'pending'").get().n;
  res.locals.geolocationCount = db.prepare("SELECT COUNT(*) AS n FROM scrape_candidates WHERE status = 'approved'").get().n;
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

// A rotating palette so auto-created organizations get visually distinct
// colors rather than all defaulting to black.
const AUTO_COLORS = ['#a6192e', '#00594c', '#1d3557', '#7b3f00', '#4a154b', '#2a6f2b', '#8c1c13', '#003554'];

function getOrganizations() {
  return db.prepare('SELECT * FROM organizations ORDER BY name').all();
}

// Looks up an organization by abbreviation (case-insensitive); auto-creates
// one if it doesn't exist yet, so scraping doesn't stall on unknown codes.
// The name starts out the same as the abbreviation — rename it on the
// Organizations page once you know what it stands for.
function getOrCreateOrganizationByAbbreviation(abbreviation) {
  if (!abbreviation) return null;
  const existing = db.prepare('SELECT * FROM organizations WHERE abbreviation = ? COLLATE NOCASE').get(abbreviation);
  if (existing) return existing.id;
  const color = AUTO_COLORS[db.prepare('SELECT COUNT(*) AS n FROM organizations').get().n % AUTO_COLORS.length];
  const info = db
    .prepare('INSERT INTO organizations (name, abbreviation, color) VALUES (?, ?, ?)')
    .run(abbreviation, abbreviation, color);
  return info.lastInsertRowid;
}

function getMassCenters() {
  return db
    .prepare(
      `SELECT mc.*, o.name AS organization_name, o.abbreviation AS organization_abbreviation
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
  res.render('admin/dashboard', { massCenterCount, organizationCount });
});

// --- Organizations -------------------------------------------------------

router.get('/organizations', (req, res) => {
  const organizations = getOrganizations();
  res.render('admin/organizations', { organizations, error: null });
});

router.post('/organizations', (req, res) => {
  const { name, abbreviation, color } = req.body;
  if (!name || !abbreviation) {
    return res.render('admin/organizations', { organizations: getOrganizations(), error: 'Name and abbreviation are required.' });
  }
  db.prepare('INSERT INTO organizations (name, abbreviation, color) VALUES (?, ?, ?)').run(
    name.trim(),
    abbreviation.trim(),
    color || '#000000'
  );
  res.redirect('/admin/organizations');
});

router.get('/organizations/:id/edit', (req, res) => {
  const organization = db.prepare('SELECT * FROM organizations WHERE id = ?').get(req.params.id);
  if (!organization) return res.status(404).send('Not found');
  res.render('admin/organization_edit', { organization, error: null });
});

router.post('/organizations/:id', (req, res) => {
  const { name, abbreviation, color } = req.body;
  if (!name || !abbreviation) {
    return res.render('admin/organization_edit', {
      organization: { ...req.body, id: req.params.id },
      error: 'Name and abbreviation are required.',
    });
  }
  db.prepare('UPDATE organizations SET name = ?, abbreviation = ?, color = ? WHERE id = ?').run(
    name.trim(),
    abbreviation.trim(),
    color || '#000000',
    req.params.id
  );
  res.redirect('/admin/organizations');
});

router.post('/organizations/:id/delete', (req, res) => {
  db.prepare('DELETE FROM organizations WHERE id = ?').run(req.params.id);
  res.redirect('/admin/organizations');
});

// --- Mass centers --------------------------------------------------------

router.get('/mass-centers', (req, res) => {
  res.render('admin/mass_centers', { massCenters: getMassCenters(), organizations: getOrganizations(), error: null });
});

router.post('/mass-centers', async (req, res) => {
  const { title, address, organization_id, latitude, longitude } = req.body;
  if (!title || !address) {
    return res.render('admin/mass_centers', {
      massCenters: getMassCenters(),
      organizations: getOrganizations(),
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
        error: `Could not find coordinates for "${address}". You can enter latitude/longitude manually below instead.`,
      });
    }
    db.prepare(
      `INSERT INTO mass_centers (title, address, latitude, longitude, organization_id)
       VALUES (?, ?, ?, ?, ?)`
    ).run(title.trim(), address.trim(), coords.latitude, coords.longitude, organization_id || null);
    res.redirect('/admin/mass-centers');
  } catch (err) {
    res.render('admin/mass_centers', { massCenters: getMassCenters(), organizations: getOrganizations(), error: err.message });
  }
});

router.get('/mass-centers/:id/edit', (req, res) => {
  const massCenter = db.prepare('SELECT * FROM mass_centers WHERE id = ?').get(req.params.id);
  if (!massCenter) return res.status(404).send('Not found');
  const notice =
    req.query.regeocoded === '1'
      ? `Address changed — re-geocoded to ${massCenter.latitude.toFixed(5)}, ${massCenter.longitude.toFixed(5)}.`
      : null;
  res.render('admin/mass_center_edit', { massCenter, organizations: getOrganizations(), error: null, notice });
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
  const { title, address, organization_id, latitude: manualLat, longitude: manualLng } = req.body;
  const existing = db.prepare('SELECT * FROM mass_centers WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).send('Not found');

  try {
    let { latitude, longitude } = existing;
    const manualCoords = parseManualCoords(manualLat, manualLng);
    const addressChanged = address.trim() !== existing.address;
    if (manualCoords) {
      ({ latitude, longitude } = manualCoords);
    } else if (addressChanged) {
      const coords = await geocodeAddress(address);
      if (!coords) {
        return res.render('admin/mass_center_edit', {
          massCenter: { ...existing, title, address, organization_id },
          organizations: getOrganizations(),
          error: `Could not find coordinates for "${address}". You can enter latitude/longitude manually below instead.`,
          notice: null,
        });
      }
      ({ latitude, longitude } = coords);
    }
    db.prepare(
      `UPDATE mass_centers SET title = ?, address = ?, latitude = ?, longitude = ?, organization_id = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(title.trim(), address.trim(), latitude, longitude, organization_id || null, req.params.id);
    res.redirect(
      addressChanged && !manualCoords ? `/admin/mass-centers/${req.params.id}/edit?regeocoded=1` : '/admin/mass-centers'
    );
  } catch (err) {
    res.render('admin/mass_center_edit', {
      massCenter: { ...existing, title, address, organization_id },
      organizations: getOrganizations(),
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

// Records/updates the "previously scraped URLs" list so a source can be
// re-run later without having to re-find the site. Title/note are left alone
// here — they're filled in by hand afterward as a reminder of what's there.
function touchSavedSource(url, organizationId) {
  db.prepare(
    `INSERT INTO saved_sources (url, organization_id, last_scraped_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(url) DO UPDATE SET
       organization_id = COALESCE(excluded.organization_id, organization_id),
       last_scraped_at = excluded.last_scraped_at`
  ).run(url, organizationId || null);
}

// Fetches a URL, extracts candidates, and inserts them for Scrape Review.
// Extraction only — no geocoding here. A directory this size can easily
// have hundreds of entries, and geocoding all of them synchronously inside
// this one request would take many minutes and risk timing out. Candidates
// go to Scrape Review first; geocoding happens after approval, either
// per-candidate on confirm or in bulk via the "Geocode All Pending" job.
// Throws if the fetch fails; returns { count, aiWarning } (count 0 = none
// found; aiWarning set when AI was configured but ended up unused for this
// page — see scraper.js).
async function runScrape(url, organizationId) {
  const { candidates, aiWarning } = await scrapeCandidates(url);
  if (!candidates.length) return { count: 0, aiWarning };

  const insert = db.prepare(
    `INSERT INTO scrape_candidates (source_url, organization_id, title, raw_address, city, state, country, postal_code, precision)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const c of candidates) {
    const candidateOrgId = organizationId || getOrCreateOrganizationByAbbreviation(c.organizationAbbreviation);
    insert.run(url, candidateOrgId || null, c.title, c.address, c.city, c.state, c.country || null, c.postalCode || null, c.precision);
  }
  touchSavedSource(url, organizationId);
  return { count: candidates.length, aiWarning };
}

router.get('/scrape', (req, res) => {
  res.render('admin/scrape', { organizations: getOrganizations(), sources: getSavedSources(), error: null });
});

router.post('/scrape', async (req, res) => {
  const { url, organization_id } = req.body;
  if (!url) {
    return res.render('admin/scrape', { organizations: getOrganizations(), sources: getSavedSources(), error: 'URL is required.' });
  }
  try {
    const { count, aiWarning } = await runScrape(url, organization_id);
    if (!count) {
      return res.render('admin/scrape', {
        organizations: getOrganizations(),
        sources: getSavedSources(),
        error: 'No addresses were found on that page.',
      });
    }
    res.redirect(`/admin/review${aiWarning ? `?ai_warning=${encodeURIComponent(aiWarning)}` : ''}`);
  } catch (err) {
    res.render('admin/scrape', { organizations: getOrganizations(), sources: getSavedSources(), error: err.message });
  }
});

// Re-runs a previously saved source by id, reusing its stored URL/organization.
router.post('/scrape/sources/:id/run', async (req, res) => {
  const source = db.prepare('SELECT * FROM saved_sources WHERE id = ?').get(req.params.id);
  if (!source) return res.status(404).send('Not found');
  try {
    const { count, aiWarning } = await runScrape(source.url, source.organization_id);
    if (!count) {
      return res.render('admin/scrape', {
        organizations: getOrganizations(),
        sources: getSavedSources(),
        error: `No addresses were found on ${source.url}.`,
      });
    }
    res.redirect(`/admin/review${aiWarning ? `?ai_warning=${encodeURIComponent(aiWarning)}` : ''}`);
  } catch (err) {
    res.render('admin/scrape', { organizations: getOrganizations(), sources: getSavedSources(), error: err.message });
  }
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
// one go. Candidates missing either are left in the queue for manual review.
router.post('/candidates/confirm-all', (req, res) => {
  const ready = db
    .prepare("SELECT * FROM scrape_candidates WHERE status = 'approved' AND latitude IS NOT NULL AND title IS NOT NULL AND title != ''")
    .all();

  const insertMassCenter = db.prepare(
    `INSERT INTO mass_centers (title, address, latitude, longitude, precision, organization_id, source_url)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const markConfirmed = db.prepare("UPDATE scrape_candidates SET status = 'confirmed' WHERE id = ?");

  const confirmAll = db.transaction((rows) => {
    for (const c of rows) {
      insertMassCenter.run(c.title.trim(), c.raw_address, c.latitude, c.longitude, c.precision, c.organization_id, c.source_url);
      markConfirmed.run(c.id);
    }
  });
  confirmAll(ready);

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

  db.prepare(
    `INSERT INTO mass_centers (title, address, latitude, longitude, precision, organization_id, source_url)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(title.trim(), address.trim(), coords.latitude, coords.longitude, precision, candidate.organization_id, candidate.source_url);
  db.prepare("UPDATE scrape_candidates SET status = 'confirmed' WHERE id = ?").run(req.params.id);
  res.redirect('/admin/candidates');
});

router.post('/candidates/:id/reject', (req, res) => {
  db.prepare("UPDATE scrape_candidates SET status = 'rejected' WHERE id = ?").run(req.params.id);
  res.redirect('/admin/candidates');
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
