const assert = require('assert');

(async () => {
  const { toPhonemes, EN_MAP } = await import('../phoneme.js');

  // English dictionary mappings
  for (const [word, mapped] of Object.entries(EN_MAP)) {
    assert.deepStrictEqual(
      toPhonemes(word),
      toPhonemes(mapped),
      `EN_MAP mapping failed for ${word}`
    );
  }

  // Katakana to phoneme conversions
  const testRes = toPhonemes('テスト');
  assert.deepStrictEqual(
    testRes.map(p => p.c + p.v),
    ['TE', 'SU', 'TO']
  );

  const catRes = toPhonemes('キャット');
  assert.strictEqual(catRes[0].c, 'KY');
  assert.strictEqual(catRes[0].v, 'A');
  assert.strictEqual(catRes[1].c, 'T');
  assert.strictEqual(catRes[1].v, 'O');
  assert.ok(catRes[1].burst);

  // Edge cases: punctuation
  const punctRes = toPhonemes('テスト。');
  assert.deepStrictEqual(punctRes, testRes);

  // Edge cases: long vowels
  const longRes = toPhonemes('カー');
  assert.deepStrictEqual(
    longRes.map(p => p.c + p.v),
    ['KA', 'A']
  );

  console.log('toPhonemes extended tests passed');
})();

