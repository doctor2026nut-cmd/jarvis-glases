/**
 * app.js — Entry point for Jarvis Glasses Assistant web prototype.
 */

import { initAudioDevices } from './audio.js';
import { toggleListening, initRelayWebSocket } from './speech.js';
import { initUI }           from './ui.js';

async function boot() {
  console.log('[jarvis] Booting…');

  // 1. Bind UI to state machine.
  initUI();

  // 2. Connect to backend relay WebSocket (T02/T03).
  initRelayWebSocket();

  // 3. Enumerate microphones & speakers.
  await initAudioDevices();

  // 4. Wire up listen button.
  const btn = document.getElementById('listen-btn');
  btn.addEventListener('click', () => toggleListening());

  console.log('[jarvis] Ready.');
}

document.addEventListener('DOMContentLoaded', boot);
