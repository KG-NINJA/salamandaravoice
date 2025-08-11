// VLM-5030風 ルールTTS (#KGNINJA)
// テキスト→CV音素→有声/無声励起→3フォルマントBPF(並列)→8kHz/量子化→WAV

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
      srEl = $("sr"), fsOutEl = $("fsOut"), formantGainEl = $("formantGain"), delayEl = $("delay");

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

// ==== 1) Grapheme→Phoneme（子音クラスタ対応） ====
function toPhonemes(input) {
  let s = (input || "").trim()
    .replace(/[!?.、。]/g, " ")
    .replace(/\s+/g, " ")
    .toUpperCase();

  // カタカナ→ローマ字（主要・拗音・促音・長音）
  const kataMap = {
    'ァ':'A','ィ':'I','ゥ':'U','ェ':'E','ォ':'O',
    'ア':'A','イ':'I','ウ':'U','エ':'E','オ':'O',
    'カ':'KA','キ':'KI','ク':'KU','ケ':'KE','コ':'KO',
    'サ':'SA','シ':'SHI','ス':'SU','セ':'SE','ソ':'SO',
    'タ':'TA','チ':'CHI','ツ':'TSU','テ':'TE','ト':'TO',
    'ナ':'NA','ニ':'NI','ヌ':'NU','ネ':'NE','ノ':'NO',
    'ハ':'HA','ヒ':'HI','フ':'FU','ヘ':'HE','ホ':'HO',
    'マ':'MA','ミ':'MI','ム':'MU','メ':'ME','モ':'MO',
    'ヤ':'YA','ユ':'YU','ヨ':'YO',
    'ラ':'RA','リ':'RI','ル':'RU','レ':'RE','ロ':'RO',
    'ワ':'WA','ヲ':'O','ン':'N',
    'ガ':'GA','ギ':'GI','グ':'GU','ゲ':'GE','ゴ':'GO',
    'ザ':'ZA','ジ':'JI','ズ':'ZU','ゼ':'ZE','ゾ':'ZO',
    'ダ':'DA','ヂ':'JI','ヅ':'ZU','デ':'DE','ド':'DO',
    'バ':'BA','ビ':'BI','ブ':'BU','ベ':'BE','ボ':'BO',
    'パ':'PA','ピ':'PI','プ':'PU','ペ':'PE','ポ':'PO',
    'キャ':'KYA','キュ':'KYU','キョ':'KYO',
    'シャ':'SHA','シュ':'SHU','ショ':'SHO',
    'チャ':'CHA','チュ':'CHU','チョ':'CHO',
    'ジャ':'JA','ジュ':'JU','ジョ':'JO',
    'リャ':'RYA','リュ':'RYU','リョ':'RYO',
    'ッ':'Q', 'ー':'-'
  };
  s = s.replace(/(キャ|キュ|キョ|シャ|シュ|ショ|チャ|チュ|チョ|ジャ|ジュ|ジョ|リャ|リュ|リョ)/g, m=>kataMap[m]||m);
  s = s.replace(/[ァ-ンー]/g, ch => kataMap[ch] || ch);

  // 英語簡易置換（必要に応じて拡張）
  s = s.replace(/\bFIRE\b/g, "FAI YA")
       .replace(/\bDESTROY\b/g, "DES TROI")
       .replace(/\bALL\b/g, "AUL")
       .replace(/\bTHEM\b/g, "ZEM")
       .replace(/\bATTACK\b/g, "A TAK")
       .replace(/\bMISSION\b/g, "MI SHON")
       .replace(/\bSTART\b/g, "STAAT")
       .replace(/\bLASER\b/g, "LEI ZER")
       .replace(/\bLAUNCH\b/g, "LON CH")
       .replace(/\bWARNING\b/g, "WOA NING")
       .replace(/\bREADY\b/g, "RE DI");

  const syl = [];
  const tokens = s.split(/\s+/).filter(Boolean);
  const VOW = /[AIUEO]/;
  const CONS = /[BCDFGHJKLMNPQRSTVWXZ]/;

  tokens.forEach(tok=>{
    tok = tok.replace(/([AIUEO])-+/g, "$1$1"); // 長音処理
    let i = 0;
    while (i < tok.length) {
      if (tok[i] === 'Q') { syl.push({c:'',v:'',len:0, gem:true}); i++; continue; }

      // 子音クラスタ（CH/SH/TS、+R/L/Y連結、先行S等）
      let c = '';
      if (tok.slice(i).startsWith('CH')) { c='CH'; i+=2; }
      else if (tok.slice(i).startsWith('SH')) { c='SH'; i+=2; }
      else if (tok.slice(i).startsWith('TS')) { c='TS'; i+=2; }
      else if (
        tok[i] === 'S' &&
        i + 2 < tok.length &&
        CONS.test(tok[i + 1]) &&
        tok[i + 2] === 'R'
      ) { c = tok.slice(i, i + 3); i += 3; }
      else if (CONS.test(tok[i])) {
        c = tok[i]; i++;
        if (i<tok.length && /[RLY]/.test(tok[i])) { c += tok[i]; i++; }
        if (i<tok.length && CONS.test(tok[i]) && !VOW.test(tok[i])) { c += tok[i]; i++; }
      }

      // 母音を必ず1つ
      let v = '';
      if (i<tok.length && VOW.test(tok[i])) { v = tok[i]; i++; }
      else if (tok[i]==='Y' && VOW.test(tok[i+1])) { c += 'Y'; v = tok[i+1]; i+=2; }
      else if (tok[i]==='N' && (i===tok.length-1 || !VOW.test(tok[i+1]))) { syl.push({c:'N',v:'',len:60}); i++; continue; }
      else { i++; continue; }

      syl.push({ c, v, len: 140 }); // 1音節=140ms（短すぎ回避）
    }
  });

  // 促音→burst
  for (let j=0;j<syl.length-1;j++) if (syl[j].gem){ syl[j].len=0; syl[j+1].burst=true; }
  return syl.filter(s=>s.len>0 || s.c==='N');
}

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

// ==== 3) 合成 ====
let bpStates = [{x1:0,x2:0,y1:0,y2:0},{x1:0,x2:0,y1:0,y2:0},{x1:0,x2:0,y1:0,y2:0}];
let currentCtx = null, currentSource = null;

async function render(exportWav=false){
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

  for(const syl of phon){
    const frames = Math.max(1, Math.floor((syl.len/rate)/10));
    const v = syl.v || ''; const c = syl.c || '';
    const voiced = (v!=='') || consonantVoiced(c);
    const cn = consonantNoise(c);
    const baseFormants = v ? VOWEL_FORMANTS[v] : [cn[0], cn[0]*1.6, cn[0]*2.3];
    const baseBw       = v ? [90,120,160]     : [cn[1], cn[1]*1.3, cn[1]*1.6];
    let f0 = baseF0;

    const sylSamples = frames * frame;
    const fadeSamps = Math.min(Math.floor(sr * 0.005), Math.floor(sylSamples / 2));
    for(let k=0;k<frames;k++){
      const jitter = (Math.random()-0.5)*4;
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
          exc = (Math.random()*2 - 1);
        }
        exc = exc*(1-noiseAmt) + (Math.random()*2-1)*noiseAmt;

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
          const fc = v ? baseFormants[b] : baseFormants[b]*(1 + (Math.random()-0.5)*0.12);
          const bw = baseBw[b];
          const q  = Math.max(0.707, fc/(2*bw));
          y += gains[b] * biquadBandpassSample1(exc, fc, q, sr, bpStates[b]);
        }
        out[idx] += Math.max(-1, Math.min(1, y * 1.6 * formantGain)); // ゲイン少し強め
      }
      t += frame;
    }
    t += Math.floor(sr*0.02); // 休符
  }

  // ---- ポストFX → 8kHz化 ----
  const post = processBuffer(out, sr, { fsOut, bit, cabDelay });

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

function processBuffer(data, sr, {fsOut, bit, cabDelay}){
  const cutoff = Math.min(4500, fsOut/2 - 100); // Nyquist安全マージン
  const lp = simpleOnePoleLP(data, sr, cutoff); // ローパス（エイリアス防止）

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
