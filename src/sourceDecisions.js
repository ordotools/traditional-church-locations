// Remembers per-source accept/skip decisions on scraped locations (see
// schema.sql source_location_decisions), so a re-scrape of the same page
// applies the same decision automatically instead of asking again.
const db = require('./db');
const duplicates = require('./duplicates');

// Sentinel for "no organization on this candidate" — kept out of the real id
// space (autoincrement ids start at 1) so it can sit in a NOT NULL column and
// still work as an ON CONFLICT target (SQLite treats NULL as never equal to
// NULL, which would defeat de-duping org-less decisions).
const NO_ORG = -1;

// Same identity used for exact-duplicate detection (candidatePipeline.js):
// normalized address+title. An empty address is never a stable identity.
function normalizedKey(address, title) {
  const normalizedAddress = duplicates.normalizeAddress(address);
  if (!normalizedAddress) return null;
  return { normalizedAddress, normalizedTitle: duplicates.normalizeTitle(title) };
}

// organization_id is part of the identity, not just stored alongside it: a
// decision recorded while the source listed org A must not silently apply if
// a later scrape of the same address/title lists org B — that's what a real
// organization taking over a location looks like, and it should still reach
// /admin/conflicts instead of being swallowed by an old decision.
function recordDecision(sourceUrl, address, title, organizationId, status) {
  const key = normalizedKey(address, title);
  if (!key) return;
  db.prepare(
    `INSERT INTO source_location_decisions (source_url, normalized_address, normalized_title, organization_id, raw_address, title, status, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(source_url, normalized_address, normalized_title, organization_id) DO UPDATE SET
       raw_address = excluded.raw_address, title = excluded.title, status = excluded.status, updated_at = excluded.updated_at`
  ).run(sourceUrl, key.normalizedAddress, key.normalizedTitle, organizationId ?? NO_ORG, address || null, title || null, status);
}

// Returns 'approved', 'rejected', or null if this address/title/organization
// combination was never decided for this source.
function getDecision(sourceUrl, address, title, organizationId) {
  const key = normalizedKey(address, title);
  if (!key) return null;
  const row = db
    .prepare(
      'SELECT status FROM source_location_decisions WHERE source_url = ? AND normalized_address = ? AND normalized_title = ? AND organization_id = ?'
    )
    .get(sourceUrl, key.normalizedAddress, key.normalizedTitle, organizationId ?? NO_ORG);
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
