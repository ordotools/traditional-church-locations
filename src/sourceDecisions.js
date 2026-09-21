// Remembers per-source accept/skip decisions on scraped locations (see
// schema.sql source_location_decisions), so a re-scrape of the same page
// applies the same decision automatically instead of asking again.
const db = require('./db');
const duplicates = require('./duplicates');

// Same identity used for exact-duplicate detection (candidatePipeline.js):
// normalized address+title. An empty address is never a stable identity.
function normalizedKey(address, title) {
  const normalizedAddress = duplicates.normalizeAddress(address);
  if (!normalizedAddress) return null;
  return { normalizedAddress, normalizedTitle: duplicates.normalizeTitle(title) };
}

function recordDecision(sourceUrl, address, title, status) {
  const key = normalizedKey(address, title);
  if (!key) return;
  db.prepare(
    `INSERT INTO source_location_decisions (source_url, normalized_address, normalized_title, raw_address, title, status, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(source_url, normalized_address, normalized_title) DO UPDATE SET
       raw_address = excluded.raw_address, title = excluded.title, status = excluded.status, updated_at = excluded.updated_at`
  ).run(sourceUrl, key.normalizedAddress, key.normalizedTitle, address || null, title || null, status);
}

// Returns 'approved', 'rejected', or null if this address/title was never decided for this source.
function getDecision(sourceUrl, address, title) {
  const key = normalizedKey(address, title);
  if (!key) return null;
  const row = db
    .prepare(
      'SELECT status FROM source_location_decisions WHERE source_url = ? AND normalized_address = ? AND normalized_title = ?'
    )
    .get(sourceUrl, key.normalizedAddress, key.normalizedTitle);
  return row ? row.status : null;
}

function listForSource(sourceUrl) {
  return db
    .prepare('SELECT * FROM source_location_decisions WHERE source_url = ? ORDER BY updated_at DESC')
    .all(sourceUrl);
}

function setDecisionStatus(id, status) {
  db.prepare("UPDATE source_location_decisions SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
}

module.exports = { recordDecision, getDecision, listForSource, setDecisionStatus };
