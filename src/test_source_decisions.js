const assert = require('assert');
const db = require('./db');
const sourceDecisions = require('./sourceDecisions');

const TEST_URL = '__test__://source-decisions';
db.prepare('DELETE FROM source_location_decisions WHERE source_url = ?').run(TEST_URL);

// Nothing recorded yet.
assert.strictEqual(sourceDecisions.getDecision(TEST_URL, '123 Main St', 'St. Mary Chapel'), null);

// Recorded decision is found even through formatting differences (same
// normalization isExactDuplicate uses).
sourceDecisions.recordDecision(TEST_URL, '123 Main St', 'St. Mary Chapel', 'approved');
assert.strictEqual(sourceDecisions.getDecision(TEST_URL, '123 Main Street', 'st. mary chapel!'), 'approved');

// Re-recording the same address+title overwrites in place, not a new row.
sourceDecisions.recordDecision(TEST_URL, '123 Main St', 'St. Mary Chapel', 'rejected');
assert.strictEqual(sourceDecisions.getDecision(TEST_URL, '123 Main St', 'St. Mary Chapel'), 'rejected');
assert.strictEqual(
  db.prepare('SELECT COUNT(*) AS n FROM source_location_decisions WHERE source_url = ?').get(TEST_URL).n,
  1
);

// A blank address has no stable identity, so it's never recorded or matched.
sourceDecisions.recordDecision(TEST_URL, '', 'Some Title', 'approved');
assert.strictEqual(sourceDecisions.getDecision(TEST_URL, '', 'Some Title'), null);

db.prepare('DELETE FROM source_location_decisions WHERE source_url = ?').run(TEST_URL);
console.log('source_decisions: ok');
