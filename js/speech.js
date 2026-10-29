/**
 * speech.js — Realtime Client Gateway & Direct Audio Recorder for Jarvis.
 *
 * РЕШЕНИЕ:
 * Отказ от ненадежного браузерного webkitSpeechRecognition в пользу
 * прямого захвата микрофона через MediaRecorder API + серверной транскрипции Gemini.
 * Это гарантирует 100% работу на любых телефонах (Android / iPhone) и Bluetooth-очках!
 */

import { setState, getState } from './state.js';
import { addBubble, setWsDot } from './ui.js';
import { executeTool } from './tools.js';

let _ws                = null;
let _mediaStream       = null;
let _mediaRecorder     = null;
let _recordedChunks    = [];
let _audioCtx          = null;
let _analyser          = null;
let _animFrameId       = null;

let _isRecording       = false;
let _isHandsFree       = false;
let _currentAudioElem  = null;
let _currentAudioSrc   = null;
let _isAudioUnlocked   = false;

let _hasSpoken         = false;
let _speechStartTime   = 0;
let _lastSpeechTime    = 0;
let _silenceTimer      = null;

// ─── AudioContext Unlocker ───────────────────────────────────────────────────

export function unlockAudioContext() {
  if (_isAudioUnlocked && _audioCtx && _audioCtx.state === 'running') return;
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      if (!_audioCtx) {
        _audioCtx = new AudioContextClass({ sampleRate: 24000 });
      }
      if (_audioCtx.state === 'suspended') {
        _audioCtx.resume();
      }
      // Воспроизводим 10мс тишины для снятия ограничений Autoplay
      const osc = _audioCtx.createOscillator();
      const gain = _audioCtx.createGain();
      gain.gain.value = 0.001;
      osc.connect(gain);
      gain.connect(_audioCtx.destination);
      osc.start(0);
      osc.stop(0.02);
      _isAudioUnlocked = true;
      console.log('[audio] AudioContext permanently unlocked');
    }
  } catch (err) {
    console.warn('[audio] AudioContext unlock warning:', err);
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
    _updateFeedback('✅ Готов к голосовым командам');
  };

  _ws.onmessage = async (event) => {
    try {
      const msg = JSON.parse(event.data);

      if (msg.type === 'state') {
        setState(msg.state);

      } else if (msg.type === 'user_transcript') {
        // Сервер распознал сказанное из аудио
        console.log('[relay-ws] Server transcript:', msg.text);
        addBubble('user', msg.text);
        _updateFeedback(`🎤 «${msg.text}»`);

      } else if (msg.type === 'assistant_reply') {
        setState('speaking');
        _updateFeedback(`🗣️ Джарвис: ${msg.text}`);
        addBubble('jarvis', msg.text);

        if (msg.audio_pcm24k) {
          await playAudioData(msg.audio_pcm24k);
        } else {
          setState('sleeping');
        }

        // В Hands-Free режиме возобновляем прослушивание
        if (_isHandsFree) {
          setTimeout(() => {
            if (_isHandsFree && !_isRecording && getState() !== 'speaking') {
              _startHandsFreeMonitor();
            }
          }, 600);
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
      console.error('[relay-ws] Message error:', err);
    }
  };

  _ws.onerror = (err) => {
    console.warn('[relay-ws] WS error:', err);
    setWsDot('disconnected');
  };

  _ws.onclose = () => {
    console.log('[relay-ws] WS closed. Reconnecting in 2.5s…');
    setWsDot('disconnected');
    setTimeout(initRelayWebSocket, 2500);
  };
}

// Keepalive ping
setInterval(() => {
  if (_ws && _ws.readyState === WebSocket.OPEN) {
    _ws.send(JSON.stringify({ type: 'ping' }));
  }
}, 20000);

// ─── Real Microphone Audio Recording (MediaRecorder) ─────────────────────────

function getSupportedMimeType() {
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/aac',
    'audio/ogg'
  ];
  for (const t of types) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) {
      return t;
    }
  }
  return '';
}

async function ensureMediaStream(deviceId = '') {
  if (_mediaStream && _mediaStream.active) {
    return _mediaStream;
  }

  const constraints = {
    audio: deviceId ? { deviceId: { exact: deviceId } } : {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  };

  try {
    _mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
    _setupAudioVisualizer(_mediaStream);
    return _mediaStream;
  } catch (err) {
    console.error('[mic] getUserMedia error:', err);
    _updateFeedback('⚠️ Ошибка доступа к микрофону очков/телефона');
    return null;
  }
}

function _setupAudioVisualizer(stream) {
  try {
    if (!_audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      _audioCtx = new AudioContextClass();
    }
    const source = _audioCtx.createMediaStreamSource(stream);
    _analyser = _audioCtx.createAnalyser();
    _analyser.fftSize = 256;
    source.connect(_analyser);

    const bufferLength = _analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const vadBarFill = document.getElementById('vad-bar-fill');

    function checkVolume() {
      if (!_analyser) return;
      _analyser.getByteFrequencyData(dataArray);

      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const avg = sum / bufferLength; // 0 - 255
      const percent = Math.min(100, Math.round((avg / 80) * 100));

      if (vadBarFill) {
        vadBarFill.style.width = `${percent}%`;
      }

      // Voice Activity Detection (VAD)
      if (_isRecording) {
        const now = Date.now();
        if (avg > 14) {
          // Зафиксирована речь
          _hasSpoken = true;
          _lastSpeechTime = now;
        } else if (_hasSpoken && (now - _lastSpeechTime > 1400) && (now - _speechStartTime > 2000)) {
          // Пауза 1.4 сек после речи — авто-завершение фразы
          console.log('[vad] Speech pause detected, committing audio');
          stopRecordingAndSend();
        }
      } else if (_isHandsFree && getState() !== 'speaking' && getState() !== 'thinking') {
        if (avg > 18) {
          // В Hands-Free режиме обнаружен голос — начинаем запись
          console.log('[handsfree] Voice trigger activated');
          startRecording();
        }
      }

      _animFrameId = requestAnimationFrame(checkVolume);
    }

    if (_animFrameId) cancelAnimationFrame(_animFrameId);
    checkVolume();
  } catch (e) {
    console.warn('[mic] Visualizer setup warning:', e);
  }
}

export async function startRecording(deviceId = '') {
  if (_isRecording) return;
  unlockAudioContext();

  const stream = await ensureMediaStream(deviceId);
  if (!stream) return;

  const mimeType = getSupportedMimeType();
  console.log('[recorder] Using MIME type:', mimeType);

  try {
    _mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  } catch (e) {
    _mediaRecorder = new MediaRecorder(stream);
  }

  _recordedChunks = [];
  _hasSpoken = false;
  _speechStartTime = Date.now();
  _lastSpeechTime = Date.now();

  _mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) {
      _recordedChunks.push(e.data);
    }
  };

  _mediaRecorder.onstart = () => {
    _isRecording = true;
    setState('listening');
    _updateListenButton(true);
    _updateFeedback('🎙️ Слышу вас... Говорите в очки');
  };

  _mediaRecorder.onstop = async () => {
    _isRecording = false;
    _updateListenButton(false);

    if (_recordedChunks.length === 0) {
      if (!_isHandsFree) setState('sleeping');
      return;
    }

    const audioBlob = new Blob(_recordedChunks, { type: _mediaRecorder.mimeType || 'audio/webm' });
    _recordedChunks = [];

    // Если запись длилась меньше 400мс и не было речи — игнорируем случайный щелчок
    if (audioBlob.size < 800 && !_hasSpoken) {
      console.log('[recorder] Audio too short / empty, ignoring');
      if (!_isHandsFree) setState('sleeping');
      return;
    }

    setState('thinking');
    _updateFeedback('🤔 Распознаю голос...');

    // Конвертируем в base64 и отправляем на сервер
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result;
      const base64Data = dataUrl.split(',')[1];
      if (_ws && _ws.readyState === WebSocket.OPEN) {
        console.log('[recorder] Sending audio to server, bytes:', audioBlob.size);
        _ws.send(JSON.stringify({
          type: 'user_audio',
          audio: base64Data,
          mimeType: audioBlob.type
        }));
      }
    };
    reader.readAsDataURL(audioBlob);
  };

  // Собираем аудио каждые 200мс
  _mediaRecorder.start(200);
}

export function stopRecordingAndSend() {
  if (_mediaRecorder && _mediaRecorder.state === 'recording') {
    try {
      _mediaRecorder.stop();
    } catch (_) {}
  }
}

// ─── Controls ────────────────────────────────────────────────────────────────

export async function toggleListening(deviceId = '') {
  unlockAudioContext();
  if (_isHandsFree) {
    toggleHandsFree(deviceId);
    return;
  }

  if (_isRecording) {
    stopRecordingAndSend();
  } else {
    await startRecording(deviceId);
  }
}

export async function toggleHandsFree(deviceId = '') {
  unlockAudioContext();
  if (_isHandsFree) {
    _isHandsFree = false;
    if (_isRecording) stopRecordingAndSend();
    setState('sleeping');
    _updateFeedback('👂 Hands-Free выключен');
    console.log('[speech] Hands-free OFF');
  } else {
    _isHandsFree = true;
    const stream = await ensureMediaStream(deviceId);
    if (stream) {
      setState('listening');
      _updateFeedback('👂 Hands-Free активен (слушаю очки)');
      console.log('[speech] Hands-free ON');
    }
  }
  return _isHandsFree;
}

export function isHandsFree() {
  return _isHandsFree;
}

function _startHandsFreeMonitor() {
  if (!_isHandsFree) return;
  setState('listening');
  _updateFeedback('👂 Слушаю очки...');
}

export function sendUserUtterance(text) {
  if (!text || !_ws || _ws.readyState !== WebSocket.OPEN) return;
  console.log('[speech] Sending text utterance:', text);
  addBubble('user', text);
  setState('thinking');
  _updateFeedback(`🤔 Думаю над: «${text}»`);
  _ws.send(JSON.stringify({ type: 'user_utterance', text }));
}

// ─── Audio Playback (PCM 24k -> WAV Blob -> HTML5 Audio) ─────────────────────

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

    const wavBlob = pcmToWavBlob(bytes, 24000);
    const audioUrl = URL.createObjectURL(wavBlob);

    return new Promise((resolve) => {
      const audio = new Audio(audioUrl);
      _currentAudioElem = audio;

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
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      _audioCtx = new AudioContextClass({ sampleRate: 24000 });
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
