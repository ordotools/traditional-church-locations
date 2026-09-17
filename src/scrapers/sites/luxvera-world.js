// Directory-World.html (a different layout than Directory-USA.html on the
// same domain — see ../registry.js, which keys this one on the full path).
//
// It's a single big table, one row per chapel with 4 columns:
//   [region code, city, org abbreviation, free-text details]
// The generic extractor misreads this: the region-code column (e.g. "NG",
// "ON", "ENG") also matches its org-code shape, so it grabs that as the
// organization and never looks at the real org column. It also has no
// US-style ", ST 12345" anchor to find, so international rows fall back to
// bare city names with no country — useless for geocoding.
//
// The region code is sometimes a real ISO country code (resolved natively
// via Intl.DisplayNames — no hardcoded country list needed) and sometimes a
// subdivision code the site invented (Canadian provinces, UK nations like
// "ENG"/"SCT"/"NIR"), which that API won't resolve. For those, fall back to
// the country named by the row's enclosing section header. Those headers
// display as spaced-out letters ("N I G E R I A") for styling, but each one
// carries a named anchor (e.g. <a name=Nigeria>) that matches an entry in
// the page's own table-of-contents links (<a href="#Nigeria">Nigeria</a>) —
// reading that gives the real name for free instead of parsing the display text.
const { cleanTitle } = require('../generic');

// Continent section headers use the same anchor/header shape as country
// section headers, but aren't a country — a real address needs to inherit
// the country header below them, not the continent one.
const CONTINENT_ANCHORS = new Set(['Africa', 'Asia', 'Europe', 'NorthAmerica', 'SouthAmerica', 'Oceania', 'Antarctica']);

function cellText($, el) {
  $(el).find('br').replaceWith('\n');
  return $(el).text().replace(/\s+/g, ' ').trim();
}

// Table-of-contents links (<a href="#Nigeria">Nigeria</a>) give a clean
// country name for each section anchor, keyed by the anchor's target id.
function buildAnchorNames($) {
  const names = {};
  $('a[href^="#"]').each((_, a) => {
    const target = $(a).attr('href').slice(1);
    const text = $(a).text().replace(/\s+/g, ' ').trim();
    if (target && text) names[target] = text;
  });
  return names;
}

// Intl.DisplayNames returns the input unchanged for a well-formed but
// unrecognized region code (e.g. "ON" for Ontario) instead of throwing, and
// throws for one that isn't even well-formed (e.g. 3-letter "ENG") — either
// way, that means it didn't resolve to a real country.
function countryFromRegionCode(displayNames, code) {
  if (!code) return null;
  try {
    const name = displayNames.of(code.toUpperCase());
    return name && name.toUpperCase() !== code.toUpperCase() ? name : null;
  } catch {
    return null;
  }
}

function extract($) {
  const anchorNames = buildAnchorNames($);
  const displayNames = new Intl.DisplayNames(['en'], { type: 'region' });
  const candidates = [];
  let sectionCountry = null;

  $('tr').each((_, tr) => {
    const tds = $(tr).find('> td');

    if (tds.length === 1) {
      const anchorName = $(tr).find('a[name]').first().attr('name');
      if (anchorName && anchorNames[anchorName] && !CONTINENT_ANCHORS.has(anchorName)) {
        sectionCountry = anchorNames[anchorName];
      }
      return;
    }
    if (tds.length !== 4) return;

    const [regionCode, cityRaw, orgAbbreviation, details] = tds.toArray().map((td) => cellText($, td));
    if (!details) return;

    const country = countryFromRegionCode(displayNames, regionCode) || sectionCountry;
    const city = cityRaw && cityRaw !== 'Other' ? cityRaw : null;
    if (!city && !country) return;

    candidates.push({
      title: cleanTitle(details) || null,
      address: [cleanTitle(details), city, country].filter(Boolean).join(', '),
      city,
      state: country,
      precision: city ? 'city' : 'state',
      organizationAbbreviation: orgAbbreviation || null,
    });
  });

  return candidates;
}

module.exports = { extract };
