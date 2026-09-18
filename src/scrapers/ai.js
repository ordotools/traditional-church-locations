// AI extraction fallback, used only when the resolved heuristic extractor
// (a site-specific one, or generic.js) finds zero candidates on a page —
// see scraper.js. Disabled entirely if GEMINI_API_KEY isn't set.
//
// The prompt is written to minimize hallucination (temperature 0, explicit
// "leave blank, don't guess" instructions, a strict JSON schema), but the
// real safeguard is unchanged: every result lands in the same pending
// scrape_candidates review queue as every other extractor's output, so
// nothing reaches the map without a human confirming it.

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
// Namespaced, not GEMINI_API_KEY — see .env.example for why (a global shell
// export of that exact name will silently shadow it otherwise).
const API_KEY = process.env.TCL_GEMINI_API_KEY;

const SYSTEM_INSTRUCTION = `You extract a directory of church/chapel/Mass center listings from a web page's text content.

Rules, follow exactly:
- Extract ONLY listings that are explicitly and literally present in the text. Never invent, infer, guess, or auto-complete a name or address field that is not written in the text.
- If a field (street, city, state, postal_code, country, organization_abbreviation) is not clearly stated for a given listing, output an empty string "" for it. Do not guess it from nearby entries, general knowledge, or context clues — leave it blank instead.
- Do not mix details from two different listings into one entry.
- Ignore navigation, headers, footers, disclaimers, and any text that is not itself a location listing.
- If the page contains no location listings at all, return an empty "locations" array.
- organization_abbreviation is a short code (often all-caps, 2-6 characters) marking which organization runs that location, if and only if the page shows one directly next to the listing.`;

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
        },
        required: ['title', 'street', 'city', 'state', 'postal_code', 'country', 'organization_abbreviation'],
      },
    },
  },
  required: ['locations'],
};

// Keep well within the model's input budget and cut token cost — nav/script/
// style are already stripped by scraper.js before this ever gets called.
const MAX_INPUT_CHARS = 100000;

function pageText($) {
  return $('body')
    .text()
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function toCandidate(loc) {
  const title = (loc.title || '').trim() || null;
  const street = (loc.street || '').trim();
  const city = (loc.city || '').trim() || null;
  const state = (loc.state || '').trim() || null;
  const postalCode = (loc.postal_code || '').trim();
  const country = (loc.country || '').trim() || null;
  const organizationAbbreviation = (loc.organization_abbreviation || '').trim() || null;

  const precision = street ? 'exact' : city ? 'city' : state ? 'state' : country ? 'country' : null;
  if (!precision) return null; // no location information at all — nothing to geocode

  const address = [street, city, state, postalCode, country].filter(Boolean).join(', ');
  return { title, address, city, state, country, precision, organizationAbbreviation };
}

async function extract($) {
  if (!API_KEY) return [];
  const text = pageText($).slice(0, MAX_INPUT_CHARS);
  if (!text) return [];

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      contents: [{ role: 'user', parts: [{ text: `Page text:\n\n${text}` }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA },
    }),
  });
  if (!res.ok) throw new Error(`AI extraction request failed with status ${res.status}`);
  const data = await res.json();
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) return [];

  const parsed = JSON.parse(raw);
  return (parsed.locations || []).map(toCandidate).filter(Boolean);
}

module.exports = { extract };
