const express = require('express');
const db = require('../db');
const { geocodeAddress, sleep } = require('../geocode');
const { scrapeAddresses } = require('../scraper');

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

function getOrganizations() {
  return db.prepare('SELECT * FROM organizations ORDER BY name').all();
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

function getPendingCandidates() {
  return db
    .prepare(
      `SELECT sc.*, o.name AS organization_name, o.abbreviation AS organization_abbreviation
       FROM scrape_candidates sc LEFT JOIN organizations o ON o.id = sc.organization_id
       WHERE sc.status = 'pending'
       ORDER BY sc.created_at DESC`
    )
    .all();
}

// --- Dashboard ---------------------------------------------------------

router.get('/', (req, res) => {
  const massCenterCount = db.prepare('SELECT COUNT(*) AS n FROM mass_centers').get().n;
  const organizationCount = db.prepare('SELECT COUNT(*) AS n FROM organizations').get().n;
  const pendingCount = db.prepare("SELECT COUNT(*) AS n FROM scrape_candidates WHERE status = 'pending'").get().n;
  res.render('admin/dashboard', { massCenterCount, organizationCount, pendingCount });
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
    const coords = parseManualCoords(latitude, longitude) || (await geocodeAddress(address));
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
    const addresses = await scrapeAddresses(url);
    if (!addresses.length) {
      return res.render('admin/scrape', {
        organizations: getOrganizations(),
        error: 'No addresses were found on that page.',
      });
    }

    const insert = db.prepare(
      `INSERT INTO scrape_candidates (source_url, organization_id, raw_address, latitude, longitude)
       VALUES (?, ?, ?, ?, ?)`
    );

    for (const address of addresses) {
      let coords = null;
      try {
        coords = await geocodeAddress(address);
      } catch {
        coords = null;
      }
      insert.run(url, organization_id || null, address, coords?.latitude ?? null, coords?.longitude ?? null);
      await sleep(1000); // respect Nominatim's 1 request/second policy
    }

    res.redirect('/admin/candidates');
  } catch (err) {
    res.render('admin/scrape', { organizations: getOrganizations(), error: err.message });
  }
});

router.get('/candidates', (req, res) => {
  res.render('admin/candidates', { candidates: getPendingCandidates(), error: null });
});

router.post('/candidates/:id/confirm', (req, res) => {
  const { title, latitude: manualLat, longitude: manualLng } = req.body;
  const candidate = db.prepare('SELECT * FROM scrape_candidates WHERE id = ?').get(req.params.id);
  if (!candidate) return res.status(404).send('Not found');

  let coords;
  try {
    coords = parseManualCoords(manualLat, manualLng) || (candidate.latitude !== null ? candidate : null);
  } catch (err) {
    return res.render('admin/candidates', { candidates: getPendingCandidates(), error: err.message });
  }

  if (!title || !coords) {
    return res.render('admin/candidates', {
      candidates: getPendingCandidates(),
      error: !title
        ? 'A title is required to confirm a pin.'
        : 'This address could not be geocoded. Enter latitude/longitude manually to confirm it.',
    });
  }

  db.prepare(
    `INSERT INTO mass_centers (title, address, latitude, longitude, organization_id, source_url)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(title.trim(), candidate.raw_address, coords.latitude, coords.longitude, candidate.organization_id, candidate.source_url);
  db.prepare("UPDATE scrape_candidates SET status = 'confirmed' WHERE id = ?").run(req.params.id);
  res.redirect('/admin/candidates');
});

router.post('/candidates/:id/reject', (req, res) => {
  db.prepare("UPDATE scrape_candidates SET status = 'rejected' WHERE id = ?").run(req.params.id);
  res.redirect('/admin/candidates');
});

module.exports = router;
