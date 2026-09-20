const assert = require('assert');
const {
  haversineMeters,
  titleSimilarity,
  normalizeAddress,
  isMorePrecise,
  findMassCenterMatch,
  findTextSimilarityMatch,
} = require('./duplicates');

// Same point → 0 distance.
assert.strictEqual(haversineMeters(40, -75, 40, -75), 0);

// Roughly 1 degree of latitude ≈ 111km.
const oneDegreeLat = haversineMeters(0, 0, 1, 0);
assert.ok(Math.abs(oneDegreeLat - 111195) < 500, `expected ~111195m, got ${oneDegreeLat}`);

// Identical / empty titles.
assert.strictEqual(titleSimilarity('St. Mary Chapel', 'St. Mary Chapel'), 1);
assert.strictEqual(titleSimilarity('', ''), 1);
assert.strictEqual(titleSimilarity('', 'St. Mary Chapel'), 0);

// Near-identical after normalization (punctuation/case differences).
assert.ok(titleSimilarity('St. Mary\'s Chapel', 'st marys chapel') > 0.8);

// Clearly different titles.
assert.ok(titleSimilarity('St. Mary Chapel', 'Holy Trinity Church') < 0.5);

// Address normalization ignores unit/suite noise and punctuation/case.
assert.strictEqual(normalizeAddress('123 Main St, Suite 4'), normalizeAddress('123 Main Street #4'));
assert.notStrictEqual(normalizeAddress('123 Main St'), normalizeAddress('456 Main St'));

// Precision ladder: exact beats postal beats city, etc.
assert.strictEqual(isMorePrecise('exact', 'city'), true);
assert.strictEqual(isMorePrecise('city', 'exact'), false);
assert.strictEqual(isMorePrecise('city', 'city'), false);

// findMassCenterMatch: same org + same address -> auto-mergeable match.
const existing = [
  { id: 1, title: 'St. Mary Chapel', address: '123 Main St', latitude: 40, longitude: -75, organization_id: 1, precision: 'exact' },
];
const sameOrgCandidate = { raw_address: '123 Main Street', latitude: 40, longitude: -75, organization_id: 1 };
const sameOrgMatch = findMassCenterMatch(sameOrgCandidate, existing);
assert.ok(sameOrgMatch && sameOrgMatch.sameOrg, 'expected a same-org match');
assert.strictEqual(sameOrgMatch.massCenter.id, 1);

// Different org at the same address -> conflict match (sameOrg: false).
const diffOrgCandidate = { raw_address: '123 Main Street', latitude: 40, longitude: -75, organization_id: 2 };
const diffOrgMatch = findMassCenterMatch(diffOrgCandidate, existing);
assert.ok(diffOrgMatch && !diffOrgMatch.sameOrg, 'expected a cross-org conflict match');

// No address/geo overlap -> no match at all.
const newPlaceCandidate = { raw_address: '999 Elsewhere Ave', latitude: 10, longitude: 10, organization_id: 1 };
assert.strictEqual(findMassCenterMatch(newPlaceCandidate, existing), null);

// findTextSimilarityMatch: pre-geocode gate, no coordinates involved at all.
const textCenters = [{ id: 1, title: 'St. Mary Chapel', address: '123 Main St', organization_id: 1 }];

// Near-identical text (minor formatting drift) -> scores above the reject
// threshold, confident enough to skip geocoding entirely.
const nearDup = findTextSimilarityMatch({ raw_address: '123 Main Street', title: 'St Mary Chapel', organization_id: 1 }, textCenters);
assert.ok(nearDup && nearDup.score >= 0.9, `expected a confident match, got ${nearDup && nearDup.score}`);

// Unrelated text -> no match reported at all (not even worth a "maybe").
assert.strictEqual(
  findTextSimilarityMatch({ raw_address: '999 Elsewhere Ave', title: 'Totally Different Place' }, textCenters),
  null
);

// Reworded title at a similar-but-not-identical address -> ambiguous middle
// band, reported with a score but below the auto-reject threshold.
const ambiguous = findTextSimilarityMatch({ raw_address: '123 Main St Suite 9', title: 'Saint Marys' }, textCenters);
assert.ok(ambiguous && ambiguous.score < 0.9 && ambiguous.score >= 0.55, `expected a mid-band score, got ${ambiguous && ambiguous.score}`);

// No existing centers at all -> nothing to compare against.
assert.strictEqual(findTextSimilarityMatch({ raw_address: '123 Main St', title: 'St. Mary Chapel' }, []), null);

console.log('ok');
