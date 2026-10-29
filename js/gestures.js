/**
 * gestures.js — Dynamic Hardware Gesture & Button Remapper.
 * Allows user to configure custom actions for Left and Right temples in UI.
 */

const STORAGE_KEY = 'jarvis_glasses_gestures';

export const DEFAULT_GESTURES = {
  left_single: 'media_play_pause',
  left_double: 'quick_note',
  left_triple: 'open_translator',
  left_long: 'ask_muse',
  right_single: 'media_play_pause',
  right_double: 'next_track',
  right_triple: 'activate_jarvis',
  right_long: 'ask_antigravity'
};

export const ACTION_NAMES = {
  activate_jarvis: '🤖 Голосовой Джарвис (AI)',
  open_translator: '🌐 Синхронный переводчик',
  quick_note: '📝 AI Заметка / Диктофон',
  ask_muse: '🧠 Поручение Музе (Meta Muse)',
  ask_antigravity: '💻 Задачи на сервере (Антигравити)',
  media_play_pause: '⏸️ Пауза / Воспроизведение',
  next_track: '⏭️ Следующий трек',
  prev_track: '⏮️ Предыдущий трек'
};

export function loadGestureConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULT_GESTURES, ...JSON.parse(raw) } : { ...DEFAULT_GESTURES };
  } catch (_) {
    return { ...DEFAULT_GESTURES };
  }
}

export function saveGestureConfig(config) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    console.log('[gestures] Saved custom gestures:', config);
  } catch (e) {
    console.error('[gestures] Failed to save config:', e);
  }
}

export function executeGestureAction(actionId) {
  console.log(`[gestures] Executing action: ${actionId}`);
  switch (actionId) {
    case 'activate_jarvis': {
      import('./speech.js').then(s => s.startListening());
      break;
    }
    case 'open_translator': {
      alert('🌐 Активирован режим синхронного переводчика прямо в ухо!');
      break;
    }
    case 'quick_note': {
      alert('📝 Диктофон включен. Назовите заметку...');
      break;
    }
    case 'ask_muse': {
      alert('🧠 Отправка запроса Музе через шлюз agent-master...');
      break;
    }
    case 'ask_antigravity': {
      alert('💻 Проверка задач и кода на сервере Антигравити...');
      break;
    }
    case 'media_play_pause': {
      console.log('[media] Toggle Play/Pause');
      break;
    }
    default:
      console.log(`[gestures] Action ${actionId} triggered`);
  }
}
