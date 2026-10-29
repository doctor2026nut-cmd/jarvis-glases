import { loadGestureConfig, saveGestureConfig, ACTION_NAMES, executeGestureAction } from './gestures.js';
import { initAudioDevices, getSelectedInputId } from './audio.js';
import { toggleListening, initRelayWebSocket, toggleHandsFree, isHandsFree, sendUserUtterance, unlockAudioContext } from './speech.js';
import { initUI } from './ui.js';

function setupGestureSettings() {
  const modal = document.getElementById('settings-modal');
  const openBtn = document.getElementById('open-settings-btn');
  const closeBtn = document.getElementById('close-settings-btn');
  const saveBtn = document.getElementById('save-settings-btn');
  const tabBtns = document.querySelectorAll('.tab-btn');

  if (!modal || !openBtn) return;

  const currentConfig = loadGestureConfig();

  // Populate selects
  ['left_single', 'left_double', 'left_triple', 'left_long',
   'right_single', 'right_double', 'right_triple', 'right_long'].forEach(key => {
    const sel = document.getElementById('sel-' + key);
    if (!sel) return;
    sel.innerHTML = '';
    Object.entries(ACTION_NAMES).forEach(([val, label]) => {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = label;
      if (currentConfig[key] === val) opt.selected = true;
      sel.appendChild(opt);
    });
  });

  openBtn.addEventListener('click', () => { modal.style.display = 'flex'; });
  closeBtn.addEventListener('click', () => { modal.style.display = 'none'; });

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('tab-btn--active'));
      btn.classList.add('tab-btn--active');
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('tab-content--active'));
      document.getElementById(btn.dataset.tab).classList.add('tab-content--active');
    });
  });

  saveBtn.addEventListener('click', () => {
    const newConfig = {};
    ['left_single', 'left_double', 'left_triple', 'left_long',
     'right_single', 'right_double', 'right_triple', 'right_long'].forEach(key => {
      const sel = document.getElementById('sel-' + key);
      if (sel) newConfig[key] = sel.value;
    });
    saveGestureConfig(newConfig);
    modal.style.display = 'none';
    alert('✅ Раскладка кнопок очков сохранена!');
  });
}

function setupMediaSession() {
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: 'Jarvis Voice Assistant',
      artist: 'Roman Glasses',
      album: 'I CLUB AI'
    });

    navigator.mediaSession.setActionHandler('play', () => {
      console.log('[media-session] Glasses button: Play');
      executeGestureAction('activate_jarvis');
    });

    navigator.mediaSession.setActionHandler('pause', () => {
      console.log('[media-session] Glasses button: Pause');
      toggleListening();
    });

    navigator.mediaSession.setActionHandler('nexttrack', () => {
      console.log('[media-session] Glasses button: Next track / Gesture');
      const cfg = loadGestureConfig();
      executeGestureAction(cfg.right_double || 'next_track');
    });

    navigator.mediaSession.setActionHandler('previoustrack', () => {
      console.log('[media-session] Glasses button: Prev track / Gesture');
      const cfg = loadGestureConfig();
      executeGestureAction(cfg.left_double || 'quick_note');
    });
  }
}

async function boot() {
  console.log('[jarvis] Booting mobile voice engine…');

  // 1. Ініціалізація UI
  initUI();

  // 2. Налаштування кнопок окулярів
  setupGestureSettings();
  setupMediaSession();

  // 3. Підключення до WebSocket релея
  initRelayWebSocket();

  // 4. Сканування мікрофонів і навушників/окулярів (Bluetooth SCO/A2DP)
  await initAudioDevices();

  // 5. Кнопка ручного запису
  const listenBtn = document.getElementById('listen-btn');
  if (listenBtn) {
    listenBtn.addEventListener('click', () => {
      unlockAudioContext();
      toggleListening(getSelectedInputId());
    });
  }

  // 6. Кнопка Hands-Free (VAD / Auto-listen)
  const hfBtn = document.getElementById('hands-free-btn');
  if (hfBtn) {
    hfBtn.addEventListener('click', async () => {
      unlockAudioContext();
      try {
        const active = await toggleHandsFree(getSelectedInputId());
        hfBtn.dataset.active = active ? 'true' : 'false';
        const lbl = hfBtn.querySelector('.ctrl-btn__label');
        if (lbl) lbl.textContent = active ? 'Вкл' : 'Авто';
      } catch (err) {
        console.error('[app] Hands-free toggle error:', err);
        alert('Потрібен дозвіл на мікрофон у браузері для Hands-Free режиму');
      }
    });
  }

  // 7. Кнопка налаштувань пристроїв (toggle панелі вибору мікрофона/динаміка)
  const settingsBtn = document.getElementById('settings-btn');
  const devicesRow = document.getElementById('devices-row');
  if (settingsBtn && devicesRow) {
    settingsBtn.addEventListener('click', () => {
      const isOpen = devicesRow.classList.toggle('open');
      settingsBtn.dataset.active = isOpen ? 'true' : 'false';
    });
  }

  // 8. Текстова форма та швидкі чіпи
  const chatForm = document.getElementById('chat-form');
  const chatInput = document.getElementById('chat-input');
  if (chatForm && chatInput) {
    chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      unlockAudioContext();
      const val = chatInput.value.trim();
      if (val) {
        sendUserUtterance(val);
        chatInput.value = '';
      }
    });
  }

  document.querySelectorAll('.chip-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      unlockAudioContext();
      const prompt = btn.dataset.prompt;
      if (prompt) {
        sendUserUtterance(prompt);
      }
    });
  });

  // 9. Розблокування аудіо-контексту при будь-якому тапі на сторінку
  const handleUserGesture = () => {
    unlockAudioContext();
  };
  window.addEventListener('click', handleUserGesture, { passive: true });
  window.addEventListener('touchstart', handleUserGesture, { passive: true });

  // 10. Реєстрація Service Worker (PWA)
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      console.log('[jarvis] Service Worker registered:', reg.scope);
      // Примусове оновлення SW
      reg.update();
    } catch (err) {
      console.warn('[jarvis] Service Worker registration failed:', err);
    }
  }

  console.log('[jarvis] Mobile PWA fully initialized 🚀');
}

document.addEventListener('DOMContentLoaded', boot);
