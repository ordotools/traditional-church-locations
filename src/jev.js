// Jev (Vercel AI Gateway's probabilistic decision model) judges the
// ambiguous middle band of the pre-geocode duplicate gate — pairs where
// string similarity alone can't confidently say "same place" or "new place".
// https://vercel.com/kb/guide/typesafe-jev-and-ai-sdk
//
// Auth: set AI_GATEWAY_API_KEY (see https://vercel.com/docs/ai-gateway) —
// works from any Node process, no Vercel deployment required.
const JEV_MODEL = 'typesafe-ai/jev';

function pairPrompt(candidate, massCenter) {
  return (
    `Candidate listing: title="${candidate.title || ''}", address="${candidate.raw_address || candidate.address || ''}", ` +
    `organization="${candidate.organization_name || ''}".\n` +
    `Existing map pin: title="${massCenter.title}", address="${massCenter.address}", ` +
    `organization="${massCenter.organization_name || ''}", lat/lng=${massCenter.latitude},${massCenter.longitude}.\n` +
    `Is the candidate listing the same physical location as the existing map pin?`
  );
}

// Batches every ambiguous pair into a single evaluate() call. Returns an
// array of probabilities (0..1, "same place") aligned to `pairs`, or null if
// Jev isn't configured or the call fails — callers should fall back to
// leaving those pairs for manual review rather than guessing.
async function judgeSameLocation(pairs) {
  if (!pairs.length) return [];
  if (!process.env.AI_GATEWAY_API_KEY) return null;

  const { experimental_evaluate: evaluate } = require('ai');
  const questions = {};
  pairs.forEach(({ candidate, massCenter }, i) => {
    questions[`pair_${i}`] = {
      type: 'boolean',
      instructions: pairPrompt(candidate, massCenter),
      criteria: {
        true: 'The candidate and the existing pin describe the same physical building/location.',
        false: 'They are different physical locations, even if names or organizations look similar.',
      },
    };
  });

  try {
    const result = await evaluate({ model: JEV_MODEL, state: pairs, questions });
    return pairs.map((_, i) => result.answers[`pair_${i}`].probability);
  } catch {
    return null;
  }
}

module.exports = { judgeSameLocation };
