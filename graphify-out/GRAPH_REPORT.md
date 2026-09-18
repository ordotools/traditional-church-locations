# Graph Report - traditional-church-locations  (2026-09-18)

## Corpus Check
- Corpus is ~12,027 words - fits in a single context window. You may not need a graph.

## Summary
- 188 nodes · 258 edges · 11 communities
- Extraction: 88% EXTRACTED · 12% INFERRED · 0% AMBIGUOUS · INFERRED: 31 edges (avg confidence: 0.86)
- Token cost: 62,534 input · 0 output

## Community Hubs (Navigation)
- Server & Package Setup
- Project Docs & Roadmap
- Admin Routes & Auth
- Generic Scraper Extraction
- Duplicate Detection
- Scraper Registry
- Map Page & Design Rationale
- Geocoding Pipeline
- Map Frontend (map.js)
- AI Scraping (Gemini)
- Dependencies List

## God Nodes (most connected - your core abstractions)
1. `geocodeCascade()` - 7 edges
2. `Later milestone` - 7 edges
3. `cleanTitle()` - 6 edges
4. `Traditional Church Locations (project)` - 6 edges
5. `organizations table (name, abbreviation, color)` - 6 edges
6. `Scrape a URL for listings` - 6 edges
7. `Next milestone` - 6 edges
8. `findDuplicatePairs()` - 5 edges
9. `extract()` - 5 edges
10. `extractTitleAndAddress()` - 5 edges

## Surprising Connections (you probably didn't know these)
- `#legend organization color key` --conceptually_related_to--> `organizations table (name, abbreviation, color)`  [INFERRED]
  public/index.html → README.md
- `Now (v0.2) milestone` --conceptually_related_to--> `Coolify deployment`  [INFERRED]
  ROADMAP.md → README.md
- `Organization visibility toggles on public map` --conceptually_related_to--> `organizations table (name, abbreviation, color)`  [INFERRED]
  ROADMAP.md → README.md
- `Search & filtering by organization/name/city` --conceptually_related_to--> `organizations table (name, abbreviation, color)`  [INFERRED]
  ROADMAP.md → README.md
- `Now (v0.2) milestone` --conceptually_related_to--> `Admin panel (single admin login)`  [INFERRED]
  ROADMAP.md → README.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Scrape-to-Review Pipeline** — readme_scrape_url_flow, readme_gemini_scraping, readme_cheerio_regex_fallback, readme_review_candidates_page, readme_data_model_scrape_candidates [EXTRACTED 1.00]
- **Geocoding Precision Fallback Ladder** — readme_nominatim_geocoding, readme_data_model_mass_centers, readme_data_model_scrape_candidates [INFERRED 0.85]
- **Public Map Rendering** — public_index_map_page, public_index_leaflet_map_container, public_index_legend, public_index_map_banner, readme_leaflet_js [EXTRACTED 1.00]

## Communities (11 total, 0 thin omitted)

### Community 0 - "Server & Package Setup"
Cohesion: 0.07
Nodes (30): description, main, name, private, scripts, start, version, better-sqlite3 (+22 more)

### Community 1 - "Project Docs & Roadmap"
Cohesion: 0.11
Nodes (26): Admin panel (single admin login), Coolify deployment, Data model, mass_centers table (pins), organizations table (name, abbreviation, color), scrape_candidates table (pending review), Dockerfile, GEOCODE_INTERVAL_MS background job interval (+18 more)

### Community 2 - "Admin Routes & Auth"
Cohesion: 0.10
Nodes (17): ref_crypto, checkCredentials(), crypto, requireAuth(), safeEqual(), AUTO_COLORS, { checkCredentials, requireAuth }, db (+9 more)

### Community 3 - "Generic Scraper Extraction"
Cohesion: 0.17
Nodes (18): cellText(), cleanTitle(), extract(), extractFromLines(), extractFromTable(), extractTitleAndAddress(), STATE_NAME_TO_CODE, STATE_TOKENS (+10 more)

### Community 4 - "Duplicate Detection"
Cohesion: 0.21
Nodes (12): ref_assert, db, findDuplicatePairs(), getDismissedPairKeys(), haversineMeters(), normalizeTitle(), pairKey(), titleSimilarity() (+4 more)

### Community 5 - "Scraper Registry"
Cohesion: 0.15
Nodes (11): cheerio, aiExtractor, cheerio, decodeBody(), generic, scrapeCandidates(), siteRegistry, exact (+3 more)

### Community 6 - "Map Page & Design Rationale"
Cohesion: 0.14
Nodes (14): #map Leaflet container, #legend organization color key, #map-banner notice, Map page (public/index.html), Cheerio + regex address finder fallback, EJS templates (admin panel), Gemini AI scrape extraction (TCL_GEMINI_API_KEY), Leaflet.js grayscale map rendering (+6 more)

### Community 7 - "Geocoding Pipeline"
Cohesion: 0.27
Nodes (9): src_geocode_bulk_interval_ms, geocodeAddress(), geocodeCascade(), geocodeStructured(), sleep(), db, { geocodeCascade, sleep, BULK_INTERVAL_MS }, startGeocodingAllPending() (+1 more)

### Community 8 - "Map Frontend (map.js)"
Cohesion: 0.27
Nodes (7): banner, escapeHtml(), glowForZoom(), map, renderLegend(), sizeForZoom(), updatePinSize()

### Community 9 - "AI Scraping (Gemini)"
Cohesion: 0.36
Nodes (8): callGemini(), extract(), isConfigured, normalizeForMatch(), pageText(), RESPONSE_SCHEMA, sleep(), toCandidate()

### Community 10 - "Dependencies List"
Cohesion: 0.29
Nodes (7): dependencies, better-sqlite3, cheerio, compression, ejs, express, express-session

## Knowledge Gaps
- **74 isolated node(s):** `name`, `version`, `private`, `description`, `main` (+69 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 95 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `express` connect `Server & Package Setup` to `Admin Routes & Auth`?**
  _High betweenness centrality (0.050) - this node is a cross-community bridge._
- **Why does `dependencies` connect `Dependencies List` to `Server & Package Setup`?**
  _High betweenness centrality (0.046) - this node is a cross-community bridge._
- **Why does `cheerio` connect `Scraper Registry` to `Server & Package Setup`?**
  _High betweenness centrality (0.044) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _74 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Server & Package Setup` be split into smaller, more focused modules?**
  _Cohesion score 0.0677361853832442 - nodes in this community are weakly interconnected._
- **Should `Project Docs & Roadmap` be split into smaller, more focused modules?**
  _Cohesion score 0.11076923076923077 - nodes in this community are weakly interconnected._
- **Should `Admin Routes & Auth` be split into smaller, more focused modules?**
  _Cohesion score 0.09666666666666666 - nodes in this community are weakly interconnected._