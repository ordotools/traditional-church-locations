const cheerio = require('cheerio');

// Best-effort extraction of Mass center listings from a directory page.
// Real-world directories (see ROADMAP.md) are messy: titles and addresses run
// together, some entries have no street address at all, and organization codes
// are unlabeled abbreviations. This is a heuristic, human-reviewed extractor,
// not a general address parser — every candidate it produces goes through the
// admin review queue before it becomes a pin.

const US_STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  PR: 'Puerto Rico',
};

// A short all-caps token (CMRI, IND, RCI, SSPV, D/S, SST, IMBC, ...) is how
// these directories usually mark which organization runs a location.
const ORG_CODE_REGEX = /^[A-Z][A-Z0-9/]{1,5}$/;

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const STATE_NAME_TO_CODE = Object.fromEntries(Object.entries(US_STATES).map(([code, name]) => [name, code]));
const STATE_TOKENS = [...Object.keys(US_STATES), ...Object.values(US_STATES)].sort((a, b) => b.length - a.length);

// Anchor on ", ST 12345" (state code OR full state name) — nearly universal
// in US addresses regardless of whether the street itself is a named street,
// a state route, or a highway number, which a street-suffix regex misses often.
const STATE_ZIP_REGEX = new RegExp(`,?\\s+(${STATE_TOKENS.map(escapeRegex).join('|')})\\s+(\\d{5})(?:-\\d{4})?\\b`, 'g');
// A house number followed by either a capitalized word (Main, State...) or an
// ordinal number (3rd, 42nd...), since ordinal street names are common.
const HOUSE_NUMBER_REGEX = /\b\d{1,6}\s+(?:[A-Z]|\d+(?:st|nd|rd|th)\b)/g;
const TITLE_CUTOFFS = [/\bFr\.\s/, /\bRev\.\s/, /\(\d{3}\)\s?\d{3}-\d{4}/, /https?:\/\//, /\bSU\b|\bM-F\b|\bSA\b/];

function cleanTitle(text) {
  let title = text;
  for (const cutoff of TITLE_CUTOFFS) {
    const m = title.match(cutoff);
    if (m && m.index > 0) title = title.slice(0, m.index);
  }
  return title.replace(/[,\s]+$/, '').trim();
}

function toStateCode(token) {
  return token.length === 2 ? token : STATE_NAME_TO_CODE[token];
}

// Finds the rightmost "[<house number> <street...>,] ST 12345" run in `text`.
// Returns { title, address, state } where `address` is null if a state/zip was
// found but no plausible house number precedes it closely enough to trust as
// a full street address (title still gets cut at the state/zip boundary).
// Returns null only when no state/zip anchor exists in the text at all.
function extractTitleAndAddress(text) {
  let best = null;
  let match;
  STATE_ZIP_REGEX.lastIndex = 0;
  while ((match = STATE_ZIP_REGEX.exec(text))) {
    const state = toStateCode(match[1]);
    if (!state) continue;
    const anchorEnd = match.index + match[0].length;

    const before = text.slice(0, match.index);
    let houseMatch = null;
    let hm;
    HOUSE_NUMBER_REGEX.lastIndex = 0;
    while ((hm = HOUSE_NUMBER_REGEX.exec(before))) houseMatch = hm; // keep the last (closest) one

    if (houseMatch && match.index - houseMatch.index <= 80) {
      best = {
        title: cleanTitle(text.slice(0, houseMatch.index)),
        address: text.slice(houseMatch.index, anchorEnd).replace(/\s+/g, ' ').trim(),
        state,
      };
    } else if (!best) {
      best = { title: cleanTitle(before), address: null, state };
    }
  }
  return best;
}

function cellText($, el) {
  // cheerio's .text() glues text across <br> with no whitespace, which
  // corrupts boundaries like "...CA 91910Call..." — insert a break first.
  $(el).find('br').replaceWith('\n');
  return $(el).text().replace(/\s+/g, ' ').trim();
}

// Strategy A: directories laid out as an HTML table, one row per location
// (common for these Word/Excel-exported directory pages). Column order isn't
// assumed — each non-final cell is classified by shape (state code / org
// code / plain text-as-city), and the final, richest cell is parsed for a
// title + address.
function extractFromTable($) {
  const rowGroups = new Map(); // cell count -> row count, to find the dominant record shape
  $('tr').each((_, tr) => {
    const n = $(tr).find('> td').length;
    if (n >= 3) rowGroups.set(n, (rowGroups.get(n) || 0) + 1);
  });
  let dominantCellCount = null;
  let dominantCount = 0;
  for (const [cells, count] of rowGroups) {
    if (count > dominantCount) {
      dominantCount = count;
      dominantCellCount = cells;
    }
  }
  if (dominantCellCount === null || dominantCount < 5) return null; // not a real directory table

  const candidates = [];
  $('tr').each((_, tr) => {
    const tds = $(tr).find('> td');
    if (tds.length !== dominantCellCount) return;

    const cells = tds.toArray().map((td) => cellText($, td));
    const details = cells[cells.length - 1];
    const context = cells.slice(0, -1);

    let state = null;
    let orgAbbreviation = null;
    let city = null;
    for (const cell of context) {
      if (!state && US_STATES[cell.toUpperCase()]) state = cell.toUpperCase();
      else if (!orgAbbreviation && ORG_CODE_REGEX.test(cell)) orgAbbreviation = cell;
      else if (!city && cell.length <= 60 && !/\d/.test(cell)) city = cell;
    }

    if (!details || (!state && !city)) return;

    const parsed = extractTitleAndAddress(details);
    let title = parsed ? parsed.title : cleanTitle(details.split(/\bFr\.\s|\(\d{3}\)/)[0]);
    // Strip a trailing "...<city name>" run off the title when we have that
    // city from a separate table column and the text ran the two together.
    if (city && title.toLowerCase().endsWith(city.toLowerCase())) {
      title = title.slice(0, title.length - city.length).replace(/[,\s]+$/, '').trim();
    }
    title = title || null;

    if (parsed && parsed.address) {
      candidates.push({
        title,
        address: parsed.address,
        city,
        state: parsed.state,
        precision: 'exact',
        organizationAbbreviation: orgAbbreviation,
      });
    } else {
      const resolvedState = (parsed && parsed.state) || state;
      if (!city && !resolvedState) return;
      candidates.push({
        title,
        address: [city, resolvedState].filter(Boolean).join(', ') || resolvedState,
        city,
        state: resolvedState,
        precision: city ? 'city' : 'state',
        organizationAbbreviation: orgAbbreviation,
      });
    }
  });
  return candidates;
}

// Strategy B (fallback for non-tabular pages): scan block-level text lines
// for a title+address anchor; used when the page has no qualifying table.
function extractFromLines($) {
  const lines = [];
  $('p, li, div, td').each((_, el) => {
    if ($(el).find('p, li, div, td').length > 0) return; // only leaf blocks
    const t = cellText($, el);
    if (t) lines.push(t);
  });

  const candidates = [];
  for (let i = 0; i < lines.length; i++) {
    const parsed = extractTitleAndAddress(lines[i]);
    if (!parsed) continue;
    const title = parsed.title || cleanTitle(lines[i - 1] || '') || null;
    candidates.push(
      parsed.address
        ? { title, address: parsed.address, city: null, state: parsed.state, precision: 'exact', organizationAbbreviation: null }
        : { title, address: parsed.state, city: null, state: parsed.state, precision: 'state', organizationAbbreviation: null }
    );
  }
  return candidates;
}

async function scrapeCandidates(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'traditional-church-locations/0.1' } });
  if (!res.ok) throw new Error(`Failed to fetch URL (status ${res.status})`);
  const html = await res.text();

  const $ = cheerio.load(html);
  $('script, style, noscript').remove();

  const tableResults = extractFromTable($);
  const candidates = tableResults && tableResults.length ? tableResults : extractFromLines($);

  // De-dupe identical (title, address) pairs the page might repeat.
  const seen = new Set();
  return candidates.filter((c) => {
    const key = `${c.title}|${c.address}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = { scrapeCandidates, US_STATES };
