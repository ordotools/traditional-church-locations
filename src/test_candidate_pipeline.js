const assert = require('assert');
const { isExactDuplicate, defaultTitle, gateForGeocoding } = require('./candidatePipeline');
const db = require('./db');

const massCenters = [
  { organization_id: 1, address: '123 Main St', title: 'St. Mary Chapel' },
];
const pendingCandidates = [
  { organization_id: 2, raw_address: '456 Oak Ave', title: 'Holy Trinity' },
];

// Same org, same address/title (formatting differences aside) as an existing
// pin -> exact duplicate, skip re-inserting it.
assert.strictEqual(
  isExactDuplicate({ address: '123 Main Street', title: 'st. mary chapel!' }, 1, massCenters, pendingCandidates),
  true
);

// Same address/title but a different organization -> not a duplicate (could
// be the location changing hands), let it flow through to the conflict check.
assert.strictEqual(
  isExactDuplicate({ address: '123 Main Street', title: 'St. Mary Chapel' }, 2, massCenters, pendingCandidates),
  false
);

// Title changed at the same address/org -> worth re-surfacing, not a duplicate.
assert.strictEqual(
  isExactDuplicate({ address: '123 Main Street', title: 'St. Mary Cathedral' }, 1, massCenters, pendingCandidates),
  false
);

// Matches an already-pending candidate from a prior scrape of this same URL.
assert.strictEqual(
  isExactDuplicate({ address: '456 Oak Avenue', title: 'Holy Trinity' }, 2, massCenters, pendingCandidates),
  true
);

// No address at all -> never treated as a duplicate match.
assert.strictEqual(isExactDuplicate({ address: '', title: 'St. Mary Chapel' }, 1, massCenters, pendingCandidates), false);

// Genuinely new location -> not a duplicate.
assert.strictEqual(
  isExactDuplicate({ address: '999 Elsewhere Ave', title: 'New Chapel' }, 1, massCenters, pendingCandidates),
  false
);

// Abbreviation known directly (the normal scraped case) -> used as-is.
assert.strictEqual(defaultTitle(null, 'SSPX'), 'SSPX Mass Center');

// No abbreviation on the candidate, but organizationId points at one in the
// db (a manual per-organization scrape) -> looked up.
const orgId = db
  .prepare('INSERT INTO organizations (name, abbreviation, color) VALUES (?, ?, ?)')
  .run('Test Org For Default Title', 'TOFDT', '#000000').lastInsertRowid;
assert.strictEqual(defaultTitle(orgId, null), 'TOFDT Mass Center');
db.prepare('DELETE FROM organizations WHERE id = ?').run(orgId);

// Neither available -> generic fallback, never blank.
assert.strictEqual(defaultTitle(null, null), 'Mass Center');

// gateForGeocoding: a candidate at the exact same address as an existing pin
// but under a different organization must go straight to 'conflict' (never
// silently auto-marked a 'duplicate', however high the text-similarity score
// is) — a human decides whether the place changed hands.
(async () => {
  const orgA = db.prepare('INSERT INTO organizations (name, abbreviation, color) VALUES (?, ?, ?)').run('Org A', 'ORGA', '#000000').lastInsertRowid;
  const orgB = db.prepare('INSERT INTO organizations (name, abbreviation, color) VALUES (?, ?, ?)').run('Org B', 'ORGB', '#000000').lastInsertRowid;
  const mcId = db
    .prepare('INSERT INTO mass_centers (title, address, latitude, longitude, organization_id) VALUES (?, ?, ?, ?, ?)')
    .run('St. Mary Chapel', '123 Main St', 40, -75, orgA).lastInsertRowid;
  const candidateId = db
    .prepare("INSERT INTO scrape_candidates (source_url, organization_id, title, raw_address, status) VALUES (?, ?, ?, ?, 'pending')")
    .run('__test__://gate', orgB, 'St. Mary Chapel', '123 Main Street').lastInsertRowid;

  try {
    const survivors = await gateForGeocoding([{ id: candidateId, organization_id: orgB, title: 'St. Mary Chapel', raw_address: '123 Main Street' }]);
    assert.strictEqual(survivors.length, 0, 'cross-org exact-address match should not survive to geocoding');
    const row = db.prepare('SELECT status, conflict_mass_center_id FROM scrape_candidates WHERE id = ?').get(candidateId);
    assert.strictEqual(row.status, 'conflict');
    assert.strictEqual(row.conflict_mass_center_id, mcId);
  } finally {
    db.prepare('DELETE FROM scrape_candidates WHERE id = ?').run(candidateId);
    db.prepare('DELETE FROM mass_centers WHERE id = ?').run(mcId);
    db.prepare('DELETE FROM organizations WHERE id IN (?, ?)').run(orgA, orgB);
  }

  console.log('ok');
})();
