/**
 * speech.js — Realtime Client Gateway for Jarvis Glasses Assistant (T03).
 *
 * ОНОВЛЕНО:
 * - Повна стабільність Web Speech API для Android Chrome / iOS Safari
 * - Відмова від continuous: true, що викликало зависання мікрофона на смартфонах
 * - Авто-цикл розпізнавання для Hands-Free режиму
 * - Надійна конвертація PCM 24k -> WAV Blob + HTML5 Audio fallback
 * - Глобальне розблокування звуку при першому тапі на екран
 * - Живе відображення почутої мови в реальному часі (Feedback)
 */

import { setState, getState } from './state.js';
import { addBubble, setWsDot } from './ui.js';
import { executeTool } from './tools.js';

let _ws                = null;
let _recognition       = null;
let _isListening       = false;
let _isHandsFree       = false;
let _audioCtx          = null;
let _currentAudioSrc   = null;
let _currentAudioElem  = null;
let _lastSpokenText    = '';
let _speechTimeout     = null;
let _isAudioUnlocked   = false;

// ─── AudioContext Unlocker ───────────────────────────────────────────────────

export function unlockAudioContext() {
  if (_isAudioUnlocked && _audioCtx && _audioCtx.state === 'running') return;
  try {
    if (!_audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        _audioCtx = new AudioContextClass({ sampleRate: 24000 });
      }
    }
    if (_audioCtx && _audioCtx.state === 'suspended') {
      _audioCtx.resume();
    }
    // Програємо 1 мілісекунду тиші для гарантованого розблокування Autoplay
    if (_audioCtx) {
      const osc = _audioCtx.createOscillator();
      const gain = _audioCtx.createGain();
      gain.gain.value = 0.001;
      osc.connect(gain);
      gain.connect(_audioCtx.destination);
      osc.start(0);
      osc.stop(0.02);
    }
    _isAudioUnlocked = true;
    console.log('[audio] AudioContext unlocked successfully');
  } catch (err) {
    console.warn('[audio] AudioContext unlock error:', err);
  }
}

// ─── WebSocket Connection ────────────────────────────────────────────────────

export function initRelayWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const path = window.location.pathname.endsWith('/') 
    ? window.location.pathname 
    : window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/') + 1);
  const normalizedPath = path.endsWith('/') ? path : `${path}/`;
  const wsUrl = `${protocol}//${window.location.host}${normalizedPath}ws`;

  console.log('[relay-ws] Connecting to:', wsUrl);
  setWsDot('connecting');

  try {
    _ws = new WebSocket(wsUrl);
  } catch (err) {
    console.error('[relay-ws] Setup error:', err);
    setWsDot('disconnected');
    setTimeout(initRelayWebSocket, 2500);
    return;
  }

  _ws.onopen = () => {
    console.log('[relay-ws] Connected to Jarvis relay');
    setWsDot('connected');
    _updateFeedback('✅ Подключено к серверу Джарвиса');
  };

  _ws.onmessage = async (event) => {
    try {
      const msg = JSON.parse(event.data);

      if (msg.type === 'state') {
        setState(msg.state);

      } else if (msg.type === 'assistant_reply') {
        setState('speaking');
        _updateFeedback(`🗣️ Джарвис: ${msg.text}`);
        addBubble('jarvis', msg.text);

        if (msg.audio_pcm24k) {
          await playAudioData(msg.audio_pcm24k);
        } else {
          setState('sleeping');
        }

        // В Hands-Free режимі після відповіді асистента відновлюємо слухання
        if (_isHandsFree && getState() !== 'listening') {
          setTimeout(() => {
            if (_isHandsFree && !_isListening) {
              _startRecognition();
            }
          }, 500);
        }

      } else if (msg.type === 'execute_tool') {
        console.log(`[relay-ws] Tool requested: ${msg.name}`);
        _updateFeedback(`⚙️ Выполняю: ${msg.name}...`);
        const result = await executeTool(msg.name, msg.args);
        if (_ws && _ws.readyState === WebSocket.OPEN) {
          _ws.send(JSON.stringify({
            type: 'tool_response',
            name: msg.name,
            candidate: msg.candidate,
            result
          }));
        }

      } else if (msg.type === 'pong') {
        // Keepalive ok
      } else if (msg.type === 'error') {
        console.error('[relay-ws] Server error:', msg.message);
        _updateFeedback(`❌ Ошибка: ${msg.message}`);
        setState('error');
        setTimeout(() => setState('sleeping'), 3000);
      }
    } catch (err) {
      console.error('[relay-ws] Message handling error:', err);
    }
  };

  _ws.onerror = (err) => {
    console.warn('[relay-ws] WS error:', err);
    setWsDot('disconnected');
  };

  _ws.onclose = () => {
    console.log('[relay-ws] Closed. Reconnecting in 2.5s…');
    setWsDot('disconnected');
    setTimeout(initRelayWebSocket, 2500);
  };
}

// Keepalive ping кожні 20 секунд
setInterval(() => {
  if (_ws && _ws.readyState === WebSocket.OPEN) {
    _ws.send(JSON.stringify({ type: 'ping' }));
  }
}, 20000);

// ─── Speech Recognition Engine (Mobile Safe) ────────────────────────────────

function _getSpeechRecognitionClass() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function _initRecognition() {
  const SpeechRec = _getSpeechRecognitionClass();
  if (!SpeechRec) {
    _updateFeedback('❌ Браузер не поддерживает Speech Recognition');
    return null;
  }

  const rec = new SpeechRec();
  rec.lang = 'ru-RU';
  // continuous: false — найнадійніший режим на мобільних телефонах (Android Chrome)
  rec.continuous = false;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  rec.onstart = () => {
    _isListening = true;
    _lastSpokenText = '';
    setState('listening');
    _updateListenButton(true);
    _updateFeedback('👂 Слушаю ваши очки...');
    console.log('[speech] Recognition started');
  };

  rec.onresult = (event) => {
    // Якщо асистент говорить, а користувач перебив його — зупиняємо звук (Barge-in)
    if (getState() === 'speaking') {
      stopPlayback();
      if (_ws && _ws.readyState === WebSocket.OPEN) {
        _ws.send(JSON.stringify({ type: 'barge_in' }));
      }
      setState('listening');
    }

    let interim = '';
    let finalStr = '';

    for (let i = event.resultIndex; i < event.results.length; ++i) {
      const trans = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalStr += trans;
      } else {
        interim += trans;
      }
    }

    const currentText = (finalStr || interim).trim();
    if (currentText) {
      _lastSpokenText = currentText;
      _updateFeedback(`🎤 «${currentText}»`);
      if (finalStr) {
        addBubble('user', finalStr.trim());
      } else {
        addBubble('interim', interim.trim());
      }
    }

    // Скидаємо таймер тиші (1.1 сек) для негайної відправки фрази
    if (_speechTimeout) clearTimeout(_speechTimeout);
    _speechTimeout = setTimeout(() => {
      if (_lastSpokenText && _lastSpokenText.length > 0) {
        _commitAndSendUtterance();
      }
    }, 1100);
  };

  rec.onerror = (event) => {
    console.warn('[speech] Recognition event error:', event.error);
    if (event.error === 'not-allowed') {
      _updateFeedback('⚠️ Микрофон заблокирован. Разрешите доступ в настройках');
      setState('error');
    } else if (event.error === 'no-speech') {
      // Нормальна ситуація тиші
      console.log('[speech] No speech detected in cycle');
    }
  };

  rec.onend = () => {
    console.log('[speech] Recognition cycle ended');
    _isListening = false;
    _updateListenButton(false);

    // Якщо є готова розпізнана фраза — відправляємо
    if (_lastSpokenText && _lastSpokenText.trim().length > 0) {
      _commitAndSendUtterance();
    }

    // В режимі Hands-Free автоматично перезапускаємо цикл
    if (_isHandsFree && getState() !== 'speaking' && getState() !== 'thinking') {
      setTimeout(() => {
        if (_isHandsFree && !_isListening && getState() !== 'speaking' && getState() !== 'thinking') {
          _startRecognition();
        }
      }, 200);
    } else if (!_isHandsFree && getState() === 'listening') {
      setState('sleeping');
      _updateFeedback('😴 Ожидание команды');
    }
  };

  return rec;
}

function _commitAndSendUtterance() {
  if (_speechTimeout) clearTimeout(_speechTimeout);
  const text = _lastSpokenText.trim();
  _lastSpokenText = '';
  if (text.length > 0) {
    _sendUserUtterance(text);
  }
}

function _startRecognition() {
  if (_isListening) return;
  unlockAudioContext();

  try {
    if (_recognition) {
      try { _recognition.abort(); } catch (_) {}
    }
    _recognition = _initRecognition();
    if (_recognition) {
      _recognition.start();
    }
  } catch (err) {
    console.warn('[speech] Start recognition exception:', err);
    _isListening = false;
  }
}

function _stopRecognition() {
  if (_speechTimeout) clearTimeout(_speechTimeout);
  if (_recognition) {
    try { _recognition.stop(); } catch (_) {}
  }
  _isListening = false;
  _updateListenButton(false);
}

// ─── Controls: Toggle Listening & Hands-Free ─────────────────────────────────

export function toggleListening(inputDeviceId = '') {
  unlockAudioContext();
  if (_isHandsFree) {
    toggleHandsFree(inputDeviceId);
    return;
  }

  if (_isListening) {
    _stopRecognition();
    setState('sleeping');
    _updateFeedback('😴 Ожидание');
  } else {
    _startRecognition();
  }
}

export async function toggleHandsFree(inputDeviceId = '') {
  unlockAudioContext();
  if (_isHandsFree) {
    _isHandsFree = false;
    _stopRecognition();
    setState('sleeping');
    _updateFeedback('👂 Hands-Free выключен');
    console.log('[speech] Hands-free OFF');
  } else {
    _isHandsFree = true;
    _startRecognition();
    _updateFeedback('👂 Hands-Free активен (говорю в очки)');
    console.log('[speech] Hands-free ON');
  }
  return _isHandsFree;
}

export function isHandsFree() {
  return _isHandsFree;
}

export function sendUserUtterance(text) {
  _sendUserUtterance(text);
}

function _sendUserUtterance(text) {
  if (!text || !_ws || _ws.readyState !== WebSocket.OPEN) return;
  console.log('[speech] Sending utterance to Jarvis:', text);
  addBubble('user', text);
  setState('thinking');
  _updateFeedback(`🤔 Думаю над: «${text}»`);
  _ws.send(JSON.stringify({ type: 'user_utterance', text }));
}

// ─── Audio Playback: PCM 24k -> WAV Blob -> Web Audio / HTML5 Audio ──────────

function pcmToWavBlob(pcmBytes, sampleRate = 24000) {
  const numChannels = 1;
  const byteRate = sampleRate * numChannels * 2;
  const blockAlign = numChannels * 2;
  const dataSize = pcmBytes.byteLength;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, 36 + dataSize, true);
  view.setUint32(8, 0x57415645, false); // "WAVE"
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // 16-bit
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, dataSize, true);

  new Uint8Array(buffer, 44).set(pcmBytes);
  return new Blob([buffer], { type: 'audio/wav' });
}

async function playAudioData(base64Data) {
  try {
    unlockAudioContext();
    stopPlayback();

    const binary = atob(base64Data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    // 1. Створюємо WAV Blob для максимально надійного відтворення через HTML5 Audio
    const wavBlob = pcmToWavBlob(bytes, 24000);
    const audioUrl = URL.createObjectURL(wavBlob);

    return new Promise((resolve) => {
      const audio = new Audio(audioUrl);
      _currentAudioElem = audio;

      // Підтримка вибору динаміка / навушників, якщо доступно setSinkId
      const outId = document.getElementById('audio-output-select')?.value;
      if (outId && typeof audio.setSinkId === 'function') {
        audio.setSinkId(outId).catch(() => {});
      }

      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        _currentAudioElem = null;
        if (getState() === 'speaking') setState('sleeping');
        _updateFeedback('😴 Ожидание');
        resolve();
      };

      audio.onerror = (e) => {
        console.warn('[audio] HTML5 Audio error, trying WebAudio fallback:', e);
        URL.revokeObjectURL(audioUrl);
        _currentAudioElem = null;
        // Fallback to Web Audio Buffer
        _playWebAudioPcm(bytes).then(resolve);
      };

      audio.play().catch((playErr) => {
        console.warn('[audio] HTML5 Audio play() rejected:', playErr);
        _playWebAudioPcm(bytes).then(resolve);
      });
    });

  } catch (err) {
    console.error('[audio-player] Playback critical failure:', err);
    setState('sleeping');
  }
}

async function _playWebAudioPcm(bytes) {
  try {
    if (!_audioCtx) {
      _audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
    }
    if (_audioCtx.state === 'suspended') {
      await _audioCtx.resume();
    }

    const int16 = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768.0;

    const buf = _audioCtx.createBuffer(1, float32.length, 24000);
    buf.getChannelData(0).set(float32);

    const source = _audioCtx.createBufferSource();
    source.buffer = buf;
    source.connect(_audioCtx.destination);
    _currentAudioSrc = source;

    return new Promise((resolve) => {
      source.onended = () => {
        _currentAudioSrc = null;
        if (getState() === 'speaking') setState('sleeping');
        resolve();
      };
      source.start(0);
    });
  } catch (e) {
    console.error('[audio-player] WebAudio fallback failed:', e);
    setState('sleeping');
  }
}

export function stopPlayback() {
  if (_currentAudioElem) {
    try {
      _currentAudioElem.pause();
      _currentAudioElem.currentTime = 0;
    } catch (_) {}
    _currentAudioElem = null;
  }
  if (_currentAudioSrc) {
    try { _currentAudioSrc.stop(); } catch (_) {}
    _currentAudioSrc = null;
  }
}

function _updateListenButton(active) {
  const btn = document.getElementById('listen-btn');
  if (btn) btn.dataset.active = active ? 'true' : 'false';
}

function _updateFeedback(text) {
  const el = document.getElementById('live-mic-feedback');
  if (el) el.textContent = text;
}
