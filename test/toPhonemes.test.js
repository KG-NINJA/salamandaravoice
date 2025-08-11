const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

// Load script.js into a sandboxed context with minimal DOM stubs
const code = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
const context = {
  console,
  document: { getElementById: () => ({ addEventListener: () => {} }) },
  window: {}
};
vm.createContext(context);
vm.runInContext(code, context);
const toPhonemes = context.toPhonemes;

const stringRes = toPhonemes('STRING');
assert.strictEqual(stringRes[0].c, 'STR');
assert.strictEqual(stringRes[0].v, 'I');

const sprintRes = toPhonemes('SPRINT');
assert.strictEqual(sprintRes[0].c, 'SPR');
assert.strictEqual(sprintRes[0].v, 'I');

console.log('toPhonemes cluster tests passed');
