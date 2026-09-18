const db = require('./db');

// ponytail: plain nested-loop scan, fine up to a few thousand mass centers;
// switch to a geo grid/index if the dataset grows past that.
const DISTANCE_THRESHOLD_METERS = 150;
const TITLE_SIMILARITY_THRESHOLD = 0.82;
const EARTH_RADIUS_METERS = 6371000;

function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(a));
}

function normalizeTitle(title) {
  return (title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

// Common USPS street-suffix abbreviations, so "St" and "Street" compare equal.
// Not exhaustive — just the ones likely to vary between two scrapes of the
// same listing (an abbreviated table vs. a spelled-out one, say).
const STREET_SUFFIXES = {
  st: 'street',
  rd: 'road',
  dr: 'drive',
  ave: 'avenue',
  blvd: 'boulevard',
  ln: 'lane',
  ct: 'court',
  pl: 'place',
  hwy: 'highway',
  pkwy: 'parkway',
};

// Strips unit/suite/apt fragments and punctuation, and expands common street
// suffixes, so "123 Main St, Suite 4" and "123 Main Street #4" compare equal.
// Not a full address parser — just enough to catch the same listing scraped
// with minor formatting differences.
function normalizeAddress(address) {
  return (address || '')
    .toLowerCase()
    .replace(/\b(apt|apartment|suite|ste|unit)\.?\s*#?\s*\w*/g, ' ')
    .replace(/#\s*\w*/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((word) => STREET_SUFFIXES[word] || word)
    .join(' ');
}

// exact > postal > city > state > country, matching geocode.js's fallback ladder.
const PRECISION_RANK = { exact: 0, postal: 1, city: 2, state: 3, country: 4 };

function isMorePrecise(a, b) {
  return (PRECISION_RANK[a] ?? 5) < (PRECISION_RANK[b] ?? 5);
}

// Standard Levenshtein edit distance, turned into a 0..1 similarity ratio.
function titleSimilarity(a, b) {
  const s1 = normalizeTitle(a);
  const s2 = normalizeTitle(b);
  if (!s1 && !s2) return 1;
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;

  const rows = s1.length + 1;
  const cols = s2.length + 1;
  const dist = Array.from({ length: rows }, (_, i) => [i, ...new Array(cols - 1).fill(0)]);
  for (let j = 0; j < cols; j++) dist[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      dist[i][j] = Math.min(dist[i - 1][j] + 1, dist[i][j - 1] + 1, dist[i - 1][j - 1] + cost);
    }
  }
  const editDistance = dist[rows - 1][cols - 1];
  return 1 - editDistance / Math.max(s1.length, s2.length);
}

function getDismissedPairKeys() {
  const rows = db.prepare('SELECT mass_center_id_1, mass_center_id_2 FROM duplicate_dismissals').all();
  return new Set(rows.map((r) => `${r.mass_center_id_1}-${r.mass_center_id_2}`));
}

function pairKey(idA, idB) {
  const [id1, id2] = idA < idB ? [idA, idB] : [idB, idA];
  return `${id1}-${id2}`;
}

// Finds candidate duplicate pairs among confirmed mass centers: pins with the
// same address, that geocode very close together, or whose titles are
// near-identical. Address match is the strongest signal (same place scraped
// twice); title similarity alone is the weakest, since different real
// locations often share a name. Dismissed pairs are excluded.
function findDuplicatePairs() {
  const centers = db
    .prepare(
      `SELECT mc.*, o.name AS organization_name
       FROM mass_centers mc LEFT JOIN organizations o ON o.id = mc.organization_id
       ORDER BY mc.id`
    )
    .all();
  const dismissed = getDismissedPairKeys();

  const pairs = [];
  for (let i = 0; i < centers.length; i++) {
    for (let j = i + 1; j < centers.length; j++) {
      const a = centers[i];
      const b = centers[j];
      if (dismissed.has(pairKey(a.id, b.id))) continue;

      const normA = normalizeAddress(a.address);
      const addressMatch = Boolean(normA) && normA === normalizeAddress(b.address);
      const distanceMeters = haversineMeters(a.latitude, a.longitude, b.latitude, b.longitude);
      const similarity = titleSimilarity(a.title, b.title);
      const closeBy = distanceMeters <= DISTANCE_THRESHOLD_METERS;
      const similarTitle = similarity >= TITLE_SIMILARITY_THRESHOLD;
      const sameOrg = (a.organization_id || null) === (b.organization_id || null);
      if (addressMatch || closeBy || similarTitle) {
        pairs.push({ a, b, distanceMeters, similarity, closeBy, similarTitle, addressMatch, sameOrg });
      }
    }
  }
  // Strongest signal first: same address, then geo-close, then title-only matches.
  pairs.sort((x, y) => (y.addressMatch - x.addressMatch) || (y.closeBy - x.closeBy) || y.similarity - x.similarity);
  return pairs;
}

// Checks a scrape candidate against existing mass centers, for use before
// it's inserted — the gate that keeps daily re-scraping from creating a new
// pin for a place that's already on the map. A match against the candidate's
// own organization always wins (it's just this listing seen again); a match
// against a different organization is returned only when no same-org match
// exists, since that needs a human to say whether the place changed hands or
// two organizations legitimately share a building.
function findMassCenterMatch(candidate, centers) {
  const list = centers || db.prepare('SELECT * FROM mass_centers').all();
  const candidateAddress = normalizeAddress(candidate.raw_address || candidate.address);

  const matches = [];
  for (const mc of list) {
    const addressMatch = Boolean(candidateAddress) && candidateAddress === normalizeAddress(mc.address);
    const distanceMeters =
      candidate.latitude != null && candidate.longitude != null
        ? haversineMeters(candidate.latitude, candidate.longitude, mc.latitude, mc.longitude)
        : null;
    const geoMatch = distanceMeters != null && distanceMeters <= DISTANCE_THRESHOLD_METERS;
    if (!addressMatch && !geoMatch) continue;
    matches.push({
      massCenter: mc,
      addressMatch,
      geoMatch,
      distanceMeters,
      sameOrg: (candidate.organization_id || null) === (mc.organization_id || null),
    });
  }
  if (!matches.length) return null;

  const pool = matches.some((m) => m.sameOrg) ? matches.filter((m) => m.sameOrg) : matches;
  pool.sort((a, b) => {
    if (a.addressMatch !== b.addressMatch) return a.addressMatch ? -1 : 1;
    return (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity);
  });
  return pool[0];
}

function dismissPair(idA, idB) {
  const [id1, id2] = idA < idB ? [idA, idB] : [idB, idA];
  db.prepare('INSERT OR IGNORE INTO duplicate_dismissals (mass_center_id_1, mass_center_id_2) VALUES (?, ?)').run(
    id1,
    id2
  );
}

module.exports = {
  haversineMeters,
  normalizeTitle,
  normalizeAddress,
  titleSimilarity,
  isMorePrecise,
  findDuplicatePairs,
  findMassCenterMatch,
  dismissPair,
};
