const db = require('./db');
const { geocodeAddress, sleep, BULK_INTERVAL_MS } = require('./geocode');

// A single in-memory job, since this is a single-process app. Progress lives
// in the scrape_candidates rows themselves (latitude IS NULL = not yet
// geocoded), so the job is naturally resumable across a restart — just start
// it again and it picks up whatever is still ungeocoded.
let state = { running: false, total: 0, done: 0, failed: 0 };

function getStatus() {
  return state;
}

function startGeocodingAllPending() {
  if (state.running) return state;

  const pending = db
    .prepare("SELECT id, raw_address FROM scrape_candidates WHERE status = 'approved' AND latitude IS NULL")
    .all();
  state = { running: true, total: pending.length, done: 0, failed: 0 };

  (async () => {
    const update = db.prepare('UPDATE scrape_candidates SET latitude = ?, longitude = ? WHERE id = ?');
    for (const row of pending) {
      try {
        const coords = await geocodeAddress(row.raw_address);
        if (coords) update.run(coords.latitude, coords.longitude, row.id);
        else state.failed++;
      } catch {
        state.failed++;
      }
      state.done++;
      await sleep(BULK_INTERVAL_MS);
    }
    state.running = false;
  })();

  return state;
}

module.exports = { startGeocodingAllPending, getStatus };
