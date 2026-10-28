/**
 * state.js — Centralised reactive state for Jarvis assistant.
 *
 * States: sleeping | listening | thinking | speaking | error
 */

const VALID_STATES = ['sleeping', 'listening', 'thinking', 'speaking', 'error'];

const STATE_LABELS = {
  sleeping:  'Спит',
  listening: 'Слушает…',
  thinking:  'Думает…',
  speaking:  'Говорит…',
  error:     'Ошибка',
};

let _currentState = 'sleeping';
const _listeners = new Set();

/**
 * Subscribe to state changes.
 * @param {(state: string) => void} fn
 * @returns {() => void} unsubscribe function
 */
export function onStateChange(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

/** Get current state. */
export function getState() {
  return _currentState;
}

/** Get human-readable label for a state. */
export function getStateLabel(state = _currentState) {
  return STATE_LABELS[state] ?? state;
}

/**
 * Transition to a new state.
 * @param {string} next
 */
export function setState(next) {
  if (!VALID_STATES.includes(next)) {
    console.warn(`[state] Unknown state: "${next}"`);
    return;
  }
  if (next === _currentState) return;

  const prev = _currentState;
  _currentState = next;
  console.log(`[state] ${prev} → ${next}`);
  for (const fn of _listeners) {
    try { fn(next, prev); } catch (e) { console.error('[state] Listener error:', e); }
  }
}
