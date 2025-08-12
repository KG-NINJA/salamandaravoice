/**
 * phoneme.js - Grapheme to Phoneme conversion for VLM-5030-style TTS
 * Handles text to phoneme conversion with English word mapping and kana support
 */

// English word mapping dictionary
const EN_MAP = {
  'FIRE': 'FAI YA',
  'DESTROY': 'DES TROI',
  'ALL': 'AUL',
  'THEM': 'ZEM',
  'ATTACK': 'A TAK',
  'MISSION': 'MI SHON',
  'START': 'STAAT',
  'LASER': 'LEI ZER',
  'LAUNCH': 'LON CH',
  'MISSILE': 'MI SAIL',
  'WARNING': 'WOA NING',
  'ENERGY': 'E NE JI',
  'BOSS': 'BOS',
  'OPTION': 'OP SHON',
  'POWER': 'PAU A',
  'UP': 'AP',
  'READY': 'RE DI',
  'GO': 'GO',
  'PLAYER': 'PLEI YA',
  'TARGET': 'TAA GET',
  'COMPLETE': 'KON PLIIT',
  'DESTROYED': 'DES TROID'
};

/**
 * Apply English word mapping to input text
 * @param {string} text - Input text
 * @returns {string} - Text with English words mapped to phonetic representation
 */
function applyEnglishMap(text) {
  let result = text;
  
  // Apply word mappings
  for (const [word, phonetic] of Object.entries(EN_MAP)) {
    const regex = new RegExp(`\\b${word}\\b`, 'g');
    result = result.replace(regex, phonetic);
  }
  
  return result;
}

/**
 * Convert text to phoneme array
 * @param {string} input - Input text (can be English or Katakana)
 * @returns {Array} - Array of phoneme objects
 */
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
    'ッ':'Q','ー':'-'
  };

  // 2文字合成(ャュョ系)を先に処理
  s = s.replace(/(キャ|キュ|キョ|シャ|シュ|ショ|チャ|チュ|チョ|ジャ|ジュ|ジョ|リャ|リュ|リョ)/g, m => kataMap[m] || m);
  // 単体のカタカナを置換
  s = s.replace(/[ァ-ンー]/g, ch => kataMap[ch] || ch);

  // 英語簡易置換
  s = applyEnglishMap(s);

  const syl = [];
  const tokens = s.split(/\s+/).filter(Boolean);
  const VOW = /[AIUEO]/;
  const CONS = /[BCDFGHJKLMNPQRSTVWXZ]/;

  tokens.forEach(tok => {
    tok = tok.replace(/([AIUEO])-+/g, "$1$1"); // 長音処理
    let i = 0;
    while (i < tok.length) {
      if (tok[i] === 'Q') { syl.push({c:'',v:'',len:0,gem:true}); i++; continue; }

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
        if (i < tok.length && /[RLY]/.test(tok[i])) { c += tok[i]; i++; }
        if (i < tok.length && CONS.test(tok[i]) && !VOW.test(tok[i])) { c += tok[i]; i++; }
      }

      let v = '';
      if (i < tok.length && VOW.test(tok[i])) { v = tok[i]; i++; }
      else if (tok[i] === 'Y' && VOW.test(tok[i + 1])) { c += 'Y'; v = tok[i + 1]; i += 2; }
      else if (tok[i] === 'N' && (i === tok.length - 1 || !VOW.test(tok[i + 1]))) { syl.push({c:'N',v:'',len:60}); i++; continue; }
      else { i++; continue; }

      syl.push({ c, v, len: 140 });
    }
  });

  // 促音→burst
  for (let j = 0; j < syl.length - 1; j++) {
    if (syl[j].gem) {
      syl[j].len = 0;
      syl[j + 1].burst = true;
    }
  }

  return syl.filter(s => s.len > 0 || s.c === 'N');
}

export { toPhonemes, applyEnglishMap, EN_MAP };
