/**
 * speech.js — Browser-native Speech Recognition wrapper.
 *
 * Uses the Web Speech API (SpeechRecognition) for the prototype.
 * A real STT/TTS backend will be wired in later via env-configured URLs.
 */

import { setState }          from './state.js';
import { getSelectedInputId } from './audio.js';
import { addBubble }          from './ui.js';

let _recognition = null;
let _isListening = false;

/**
 * Initialise speech recognition (lazy, created on first use).
 */
function getRecognition() {
  if (_recognition) return _recognition;

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.error('[speech] SpeechRecognition API not available in this browser.');
    return null;
  }

  const rec = new SpeechRecognition();
  rec.lang       = 'ru-RU';
  rec.continuous  = false;   // one utterance at a time
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  rec.addEventListener('result', handleResult);
  rec.addEventListener('end',    handleEnd);
  rec.addEventListener('error',  handleError);

  _recognition = rec;
  return rec;
}

/** Toggle listening on/off. */
export function toggleListening() {
  _isListening ? stopListening() : startListening();
}

export function startListening() {
  const rec = getRecognition();
  if (!rec) {
    setState('error');
    return;
  }
  try {
    rec.start();
    _isListening = true;
    setState('listening');
  } catch (e) {
    console.warn('[speech] start() error (may already be running):', e);
  }
}

export function stopListening() {
  if (_recognition) {
    _recognition.stop();
  }
  _isListening = false;
}

/* ---- Internal handlers ---- */

function handleResult(event) {
  const result = event.results[event.results.length - 1];
  const text = result[0].transcript.trim();

  if (result.isFinal && text) {
    setState('thinking');
    addBubble('user', text);

    // Simulate Jarvis response (placeholder until LLM is wired).
    simulateJarvisReply(text);
  }
}

function handleEnd() {
  _isListening = false;
  // If we were still in "listening" state, go back to sleep.
  // (If we moved to "thinking" already, don't override.)
  import('./state.js').then(({ getState }) => {
    if (getState() === 'listening') {
      setState('sleeping');
    }
  });
}

function handleError(event) {
  console.error('[speech] Recognition error:', event.error);
  _isListening = false;

  if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
    setState('error');
  } else {
    setState('sleeping');
  }
}

/* ---- Placeholder "AI" response ---- */

async function simulateJarvisReply(userText) {
  // Fake delay to show "thinking" state.
  await new Promise(r => setTimeout(r, 1200 + Math.random() * 800));

  setState('speaking');
  const reply = `Я получил: «${userText}». Скоро здесь будет настоящий LLM.`;
  addBubble('jarvis', reply);

  // Speak the reply with browser TTS (placeholder).
  speakBrowser(reply).finally(() => setState('sleeping'));
}

/** Use browser SpeechSynthesis as a placeholder TTS. */
function speakBrowser(text) {
  return new Promise((resolve) => {
    if (!window.speechSynthesis) { resolve(); return; }

    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = 'ru-RU';
    utt.onend = resolve;
    utt.onerror = resolve;
    window.speechSynthesis.speak(utt);
  });
}
