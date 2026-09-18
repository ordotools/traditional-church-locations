// AI extraction, used as the primary extractor on every scraped page (see
// scraper.js), falling back to the regex/table heuristic only if this isn't
// configured, errors out, or finds nothing. Disabled entirely if
// TCL_GEMINI_API_KEY isn't set (extract() then just no-ops to []).
//
// Two independent defenses against hallucination:
// 1. The prompt (temperature 0, explicit "leave blank, don't guess"
//    instructions, a strict JSON schema) — soft, since a model can ignore it.
// 2. source_snippet verification below — hard: each listing must come with
//    a verbatim quote from the page, and any listing whose quote doesn't
//    actually appear in the page text is dropped, regardless of what the
//    model claims. This catches the model disobeying rule 1, not just
//    trusts it to obey.
// Even so, the real safeguard is unchanged: every surviving result lands in
// the same pending scrape_candidates review queue as every other
// extractor's output, so nothing reaches the map without a human confirming it.

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
// Namespaced, not GEMINI_API_KEY — see .env.example for why (a global shell
// export of that exact name will silently shadow it otherwise).
const API_KEY = process.env.TCL_GEMINI_API_KEY;
const isConfigured = Boolean(API_KEY);

const SYSTEM_INSTRUCTION = `You extract a directory of church/chapel/Mass center listings from a web page's text content.

Rules, follow exactly:
- Extract ONLY listings that are explicitly and literally present in the text. Never invent, infer, guess, or auto-complete a name or address field that is not written in the text.
- If a field (street, city, state, postal_code, country, organization_abbreviation) is not clearly stated for a given listing, output an empty string "" for it. Do not guess it from nearby entries, general knowledge, or context clues — leave it blank instead.
- Do not mix details from two different listings into one entry.
- Ignore navigation, headers, footers, disclaimers, and any text that is not itself a location listing.
- If the page contains no location listings at all, return an empty "locations" array.
- organization_abbreviation is a short code (often all-caps, 2-6 characters) marking which organization runs that location, if and only if the page shows one directly next to the listing.
- source_snippet is REQUIRED and is checked by other code, not just read by a person: copy it character-for-character from the page text above — the shortest contiguous run of the original text that contains this listing's name and address. Do not paraphrase, summarize, translate, or fix typos in it. If you cannot point to real text this listing came from, do not output that listing at all.`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    locations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          street: { type: 'string' },
          city: { type: 'string' },
          state: { type: 'string' },
          postal_code: { type: 'string' },
          country: { type: 'string' },
          organization_abbreviation: { type: 'string' },
          source_snippet: { type: 'string' },
        },
        required: ['title', 'street', 'city', 'state', 'postal_code', 'country', 'organization_abbreviation', 'source_snippet'],
      },
    },
  },
  required: ['locations'],
};

// Keep well within the model's input budget and cut token cost — nav/script/
// style are already stripped by scraper.js before this ever gets called.
const MAX_INPUT_CHARS = 100000;
const RETRY_DELAY_MS = 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pageText($) {
  return $('body')
    .text()
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

// Whitespace-insensitive comparison — the model may quote across a line
// break the page-text extraction collapsed differently — but otherwise
// requires an exact substring match against the real page text.
function normalizeForMatch(s) {
  return s.replace(/\s+/g, ' ').trim();
}

function toCandidate(loc) {
  const title = (loc.title || '').trim() || null;
  const street = (loc.street || '').trim();
  const city = (loc.city || '').trim() || null;
  const state = (loc.state || '').trim() || null;
  const postalCode = (loc.postal_code || '').trim() || null;
  const country = (loc.country || '').trim() || null;
  const organizationAbbreviation = (loc.organization_abbreviation || '').trim() || null;

  const precision = street ? 'exact' : postalCode ? 'postal' : city ? 'city' : state ? 'state' : country ? 'country' : null;
  if (!precision) return null; // no location information at all — nothing to geocode

  const address = [street, city, state, postalCode, country].filter(Boolean).join(', ');
  return { title, address, city, state, country, postalCode, precision, organizationAbbreviation };
}

// A rate limit (429) or a transient server error (5xx) is worth one retry —
// anything else (bad key, bad request) won't succeed on a second try.
async function callGemini(text) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents: [{ role: 'user', parts: [{ text: `Page text:\n\n${text}` }] }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA },
  });

  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    if (res.ok) return res.json();
    const retryable = (res.status === 429 || res.status >= 500) && attempt < 2;
    if (!retryable) throw new Error(`AI extraction request failed with status ${res.status}`);
    await sleep(RETRY_DELAY_MS);
  }
}

async function extract($) {
  if (!API_KEY) return [];
  const text = pageText($).slice(0, MAX_INPUT_CHARS);
  if (!text) return [];

  const data = await callGemini(text);
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) return [];

  const parsed = JSON.parse(raw);
  const normalizedText = normalizeForMatch(text);

  return (parsed.locations || [])
    .filter((loc) => {
      const snippet = normalizeForMatch(loc.source_snippet || '');
      return snippet.length > 0 && normalizedText.includes(snippet);
    })
    .map(toCandidate)
    .filter(Boolean);
}

module.exports = { extract, isConfigured };
