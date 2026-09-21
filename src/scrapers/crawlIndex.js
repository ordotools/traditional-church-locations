// Pages that are pure link indexes — a directory whose entries link out to
// each location's own page/site rather than stating an address itself (e.g.
// fssp.com/locations-list/: a list of cities, each linking to that parish's
// own website). Scraping one of these means following every link inside
// `linkSelector` and extracting candidates from each destination page
// instead of the index page, which has no address text of its own.
// Keys are matched as "hostname/path", lowercased; see scraper.js.
//
// Built-ins ship with the code; anyone found later is added by an admin
// from the Scrape URL page (backed by the crawl_rules table) instead of
// requiring a code change — see the "Crawl Rules" section there and its
// routes in routes/admin.js.
const db = require('../db');

const exact = {
  // The page a person actually lands on/pastes in — it's just a map (no
  // address text at all), with a single link to the real text listing.
  // scrapeCandidates() re-checks this registry on every hop, so following
  // this one link straight into locations-list/ below happens automatically.
  'fssp.com/locations/': { linkSelector: 'a[href*="locations-list"]' },
  'fssp.com/locations-list/': { linkSelector: 'article a[href]' },
};

function resolve(pageKey) {
  if (exact[pageKey]) return exact[pageKey];
  const row = db.prepare('SELECT link_selector FROM crawl_rules WHERE page_key = ?').get(pageKey);
  return row ? { linkSelector: row.link_selector } : null;
}

module.exports = { resolve };
