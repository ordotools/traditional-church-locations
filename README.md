# Traditional Church Locations

A minimal map of traditional Mass centers. Pan and zoom to see every pin;
each pin is colored by the organization that runs that Mass center.

## Stack

- Node.js + Express, EJS templates for the admin panel
- SQLite via `better-sqlite3` (single file at `data/db.sqlite`)
- Leaflet.js (loaded from a CDN) for the map, rendered in grayscale
- Geocoding via the free OpenStreetMap Nominatim API, with a fallback ladder
  (full address → city → state → country) when the exact address can't be found
- Scraping via Gemini AI extraction (`TCL_GEMINI_API_KEY`) for consistent results
  across every site, falling back to `cheerio` plus a regex-based address
  finder when no key is set, the AI call errors, or it finds nothing

No build step, no frontend framework.

## Running locally

```
npm install
cp .env.example .env   # set GEOCODE_CONTACT, ADMIN_USERNAME/PASSWORD, SESSION_SECRET
npm start
```

- Map: http://localhost:3000/
- Admin panel: http://localhost:3000/admin — log in with `ADMIN_USERNAME`/`ADMIN_PASSWORD`
  (single admin account; see ROADMAP.md for multi-user/roles).

## Deploying (Coolify)

The app is a plain Node/Express server with a SQLite file on disk, built from the
included `Dockerfile`.

1. In Coolify, create a new resource from this repo — it will detect and build
   the `Dockerfile` automatically.
2. Add a **persistent volume** mounted at `/app/data` (the container's
   `DATA_DIR`), so the SQLite database survives redeploys.
3. Set environment variables: `ADMIN_USERNAME`, `ADMIN_PASSWORD`,
   `SESSION_SECRET` (a long random string — `openssl rand -hex 32`), and
   `GEOCODE_CONTACT`.
4. Set the exposed port to `3000` and enable HTTPS in Coolify — the app trusts
   the proxy's forwarded headers and requires it in production for the login
   cookie.

## How pins get added

1. **By hand** — Admin → Mass Centers → enter a title, address, and
   organization. The address is geocoded immediately. If geocoding fails or
   is wrong (OpenStreetMap has real gaps, especially on rural roads), you can
   enter latitude/longitude directly instead.
2. **By scraping a URL** — Admin → Scrape URL → enter a page URL. The page is
   parsed for listings (title, address, organization), handling either an
   HTML table layout (one row per location) or loose paragraph text. If a
   listing has no street address, it falls back to a city- or state-level
   pin. Organization abbreviations that aren't in your Organizations table
   yet are created automatically — rename them from the Organizations page.

   When `TCL_GEMINI_API_KEY` is set, every page is extracted by Gemini rather
   than the regex/table heuristic, so results are consistent site to site —
   the heuristic extractor can "succeed" (find rows) while still producing
   malformed addresses, which per-site AI extraction avoids. The prompt is
   instructed to leave a field blank rather than guess at it, and either way
   every result still lands in the review queue below rather than going
   straight to the map. The heuristic/site-specific extractors are only used
   as a fallback — no API key configured, the AI call errors, or it finds
   nothing on the page.

   Nothing is geocoded during scraping (a large directory can have hundreds
   of entries, which would block the request for many minutes). Instead, on
   the Review Candidates page you can either confirm candidates one at a
   time (each is geocoded on demand) or click "Geocode All Pending" to
   geocode the rest in the background at a configurable interval
   (`GEOCODE_INTERVAL_MS`, default 5s) — the page shows progress and you can
   keep confirming already-geocoded candidates while it runs. If the full
   address can't be found, geocoding falls back to city, then state, then
   country — whichever of those the extractor captured — so a candidate still
   gets a pin (marked with its actual precision) instead of getting stuck.

   Before either of those actually calls the geocoder, each candidate passes
   a dedup gate (`src/candidatePipeline.js#gateForGeocoding`) so re-scraping
   never burns a Nominatim call on something already on the map: address+title
   text similarity (`src/duplicates.js`) auto-rejects near-identical repeats
   outright, lets clearly-new listings straight through, and escalates the
   ambiguous middle band to Jev (`src/jev.js`, needs `AI_GATEWAY_API_KEY` —
   see `.env.example`) in one batched call. Whatever's still uncertain (or
   whatever Jev isn't configured to judge) lands on `/admin/conflicts`
   tagged with the confidence score, same queue used for post-geocode
   cross-organization matches. Resolved geocodes are also cached by
   normalized address, so the same address is never looked up twice.

## Data model

- `organizations` — name, abbreviation, color
- `mass_centers` — the pins: title, address, lat/lng, precision (exact/city/state/country), organization
- `scrape_candidates` — listings found by scraping, pending review: title,
  address, city/state/country, precision, organization, geocoded lat/lng,
  plus `duplicate_score` when the dedup gate flagged a possible match
- `geocode_cache` — normalized address -> resolved lat/lng/precision, so a
  repeat scrape never re-geocodes an address already resolved
