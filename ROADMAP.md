# Roadmap

## Now (v0.2)

- Map with pan/zoom showing all pins, colored by organization; approximate
  (city/state-level) pins are marked as such in the popup
- Admin: add a pin by address (geocoded on save), with a manual lat/lng
  override for addresses OpenStreetMap can't find
- Admin: scrape a URL for Mass center listings — extracts title, address (or
  falls back to city/state when no street address is given), and organization
  from either an HTML table layout or freeform text; auto-creates unrecognized
  organization abbreviations
- Admin: geocoding is decoupled from scraping — confirm candidates one at a
  time (geocoded on demand) or run a background "Geocode All Pending" job at a
  configurable interval, so a directory with hundreds of entries doesn't block
  the page or blow through Nominatim's rate limit
- Admin: organization management (name, abbreviation, color), editable after
  auto-creation
- SQLite storage, no build step
- Single-admin login (env-var credentials, session cookie) protecting the
  admin panel; SQLite file path configurable via `DATA_DIR` for a persistent
  volume in production; `Dockerfile` for deploying on Coolify

## Next

- **Scheduled re-scraping** — periodically re-run scraping for saved source URLs
  (a cron-style job) to pick up new or changed locations automatically, landing
  as new candidates for review rather than silently overwriting existing pins.
- **Broader extraction formats** — the scraper currently handles two page
  shapes: an HTML table (one row per location) and loose paragraph text. Add
  `schema.org`/JSON-LD structured data and PDF locator pages; improve title
  detection for freeform pages where a table isn't available.
- **Edit history** — track who/when/what changed on a mass center, with the
  ability to revert.

## Later

- **Multiple users** — accounts, per-user login, and permissions for the admin
  panel (currently a single shared admin login). Roles: viewer, editor, admin.
- **Discrepancy resolution** — when re-scraping finds a pin whose address or
  title differs from what's stored, surface it as a conflict to resolve
  (keep existing / take new / merge) instead of silently creating a duplicate.
- **Duplicate detection** — flag pins that geocode very close to one another
  or share a near-identical title, for merging.
- **Search & filtering** — filter the map by organization; search by name or
  city.
- **Organization visibility toggles** — show/hide an organization's pins on
  the public map.
- **Public submission form** — let visitors suggest a new location or a
  correction, queued for admin review like scraped candidates.
