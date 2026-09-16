# Traditional Church Locations

A minimal map of traditional Mass centers. Pan and zoom to see every pin;
each pin is colored by the organization that runs that Mass center.

## Stack

- Node.js + Express, EJS templates for the admin panel
- SQLite via `better-sqlite3` (single file at `data/db.sqlite`)
- Leaflet.js (loaded from a CDN) for the map, rendered in grayscale
- Geocoding via the free OpenStreetMap Nominatim API
- Scraping via `cheerio` plus a regex-based address finder

No build step, no frontend framework.

## Running locally

```
npm install
cp .env.example .env   # set GEOCODE_CONTACT to a real contact
npm start
```

- Map: http://localhost:3000/
- Admin panel: http://localhost:3000/admin

The admin panel has no authentication yet (see ROADMAP.md).

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

   Nothing is geocoded during scraping (a large directory can have hundreds
   of entries, which would block the request for many minutes). Instead, on
   the Review Candidates page you can either confirm candidates one at a
   time (each is geocoded on demand) or click "Geocode All Pending" to
   geocode the rest in the background at a configurable interval
   (`GEOCODE_INTERVAL_MS`, default 5s) — the page shows progress and you can
   keep confirming already-geocoded candidates while it runs.

## Data model

- `organizations` — name, abbreviation, color
- `mass_centers` — the pins: title, address, lat/lng, precision (exact/city/state), organization
- `scrape_candidates` — listings found by scraping, pending review: title,
  address (or city/state fallback), precision, organization, geocoded lat/lng
