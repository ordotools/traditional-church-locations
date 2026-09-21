const cheerio = require('cheerio');
const generic = require('./scrapers/generic');
const siteRegistry = require('./scrapers/registry');
const crawlIndex = require('./scrapers/crawlIndex');
const aiExtractor = require('./scrapers/ai');

// fetch's res.text() always decodes as UTF-8 regardless of the page's real
// encoding. Some of these directory pages are Word exports saved as
// UTF-16 (with a BOM) rather than UTF-8 — decoding those as UTF-8 turns the
// whole page into null-byte garbage that cheerio can't parse at all.
async function decodeBody(res) {
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf);
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf);
  return buf.toString('utf8');
}

// Shared with crawlIndex.js's DB-backed rules and the admin UI that manages
// them, so a rule added there matches exactly what a live scrape looks up.
function pageKeyFor(url) {
  const parsedUrl = new URL(url);
  const hostname = parsedUrl.hostname.replace(/^www\./, '');
  return `${hostname}${parsedUrl.pathname}`.toLowerCase();
}

// A link-index page (see crawlIndex.js) has no address text of its own —
// every entry just points at that location's own page. So instead of
// extracting from this page, follow each link inside `linkSelector` and
// extract from the destination instead, tagging each candidate with the
// actual page it came from (not the index) so per-source dedup and
// human decisions (sourceDecisions.js) key on the real parish page.
async function crawlLinkIndex(baseUrl, $, crawl) {
  const links = new Set();
  $(crawl.linkSelector).each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    try {
      links.add(new URL(href, baseUrl).toString());
    } catch {
      // malformed href on the page — skip it
    }
  });

  const candidates = [];
  const warnings = [];
  for (const link of links) {
    try {
      const sub = await scrapeCandidates(link);
      candidates.push(...sub.candidates);
      if (sub.aiWarning) warnings.push(`${link}: ${sub.aiWarning}`);
    } catch (err) {
      warnings.push(`${link}: ${err.message}`);
    }
  }
  return { candidates, aiWarning: warnings.length ? warnings.join('; ') : null };
}

async function scrapeCandidates(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'traditional-church-locations/0.1' } });
  if (!res.ok) throw new Error(`Failed to fetch URL (status ${res.status})`);
  const html = await decodeBody(res);

  const $ = cheerio.load(html);
  $('script, style, noscript').remove();

  const hostname = new URL(url).hostname.replace(/^www\./, '');
  const pageKey = pageKeyFor(url);

  const crawl = crawlIndex.resolve(pageKey);
  let candidates;
  let aiWarning;
  if (crawl) {
    ({ candidates, aiWarning } = await crawlLinkIndex(url, $, crawl));
  } else {
    const heuristicExtractor = siteRegistry.resolve(hostname, pageKey) || generic;

    // AI is the primary extractor on every site, not just ones the regex/table
    // heuristics fail on outright — a heuristic extractor can "succeed" (find
    // rows) while still producing malformed addresses, which is exactly the
    // inconsistency this is meant to fix. Fall back to the heuristic extractor
    // only when AI isn't configured (no TCL_GEMINI_API_KEY — extract() no-ops to
    // []), or errors out, or genuinely finds nothing.
    //
    // A configured-but-unused AI extractor is worth flagging loudly: it's
    // exactly the failure mode that silently looked like "it's working" before
    // (see conversation history) — a dead key or a retired model, quietly
    // papered over by the fallback, indistinguishable from normal operation
    // unless something says so.
    candidates = [];
    aiWarning = null;
    if (aiExtractor.isConfigured) {
      try {
        candidates = await aiExtractor.extract($);
        if (!candidates.length) aiWarning = 'AI extraction returned no results; used the fallback extractor instead.';
      } catch (err) {
        aiWarning = `AI extraction failed (${err.message}); used the fallback extractor instead.`;
      }
    }
    if (!candidates.length) {
      if (aiWarning) console.warn(`[scraper] ${url}: ${aiWarning}`);
      candidates = heuristicExtractor.extract($);
    }
    candidates.forEach((c) => {
      c.sourceUrl = url;
    });
  }

  // De-dupe identical (source page, title, address) triples — a crawl can
  // easily repeat a page two different cities both link to, and a single
  // page might repeat a listing too.
  const seen = new Set();
  const deduped = candidates.filter((c) => {
    const key = `${c.sourceUrl}|${c.title}|${c.address}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { candidates: deduped, aiWarning };
}

module.exports = { scrapeCandidates, pageKeyFor, US_STATES: generic.US_STATES };
