const assert = require('assert');
const { haversineMeters, titleSimilarity, normalizeAddress, isMorePrecise, findMassCenterMatch } = require('./duplicates');

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

console.log('ok');
