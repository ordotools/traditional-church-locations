const assert = require('assert');
const { isExactDuplicate } = require('./candidatePipeline');

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

console.log('ok');
