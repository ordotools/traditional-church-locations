const assert = require('assert');

// Stub Nominatim: only a query of "Agenebode, Nigeria" or shorter succeeds,
// simulating a real street address that OSM doesn't have but the town does.
const calls = [];
global.fetch = async (url) => {
  calls.push(decodeURIComponent(new URL(url).searchParams.get('q') || ''));
  const q = decodeURIComponent(new URL(url).searchParams.get('q') || '');
  const found = q === 'Agenebode, Nigeria' || q === 'Nigeria';
  return {
    ok: true,
    json: async () => (found ? [{ lat: '7.1', lon: '6.7', address: { country: 'Nigeria' } }] : []),
  };
};

const { geocodeAddress } = require('./geocode');

(async () => {
  const coords = await geocodeAddress('Ugabi Street, Ewea Quarters, Agenebode, Nigeria');
  assert.deepStrictEqual(coords, { latitude: 7.1, longitude: 6.7, country: 'Nigeria' });
  assert.deepStrictEqual(calls, [
    'Ugabi Street, Ewea Quarters, Agenebode, Nigeria',
    'Ewea Quarters, Agenebode, Nigeria',
    'Agenebode, Nigeria',
  ]);

  const nothing = await geocodeAddress('Nowhere Real');
  assert.strictEqual(nothing, null);

  console.log('ok');
})();
