// VLM-5030風 ルールTTS (#KGNINJA)
// 方針: テキスト→CV音素→有声/無声励起→フォルマント(BPF×3)→8kHz/ビットクラッシュ/帯域制限→WAV

const $ = (id) => document.getElementById(id);
const textEl = $("text"), rateEl = $("rate"), pitchEl = $("pitch"), bitEl = $("bit"),
      noiseEl = $("noise"), phonemesEl = $("phonemes"), statusEl = $("status"),
      srEl = $("sr"), fsOutEl = $("fsOut"), formantGainEl = $("formantGain"), delayEl = $("delay");

$("speak").onclick = async () => render(false);
$("export").onclick = async () => render(true);

// --- 1) Grapheme→Phoneme（超簡易: ローマ字/カタカナ→CV配列） ---
function toPhonemes(input) {
  let s = input.trim()
    .replace(/[!?.、。]/g, " ")
    .replace(/\s+/g, " ")
    .toUpperCase();

  // カタカナ→ローマ字(ごく一部)
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
  // 2文字合成（ャュョ）を先に
  s = s.replace(/(キャ|キュ|キョ|シャ|シュ|ショ|チャ|チュ|チョ|ジャ|ジュ|ジョ|リャ|リュ|リョ)/g, m=>kataMap[m]||m);
  // 単体
  s = s.replace(/[ァ-ンー]/g, ch => kataMap[ch] || ch);

  // 英語簡易置換（FIRE, DESTROY, ALLなど最低限）
  s = s.replace(/\bFIRE\b/g, "FAI YA")
       .replace(/\bDESTROY\b/g, "DES TROI")
       .replace(/\bALL\b/g, "AUL")
       .replace(/\bTHEM\b/g, "ZEM")
       .replace(/\bATTACK\b/g, "A TAK");

  // ローマ字→音素スライス（CH, SH, KY…先に）
  const syl = [];
  const tokens = s.split(/\s+/);
  tokens.forEach(tok=>{
    // 長音記号→母音二重化
    tok = tok.replace(/([AIUEO])-+/g, "$1$1");
    // 促音Q処理: 次の子音を強勢/短破裂
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
      else if (tok[i]==='N' && (i===tok.length-1 || !'AIUEO'.includes(tok[i+1]))) { // 撥音
        syl.push({c:'N', v:'', len:60}); i++; continue;
      } else { i++; continue; }

      syl.push({c,v,len:120});
    }
  });

  // geminate（促音）を反映：直後子音の開始を短く強調
  for(let j=0;j<syl.length-1;j++){
    if(syl[j].gem){
      syl[j].len=0;
      syl[j+1].burst = true;
    }
  }

  return syl.filter(s=>s.len>0 || s.c==='N');
}

// --- 2) 合成パラメータ（フォルマント中心） ---
const VOWEL_FORMANTS = {
  'A': [700, 1100, 2450],
  'I': [300, 2400, 3000],
  'U': [350, 1100, 2250],
  'E': [500, 1700, 2500],
  'O': [450, 800, 2600]
};

function consonantNoise(c) {
  // 無声ノイズの帯域目安（超簡易）
  const map = {
    'S': [5000, 1200], 'SH':[3000,800], 'TS':[4500,1000], 'CH':[3500,900],
    'F':[2000,700], 'H':[1600,600], 'K':[2500,900], 'T':[4000,1200], 'P':[1500,600]
  };
  return map[c] || [2000, 900];
}

function consonantVoiced(c){
  // 有声子音のフォルマント補正（軽く）
  const voiced = new Set(['B','D','G','Z','J','R','M','N','L','Y','W']);
  return voiced.has(c);
}

// --- 3) 合成本体（OfflineAudioContextでレンダリング→再生/書き出し） ---
async function render(exportWav=false){
  const sr = parseInt(srEl.value,10) || 16000;
  const fsOut = parseInt(fsOutEl.value,10) || 8000;
  const bit = parseInt(bitEl.value,10);
  const formantGain = parseFloat(formantGainEl.value);
  const baseF0 = parseFloat(pitchEl.value);       // Hz
  const rate = parseFloat(rateEl.value);          // 話速係数
  const noiseAmt = parseFloat(noiseEl.value);
  const cabDelay = parseFloat(delayEl.value);

  const phon = toPhonemes(textEl.value || "FIRE");
  phonemesEl.textContent = phon.map(p=>`${p.c}${p.v || ''}${p.burst?'*':''}`).join(' ');

  // 長さ見積もり
  let durMs = phon.reduce((a,p)=>a+p.len, 0) / rate + 300;
  const ctx = new OfflineAudioContext({ numberOfChannels: 1, length: Math.ceil(sr*durMs/1000), sampleRate: sr });

  // 合成: 1フレーム= 10ms
  const frame = Math.floor(sr*0.01);
  const buf = ctx.createBuffer(1, Math.ceil(sr*durMs/1000), sr);
  const out = buf.getChannelData(0);

  let t = 0;
  for(const syl of phon){
    const frames = Math.max(1, Math.floor((syl.len/rate)/10));
    const v = syl.v || '';
    const c = syl.c || '';
    const voiced = (v!=='') || consonantVoiced(c);
    const formants = v ? VOWEL_FORMANTS[v] : [ consonantNoise(c)[0], consonantNoise(c)[0]*1.6, consonantNoise(c)[0]*2.3 ];
    const bw = v ? [90, 120, 160] : [ consonantNoise(c)[1], consonantNoise(c)[1]*1.3, consonantNoise(c)[1]*1.6 ];
    let f0 = baseF0;

    for(let k=0;k<frames;k++){
      // 微妙なF0揺らぎ
      const jitter = (Math.random()-0.5)*4;
      const period = Math.max(1, Math.floor(sr/(f0 + jitter)));

      // フレーム分生成
      for(let n=0;n<frame;n++){
        const idx = t + n;
        if(idx>=out.length) break;

        // 励起: 有声=矩形パルス, 無声=ホワイトノイズ
        let exc = 0;
        if (voiced){
          const ph = (idx % period);
          exc = (ph < 2) ? 1.0 : 0.0;  // パルス列
          // 子音破裂
          if (syl.burst && k===0 && n<Math.min(40, frame)) exc += 0.6;
        } else {
          exc = (Math.random()*2-1);
        }
        // ノイズ成分を常に少し混ぜる（ザラつき）
        exc = exc*(1-noiseAmt) + (Math.random()*2-1)*noiseAmt;

        // 3バンドパス（フォルマント）通過: 双二次IIRを手計算近似
        let y = exc;
        for(let b=0; b<3; b++){
          const fc = formants[b];
          const q = Math.max(0.707, fc/(2*bw[b]));
          y = biquadBandpassSample(y, fc, q, sr);
        }

        // クリップ＆出力
        out[idx] += Math.max(-1, Math.min(1, y * 0.9 * formantGain));
      }
      t += frame;
    }
    // 休止(短間)
    t += Math.floor(sr*0.02);
  }

  // ポストFX: ローパス(4kHz)→ビットクラッシュ→キャビネット風ディレイ→ハードクリップ
  const post = processBuffer(ctx, out, sr, { fsOut, bit, cabDelay });

  // 再生 or 書き出し
  const bufNode = ctx.createBuffer(1, post.length, sr);
  bufNode.copyToChannel(post,0);
  const src = ctx.createBufferSource(); src.buffer = bufNode;
  src.connect(ctx.destination); src.start();
  const rendered = await ctx.startRendering();

  // 実再生
  const playCtx = new AudioContext();
  const pb = playCtx.createBuffer(1, rendered.length, rendered.sampleRate);
  pb.copyToChannel(rendered.getChannelData(0),0);
  const psrc = playCtx.createBufferSource(); psrc.buffer = pb; psrc.connect(playCtx.destination); psrc.start();

  statusEl.textContent = exportWav ? "書き出し準備中…" : "再生中…";

  if(exportWav){
    const wav = pcm16ToWav(rendered.getChannelData(0), rendered.sampleRate);
    const blob = new Blob([wav], {type:"audio/wav"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "vlm5030_style.wav";
    a.click();
    statusEl.textContent = "WAVを書き出しました";
  } else {
    statusEl.textContent = "再生しました";
  }
}

// --- DSP小物 ---
let bp_z1 = [0,0,0], bp_z2 = [0,0,0]; // 双二次の状態を3バンド分
function biquadBandpassSample(x, fc, q, fs){
  const w0 = 2*Math.PI*fc/fs;
  const alpha = Math.sin(w0)/(2*q);
  const b0 =   q*alpha;
  const b1 =   0;
  const b2 =  -q*alpha;
  const a0 =   1 + alpha;
  const a1 =  -2*Math.cos(w0);
  const a2 =   1 - alpha;

  // 直列3段で使うため、各段の状態を別に持つ
  let y = x;
  for(let i=0;i<3;i++){
    const _b0=b0/_a(a0), _b1=b1/_a(a0), _b2=b2/_a(a0), _a1=a1/_a(a0), _a2=a2/_a(a0);
    const out = _b0*y + _b1*bp_z1[i] + _b2*bp_z2[i] - _a1*bp_z1[i] - _a2*bp_z2[i];
    bp_z2[i] = bp_z1[i];
    bp_z1[i] = out;
    y = out;
  }
  return y;
  function _a(v){ return v===0?1e-9:v; }
}

function processBuffer(ctx, data, sr, {fsOut, bit, cabDelay}){
  // ローパス(約4kHz)
  const lp = simpleOnePoleLP(data, sr, 4000);

  // ビットクラッシュ（量子化）
  const step = Math.pow(2, bit)-1;
  for(let i=0;i<lp.length;i++){
    lp[i] = Math.round(((lp[i]+1)/2)*step)/step*2 - 1;
  }

  // 短ディレイ（筐体反射）
  const d = Math.floor(sr * cabDelay);
  if(d>4){
    for(let i=d;i<lp.length;i++){
      lp[i] += lp[i-d]*0.25;
    }
  }

  // ハードクリップ
  for(let i=0;i<lp.length;i++){
    lp[i] = Math.max(-0.98, Math.min(0.98, lp[i]));
  }

  // 8kHzへダウンサンプル（線形補間なしの単純間引きで荒さを出す）
  const ratio = Math.floor(sr/fsOut);
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

// PCM16 WAV
function pcm16ToWav(float32, sampleRate){
  const len = float32.length;
  const buffer = new ArrayBuffer(44 + len*2);
  const view = new DataView(buffer);

  function writeStr(o, s){ for(let i=0;i<s.length;i++) view.setUint8(o+i, s.charCodeAt(i)); }

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + len*2, true);
  writeStr(8, "WAVE");
  writeStr(12,"fmt ");
  view.setUint32(16, 16, true);       // PCM
  view.setUint16(20, 1, true);        // PCM
  view.setUint16(22, 1, true);        // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate*2, true);
  view.setUint16(32, 2, true);        // block align
  view.setUint16(34, 16, true);       // bits
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
