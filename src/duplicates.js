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

// Finds candidate duplicate pairs among confirmed mass centers: pins that
// geocode very close together, or whose titles are near-identical, per the
// roadmap's "Duplicate detection" item. Dismissed pairs are excluded.
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

      const distanceMeters = haversineMeters(a.latitude, a.longitude, b.latitude, b.longitude);
      const similarity = titleSimilarity(a.title, b.title);
      const closeBy = distanceMeters <= DISTANCE_THRESHOLD_METERS;
      const similarTitle = similarity >= TITLE_SIMILARITY_THRESHOLD;
      if (closeBy || similarTitle) {
        pairs.push({ a, b, distanceMeters, similarity, closeBy, similarTitle });
      }
    }
  }
  return pairs;
}

function dismissPair(idA, idB) {
  const [id1, id2] = idA < idB ? [idA, idB] : [idB, idA];
  db.prepare('INSERT OR IGNORE INTO duplicate_dismissals (mass_center_id_1, mass_center_id_2) VALUES (?, ?)').run(
    id1,
    id2
  );
}

module.exports = { haversineMeters, normalizeTitle, titleSimilarity, findDuplicatePairs, dismissPair };
