/**
 * ui.js — DOM updates: orb, state label, chat bubbles, WS dot.
 * Mobile-optimised: interim bubble reuse, auto-scroll, haptic feedback.
 */

import { onStateChange, getState, getStateLabel } from './state.js';

const ORB_EMOJI = {
  sleeping:  '😴',
  listening: '👂',
  thinking:  '🤔',
  speaking:  '🗣️',
  error:     '❌',
};

let _interimBubble = null;  // reuse interim bubble instead of creating new ones

export function initUI() {
  applyState(getState());
  onStateChange(applyState);

  // Clear button
  document.getElementById('clear-btn')?.addEventListener('click', clearChat);
}

function applyState(state) {
  // Orb emoji
  const emoji = document.getElementById('orb-emoji');
  if (emoji) emoji.textContent = ORB_EMOJI[state] ?? '🤖';

  // Orb data-state (CSS handles colours/animations)
  const orbWrap = document.getElementById('status-orb')?.parentElement;
  if (orbWrap) orbWrap.dataset.state = state;

  // State label
  const lbl = document.getElementById('status-label');
  if (lbl) lbl.textContent = getStateLabel(state);

  // Listen button
  const listenBtn = document.getElementById('listen-btn');
  if (listenBtn) listenBtn.dataset.active = (state === 'listening') ? 'true' : 'false';

  // Haptic on state change (mobile)
  if (navigator.vibrate) {
    if (state === 'listening') navigator.vibrate(30);
    if (state === 'speaking')  navigator.vibrate([15, 30, 15]);
    if (state === 'error')     navigator.vibrate([100, 50, 100]);
  }
}

/**
 * Add or update a chat bubble.
 * role: 'user' | 'interim' | 'jarvis' | 'system'
 */
export function addBubble(role, text) {
  const scroll = document.getElementById('transcript-scroll');
  if (!scroll) return;

  // Remove hint
  document.getElementById('chat-hint')?.remove();

  if (role === 'interim') {
    // Reuse or create interim bubble
    if (!_interimBubble || !scroll.contains(_interimBubble)) {
      _interimBubble = _makeBubble('interim');
      scroll.appendChild(_interimBubble);
    }
    _interimBubble.textContent = '…' + text;
    _scrollToBottom(scroll);
    return;
  }

  // Commit interim → user bubble
  if (role === 'user' && _interimBubble && scroll.contains(_interimBubble)) {
    _interimBubble.className = 'bubble bubble--user';
    _interimBubble.textContent = text;
    _interimBubble = null;
    _scrollToBottom(scroll);
    return;
  }

  _interimBubble = null;
  const el = _makeBubble(role);
  el.textContent = text;
  scroll.appendChild(el);
  _scrollToBottom(scroll);
}

function _makeBubble(role) {
  const el = document.createElement('div');
  el.className = `bubble bubble--${role}`;
  return el;
}

function _scrollToBottom(el) {
  requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
}

export function clearChat() {
  const scroll = document.getElementById('transcript-scroll');
  if (!scroll) return;
  scroll.innerHTML = `
    <div class="chat__hint" id="chat-hint">
      <p>👋 Нажмите <strong>👂 Авто</strong> — говорите в очки,<br>Джарвис ответит голосом</p>
    </div>`;
  _interimBubble = null;
}

/** Update WebSocket indicator dot */
export function setWsDot(state) {  // 'connecting' | 'connected' | 'disconnected'
  const dot = document.getElementById('ws-dot');
  if (dot) dot.dataset.state = state;
}
