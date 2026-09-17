const express = require('express');
const db = require('../db');
const { geocodeAddress } = require('../geocode');
const { scrapeCandidates } = require('../scraper');
const geocodeQueue = require('../geocodeQueue');

const router = express.Router();

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
  const reviewCount = db.prepare("SELECT COUNT(*) AS n FROM scrape_candidates WHERE status = 'pending'").get().n;
  const geolocationCount = db.prepare("SELECT COUNT(*) AS n FROM scrape_candidates WHERE status = 'approved'").get().n;
  res.render('admin/dashboard', { massCenterCount, organizationCount, reviewCount, geolocationCount });
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
  res.render('admin/mass_center_edit', { massCenter, organizations: getOrganizations(), error: null });
});

router.post('/mass-centers/:id', async (req, res) => {
  const { title, address, organization_id, latitude: manualLat, longitude: manualLng } = req.body;
  const existing = db.prepare('SELECT * FROM mass_centers WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).send('Not found');

  try {
    let { latitude, longitude } = existing;
    const manualCoords = parseManualCoords(manualLat, manualLng);
    if (manualCoords) {
      ({ latitude, longitude } = manualCoords);
    } else if (address.trim() !== existing.address) {
      const coords = await geocodeAddress(address);
      if (!coords) {
        return res.render('admin/mass_center_edit', {
          massCenter: { ...existing, title, address, organization_id },
          organizations: getOrganizations(),
          error: `Could not find coordinates for "${address}". You can enter latitude/longitude manually below instead.`,
        });
      }
      ({ latitude, longitude } = coords);
    }
    db.prepare(
      `UPDATE mass_centers SET title = ?, address = ?, latitude = ?, longitude = ?, organization_id = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(title.trim(), address.trim(), latitude, longitude, organization_id || null, req.params.id);
    res.redirect('/admin/mass-centers');
  } catch (err) {
    res.render('admin/mass_center_edit', {
      massCenter: { ...existing, title, address, organization_id },
      organizations: getOrganizations(),
      error: err.message,
    });
  }
});

router.post('/mass-centers/:id/delete', (req, res) => {
  db.prepare('DELETE FROM mass_centers WHERE id = ?').run(req.params.id);
  res.redirect('/admin/mass-centers');
});

// --- Scraping --------------------------------------------------------------

router.get('/scrape', (req, res) => {
  res.render('admin/scrape', { organizations: getOrganizations(), error: null });
});

router.post('/scrape', async (req, res) => {
  const { url, organization_id } = req.body;
  if (!url) {
    return res.render('admin/scrape', { organizations: getOrganizations(), error: 'URL is required.' });
  }
  try {
    const candidates = await scrapeCandidates(url);
    if (!candidates.length) {
      return res.render('admin/scrape', {
        organizations: getOrganizations(),
        error: 'No addresses were found on that page.',
      });
    }

    // Extraction only — no geocoding here. A directory this size can easily
    // have hundreds of entries, and geocoding all of them synchronously
    // inside this one request would take many minutes and risk timing out.
    // Candidates go to Scrape Review first; geocoding happens after approval,
    // either per-candidate on confirm or in bulk via the "Geocode All
    // Pending" background job on the Geolocation Queue page.
    const insert = db.prepare(
      `INSERT INTO scrape_candidates (source_url, organization_id, title, raw_address, city, state, precision)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const c of candidates) {
      const organizationId = organization_id || getOrCreateOrganizationByAbbreviation(c.organizationAbbreviation);
      insert.run(url, organizationId || null, c.title, c.address, c.city, c.state, c.precision);
    }

    res.redirect('/admin/review');
  } catch (err) {
    res.render('admin/scrape', { organizations: getOrganizations(), error: err.message });
  }
});

// --- Stage 1: raw scrape review ---------------------------------------------
// Freshly scraped candidates land here first (status 'pending'), before any
// geocoding is attempted. A human skims titles/addresses/orgs for obvious
// scraper mistakes (wrong org, garbled text, junk rows) and either approves
// them into the geolocation queue below or deletes them, individually or in
// bulk — nothing reaches the map without passing through both queues.

router.get('/review', (req, res) => {
  res.render('admin/review', { candidates: getCandidatesByStatus('pending'), error: null });
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
    try {
      coords = await geocodeAddress(address.trim());
    } catch (err) {
      return renderError(err.message);
    }
    if (!coords) return renderError('This address could not be geocoded. Correct it above, or enter latitude/longitude manually.');
  }

  db.prepare(
    `INSERT INTO mass_centers (title, address, latitude, longitude, precision, organization_id, source_url)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    title.trim(),
    address.trim(),
    coords.latitude,
    coords.longitude,
    candidate.precision,
    candidate.organization_id,
    candidate.source_url
  );
  db.prepare("UPDATE scrape_candidates SET status = 'confirmed' WHERE id = ?").run(req.params.id);
  res.redirect('/admin/candidates');
});

router.post('/candidates/:id/reject', (req, res) => {
  db.prepare("UPDATE scrape_candidates SET status = 'rejected' WHERE id = ?").run(req.params.id);
  res.redirect('/admin/candidates');
});

module.exports = router;
