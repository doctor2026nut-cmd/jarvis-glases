/**
 * ui.js — DOM updates: status orb, label, transcript bubbles, button state.
 */

import { onStateChange, getState, getStateLabel } from './state.js';

const orb       = () => document.getElementById('status-orb');
const label     = () => document.getElementById('status-label');
const btn       = () => document.getElementById('listen-btn');
const scroll    = () => document.getElementById('transcript-scroll');

/**
 * Bind UI to reactive state.
 */
export function initUI() {
  // Set initial visual state.
  applyState(getState());

  // React to every state change.
  onStateChange((state) => applyState(state));
}

function applyState(state) {
  const orbEl   = orb();
  const labelEl = label();
  const btnEl   = btn();

  if (orbEl)   orbEl.dataset.state = state;
  if (labelEl) {
    labelEl.textContent = getStateLabel(state);
    labelEl.style.color = getComputedStyle(orbEl).backgroundColor;
  }
  if (btnEl)   btnEl.dataset.active = (state === 'listening') ? 'true' : 'false';
}

/**
 * Add a chat bubble to the transcript.
 * @param {'user'|'jarvis'} role
 * @param {string} text
 */
export function addBubble(role, text) {
  const container = scroll();
  if (!container) return;

  // Remove placeholder if present.
  const placeholder = container.querySelector('.transcript__placeholder');
  if (placeholder) placeholder.remove();

  const div = document.createElement('div');
  div.classList.add('transcript__bubble', `transcript__bubble--${role}`);
  div.textContent = text;
  container.appendChild(div);

  // Auto-scroll to bottom.
  container.scrollTop = container.scrollHeight;
}
