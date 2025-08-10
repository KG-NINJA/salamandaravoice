/**
 * dsp.js - DSP utilities for VLM-5030-style TTS
 * Handles post-processing and WAV file generation
 */

/**
 * Simple one-pole lowpass filter
 * @param {Float32Array} data - Input audio data
 * @param {number} sr - Sample rate
 * @param {number} cutoff - Cutoff frequency
 * @returns {Float32Array} - Filtered audio data
 */
function simpleOnePoleLP(data, sr, cutoff) {
  const out = new Float32Array(data.length);
  const rc = 1.0 / (2 * Math.PI * cutoff);
  const dt = 1.0 / sr;
  const alpha = dt / (rc + dt);
  out[0] = data[0];
  for (let i = 1; i < data.length; i++) {
    out[i] = out[i - 1] + alpha * (data[i] - out[i - 1]);
  }
  return out;
}

/**
 * Apply post-processing effects to audio buffer
 * @param {Float32Array} data - Raw audio data
 * @param {number} sr - Sample rate
 * @param {Object} options - Processing options
 * @returns {Float32Array} - Processed audio data
 */
function processBuffer(data, sr, options) {
  const { fsOut, bit, cabDelay, brightConsonant = false } = options;
  
  // Ensure fsOut doesn't exceed sr
  const safefsOut = Math.min(fsOut, sr);
  
  // ローパス(~4.5kHz for bright consonants, otherwise 4.2kHz)
  const lpCutoff = brightConsonant ? 4500 : 4200;
  const lp = simpleOnePoleLP(data, sr, lpCutoff);

  // 量子化（ビットクラッシュ）
  const step = Math.pow(2, bit) - 1;
  for (let i = 0; i < lp.length; i++) {
    lp[i] = Math.round(((lp[i] + 1) / 2) * step) / step * 2 - 1;
  }

  // 短ディレイ（筐体反射的）
  const d = Math.floor(sr * cabDelay);
  if (d > 4) {
    for (let i = d; i < lp.length; i++) {
      lp[i] += lp[i - d] * 0.25;
    }
  }

  // クリップ
  for (let i = 0; i < lp.length; i++) {
    lp[i] = Math.max(-0.98, Math.min(0.98, lp[i]));
  }

  // ダウンサンプル（ラフ間引きで荒さ出し）
  const ratio = Math.max(1, Math.floor(sr / safefsOut));
  const outLen = Math.floor(lp.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) out[i] = lp[i * ratio];

  return out;
}

/**
 * Convert PCM float data to WAV file format
 * @param {Float32Array} float32 - Audio data
 * @param {number} sampleRate - Sample rate
 * @returns {DataView} - WAV file data
 */
function pcm16ToWav(float32, sampleRate) {
  const len = float32.length;
  const buffer = new ArrayBuffer(44 + len * 2);
  const view = new DataView(buffer);
  const writeStr = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + len * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);       // Subchunk1Size (PCM)
  view.setUint16(20, 1, true);        // AudioFormat PCM
  view.setUint16(22, 1, true);        // NumChannels mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // ByteRate (sr*channels*2)
  view.setUint16(32, 2, true);        // BlockAlign
  view.setUint16(34, 16, true);       // BitsPerSample
  writeStr(36, "data");
  view.setUint32(40, len * 2, true);

  let o = 44;
  for (let i = 0; i < len; i++) {
    let s = Math.max(-1, Math.min(1, float32[i]));
    view.setInt16(o, (s < 0 ? s * 0x8000 : s * 0x7FFF), true);
    o += 2;
  }
  return view;
}

export { simpleOnePoleLP, processBuffer, pcm16ToWav };