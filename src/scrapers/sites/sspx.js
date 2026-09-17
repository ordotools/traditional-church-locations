// sspx.org renders each chapel with Drupal's Address module, which emits
// labeled microformat classes (address-line1, locality, administrative-area,
// postal-code) instead of free-form text. Read those fields directly rather
// than regex-guessing — it's more reliable and breaks less on a redesign,
// since the field classes tend to outlive the visual layout around them.
// If sspx.org restructures and this stops matching, scrapeCandidates() falls
// back to the generic extractor automatically (see ../registry.js) — it'll
// just produce lower-quality candidates until this file is updated to match.

function fieldText($, el, selector) {
  return $(el).find(selector).first().text().replace(/\s+/g, ' ').trim();
}

function extract($) {
  const candidates = [];

  $('article.spotlight-row--operation').each((_, el) => {
    const title = fieldText($, el, '.spotlight-row__title') || null;
    const line1 = fieldText($, el, '.address-line1');
    const line2 = fieldText($, el, '.address-line2');
    const city = fieldText($, el, '.locality') || null;
    const state = fieldText($, el, '.administrative-area') || null;
    const zip = fieldText($, el, '.postal-code');

    if (!line1 && !city && !state) return; // nothing usable in this row

    const street = [line1, line2].filter(Boolean).join(', ');
    if (street) {
      candidates.push({
        title,
        address: [street, [city, state].filter(Boolean).join(', '), zip].filter(Boolean).join(', '),
        city,
        state,
        precision: 'exact',
        organizationAbbreviation: null,
      });
    } else {
      candidates.push({
        title,
        address: [city, state].filter(Boolean).join(', '),
        city,
        state,
        precision: city ? 'city' : 'state',
        organizationAbbreviation: null,
      });
    }
  });

  return candidates;
}

module.exports = { extract };
