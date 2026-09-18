// Geocoding via the OpenStreetMap Nominatim public API (free, no API key).
// Usage policy requires a real contact in the User-Agent and max 1 request/second:
// https://operations.osmfoundation.org/policies/nominatim/
const CONTACT = process.env.GEOCODE_CONTACT || 'set-GEOCODE_CONTACT-env-var';
const USER_AGENT = `traditional-church-locations/0.1 (${CONTACT})`;

// Bulk geocoding (e.g. confirming many scraped candidates) waits this long
// between requests. Nominatim's policy requires at least 1000ms; default to
// something more conservative since we may be issuing many in a row.
const BULK_INTERVAL_MS = parseInt(process.env.GEOCODE_INTERVAL_MS, 10) || 5000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function geocodeAddress(address) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Geocoding request failed with status ${res.status}`);
  const results = await res.json();
  if (!results.length) return null;
  return { latitude: parseFloat(results[0].lat), longitude: parseFloat(results[0].lon) };
}

// Nominatim's "structured" search — city/state/country passed as separate
// params instead of one freeform string — used by geocodeCascade's fallback
// tiers below, since those tiers deliberately have no street to put in `q=`.
async function geocodeStructured(fields) {
  const qs = new URLSearchParams({ format: 'json', limit: '1' });
  for (const [key, value] of Object.entries(fields)) {
    if (value) qs.set(key, value);
  }
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${qs}`, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Geocoding request failed with status ${res.status}`);
  const results = await res.json();
  if (!results.length) return null;
  return { latitude: parseFloat(results[0].lat), longitude: parseFloat(results[0].lon) };
}

// Nominatim's policy floor (1 req/sec) applies between these cascade steps
// too, since they're just more requests to the same API in the same call.
const CASCADE_STEP_DELAY_MS = 1100;

// A full street address often can't be found (OpenStreetMap has real
// coverage gaps — see README), which used to just leave a candidate stuck
// unconfirmed. Instead, fall back to whatever's less specific: postal code,
// then city, then state/province, then country — each only attempted if
// that field is actually present. Returns the coordinates AND the precision
// tier that actually succeeded (which may be coarser than the input data
// implied), or null if every available tier failed.
async function geocodeCascade({ address, postalCode, city, state, country }) {
  const attempts = [];
  if (address) attempts.push({ precision: 'exact', run: () => geocodeAddress(address) });
  if (postalCode) attempts.push({ precision: 'postal', run: () => geocodeStructured({ postalcode: postalCode, country }) });
  if (city) attempts.push({ precision: 'city', run: () => geocodeStructured({ city, state, country }) });
  if (state) attempts.push({ precision: 'state', run: () => geocodeStructured({ state, country }) });
  if (country) attempts.push({ precision: 'country', run: () => geocodeStructured({ country }) });

  for (let i = 0; i < attempts.length; i++) {
    if (i > 0) await sleep(CASCADE_STEP_DELAY_MS);
    const coords = await attempts[i].run();
    if (coords) return { coords, precision: attempts[i].precision };
  }
  return null;
}

module.exports = { geocodeAddress, geocodeCascade, sleep, BULK_INTERVAL_MS };
