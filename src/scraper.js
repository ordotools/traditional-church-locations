const cheerio = require('cheerio');
const generic = require('./scrapers/generic');
const siteRegistry = require('./scrapers/registry');

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
  const extractor = siteRegistry.resolve(hostname, pageKey) || generic;
  const candidates = extractor.extract($);

  // De-dupe identical (title, address) pairs the page might repeat.
  const seen = new Set();
  return candidates.filter((c) => {
    const key = `${c.title}|${c.address}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = { scrapeCandidates, US_STATES: generic.US_STATES };
