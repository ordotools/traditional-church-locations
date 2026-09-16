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

module.exports = { geocodeAddress, sleep, BULK_INTERVAL_MS };
