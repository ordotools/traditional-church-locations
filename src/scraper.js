const cheerio = require('cheerio');

// Best-effort extraction of US-style street addresses from a page's visible text.
// This is a heuristic (see ROADMAP.md for planned improvements), not a full address parser.
const STREET_SUFFIXES = [
  'Street', 'St', 'Avenue', 'Ave', 'Boulevard', 'Blvd', 'Road', 'Rd', 'Drive', 'Dr',
  'Lane', 'Ln', 'Court', 'Ct', 'Place', 'Pl', 'Way', 'Circle', 'Cir', 'Terrace', 'Ter',
  'Highway', 'Hwy', 'Parkway', 'Pkwy', 'Square', 'Sq',
];

const ADDRESS_REGEX = new RegExp(
  `\\d{1,6}\\s+[A-Za-z0-9.'-]+(?:\\s+[A-Za-z0-9.'-]+){0,4}\\s+(?:${STREET_SUFFIXES.join('|')})\\.?,?\\s+` +
    `[A-Za-z .'-]+,\\s*[A-Z]{2}\\s+\\d{5}(?:-\\d{4})?`,
  'g'
);

async function scrapeAddresses(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'traditional-church-locations/0.1' } });
  if (!res.ok) throw new Error(`Failed to fetch URL (status ${res.status})`);
  const html = await res.text();

  const $ = cheerio.load(html);
  $('script, style, noscript').remove();
  const text = $('body').text().replace(/\s+/g, ' ').trim();

  const matches = text.match(ADDRESS_REGEX) || [];
  return [...new Set(matches.map((m) => m.trim()))];
}

module.exports = { scrapeAddresses };
