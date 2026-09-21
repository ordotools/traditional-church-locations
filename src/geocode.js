// Geocoding via the OpenStreetMap Nominatim public API (free, no API key).
// Usage policy requires a real contact in the User-Agent and max 1 request/second:
// https://operations.osmfoundation.org/policies/nominatim/
const db = require('./db');
const { normalizeAddress } = require('./duplicates');

const CONTACT = process.env.GEOCODE_CONTACT || 'set-GEOCODE_CONTACT-env-var';
const USER_AGENT = `traditional-church-locations/0.1 (${CONTACT})`;

// Bulk geocoding (e.g. confirming many scraped candidates) waits this long
// between requests. Nominatim's policy requires at least 1000ms; default to
// something more conservative since we may be issuing many in a row.
const BULK_INTERVAL_MS = parseInt(process.env.GEOCODE_INTERVAL_MS, 10) || 5000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Nominatim's policy floor (1 req/sec) applies between these fallback steps
// too, since they're just more requests to the same API in the same call.
// Also used as the delay between geocodeCascade's structured-field tiers below.
const CASCADE_STEP_DELAY_MS = 1100;

async function geocodeOnce(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=1&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Geocoding request failed with status ${res.status}`);
  const results = await res.json();
  if (!results.length) return null;
  return {
    latitude: parseFloat(results[0].lat),
    longitude: parseFloat(results[0].lon),
    country: results[0].address?.country || null,
  };
}

// A full freeform address often can't be found as-is (OpenStreetMap has real
// coverage gaps — see README) even though a coarser version of the same
// string would resolve fine, e.g. "Ugabi Street, Ewea Quarters, Agenebode,
// Nigeria" fails but "Agenebode, Nigeria" succeeds. Retry by progressively
// dropping the leading comma-separated segment, so this bottoms out at
// whatever's last in the string — normally the country — before giving up.
async function geocodeAddress(address) {
  const segments = address.split(',').map((s) => s.trim()).filter(Boolean);
  for (let i = 0; i < segments.length; i++) {
    if (i > 0) await sleep(CASCADE_STEP_DELAY_MS);
    const coords = await geocodeOnce(segments.slice(i).join(', '));
    if (coords) return coords;
  }
  return null;
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

// Cache key covers every field the cascade below can use — so "same street
// address" and "no street, but same city/state/country" each cache
// separately instead of colliding. Re-scraping the same site never re-hits
// Nominatim for an address it already resolved.
function cacheKey({ address, postalCode, city, state, country }) {
  const key = normalizeAddress([address, postalCode, city, state, country].filter(Boolean).join(' '));
  return key || null;
}

function getCachedCascade(key) {
  if (!key) return null;
  const row = db.prepare('SELECT latitude, longitude, precision FROM geocode_cache WHERE cache_key = ?').get(key);
  return row ? { coords: { latitude: row.latitude, longitude: row.longitude }, precision: row.precision } : null;
}

function setCachedCascade(key, result) {
  if (!key) return;
  db.prepare(
    `INSERT INTO geocode_cache (cache_key, latitude, longitude, precision) VALUES (?, ?, ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET latitude = excluded.latitude, longitude = excluded.longitude, precision = excluded.precision`
  ).run(key, result.coords.latitude, result.coords.longitude, result.precision);
}

// A full street address often can't be found (OpenStreetMap has real
// coverage gaps — see README), which used to just leave a candidate stuck
// unconfirmed. Instead, fall back to whatever's less specific: postal code,
// then city, then state/province, then country — each only attempted if
// that field is actually present. Returns the coordinates AND the precision
// tier that actually succeeded (which may be coarser than the input data
// implied), or null if every available tier failed.
async function geocodeCascade({ address, postalCode, city, state, country }) {
  const key = cacheKey({ address, postalCode, city, state, country });
  const cached = getCachedCascade(key);
  if (cached) return cached;

  const attempts = [];
  if (address) attempts.push({ precision: 'exact', run: () => geocodeAddress(address) });
  if (postalCode) attempts.push({ precision: 'postal', run: () => geocodeStructured({ postalcode: postalCode, country }) });
  if (city) attempts.push({ precision: 'city', run: () => geocodeStructured({ city, state, country }) });
  if (state) attempts.push({ precision: 'state', run: () => geocodeStructured({ state, country }) });
  if (country) attempts.push({ precision: 'country', run: () => geocodeStructured({ country }) });

  for (let i = 0; i < attempts.length; i++) {
    if (i > 0) await sleep(CASCADE_STEP_DELAY_MS);
    const coords = await attempts[i].run();
    if (coords) {
      const result = { coords, precision: attempts[i].precision };
      setCachedCascade(key, result);
      return result;
    }
  }
  return null;
}

module.exports = { geocodeAddress, geocodeCascade, sleep, BULK_INTERVAL_MS };
