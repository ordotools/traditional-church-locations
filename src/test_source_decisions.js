const assert = require('assert');
const db = require('./db');
const sourceDecisions = require('./sourceDecisions');

const TEST_URL = '__test__://source-decisions';
db.prepare('DELETE FROM source_location_decisions WHERE source_url = ?').run(TEST_URL);

// Nothing recorded yet.
assert.strictEqual(sourceDecisions.getDecision(TEST_URL, '123 Main St', 'St. Mary Chapel', 1), null);

// Recorded decision is found even through formatting differences (same
// normalization isExactDuplicate uses).
sourceDecisions.recordDecision(TEST_URL, '123 Main St', 'St. Mary Chapel', 1, 'approved');
assert.strictEqual(sourceDecisions.getDecision(TEST_URL, '123 Main Street', 'st. mary chapel!', 1), 'approved');

// Re-recording the same address+title+organization overwrites in place, not a new row.
sourceDecisions.recordDecision(TEST_URL, '123 Main St', 'St. Mary Chapel', 1, 'rejected');
assert.strictEqual(sourceDecisions.getDecision(TEST_URL, '123 Main St', 'St. Mary Chapel', 1), 'rejected');
assert.strictEqual(
  db.prepare('SELECT COUNT(*) AS n FROM source_location_decisions WHERE source_url = ?').get(TEST_URL).n,
  1
);

// Same address+title but a *different* organization is a separate decision —
// a human correcting the org (or a scrape later reporting an actual
// handover) must still be able to reach /admin/conflicts instead of being
// silently swallowed by the decision recorded for the old organization.
assert.strictEqual(sourceDecisions.getDecision(TEST_URL, '123 Main St', 'St. Mary Chapel', 2), null);
sourceDecisions.recordDecision(TEST_URL, '123 Main St', 'St. Mary Chapel', 2, 'rejected');
assert.strictEqual(sourceDecisions.getDecision(TEST_URL, '123 Main St', 'St. Mary Chapel', 1), 'rejected');
assert.strictEqual(sourceDecisions.getDecision(TEST_URL, '123 Main St', 'St. Mary Chapel', 2), 'rejected');

// No organization on the candidate (null/undefined) is its own identity too,
// not a wildcard that matches every organization.
sourceDecisions.recordDecision(TEST_URL, '456 Oak Ave', 'Holy Trinity', null, 'approved');
assert.strictEqual(sourceDecisions.getDecision(TEST_URL, '456 Oak Ave', 'Holy Trinity', null), 'approved');
assert.strictEqual(sourceDecisions.getDecision(TEST_URL, '456 Oak Ave', 'Holy Trinity', 3), null);

// A blank address has no stable identity, so it's never recorded or matched.
sourceDecisions.recordDecision(TEST_URL, '', 'Some Title', 1, 'approved');
assert.strictEqual(sourceDecisions.getDecision(TEST_URL, '', 'Some Title', 1), null);

db.prepare('DELETE FROM source_location_decisions WHERE source_url = ?').run(TEST_URL);
console.log('source_decisions: ok');
