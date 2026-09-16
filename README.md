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
   organization. The address is geocoded immediately.
2. **By scraping a URL** — Admin → Scrape URL → enter a page URL and an
   organization. The page's text is scanned for street addresses, each
   candidate is geocoded, and nothing is saved to the map until you
   review and confirm it under Admin → Review Candidates (where you also
   supply the title, since a scraped page rarely labels each address).

## Data model

- `organizations` — name, abbreviation, color
- `mass_centers` — the pins: title, address, lat/lng, organization
- `scrape_candidates` — addresses found by scraping, pending review
