// VLM-5030風 ルールTTS (#KGNINJA)
// テキスト→CV音素→有声/無声励起→3フォルマントBPF→8kHz/量子化→WAV

// プリセット
function setPreset(text) {
  document.getElementById('text').value = text;
  render(false); // すぐ再生
}

// DOM参照
const $ = (id) => document.getElementById(id);
const textEl = $("text"), rateEl = $("rate"), pitchEl = $("pitch"), bitEl = $("bit"),
      noiseEl = $("noise"), phonemesEl = $("phonemes"), statusEl = $("status"),
      srEl = $("sr"), fsOutEl = $("fsOut"), formantGainEl = $("formantGain"), delayEl = $("delay");

$("speak").onclick = async () => render(false);
$("export").onclick = async () => render(true);

// -------- 1) Grapheme→Phoneme（簡易: ローマ字/カタカナ→CV配列） --------
function toPhonemes(input) {
  let s = (input || "").trim()
    .replace(/[!?.、。]/g, " ")
    .replace(/\s+/g, " ")
    .toUpperCase();

  // カタカナ→ローマ字(主要・拗音・促音・長音)
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
    'ッ':'Q', // 促音: 次子音の促進トリガ
    'ー':'-' // 長音
  };
  // 2文字合成(ャュョ系)を先に
  s = s.replace(/(キャ|キュ|キョ|シャ|シュ|ショ|チャ|チュ|チョ|ジャ|ジュ|ジョ|リャ|リュ|リョ)/g, m=>kataMap[m]||m);
  // 単体
  s = s.replace(/[ァ-ンー]/g, ch => kataMap[ch] || ch);

  // 英語簡易置換
  s = s.replace(/\bFIRE\b/g, "FAI YA")
       .replace(/\bDESTROY\b/g, "DES TROI")
       .replace(/\bALL\b/g, "AUL")
       .replace(/\bTHEM\b/g, "ZEM")
       .replace(/\bATTACK\b/g, "A TAK")
       .replace(/\bMISSION\b/g, "MI SHON")
       .replace(/\bSTART\b/g, "STAAT")
       .replace(/\bLASER\b/g, "LEI ZER");

  // ローマ字→音素スライス
  const syl = [];
  const tokens = s.split(/\s+/).filter(Boolean);
  tokens.forEach(tok=>{
    // 長音：母音重ね
    tok = tok.replace(/([AIUEO])-+/g, "$1$1");
    let i=0;
    while(i<tok.length){
      if(tok[i]==='Q'){ syl.push({c:'',v:'',len:0, gem:true}); i++; continue; }
      let c='', v='';
      if (tok.slice(i).startsWith("CH")) { c="CH"; i+=2; }
      else if (tok.slice(i).startsWith("SH")) { c="SH"; i+=2; }
      else if (tok.slice(i).startsWith("KY")) { c="KY"; i+=2; }
      else if (tok.slice(i).startsWith("TS")) { c="TS"; i+=2; }
      else if ("BCDFGHJKLMNPQRSTVWXZ".includes(tok[i])) { c=tok[i]; i++; }

      if ("AIUEO".includes(tok[i])) { v=tok[i]; i++; }
      else if (tok[i]==='Y' && "AIUEO".includes(tok[i+1])) { c=(c||'')+'Y'; v=tok[i+1]; i+=2; }
      else if (tok[i]==='N' && (i===tok.length-1 || !'AIUEO'.includes(tok[i+1]))) {
        syl.push({c:'N', v:'', len:60}); i++; continue;
      } else { i++; continue; }

      syl.push({c,v,len:120});
    }
  });

  // 促音の反映（直後をburst）
  for(let j=0;j<syl.length-1;j++){
    if(syl[j].gem){
      syl[j].len=0;
      syl[j+1].burst = true;
    }
  }

  return syl.filter(s=>s.len>0 || s.c==='N');
}

// -------- 2) 合成用パラメータ --------
const VOWEL_FORMANTS = {
  'A': [700, 1100, 2450],
  'I': [300, 2400, 3000],
  'U': [350, 1100, 2250],
  'E': [500, 1700, 2500],
  'O': [450, 800, 2600]
};

function consonantNoise(c) {
  // 無声ノイズ帯域（中心周波数, バンド幅）
  const map = {
    'S': [5000, 1200], 'SH':[3000,800], 'TS':[4500,1000], 'CH':[3500,900],
    'F':[2000,700], 'H':[1600,600], 'K':[2500,900], 'T':[4000,1200], 'P':[1500,600]
  };
  return map[c] || [2000, 900];
}
function consonantVoiced(c){
  const voiced = new Set(['B','D','G','Z','J','R','M','N','L','Y','W']);
  return voiced.has(c);
}

// -------- 3) 合成（手計算→そのまま再生/保存） --------
let bp_z1 = [0,0,0], bp_z2 = [0,0,0]; // BPFの内部状態（3段）

async function render(exportWav=false){
  // BPFの状態を毎回リセット（無音化/音色暴走対策）
  bp_z1 = [0,0,0];
  bp_z2 = [0,0,0];

  const sr = parseInt(srEl.value,10) || 16000;     // 合成FS
  const fsOut = parseInt(fsOutEl.value,10) || 8000; // 最終出力FS
  const bit = parseInt(bitEl.value,10);
  const formantGain = parseFloat(formantGainEl.value);
  const baseF0 = parseFloat(pitchEl.value);
  const rate = parseFloat(rateEl.value);
  const noiseAmt = parseFloat(noiseEl.value);
  const cabDelay = parseFloat(delayEl.value);

  const phon = toPhonemes(textEl.value || "FIRE");
  phonemesEl.textContent = phon.map(p=>`${p.c}${p.v || ''}${p.burst?'*':''}`).join(' ');

  // 総サンプル長の見積もり
  const totalMs = phon.reduce((a,p)=>a+p.len,0)/rate + 300;
  const totalN = Math.ceil(sr * (totalMs/1000));
  const out = new Float32Array(totalN);

  // 1フレーム=10msで処理
  const frame = Math.max(1, Math.floor(sr * 0.01));
  let t = 0;

  for(const syl of phon){
    const frames = Math.max(1, Math.floor((syl.len/rate)/10));
    const v = syl.v || '';
    const c = syl.c || '';
    const voiced = (v!=='') || consonantVoiced(c);

    // 目標フォルマント/帯域
    const cn = consonantNoise(c);
    const baseFormants = v ? VOWEL_FORMANTS[v] : [ cn[0], cn[0]*1.6, cn[0]*2.3 ];
    const baseBw = v ? [90,120,160] : [ cn[1], cn[1]*1.3, cn[1]*1.6 ];

    let f0 = baseF0;

    for(let k=0;k<frames;k++){
      // 軽いF0ジッタ
      const jitter = (Math.random()-0.5)*4;
      const period = Math.max(1, Math.floor(sr/(f0 + jitter)));

      for(let n=0;n<frame;n++){
        const idx = t + n;
        if(idx>=out.length) break;

        // 励起：有声=パルス列、無声=ホワイトノイズ
        let exc = 0;
        if (voiced){
          const ph = (idx % period);
          exc = (ph < 2) ? 1.0 : 0.0; // パルス
          // 破裂（先頭40msほど）
          if (syl.burst && k===0 && n<Math.min(40, frame)) {
            const env = 0.9 * Math.exp(-n/120);
            exc += env;
          }
        } else {
          exc = (Math.random()*2 - 1);
        }
        // 常時ノイズを少量ミックス（ザラ感）
        exc = exc*(1-noiseAmt) + (Math.random()*2-1)*noiseAmt;

        // 3段バンドパス（フォルマント）
        let y = exc;
        for(let b=0; b<3; b++){
          // 子音は少しランダム化してシャリ感
          const fcJit = v ? 0 : baseFormants[b] * (1 + (Math.random()-0.5)*0.1);
          const fc = v ? baseFormants[b] : fcJit;
          const bw = baseBw[b];
          const q = Math.max(0.707, fc/(2*bw));
          y = biquadBandpassSample(y, fc, q, sr);
        }
        // 出力（軽くゲイン＆クリップ）
        out[idx] += Math.max(-1, Math.min(1, y * 0.9 * formantGain));
      }
      t += frame;
    }
    // 短休符
    t += Math.floor(sr * 0.02);
  }

  // ---- ポストFX：LPF→量子化→キャビネット風ディレイ→クリップ→8kHz化 ----
  const post = processBuffer(out, sr, { fsOut, bit, cabDelay });

  // ---- 再生（fsOutでAudioContextを作る）----
  const ctxPlay = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: fsOut });
  await ctxPlay.resume(); // 自動再生ブロック対策（ユーザー操作内想定でも一応）

  const audioBuf = ctxPlay.createBuffer(1, post.length, fsOut);
  audioBuf.copyToChannel(post, 0);
  const srcNode = ctxPlay.createBufferSource();
  srcNode.buffer = audioBuf;
  srcNode.connect(ctxPlay.destination);
  srcNode.start();

  statusEl.textContent = exportWav ? "書き出し準備中…" : "再生中…";

  // ---- 書き出し（16bit PCM, fsOut） ----
  if (exportWav) {
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

// -------- DSPユーティリティ --------

// 双二次BPF（直列3段用の共有状態bp_z1/bp_z2を使用）
function biquadBandpassSample(x, fc, q, fs){
  const w0 = 2*Math.PI*fc/fs;
  const alpha = Math.sin(w0)/(2*q);
  const b0 =   q*alpha;
  const b1 =   0;
  const b2 =  -q*alpha;
  const a0 =   1 + alpha;
  const a1 =  -2*Math.cos(w0);
  const a2 =   1 - alpha;

  // 3段直列
  let y = x;
  for(let i=0;i<3;i++){
    const _b0=b0/a0, _b1=b1/a0, _b2=b2/a0, _a1=a1/a0, _a2=a2/a0;
    const out = _b0*y + _b1*bp_z1[i] + _b2*bp_z2[i] - _a1*bp_z1[i] - _a2*bp_z2[i];
    bp_z2[i] = bp_z1[i];
    bp_z1[i] = out;
    y = out;
  }
  return y;
}

// ポストFX
function processBuffer(data, sr, {fsOut, bit, cabDelay}){
  // ローパス(~4.2kHz)
  const lp = simpleOnePoleLP(data, sr, 4200);

  // 量子化（ビットクラッシュ）
  const step = Math.pow(2, bit)-1;
  for(let i=0;i<lp.length;i++){
    lp[i] = Math.round(((lp[i]+1)/2)*step)/step*2 - 1;
  }

  // 短ディレイ（筐体反射的）
  const d = Math.floor(sr * cabDelay);
  if(d>4){
    for(let i=d;i<lp.length;i++){
      lp[i] += lp[i-d]*0.25;
    }
  }

  // クリップ
  for(let i=0;i<lp.length;i++){
    lp[i] = Math.max(-0.98, Math.min(0.98, lp[i]));
  }

  // 8kHzへダウンサンプル（ラフ間引きで荒さ出し）
  const ratio = Math.max(1, Math.floor(sr/fsOut));
  const outLen = Math.floor(lp.length/ratio);
  const out = new Float32Array(outLen);
  for(let i=0;i<outLen;i++) out[i] = lp[i*ratio];

  return out;
}

function simpleOnePoleLP(data, sr, cutoff){
  const out = new Float32Array(data.length);
  const rc = 1.0/(2*Math.PI*cutoff);
  const dt = 1.0/sr;
  const alpha = dt/(rc+dt);
  out[0] = data[0];
  for(let i=1;i<data.length;i++){
    out[i] = out[i-1] + alpha*(data[i]-out[i-1]);
  }
  return out;
}

// WAV(16bit PCM mono)
function pcm16ToWav(float32, sampleRate){
  const len = float32.length;
  const buffer = new ArrayBuffer(44 + len*2);
  const view = new DataView(buffer);

  const writeStr = (o, s) => { for(let i=0;i<s.length;i++) view.setUint8(o+i, s.charCodeAt(i)); };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + len*2, true);
  writeStr(8, "WAVE");
  writeStr(12,"fmt ");
  view.setUint32(16, 16, true);       // Subchunk1Size (PCM)
  view.setUint16(20, 1, true);        // AudioFormat PCM
  view.setUint16(22, 1, true);        // NumChannels mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate*2, true); // ByteRate (sr*channels*2)
  view.setUint16(32, 2, true);        // BlockAlign
  view.setUint16(34, 16, true);       // BitsPerSample
  writeStr(36,"data");
  view.setUint32(40, len*2, true);

  let o = 44;
  for(let i=0;i<len;i++){
    let s = Math.max(-1, Math.min(1, float32[i]));
    view.setInt16(o, (s<0 ? s*0x8000 : s*0x7FFF), true);
    o+=2;
  }
  return view;
}
