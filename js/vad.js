/**
 * vad.js — Voice Activity Detection (VAD) для Jarvis Glasses Assistant.
 *
 * Використовує Web Audio API AnalyserNode для визначення голосу.
 * Автоматично запускає та зупиняє SpeechRecognition без натискання кнопок.
 * Підтримує візуалізацію рівня гучності на мобільному (vad-bar).
 */

const ENERGY_THRESHOLD   = 0.015;   // RMS поріг (0.0–1.0)
const SPEECH_MIN_MS      = 180;     // мінімальна тривалість щоб вважати мовою
const SILENCE_TIMEOUT_MS = 1100;    // тиша після якої фраза "закрита"
const ANALYSIS_INTERVAL  = 30;      // ms між вимірами

let _audioCtx      = null;
let _analyser      = null;
let _dataArray     = null;
let _stream        = null;
let _intervalId    = null;
let _vadActive     = false;

let _speechStart   = null;
let _silenceStart  = null;
let _isSpeaking    = false;

let _onSpeechStart = null;   // callback: () => void
let _onSpeechEnd   = null;   // callback: () => void

const vadBarFill = () => document.getElementById('vad-bar-fill');

export async function startVAD(deviceId, onStart, onEnd) {
  _onSpeechStart = onStart;
  _onSpeechEnd   = onEnd;

  if (_vadActive) stopVAD();

  try {
    const constraints = {
      audio: deviceId ? { deviceId: { exact: deviceId } } : {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    };
    _stream    = await navigator.mediaDevices.getUserMedia(constraints);
    _audioCtx  = new (window.AudioContext || window.webkitAudioContext)();
    if (_audioCtx.state === 'suspended') {
      await _audioCtx.resume();
    }

    _analyser  = _audioCtx.createAnalyser();
    _analyser.fftSize = 256;
    _dataArray = new Float32Array(_analyser.frequencyBinCount);

    const source = _audioCtx.createMediaStreamSource(_stream);
    source.connect(_analyser);

    _vadActive    = true;
    _isSpeaking   = false;
    _speechStart  = null;
    _silenceStart = null;

    _intervalId = setInterval(_tick, ANALYSIS_INTERVAL);
    console.log('[vad] Started. Listening for voice activity...');
  } catch (err) {
    console.error('[vad] Failed to start:', err);
    throw err;
  }
}

export function stopVAD() {
  _vadActive = false;
  if (_intervalId) { clearInterval(_intervalId); _intervalId = null; }
  if (_stream)     { _stream.getTracks().forEach(t => t.stop()); _stream = null; }
  if (_audioCtx)   { _audioCtx.close().catch(() => {}); _audioCtx = null; }
  _analyser  = null;
  _dataArray = null;
  _isSpeaking = false;
  const bar = vadBarFill();
  if (bar) bar.style.width = '0%';
  console.log('[vad] Stopped.');
}

export function isVADActive() { return _vadActive; }

function _tick() {
  if (!_analyser) return;

  _analyser.getFloatTimeDomainData(_dataArray);
  const rms = _calcRMS(_dataArray);
  const now  = Date.now();

  // Оновлюємо індикатор гучності для зворотного зв'язку
  const bar = vadBarFill();
  if (bar) {
    const pct = Math.min(100, Math.round((rms / 0.12) * 100));
    bar.style.width = `${pct}%`;
  }

  if (rms > ENERGY_THRESHOLD) {
    _silenceStart = null;

    if (!_isSpeaking) {
      if (!_speechStart) {
        _speechStart = now;
      } else if (now - _speechStart >= SPEECH_MIN_MS) {
        _isSpeaking = true;
        console.log(`[vad] Speech detected (rms=${rms.toFixed(4)})`);
        if (_onSpeechStart) _onSpeechStart();
      }
    }
  } else {
    _speechStart = null;

    if (_isSpeaking) {
      if (!_silenceStart) {
        _silenceStart = now;
      } else if (now - _silenceStart >= SILENCE_TIMEOUT_MS) {
        _isSpeaking   = false;
        _silenceStart = null;
        console.log('[vad] Speech ended (silence timeout)');
        if (_onSpeechEnd) _onSpeechEnd();
      }
    }
  }
}

function _calcRMS(data) {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / data.length);
}
