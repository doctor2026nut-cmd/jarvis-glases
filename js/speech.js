/**
 * speech.js — Realtime Client Gateway for Jarvis Glasses Assistant (T03).
 *
 * Connects web client with server.py relay:
 * - Uses Web Speech API for low-latency recognition
 * - Streams user utterances to server.py relay
 * - Handles real-time state changes (listening -> thinking -> speaking)
 * - Plays high-fidelity 24kHz PCM audio responses from Gemini TTS
 * - Supports barge-in interruption and client-side tool execution (T05)
 */

import { setState, getState } from './state.js';
import { addBubble } from './ui.js';
import { executeTool } from './tools.js';

let _ws = null;
let _recognition = null;
let _isListening = false;
let _audioCtx = null;
let _currentAudioSource = null;

/**
 * Initialize WebSocket connection to server relay.
 */
export function initRelayWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  _ws = new WebSocket(wsUrl);

  _ws.onopen = () => {
    console.log('[relay-ws] Connected to Jarvis server relay');
  };

  _ws.onmessage = async (event) => {
    try {
      const msg = JSON.parse(event.data);

      if (msg.type === 'state') {
        setState(msg.state);
      } else if (msg.type === 'assistant_reply') {
        setState('speaking');
        addBubble('jarvis', msg.text);

        if (msg.audio_pcm24k) {
          await playPcm24kAudio(msg.audio_pcm24k);
        } else {
          setState('sleeping');
        }
      } else if (msg.type === 'execute_tool') {
        // Execute tool locally
        console.log(`[relay-ws] Model requested tool: ${msg.name}`);
        const toolResult = await executeTool(msg.name, msg.args);

        // Send output back to complete response
        _ws.send(JSON.stringify({
          type: 'tool_response',
          name: msg.name,
          candidate: msg.candidate,
          result: toolResult
        }));
      } else if (msg.type === 'error') {
        console.error('[relay-ws] Server error:', msg.message);
        setState('error');
        setTimeout(() => setState('sleeping'), 3000);
      }
    } catch (err) {
      console.error('[relay-ws] Error handling message:', err);
    }
  };

  _ws.onerror = (err) => {
    console.warn('[relay-ws] WebSocket error:', err);
  };

  _ws.onclose = () => {
    console.log('[relay-ws] Connection closed. Reconnecting in 2s...');
    setTimeout(initRelayWebSocket, 2000);
  };
}

/** Play raw 24kHz PCM linear audio received from Gemini */
async function playPcm24kAudio(base64Data) {
  try {
    if (!_audioCtx) {
      _audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
    }
    if (_audioCtx.state === 'suspended') {
      await _audioCtx.resume();
    }

    // Stop any playing sound
    stopPlayback();

    const binary = atob(base64Data);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const int16Array = new Int16Array(bytes.buffer);
    const float32Array = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i++) {
      float32Array[i] = int16Array[i] / 32768.0;
    }

    const audioBuffer = _audioCtx.createBuffer(1, float32Array.length, 24000);
    audioBuffer.getChannelData(0).set(float32Array);

    const source = _audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(_audioCtx.destination);

    _currentAudioSource = source;

    return new Promise((resolve) => {
      source.onended = () => {
        _currentAudioSource = null;
        if (getState() === 'speaking') {
          setState('sleeping');
        }
        resolve();
      };
      source.start(0);
    });
  } catch (e) {
    console.error('[audio-player] Failed to play PCM audio:', e);
    setState('sleeping');
  }
}

function stopPlayback() {
  if (_currentAudioSource) {
    try {
      _currentAudioSource.stop();
    } catch (_) {}
    _currentAudioSource = null;
  }
}

/** Initialise Speech Recognition */
function getRecognition() {
  if (_recognition) return _recognition;

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.error('[speech] SpeechRecognition not available');
    return null;
  }

  const rec = new SpeechRecognition();
  rec.lang = 'ru-RU';
  rec.continuous = false;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  rec.addEventListener('result', (event) => {
    // If speaking, user interrupted (barge-in)
    if (getState() === 'speaking') {
      stopPlayback();
      if (_ws && _ws.readyState === WebSocket.OPEN) {
        _ws.send(JSON.stringify({ type: 'barge_in' }));
      }
      setState('listening');
    }

    const result = event.results[event.results.length - 1];
    const text = result[0].transcript.trim();

    if (result.isFinal && text) {
      addBubble('user', text);
      setState('thinking');

      if (_ws && _ws.readyState === WebSocket.OPEN) {
        _ws.send(JSON.stringify({
          type: 'user_utterance',
          text: text
        }));
      } else {
        console.warn('[speech] WebSocket not open');
        setState('error');
      }
    }
  });

  rec.addEventListener('end', () => {
    _isListening = false;
    if (getState() === 'listening') {
      setState('sleeping');
    }
  });

  rec.addEventListener('error', (event) => {
    console.warn('[speech] Recognition error:', event.error);
    _isListening = false;
    if (event.error === 'not-allowed') {
      setState('error');
    } else {
      if (getState() === 'listening') setState('sleeping');
    }
  });

  _recognition = rec;
  return rec;
}

export function toggleListening() {
  _isListening ? stopListening() : startListening();
}

export function startListening() {
  // If assistant is currently speaking, barge-in stops it immediately
  if (getState() === 'speaking') {
    stopPlayback();
    if (_ws && _ws.readyState === WebSocket.OPEN) {
      _ws.send(JSON.stringify({ type: 'barge_in' }));
    }
  }

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
    console.warn('[speech] start error:', e);
  }
}

export function stopListening() {
  if (_recognition) {
    _recognition.stop();
  }
  _isListening = false;
}
