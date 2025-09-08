// VLM-5030風 ルールTTS (#KGNINJA)
// テキスト→CV音素→有声/無声励起→3フォルマントBPF(並列)→8kHz/量子化→WAV
import { toPhonemes } from './phoneme.js';

// Global debug flag. Set to true to enable detailed logging.
window.DEBUG = false;

// ---- プリセット ----
function setPreset(text) {
  document.getElementById('text').value = text;
  render(false); // すぐ再生
}

// ---- DOM参照 ----
const $ = (id) => document.getElementById(id);
const textEl = $("text"), rateEl = $("rate"), pitchEl = $("pitch"), bitEl = $("bit"),
      noiseEl = $("noise"), phonemesEl = $("phonemes"), statusEl = $("status"),
      srEl = $("sr"), fsOutEl = $("fsOut"), formantGainEl = $("formantGain"), delayEl = $("delay"),
      vocoderEl = $("vocoder"), recordEl = $("record");

const DEFAULTS = {
  bit: parseInt(bitEl.value, 10),
  formantGain: parseFloat(formantGainEl.value),
  baseF0: parseFloat(pitchEl.value),
  rate: parseFloat(rateEl.value),
  noiseAmt: parseFloat(noiseEl.value),
  cabDelay: parseFloat(delayEl.value),
};

function sanitizeParam(el, parser, def, min, max) {
  let val = parser(el.value);
  if (!Number.isFinite(val)) val = def;
  if (min !== undefined) val = Math.max(min, val);
  if (max !== undefined) val = Math.min(max, val);
  el.value = val;
  return val;
}

[
  [bitEl, (v) => parseInt(v, 10), DEFAULTS.bit, 3, 8],
  [formantGainEl, parseFloat, DEFAULTS.formantGain, 0.5, 2.0],
  [pitchEl, parseFloat, DEFAULTS.baseF0, 70, 180],
  [rateEl, parseFloat, DEFAULTS.rate, 0.6, 1.6],
  [noiseEl, parseFloat, DEFAULTS.noiseAmt, 0.02, 1],
  [delayEl, parseFloat, DEFAULTS.cabDelay, 0, 0.08],
].forEach(([el, parser, def, min, max]) => {
  el.addEventListener("change", () => sanitizeParam(el, parser, def, min, max));
});

$("speak").onclick = async () => render(false);
$("export").onclick = async () => render(true);
recordEl.onclick = async () => toggleRecord();

// ==== 1) Grapheme→Phoneme（子音クラスタ対応） ====
// toPhonemes is imported from phoneme.js

// ==== 2) 合成パラメータ ====
const VOWEL_FORMANTS = {
  'A':[700,1100,2450],'I':[300,2400,3000],'U':[350,1100,2250],'E':[500,1700,2500],'O':[450,800,2600]
};
function consonantNoise(c){
  const map = {'S':[5000,1200],'SH':[3000,800],'TS':[4500,1000],'CH':[3500,900],
               'F':[2000,700],'H':[1600,600],'K':[2500,900],'T':[4000,1200],'P':[1500,600]};
  return map[c] || [2000,900];
}
function consonantVoiced(c){ return new Set(['B','D','G','Z','J','R','M','N','L','Y','W']).has(c); }

function baseFormantsFor(syl){
  if(!syl) return [500,1500,2500];
  const v = syl.v || '';
  const c = syl.c || '';
  if(v){
    return VOWEL_FORMANTS[v];
  } else {
    const cn = consonantNoise(c);
    return [cn[0], cn[0]*1.6, cn[0]*2.3];
  }
}

// ==== 3) 合成 ====
let bpStates = [{x1:0,x2:0,y1:0,y2:0},{x1:0,x2:0,y1:0,y2:0},{x1:0,x2:0,y1:0,y2:0}];
let currentCtx = null, currentSource = null;
let recCtx = null, recStream = null, recSource = null, recNode = null;
let recBuffers = [], recording = false;

async function render(exportWav=false, rng = Math.random){
  // BPF状態リセット
  bpStates = [{x1:0,x2:0,y1:0,y2:0},{x1:0,x2:0,y1:0,y2:0},{x1:0,x2:0,y1:0,y2:0}];

  let sr = parseInt(srEl.value,10) || 16000;
  let fsOut = parseInt(fsOutEl.value,10) || 8000;
  if (!Number.isFinite(sr) || sr<8000) sr = 16000;
  if (!Number.isFinite(fsOut) || fsOut<4000) fsOut = 8000;
  if (fsOut > sr) fsOut = sr; // 安全ガード

  const bit = sanitizeParam(bitEl, (v) => parseInt(v, 10), DEFAULTS.bit, 3, 8);
  const formantGain = sanitizeParam(formantGainEl, parseFloat, DEFAULTS.formantGain, 0.5, 2.0);
  const baseF0 = sanitizeParam(pitchEl, parseFloat, DEFAULTS.baseF0, 70, 180);
  const rate = sanitizeParam(rateEl, parseFloat, DEFAULTS.rate, 0.6, 1.6);
  const noiseAmt = sanitizeParam(noiseEl, parseFloat, DEFAULTS.noiseAmt, 0.02, 1); // 完全無ノイズは避ける
  const cabDelay = sanitizeParam(delayEl, parseFloat, DEFAULTS.cabDelay, 0, 0.08);

  const phon = toPhonemes(textEl.value || "FIRE");
  phonemesEl.textContent = phon.map(p=>`${p.c}${p.v||''}${p.burst?'*':''}`).join(' ');

  // 出力バッファ
  const totalMs = phon.reduce((a,p)=>a+p.len,0)/rate + 300;
  const totalN  = Math.ceil(sr * (totalMs/1000));
  const out = new Float32Array(totalN);

  const frame = Math.max(1, Math.floor(sr*0.01));
  let t = 0;

  for(let i=0;i<phon.length;i++){
    const syl = phon[i];
    const frames = Math.max(1, Math.floor((syl.len/rate)/10));
    const v = syl.v || ''; const c = syl.c || '';
    const voiced = (v!=='') || consonantVoiced(c);
    const cn = consonantNoise(c);
    const baseFormants = v ? VOWEL_FORMANTS[v] : [cn[0], cn[0]*1.6, cn[0]*2.3];
    const baseBw       = v ? [90,120,160]     : [cn[1], cn[1]*1.3, cn[1]*1.6];
    const prevFormants = baseFormantsFor(phon[i-1] || syl);
    const nextFormants = baseFormantsFor(phon[i+1] || syl);
    let f0 = baseF0;
    const totalSamples = frames * frame;
    const transSamples = Math.min(Math.floor(sr*0.02), Math.floor(totalSamples/2));
    let sampleInSyl = 0;

    const sylSamples = frames * frame;
    const fadeSamps = Math.min(Math.floor(sr * 0.005), Math.floor(sylSamples / 2));
    for(let k=0;k<frames;k++){
      const jitter = (rng()-0.5)*4;
      const period = Math.max(1, Math.floor(sr/(f0 + jitter)));

      for(let n=0;n<frame;n++){
        const idx = t + n; if (idx>=out.length) break;

        // 励起（有声=パルス列 デューティ5%）
        let exc = 0;
        if (voiced){
          const ph = (idx % period);
          const width = Math.max(1, Math.floor(period * 0.05)); // ★5%
          exc = (ph < width) ? 1.0 : 0.0;
        } else {
          exc = (rng()*2 - 1);
        }
        // 有声/無声でノイズ量を切り替える（有声は0.05固定）
        const effectiveNoiseAmt = voiced ? 0.05 : noiseAmt;
        exc = exc*(1-effectiveNoiseAmt) + (rng()*2-1)*effectiveNoiseAmt;

        // アタック/ディケイエンベロープ（5ms）
        const pos = k * frame + n;
        if (fadeSamps > 0){
          let env = 1;
          if (pos < fadeSamps) env = pos / fadeSamps;
          else if (pos >= sylSamples - fadeSamps) env = (sylSamples - pos) / fadeSamps;
          exc *= env; // 比較用にコメントアウト可
        }

        // 破裂音強化: 先頭40msのみ別途加算
        if (voiced && syl.burst && k===0 && n<Math.min(40, frame)){
          const burstEnv = 1.1 * Math.exp(-n/100);
          exc += burstEnv;
        }

        // ---- フォルマントBPF（並列合算）----
        const gains = [1.0, 0.9, 0.6]; // 第3はやや抑える
        let y = 0;
        for (let b=0;b<3;b++){
          let fcTarget = baseFormants[b];
          if (sampleInSyl < transSamples) {
            const r = sampleInSyl / transSamples;
            fcTarget = prevFormants[b] + (baseFormants[b] - prevFormants[b]) * r;
          } else if (sampleInSyl >= totalSamples - transSamples) {
            const r = (sampleInSyl - (totalSamples - transSamples)) / transSamples;
            fcTarget = baseFormants[b] + (nextFormants[b] - baseFormants[b]) * r;
          }
          const fc = v ? fcTarget : fcTarget * (1 + (rng()-0.5)*0.1);
          const bw = baseBw[b];
          const q  = Math.max(0.707, fc/(2*bw));
          y += gains[b] * biquadBandpassSample1(exc, fc, q, sr, bpStates[b]);
        }
        out[idx] += Math.max(-1, Math.min(1, y * 1.6 * formantGain)); // ゲイン少し強め
        sampleInSyl++;
      }
      t += frame;
    }
    t += Math.floor(sr*0.02); // 休符
  }

  // ---- ポストFX → 8kHz化 ----
  const post = processBuffer(out, sr, { fsOut, bit, cabDelay, vocoder: vocoderEl.checked });

  // Debug logging
  if (window.DEBUG) {
    const ratio = Math.max(1, Math.floor(sr / fsOut));
    const meanAmp = post.slice(0, 100).reduce((a, v) => a + Math.abs(v), 0) /
                    Math.min(100, post.length);
    console.table(phon);
    console.table([
      { stage: 'input', samples: out.length },
      { stage: 'output', samples: post.length }
    ]);
    console.table([{ sr, fsOut, ratio }]);
    console.table([{ meanAmpFirst100: meanAmp }]);
  }

  // 既存再生を停止
  try { currentSource?.stop(0); } catch(e){}
  try { currentCtx?.close(); } catch(e){}

  // ---- 再生 ----
  const ctxPlay = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: fsOut });
  await ctxPlay.resume();
  const audioBuf = ctxPlay.createBuffer(1, post.length, fsOut);
  audioBuf.copyToChannel(post, 0);
  const srcNode = ctxPlay.createBufferSource();
  srcNode.buffer = audioBuf; srcNode.connect(ctxPlay.destination); srcNode.start();
  currentCtx = ctxPlay; currentSource = srcNode;

  statusEl.textContent = exportWav ? "書き出し準備中…" : "再生中…";

  // ---- 書き出し ----
  if (exportWav){
    const wav = pcm16ToWav(post, fsOut);
    const blob = new Blob([wav], { type: "audio/wav" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "vlm5030_style.wav";
    a.click();
    statusEl.textContent = "WAVを書き出しました";
  } else {
    statusEl.textContent = "再生しました";
  }
}

async function toggleRecord(){
  if (!recording){
    try {
      recStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recCtx = new (window.AudioContext || window.webkitAudioContext)();
      recSource = recCtx.createMediaStreamSource(recStream);
      recNode = recCtx.createScriptProcessor(4096, 1, 1);
      recBuffers = [];
      recNode.onaudioprocess = e => {
        recBuffers.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      };
      recSource.connect(recNode);
      recNode.connect(recCtx.destination);
      recording = true;
      recordEl.textContent = "■ 停止";
      statusEl.textContent = "録音中…";
    } catch(err){
      statusEl.textContent = "マイクが利用できません";
    }
  } else {
    recNode.disconnect();
    recSource.disconnect();
    recStream.getTracks().forEach(t => t.stop());
    await recCtx.close();
    recording = false;
    recordEl.textContent = "🎤 ボイスチェンジ";
    const len = recBuffers.reduce((a,b) => a + b.length, 0);
    const buf = new Float32Array(len);
    let offset = 0;
    for (const b of recBuffers){
      buf.set(b, offset);
      offset += b.length;
    }
    let fsOut = parseInt(fsOutEl.value, 10);
    if (!Number.isFinite(fsOut) || fsOut < 4000) fsOut = 8000;
    fsOut = Math.min(fsOut, recCtx.sampleRate);
    const bit = sanitizeParam(bitEl, v => parseInt(v,10), DEFAULTS.bit, 3, 8);
    const cabDelay = sanitizeParam(delayEl, parseFloat, DEFAULTS.cabDelay, 0, 0.08);
    const post = processBuffer(buf, recCtx.sampleRate, { fsOut, bit, cabDelay, vocoder: vocoderEl.checked });
    const ctxPlay = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: fsOut });
    await ctxPlay.resume();
    const audioBuf = ctxPlay.createBuffer(1, post.length, fsOut);
    audioBuf.copyToChannel(post, 0);
    const src = ctxPlay.createBufferSource();
    src.buffer = audioBuf; src.connect(ctxPlay.destination); src.start();
    currentCtx = ctxPlay; currentSource = src;
    statusEl.textContent = "変換しました";
  }
}

// ==== DSP ====
function biquadBandpassSample1(x, fc, q, fs, state){
  const w0 = 2*Math.PI*fc/fs;
  const alpha = Math.sin(w0)/(2*q);
  const b0 =  q*alpha, b1 = 0,     b2 = -q*alpha;
  const a0 =  1 + alpha, a1 = -2*Math.cos(w0), a2 = 1 - alpha;

  const _b0 = b0/a0, _b1 = b1/a0, _b2 = b2/a0;
  const _a1 = a1/a0, _a2 = a2/a0;

  const y = _b0*x + _b1*state.x1 + _b2*state.x2 - _a1*state.y1 - _a2*state.y2;
  state.x2 = state.x1; state.x1 = x;
  state.y2 = state.y1; state.y1 = y;
  return y;
}

function processBuffer(data, sr, {fsOut, bit, cabDelay, vocoder=false}){
  const cutoff = Math.min(4500, fsOut/2 - 100); // Nyquist安全マージン
  const lp = simpleOnePoleLP(data, sr, cutoff); // ローパス（エイリアス防止）

  // Vocoder-style ring modulation
  if (vocoder){
    const freq = 150; // 100-200 Hz range center
    const inc = freq/sr;
    let phase = 0, preRms = 0, postRms = 0;
    for(let i=0;i<lp.length;i++) preRms += lp[i]*lp[i];
    for(let i=0;i<lp.length;i++){
      phase += inc; if (phase>=1) phase-=1;
      const carrier = 2*phase-1;
      lp[i] *= carrier;
      postRms += lp[i]*lp[i];
    }
    const gain = Math.sqrt(preRms/(postRms||1));
    for(let i=0;i<lp.length;i++) lp[i] = Math.tanh(lp[i]*gain*1.2);
  }

  // 量子化（ビットクラッシュ）
  const step = Math.pow(2, bit)-1;
  for(let i=0;i<lp.length;i++){
    lp[i] = Math.round(((lp[i]+1)/2)*step)/step*2 - 1;
  }

  // 短ディレイ（筐体反射）
  const d = Math.floor(sr * cabDelay);
  if (d>4) for(let i=d;i<lp.length;i++) lp[i] += lp[i-d]*0.25;

  // クリップ
  for(let i=0;i<lp.length;i++) lp[i] = Math.max(-0.98, Math.min(0.98, lp[i]));

  // ダウンサンプル
  const ratio = Math.max(1, Math.floor(sr/fsOut));
  const outLen = Math.floor(lp.length/ratio);
  const out = new Float32Array(outLen);
  for(let i=0;i<outLen;i++) out[i] = lp[i*ratio];
  return out;
}

function simpleOnePoleLP(data, sr, cutoff){
  const out = new Float32Array(data.length);
  const rc = 1/(2*Math.PI*cutoff), dt = 1/sr, alpha = dt/(rc+dt);
  out[0] = data[0];
  for(let i=1;i<data.length;i++) out[i] = out[i-1] + alpha*(data[i]-out[i-1]);
  return out;
}

function pcm16ToWav(float32, sampleRate){
  const len = float32.length;
  const buffer = new ArrayBuffer(44 + len*2);
  const view = new DataView(buffer);
  const w = (o,s)=>{ for(let i=0;i<s.length;i++) view.setUint8(o+i, s.charCodeAt(i)); };

  w(0,"RIFF"); view.setUint32(4, 36+len*2, true);
  w(8,"WAVE"); w(12,"fmt "); view.setUint32(16,16,true);
  view.setUint16(20,1,true); view.setUint16(22,1,true);
  view.setUint32(24,sampleRate,true); view.setUint32(28,sampleRate*2,true);
  view.setUint16(32,2,true); view.setUint16(34,16,true);
  w(36,"data"); view.setUint32(40,len*2,true);

  let o=44;
  for(let i=0;i<len;i++){
    let s=Math.max(-1, Math.min(1, float32[i]));
    view.setInt16(o, s<0 ? s*0x8000 : s*0x7FFF, true);
    o+=2;
  }
  return view;
}
