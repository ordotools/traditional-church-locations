const assert = require('assert');
const { haversineMeters, titleSimilarity } = require('./duplicates');

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

console.log('ok');
