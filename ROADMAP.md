# Roadmap

## Now (v0.1)

- Map with pan/zoom showing all pins, colored by organization
- Admin: add a pin by address (geocoded on save)
- Admin: scrape a URL for addresses, geocode candidates, review/confirm before they hit the map
- Admin: organization management (name, abbreviation, color)
- SQLite storage, no build step

## Next

- **Scheduled re-scraping** — periodically re-run scraping for saved source URLs
  (a cron-style job) to pick up new or changed locations automatically, landing
  as new candidates for review rather than silently overwriting existing pins.
- **Better address extraction** — the current scraper is a US-format regex
  over page text. Improve it to handle non-US addresses, `schema.org`/JSON-LD
  structured data, and PDF locator pages; try to infer a title from nearby
  headings so it can be pre-filled instead of typed by hand.
- **Edit history** — track who/when/what changed on a mass center, with the
  ability to revert.

## Later

- **Multiple users** — accounts, login, and permissions for the admin panel
  (currently unauthenticated). Roles: viewer, editor, admin.
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
