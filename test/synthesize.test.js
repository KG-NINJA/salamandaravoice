const assert = require('assert');

function seededRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

(async () => {
  const { synthesize } = await import('../synth.js');

  const phon = [{ c: '', v: 'A', len: 140 }];
  const params = { sr: 8000, baseF0: 100, rate: 1, noiseAmt: 0.05 };

  const rng1 = seededRng(1);
  const out1 = synthesize(phon, params, rng1);
  const rng2 = seededRng(1);
  const out2 = synthesize(phon, params, rng2);

  assert.strictEqual(out1.length, out2.length);
  for (let i = 0; i < out1.length; i++) {
    assert.strictEqual(out1[i], out2[i]);
  }

  console.log('synthesize deterministic output test passed');
})();
