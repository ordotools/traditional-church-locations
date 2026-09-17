// Sites (or specific pages, keyed as "hostname/path" when one domain serves
// more than one directory layout) whose markup is reliable enough to parse
// with dedicated field selectors instead of the generic heuristic extractor.
// Add an entry here only once you've confirmed the generic extractor does a
// bad job on a given page (wrong titles, missed addresses, etc.) — most
// pages don't need one. Keys are matched case-insensitively; see scraper.js.
module.exports = {
  'sspx.org': require('./sites/sspx'),
  'ecclesia.luxvera.org/directory-world.html': require('./sites/luxvera-world'),
};
