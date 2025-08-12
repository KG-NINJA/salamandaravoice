const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

async function load() {
  return await import(pathToFileURL(path.join(__dirname, '..', 'phoneme.js')).href);
}

(async () => {
  const { toPhonemes } = await load();

  const stringRes = toPhonemes('STRING');
  assert.strictEqual(stringRes[0].c, 'STR');
  assert.strictEqual(stringRes[0].v, 'I');

  const sprintRes = toPhonemes('SPRINT');
  assert.strictEqual(sprintRes[0].c, 'SPR');
  assert.strictEqual(sprintRes[0].v, 'I');

  console.log('toPhonemes cluster tests passed');
})();

