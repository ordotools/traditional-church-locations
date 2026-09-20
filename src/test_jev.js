const assert = require('assert');

delete process.env.AI_GATEWAY_API_KEY;
const { judgeSameLocation } = require('./jev');

(async () => {
  // No pairs -> nothing to ask, no network call needed.
  assert.deepStrictEqual(await judgeSameLocation([]), []);

  // Not configured -> null, so callers fall back to leaving pairs for
  // manual review instead of guessing.
  const result = await judgeSameLocation([{ candidate: { title: 'A' }, massCenter: { title: 'B' } }]);
  assert.strictEqual(result, null);

  console.log('ok');
})();
