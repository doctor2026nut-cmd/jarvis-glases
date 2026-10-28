/**
 * app.js — Entry point for Jarvis Glasses Assistant web prototype.
 */

import { initAudioDevices } from './audio.js';
import { toggleListening }  from './speech.js';
import { initUI }           from './ui.js';

async function boot() {
  console.log('[jarvis] Booting…');

  // 1. Bind UI to state machine.
  initUI();

  // 2. Enumerate microphones & speakers.
  await initAudioDevices();

  // 3. Wire up listen button.
  const btn = document.getElementById('listen-btn');
  btn.addEventListener('click', () => toggleListening());

  console.log('[jarvis] Ready.');
}

document.addEventListener('DOMContentLoaded', boot);
