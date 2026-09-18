// Automatic re-scraping of saved sources on a user-defined interval. A
// single in-memory job, same pattern as geocodeQueue.js — this is a
// single-process app, and progress lives in the DB rows themselves, so
// there's nothing to lose by keeping the schedule state in memory too.
const db = require('./db');
const pipeline = require('./candidatePipeline');
const geocodeQueue = require('./geocodeQueue');
const { sleep } = require('./geocode');

// How often to check whether a run is due — not the re-scrape cadence
// itself (that's interval_hours, set on the Scrape URL page). Checking the
// DB every 5 minutes means a changed interval takes effect on the next
// check instead of requiring the process to restart a timer.
const POLL_INTERVAL_MS = 5 * 60 * 1000;
const GEOCODE_POLL_MS = 2000;

// phase/sourcesDone/sourcesTotal are only meaningful while running=true — a
// quick "how far along" reading for the status bar (see footer.ejs), since a
// scheduled run can take a while (one Nominatim request per address, at
// GEOCODE_INTERVAL_MS apart).
let state = { running: false, phase: null, sourcesDone: 0, sourcesTotal: 0 };
let pollTimer = null;

function getSchedule() {
  return db.prepare('SELECT * FROM scrape_schedule WHERE id = 1').get();
}

function getStatus() {
  return { ...getSchedule(), ...state };
}

function updateSchedule({ enabled, intervalHours }) {
  const hours = Math.max(1, parseInt(intervalHours, 10) || 24);
  db.prepare('UPDATE scrape_schedule SET enabled = ?, interval_hours = ? WHERE id = 1').run(enabled ? 1 : 0, hours);
}

// Pushed into SQL rather than compared in JS — SQLite's own datetime
// arithmetic sidesteps parsing its "YYYY-MM-DD HH:MM:SS" (no timezone)
// format back into a JS Date correctly.
function isDue() {
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM scrape_schedule
         WHERE id = 1 AND enabled = 1
           AND (last_run_at IS NULL OR last_run_at <= datetime('now', '-' || interval_hours || ' hours'))`
      )
      .get()
  );
}

// Scrapes every saved source, dedupes against what's already known, geocodes
// the new/changed ones, then auto-resolves them exactly like "Confirm All"
// does for a manual scrape: same-org match refreshes the pin, different-org
// match goes to the conflict queue, no match becomes a new pin.
async function runNow() {
  const sources = db.prepare('SELECT * FROM saved_sources').all();
  const summary = { sourcesScraped: 0, sourcesFailed: 0, newCandidates: 0, skippedDuplicates: 0, errors: [] };

  state.phase = 'scraping';
  state.sourcesTotal = sources.length;
  state.sourcesDone = 0;
  for (const source of sources) {
    try {
      const { count, skipped } = await pipeline.runScrape(source.url, source.organization_id, {
        status: 'approved',
        dedupe: true,
      });
      summary.sourcesScraped++;
      summary.newCandidates += count;
      summary.skippedDuplicates += skipped;
    } catch (err) {
      summary.sourcesFailed++;
      summary.errors.push({ url: source.url, message: err.message });
    }
    state.sourcesDone++;
  }

  state.phase = 'geocoding';
  geocodeQueue.startGeocodingAllPending();
  while (geocodeQueue.getStatus().running) {
    await sleep(GEOCODE_POLL_MS);
  }

  state.phase = 'resolving';
  const resolved = await pipeline.resolveReadyCandidates();

  db.prepare(
    "UPDATE scrape_schedule SET last_run_at = datetime('now'), last_run_summary = ?, run_count = run_count + 1 WHERE id = 1"
  ).run(JSON.stringify({ ...summary, ...resolved }));
}

// Fire-and-forget: starts a run if one isn't already in progress, and
// returns immediately so callers (the poll tick, or the "Run now" button)
// never block on it.
function triggerRun() {
  if (state.running) return state;
  state = { running: true, phase: 'scraping', sourcesDone: 0, sourcesTotal: 0 };
  runNow()
    .catch((err) => console.error('Scheduled scrape run failed:', err))
    .finally(() => {
      state = { running: false, phase: null, sourcesDone: 0, sourcesTotal: 0 };
    });
  return state;
}

function start() {
  if (pollTimer) return;
  if (isDue()) triggerRun();
  pollTimer = setInterval(() => {
    if (isDue()) triggerRun();
  }, POLL_INTERVAL_MS);
}

module.exports = { start, getStatus, updateSchedule, triggerRun };
