// Shared candidate scrape/confirm logic used by both the manual admin routes
// (src/routes/admin.js) and the scheduled re-scrape job (src/scrapeScheduler.js),
// so the two never drift apart.
const db = require('./db');
const { scrapeCandidates } = require('./scraper');
const duplicates = require('./duplicates');
const jev = require('./jev');
const sourceDecisions = require('./sourceDecisions');

// Jev's returned probability (0..1, "same physical location") past which the
// ambiguous middle band is resolved automatically instead of left for a
// human — see gateForGeocoding.
const JEV_REJECT_PROBABILITY = 0.9;
const JEV_NEW_PROBABILITY = 0.1;

// A rotating palette so auto-created organizations get visually distinct
// colors rather than all defaulting to black.
const AUTO_COLORS = ['#a6192e', '#00594c', '#1d3557', '#7b3f00', '#4a154b', '#2a6f2b', '#8c1c13', '#003554'];

// This is a single-process server — a long unbroken synchronous loop over
// hundreds of rows blocks the Node event loop for as long as it takes,
// stalling every other request in flight, including a regular visitor's
// GET /api/pins for the public map (measured: ~1.4s blocked resolving 1000
// candidates against 2000 pins). Yielding back to the event loop every
// CHUNK_SIZE rows keeps each blocking burst small instead of one long one.
const CHUNK_SIZE = 10;
function yieldToEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
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

// True when a freshly scraped item is identical (same org, same normalized
// address, same normalized title) to something we already have — a
// confirmed pin, or a candidate from a previous scrape of this same URL that
// hasn't been resolved yet. Used to keep scheduled re-scraping from piling
// up repeat candidates for pages that haven't actually changed. An empty
// address never counts as a match (would collapse unrelated blank rows).
function isExactDuplicate(item, organizationId, existingMassCenters, existingCandidates) {
  const addr = duplicates.normalizeAddress(item.address);
  if (!addr) return false;
  const title = duplicates.normalizeTitle(item.title);
  const matches = (row) =>
    (row.organization_id || null) === (organizationId || null) &&
    duplicates.normalizeAddress(row.address != null ? row.address : row.raw_address) === addr &&
    duplicates.normalizeTitle(row.title) === title;
  return existingMassCenters.some(matches) || existingCandidates.some(matches);
}

// Fetches a URL, extracts candidates, and inserts them as scrape_candidates.
// Extraction only — no geocoding here. A directory this size can easily have
// hundreds of entries, and geocoding all of them synchronously inside this
// one call would take many minutes and risk timing out.
//
// opts.status: candidate status to insert as. 'pending' (default) is the
// manual-scrape path — a human triages in Scrape Review before anything is
// geocoded. Scheduled re-scrapes use 'approved' to skip straight to
// geocoding, since this is an unattended re-run of a page that was already
// reviewed once.
// opts.dedupe: when true, skips inserting a candidate that's an exact repeat
// of an existing pin or unresolved candidate (see isExactDuplicate) — only
// meant for scheduled re-scrapes, where the same page gets re-run regularly.
//
// Regardless of opts, every candidate is first checked against
// source_location_decisions (see sourceDecisions.js) — a human's past
// approve/skip choice for this exact address+title on this source_url. A
// remembered 'rejected' skips insertion outright; a remembered 'approved'
// inserts straight in as 'approved', bypassing the pending review queue —
// this is what lets a re-scrape stop re-asking about locations already
// triaged once.
//
// Throws if the fetch fails; returns { count, skipped, aiWarning } (count 0 =
// none found; aiWarning set when AI was configured but ended up unused for
// this page — see scraper.js).
// A blank title is what a human would otherwise have to type in by hand to
// get a candidate past the various "title required" gates (resolveReadyCandidates,
// the conflict-resolution actions in admin.js) — so default it up front,
// here at the one place every scraped candidate is inserted, instead of
// leaving blank titles for every downstream consumer to guard against.
function defaultTitle(organizationId, abbreviation) {
  const abbr = abbreviation || db.prepare('SELECT abbreviation FROM organizations WHERE id = ?').get(organizationId || -1)?.abbreviation;
  return abbr ? `${abbr} Mass Center` : 'Mass Center';
}

async function runScrape(url, organizationId, opts = {}) {
  const status = opts.status || 'pending';
  const dedupe = Boolean(opts.dedupe);

  const { candidates, aiWarning } = await scrapeCandidates(url);
  if (!candidates.length) return { count: 0, skipped: 0, aiWarning };

  const existingMassCenters = dedupe ? db.prepare('SELECT * FROM mass_centers').all() : [];
  const existingCandidates = dedupe
    ? db.prepare('SELECT * FROM scrape_candidates WHERE source_url = ?').all(url)
    : [];

  const insert = db.prepare(
    `INSERT INTO scrape_candidates (source_url, organization_id, title, raw_address, city, state, country, postal_code, precision, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  let count = 0;
  let skipped = 0;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const candidateOrgId = organizationId || getOrCreateOrganizationByAbbreviation(c.organizationAbbreviation);
    const remembered = sourceDecisions.getDecision(url, c.address, c.title, candidateOrgId);
    if (remembered === 'rejected' || (dedupe && isExactDuplicate(c, candidateOrgId, existingMassCenters, existingCandidates))) {
      skipped++;
    } else {
      const candidateStatus = remembered === 'approved' ? 'approved' : status;
      const title = (c.title && c.title.trim()) || defaultTitle(candidateOrgId, c.organizationAbbreviation);
      insert.run(url, candidateOrgId || null, title, c.address, c.city, c.state, c.country || null, c.postalCode || null, c.precision, candidateStatus);
      count++;
    }
    if (dedupe && i % CHUNK_SIZE === CHUNK_SIZE - 1) await yieldToEventLoop();
  }
  touchSavedSource(url, organizationId);
  return { count, skipped, aiWarning };
}

// Re-scraping found this same listing again — touch the existing pin's
// source/timestamp, and upgrade its address/coordinates if this scrape came
// back more precise than what's stored (see duplicates.js precision ladder).
// This is what lets scheduled re-scraping run without a human: same
// organization at the same address is never a new pin.
function refreshMassCenterFromCandidate(mc, candidate) {
  const useNew = duplicates.isMorePrecise(candidate.precision, mc.precision);
  const merged = {
    address: useNew ? candidate.raw_address : mc.address,
    latitude: useNew ? candidate.latitude : mc.latitude,
    longitude: useNew ? candidate.longitude : mc.longitude,
    precision: useNew ? candidate.precision : mc.precision,
    country: mc.country || candidate.country || null,
  };
  db.prepare(
    `UPDATE mass_centers SET address = ?, latitude = ?, longitude = ?, precision = ?, country = ?,
       source_url = COALESCE(?, source_url), updated_at = datetime('now')
     WHERE id = ?`
  ).run(merged.address, merged.latitude, merged.longitude, merged.precision, merged.country, candidate.source_url || null, mc.id);
  Object.assign(mc, merged);
  return mc;
}

// Confirms every approved candidate that's already geocoded and titled, in
// one go — used by both the manual "Confirm All" button and the scheduler.
// Each is checked against existing pins first (see duplicates.js): a
// same-organization match refreshes that pin instead of creating a new one,
// a different-organization match is held as a conflict for /admin/conflicts,
// and a genuinely new location becomes a new pin. Candidates missing
// geocoding or a title are left in the queue for manual review.
//
// Each candidate resolves in its own transaction (not one covering the
// whole batch) so a run can be interrupted without losing progress, and so
// the CHUNK_SIZE yield below actually gets to run between rows — a single
// db.transaction() around an await never yields, since better-sqlite3
// transactions must be synchronous top to bottom.
async function resolveReadyCandidates() {
  const ready = db
    .prepare("SELECT * FROM scrape_candidates WHERE status = 'approved' AND latitude IS NOT NULL AND title IS NOT NULL AND title != ''")
    .all();

  const insertMassCenter = db.prepare(
    `INSERT INTO mass_centers (title, address, latitude, longitude, precision, organization_id, source_url, country)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const markConfirmed = db.prepare("UPDATE scrape_candidates SET status = 'confirmed' WHERE id = ?");
  const markConflict = db.prepare("UPDATE scrape_candidates SET status = 'conflict', conflict_mass_center_id = ? WHERE id = ?");

  const summary = { confirmed: 0, conflicts: 0, newPins: 0 };
  // Fetched once and kept in sync locally (rather than re-queried per row)
  // so two candidates in the same batch that duplicate each other, or a
  // freshly-inserted pin earlier in the batch, are still caught.
  const centers = db.prepare('SELECT * FROM mass_centers').all();

  const resolveOne = db.transaction((c) => {
    const match = duplicates.findMassCenterMatch(c, centers);
    if (match && !match.sameOrg) {
      markConflict.run(match.massCenter.id, c.id);
      summary.conflicts++;
      return;
    }
    if (match) {
      refreshMassCenterFromCandidate(match.massCenter, c);
      markConfirmed.run(c.id);
      summary.confirmed++;
      return;
    }
    const info = insertMassCenter.run(c.title.trim(), c.raw_address, c.latitude, c.longitude, c.precision, c.organization_id, c.source_url, c.country || null);
    centers.push({
      id: info.lastInsertRowid,
      title: c.title,
      address: c.raw_address,
      latitude: c.latitude,
      longitude: c.longitude,
      organization_id: c.organization_id,
      precision: c.precision,
    });
    markConfirmed.run(c.id);
    summary.newPins++;
  });

  for (let i = 0; i < ready.length; i++) {
    resolveOne(ready[i]);
    if (i % CHUNK_SIZE === CHUNK_SIZE - 1) await yieldToEventLoop();
  }
  return summary;
}

// Pre-geocode duplicate gate: runs before a batch of candidates is handed to
// geocodeCascade, so Nominatim is only called for rows that actually need
// it. isExactDuplicate (above) already catches byte-identical repeats at
// scrape time; this catches near-duplicates (reworded titles, minor address
// formatting drift) via string similarity, with Jev settling the pairs that
// similarity alone can't call confidently.
//
// - A different organization than the matched pin: straight to
//   /admin/conflicts regardless of score — never auto-marked a duplicate,
//   since that needs a human (see the sameOrg check in resolveReadyCandidates).
// - High same-org similarity (>= PRE_GEOCODE_REJECT_THRESHOLD, which an exact
//   address match always meets on its own — see findTextSimilarityMatch):
//   auto-marked 'duplicate' against the matched pin, skipping geocoding
//   entirely.
// - Low similarity (< PRE_GEOCODE_NEW_THRESHOLD, or no existing pins at all):
//   returned as a survivor — proceeds to geocoding unchanged.
// - The middle band is batched into one Jev call. Jev >= JEV_REJECT_PROBABILITY
//   resolves the same way as a high string-similarity match; <= JEV_NEW_PROBABILITY
//   proceeds to geocoding; anything else (including Jev being unconfigured or
//   failing) lands on /admin/conflicts tagged with the score, same queue used
//   for post-geocode cross-organization matches.
//
// Returns the subset of `candidates` that should still be geocoded.
async function gateForGeocoding(candidates) {
  if (!candidates.length) return candidates;

  const centers = db
    .prepare(`SELECT mc.*, o.name AS organization_name FROM mass_centers mc LEFT JOIN organizations o ON o.id = mc.organization_id`)
    .all();
  const markDuplicate = db.prepare("UPDATE scrape_candidates SET status = 'duplicate', conflict_mass_center_id = ?, duplicate_score = ? WHERE id = ?");
  const markConflict = db.prepare("UPDATE scrape_candidates SET status = 'conflict', conflict_mass_center_id = ?, duplicate_score = ? WHERE id = ?");

  const survivors = [];
  const ambiguous = [];
  for (const c of candidates) {
    const match = duplicates.findTextSimilarityMatch(c, centers);
    if (!match) {
      survivors.push(c);
    } else if (!match.sameOrg) {
      // A different organization at what looks like the same place — same
      // rule as the post-geocode conflict check in resolveReadyCandidates:
      // this needs a human (location changed hands? two orgs share a
      // building?), so it's never auto-marked a duplicate no matter how high
      // the text-similarity score is.
      markConflict.run(match.massCenter.id, match.score, c.id);
    } else if (match.score >= duplicates.PRE_GEOCODE_REJECT_THRESHOLD) {
      markDuplicate.run(match.massCenter.id, match.score, c.id);
    } else {
      ambiguous.push({ candidate: c, match });
    }
  }
  if (!ambiguous.length) return survivors;

  const probabilities = await jev.judgeSameLocation(ambiguous.map((a) => ({ candidate: a.candidate, massCenter: a.match.massCenter })));
  ambiguous.forEach((a, i) => {
    const p = probabilities ? probabilities[i] : null;
    if (p != null && p >= JEV_REJECT_PROBABILITY) {
      markDuplicate.run(a.match.massCenter.id, p, a.candidate.id);
    } else if (p != null && p <= JEV_NEW_PROBABILITY) {
      survivors.push(a.candidate);
    } else {
      markConflict.run(a.match.massCenter.id, p != null ? p : a.match.score, a.candidate.id);
    }
  });
  return survivors;
}

module.exports = {
  getOrCreateOrganizationByAbbreviation,
  isExactDuplicate,
  defaultTitle,
  runScrape,
  refreshMassCenterFromCandidate,
  resolveReadyCandidates,
  gateForGeocoding,
};
