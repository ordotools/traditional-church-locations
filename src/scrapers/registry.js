// Sites (or specific pages, keyed as "hostname/path" when one domain serves
// more than one directory layout) whose markup is reliable enough to parse
// with dedicated field selectors instead of the generic heuristic extractor.
// Add an entry here only once you've confirmed the generic extractor does a
// bad job on a given page (wrong titles, missed addresses, etc.) — most
// pages don't need one. Keys are matched case-insensitively; see scraper.js.
// The various national SSPX sites (sspx.org, sspx.ca, fsspx.ch, fsspx.asia, ...)
// are all built on the same Drupal platform and share its markup, so any
// sspx.* / fsspx.* domain routes to the one dedicated extractor.
const sspx = require('./sites/sspx');
const SSPX_HOSTNAME_REGEX = /^f?sspx\.[a-z.]+$/i;

const exact = {
  'ecclesia.luxvera.org/directory-world.html': require('./sites/luxvera-world'),
};

function resolve(hostname, pageKey) {
  return exact[pageKey] || exact[hostname] || (SSPX_HOSTNAME_REGEX.test(hostname) ? sspx : null);
}

module.exports = { resolve };
