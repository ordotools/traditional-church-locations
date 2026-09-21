# Graph Report - traditional-church-locations  (2026-09-21)

## Corpus Check
- 33 files · ~20,129 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 283 nodes · 406 edges · 14 communities
- Extraction: 88% EXTRACTED · 12% INFERRED · 0% AMBIGUOUS · INFERRED: 48 edges (avg confidence: 0.85)
- Token cost: 57,364 input · 0 output

## Community Hubs (Navigation)
- Project Config & Dependencies
- Duplicate Detection Core
- Admin Routes
- Architecture Rationale & Data Model
- Scraper Registry & AI Extraction
- Public Map Frontend
- Generic Scraper Parsing
- Jev AI Judging & Source Decisions
- Candidate Pipeline
- Geocoding
- Roadmap / Future Features
- Scrape Scheduler
- NPM Dependencies List
- Auth

## God Nodes (most connected - your core abstractions)
1. `geocodeCascade()` - 11 edges
2. `Traditional Church Locations` - 8 edges
3. `Later milestone` - 7 edges
4. `normalizeAddress()` - 7 edges
5. `cleanTitle()` - 6 edges
6. `titleSimilarity()` - 6 edges
7. `findDuplicatePairs()` - 6 edges
8. `sleep()` - 6 edges
9. `Admin Panel (/admin)` - 6 edges
10. `extractFromLines()` - 5 edges

## Surprising Connections (you probably didn't know these)
- `Dedup Gate (pre-geocode)` --rationale_for--> `gateForGeocoding()`  [EXTRACTED]
  README.md → src/candidatePipeline.js
- `gateForGeocoding()` --references--> `Address+Title Similarity Dedup (src/duplicates.js)`  [EXTRACTED]
  src/candidatePipeline.js → README.md
- `gateForGeocoding()` --references--> `Jev AI Escalation (src/jev.js)`  [EXTRACTED]
  src/candidatePipeline.js → README.md
- `/admin/statuses page` --references--> `Admin Panel (/admin)`  [INFERRED]
  public/index.html → README.md
- `Gemini AI Scraping Extraction` --references--> `gateForGeocoding()`  [EXTRACTED]
  README.md → src/candidatePipeline.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Candidate Dedup & Escalation Pipeline** — src_candidatepipeline_gateforgeocoding, src_duplicates_dedup, src_jev_jev, readme_conflicts_page [EXTRACTED 1.00]
- **Traditional Church Locations Data Model** — readme_organizations_table, readme_mass_centers_table, readme_scrape_candidates_table, readme_geocode_cache_table [EXTRACTED 1.00]
- **Application Stack** — readme_node_express, readme_ejs, readme_sqlite_better_sqlite3, readme_leaflet_js, readme_nominatim_geocoding, readme_gemini_ai_extraction [EXTRACTED 1.00]

## Communities (14 total, 0 thin omitted)

### Community 0 - "Project Config & Dependencies"
Cohesion: 0.06
Nodes (32): description, main, name, private, scripts, start, version, better-sqlite3 (+24 more)

### Community 1 - "Duplicate Detection Core"
Cohesion: 0.10
Nodes (27): addressSimilarity(), db, findDuplicatePairs(), findMassCenterMatch(), findTextSimilarityMatch(), getDismissedPairKeys(), haversineMeters(), isMorePrecise() (+19 more)

### Community 2 - "Admin Routes"
Cohesion: 0.09
Nodes (17): candidatePipeline, { checkCredentials, requireAuth }, db, duplicates, express, { geocodeAddress, geocodeCascade }, geocodeQueue, getDecisionsBySource() (+9 more)

### Community 3 - "Architecture Rationale & Data Model"
Cohesion: 0.11
Nodes (24): Admin Panel (/admin), Geocode All Pending (background job), Cheerio + Regex Fallback Extractor, /admin/conflicts Queue, Coolify Deployment, Dedup Gate (pre-geocode), Dockerfile, EJS Templates (Admin Panel) (+16 more)

### Community 4 - "Scraper Registry & AI Extraction"
Cohesion: 0.11
Nodes (19): cheerio, aiExtractor, cheerio, decodeBody(), generic, scrapeCandidates(), siteRegistry, callGemini() (+11 more)

### Community 5 - "Public Map Frontend"
Cohesion: 0.12
Nodes (18): /admin/statuses page, /api/status-settings endpoint, public/css/style.css, Legend (details#legend), Map Page (public/index.html), banner, escapeHtml(), glowForZoom() (+10 more)

### Community 6 - "Generic Scraper Parsing"
Cohesion: 0.17
Nodes (18): cellText(), cleanTitle(), extract(), extractFromLines(), extractFromTable(), extractTitleAndAddress(), STATE_NAME_TO_CODE, STATE_TOKENS (+10 more)

### Community 7 - "Jev AI Judging & Source Decisions"
Cohesion: 0.12
Nodes (14): ai, ref_assert, judgeSameLocation(), pairPrompt(), db, duplicates, getDecision(), normalizedKey() (+6 more)

### Community 8 - "Candidate Pipeline"
Cohesion: 0.14
Nodes (18): AUTO_COLORS, db, duplicates, getOrCreateOrganizationByAbbreviation(), isExactDuplicate(), jev, refreshMassCenterFromCandidate(), resolveReadyCandidates() (+10 more)

### Community 9 - "Geocoding"
Cohesion: 0.16
Nodes (17): normalizeAddress(), src_geocode_bulk_interval_ms, cacheKey(), db, geocodeAddress(), geocodeCascade(), geocodeStructured(), getCachedCascade() (+9 more)

### Community 10 - "Roadmap / Future Features"
Cohesion: 0.18
Nodes (13): Broader extraction formats (schema.org/JSON-LD, PDF locators), Discrepancy resolution on re-scrape conflicts, Duplicate pin detection, Edit history / revert, Later milestone, Multiple users / roles (viewer, editor, admin), Next milestone, Organization visibility toggles on public map (+5 more)

### Community 11 - "Scrape Scheduler"
Cohesion: 0.22
Nodes (11): db, geocodeQueue, getSchedule(), getStatus(), isDue(), pipeline, runNow(), { sleep } (+3 more)

### Community 12 - "NPM Dependencies List"
Cohesion: 0.25
Nodes (8): dependencies, ai, better-sqlite3, cheerio, compression, ejs, express, express-session

### Community 13 - "Auth"
Cohesion: 0.40
Nodes (4): ref_crypto, checkCredentials(), crypto, safeEqual()

## Knowledge Gaps
- **120 isolated node(s):** `crypto`, `STATE_NAME_TO_CODE`, `STATE_TOKENS`, `STATE_ZIP_REGEX`, `TITLE_CUTOFFS` (+115 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 147 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `gateForGeocoding()` connect `Architecture Rationale & Data Model` to `Candidate Pipeline`?**
  _High betweenness centrality (0.327) - this node is a cross-community bridge._
- **Why does `Traditional Church Locations` connect `Architecture Rationale & Data Model` to `Public Map Frontend`?**
  _High betweenness centrality (0.281) - this node is a cross-community bridge._
- **What connects `crypto`, `STATE_NAME_TO_CODE`, `STATE_TOKENS` to the rest of the system?**
  _120 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Project Config & Dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.06156156156156156 - nodes in this community are weakly interconnected._
- **Should `Duplicate Detection Core` be split into smaller, more focused modules?**
  _Cohesion score 0.10344827586206896 - nodes in this community are weakly interconnected._
- **Should `Admin Routes` be split into smaller, more focused modules?**
  _Cohesion score 0.08615384615384615 - nodes in this community are weakly interconnected._
- **Should `Architecture Rationale & Data Model` be split into smaller, more focused modules?**
  _Cohesion score 0.10507246376811594 - nodes in this community are weakly interconnected._