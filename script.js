/**
 * script.js - Main controller for VLM-5030-style TTS
 * Handles UI interaction and audio playback
 */

import { toPhonemes } from './phoneme.js';
import { synthesize, resetBpfState } from './synth.js';
import { processBuffer, pcm16ToWav } from './dsp.js';

// Current audio source node (for stopping previous playback)
let currentSource = null;

// AudioContext instance
let audioCtx = null;

/**
 * Set preset text and render immediately
 * @param {string} text - Preset text
 */
function setPreset(text) {
  document.getElementById('text').value = text;
  render(false); // すぐ再生
}

// DOM参照
const $ = (id) => document.getElementById(id);
const textEl = $("text"), rateEl = $("rate"), pitchEl = $("pitch"), bitEl = $("bit"),
      noiseEl = $("noise"), phonemesEl = $("phonemes"), statusEl = $("status"),
      srEl = $("sr"), fsOutEl = $("fsOut"), formantGainEl = $("formantGain"), delayEl = $("delay");

/**
 * Initialize audio context with user interaction
 */
async function initAudioContext() {
  if (!audioCtx) {
    const fsOut = parseInt(fsOutEl.value, 10) || 8000;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: fsOut });
  }
  
  // iOS/Chrome対策: ユーザー操作内でresume()を確実に実行
  if (audioCtx.state !== 'running') {
    try {
      await audioCtx.resume();
    } catch (e) {
      console.error("AudioContext resume failed:", e);
    }
  }
  return audioCtx;
}

// Event listeners with proper audio context initialization
$("speak").onclick = async () => {
  await initAudioContext();
  render(false);
};

$("export").onclick = async () => {
  await initAudioContext();
  render(true);
};

/**
 * Main render function - synthesize and play/export audio
 * @param {boolean} exportWav - Whether to export as WAV
 */
async function render(exportWav = false) {
  // Stop any currently playing audio
  if (currentSource) {
    currentSource.stop(0);
    currentSource = null;
  }
  
  // Get parameters from UI
  const sr = parseInt(srEl.value, 10) || 16000;
  let fsOut = parseInt(fsOutEl.value, 10) || 8000;
  
  // Ensure fsOut doesn't exceed sr
  fsOut = Math.min(fsOut, sr);
  fsOutEl.value = fsOut; // Update UI to reflect the capped value
  
  const bit = parseInt(bitEl.value, 10);
  const formantGain = parseFloat(formantGainEl.value);
  const baseF0 = parseFloat(pitchEl.value);
  const rate = parseFloat(rateEl.value);
  const noiseAmt = parseFloat(noiseEl.value);
  const cabDelay = parseFloat(delayEl.value);
  const brightConsonant = $("brightConsonant")?.checked || false;

  // Convert text to phonemes
  const phon = toPhonemes(textEl.value || "FIRE");
  phonemesEl.textContent = phon.map(p => `${p.c}${p.v || ''}${p.burst ? '*' : ''}`).join(' ');

  // Synthesize audio
  const synthParams = { 
    sr, baseF0, rate, noiseAmt, formantGain, brightConsonant 
  };
  const rawAudio = synthesize(phon, synthParams);

  // Apply post-processing
  const processOptions = { 
    fsOut, bit, cabDelay, brightConsonant 
  };
  const processedAudio = processBuffer(rawAudio, sr, processOptions);

  // Ensure AudioContext is initialized and running
  await initAudioContext();
  
  // Create and play audio buffer
  const audioBuf = audioCtx.createBuffer(1, processedAudio.length, fsOut);
  audioBuf.copyToChannel(processedAudio, 0);
  
  currentSource = audioCtx.createBufferSource();
  currentSource.buffer = audioBuf;
  currentSource.connect(audioCtx.destination);
  currentSource.start();

  statusEl.textContent = exportWav ? "書き出し準備中…" : "再生中…";

  // Export WAV if requested
  if (exportWav) {
    const wav = pcm16ToWav(processedAudio, fsOut);
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

// Export functions for global access
window.setPreset = setPreset;
window.render = render;
