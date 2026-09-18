const cheerio = require('cheerio');
const generic = require('./scrapers/generic');
const siteRegistry = require('./scrapers/registry');
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

async function scrapeCandidates(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'traditional-church-locations/0.1' } });
  if (!res.ok) throw new Error(`Failed to fetch URL (status ${res.status})`);
  const html = await decodeBody(res);

  const $ = cheerio.load(html);
  $('script, style, noscript').remove();

  const parsedUrl = new URL(url);
  const hostname = parsedUrl.hostname.replace(/^www\./, '');
  const pageKey = `${hostname}${parsedUrl.pathname}`.toLowerCase();
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
  let candidates = [];
  let aiWarning = null;
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

  // De-dupe identical (title, address) pairs the page might repeat.
  const seen = new Set();
  const deduped = candidates.filter((c) => {
    const key = `${c.title}|${c.address}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { candidates: deduped, aiWarning };
}

module.exports = { scrapeCandidates, US_STATES: generic.US_STATES };
