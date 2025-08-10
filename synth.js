/**
 * synth.js - Synthesis engine for VLM-5030-style TTS
 * Handles phoneme to audio conversion with formant synthesis
 */

// Formant data for vowels
const VOWEL_FORMANTS = {
  'A': [700, 1100, 2450],
  'I': [300, 2400, 3000],
  'U': [350, 1100, 2250],
  'E': [500, 1700, 2500],
  'O': [450, 800, 2600]
};

/**
 * Get noise parameters for consonants
 * @param {string} c - Consonant character
 * @returns {Array} - [center frequency, bandwidth]
 */
function consonantNoise(c) {
  // 無声ノイズ帯域（中心周波数, バンド幅）
  const map = {
    'S': [5000, 1200], 'SH': [3000, 800], 'TS': [4500, 1000], 'CH': [3500, 900],
    'F': [2000, 700], 'H': [1600, 600], 'K': [2500, 900], 'T': [4000, 1200], 'P': [1500, 600]
  };
  return map[c] || [2000, 900];
}

/**
 * Check if consonant is voiced
 * @param {string} c - Consonant character
 * @returns {boolean} - True if voiced
 */
function consonantVoiced(c) {
  const voiced = new Set(['B', 'D', 'G', 'Z', 'J', 'R', 'M', 'N', 'L', 'Y', 'W']);
  return voiced.has(c);
}

// BPF state variables (separate for each formant band)
let bp_x1 = [0, 0, 0], bp_x2 = [0, 0, 0], bp_y1 = [0, 0, 0], bp_y2 = [0, 0, 0];

/**
 * Reset BPF state
 */
function resetBpfState() {
  bp_x1 = [0, 0, 0]; 
  bp_x2 = [0, 0, 0]; 
  bp_y1 = [0, 0, 0]; 
  bp_y2 = [0, 0, 0];
}

/**
 * Biquad bandpass filter implementation
 * @param {number} x - Input sample
 * @param {number} fc - Center frequency
 * @param {number} q - Q factor
 * @param {number} fs - Sample rate
 * @returns {number} - Filtered sample
 */
function biquadBandpassSample(x, fc, q, fs) {
  const w0 = 2 * Math.PI * fc / fs;
  const alpha = Math.sin(w0) / (2 * q);
  // Band-pass (constant skirt gain)
  const b0 = q * alpha, b1 = 0, b2 = -q * alpha;
  const a0 = 1 + alpha, a1 = -2 * Math.cos(w0), a2 = 1 - alpha;

  let y = x;
  for (let i = 0; i < 3; i++) {
    const _b0 = b0 / a0, _b1 = b1 / a0, _b2 = b2 / a0;
    const _a1 = a1 / a0, _a2 = a2 / a0;
    const out = _b0 * y + _b1 * bp_x1[i] + _b2 * bp_x2[i] - _a1 * bp_y1[i] - _a2 * bp_y2[i];
    // 履歴更新
    bp_x2[i] = bp_x1[i];
    bp_x1[i] = y;
    bp_y2[i] = bp_y1[i];
    bp_y1[i] = out;
    y = out;
  }
  return y;
}

/**
 * Synthesize audio from phoneme array
 * @param {Array} phon - Phoneme array
 * @param {Object} params - Synthesis parameters
 * @returns {Float32Array} - Raw audio data
 */
function synthesize(phon, params) {
  const { 
    sr, baseF0, rate, noiseAmt, brightConsonant = false 
  } = params;
  
  // Reset BPF state for clean synthesis
  resetBpfState();
  
  // 総サンプル長の見積もり
  const totalMs = phon.reduce((a, p) => a + p.len, 0) / rate + 300;
  const totalN = Math.ceil(sr * (totalMs / 1000));
  const out = new Float32Array(totalN);

  // 1フレーム=10ms
  const frame = Math.max(1, Math.floor(sr * 0.01));
  let t = 0;

  for (const syl of phon) {
    const frames = Math.max(1, Math.floor((syl.len / rate) / 10));
    const v = syl.v || '';
    const c = syl.c || '';
    const voiced = (v !== '') || consonantVoiced(c);

    const cn = consonantNoise(c);
    const baseFormants = v ? VOWEL_FORMANTS[v] : [cn[0], cn[0] * 1.6, cn[0] * 2.3];
    const baseBw = v ? [90, 120, 160] : [cn[1], cn[1] * 1.3, cn[1] * 1.6];

    let f0 = baseF0;

    for (let k = 0; k < frames; k++) {
      const jitter = (Math.random() - 0.5) * 4;
      const period = Math.max(1, Math.floor(sr / (f0 + jitter)));

      for (let n = 0; n < frame; n++) {
        const idx = t + n;
        if (idx >= out.length) break;

        // 励起：有声=パルス列、無声=ホワイトノイズ
        let exc = 0;
        if (voiced) {
          const ph = (idx % period);
          exc = (ph < 2) ? 1.0 : 0.0;
          
          // 破裂音強化: 先頭40msのエンベロープを強化
          if (syl.burst && k === 0 && n < Math.min(40, frame)) {
            const env = 1.1 * Math.exp(-n / 100);
            exc += env;
          }
        } else {
          exc = (Math.random() * 2 - 1);
        }
        
        // 常時ノイズを少量ミックス（ザラ感）- 最小値を0.02に底上げ
        const effectiveNoiseAmt = Math.max(0.02, noiseAmt);
        exc = exc * (1 - effectiveNoiseAmt) + (Math.random() * 2 - 1) * effectiveNoiseAmt;

        // 3段BPF（フォルマント）
        let y = exc;
        for (let b = 0; b < 3; b++) {
          // 子音シャリ感: 子音時は第3フォルマントを+10%～+15%ランダム
          let fc = baseFormants[b];
          if (!v && b === 2 && brightConsonant) {
            fc *= (1 + 0.1 + Math.random() * 0.05);
          }
          
          const bw = baseBw[b];
          const q = Math.max(0.707, fc / (2 * bw));
          y = biquadBandpassSample(y, fc, q, sr);
        }
        
        out[idx] += Math.max(-1, Math.min(1, y * 0.9));
      }
      t += frame;
    }
    // 短休符
    t += Math.floor(sr * 0.02);
  }

  return out;
}

export { 
  synthesize, 
  resetBpfState, 
  consonantNoise, 
  consonantVoiced, 
  VOWEL_FORMANTS 
};