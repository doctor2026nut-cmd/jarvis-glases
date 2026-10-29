import { loadGestureConfig, saveGestureConfig, ACTION_NAMES, executeGestureAction } from './gestures.js';
import { initAudioDevices, getSelectedInputId, requestMicPermission } from './audio.js';
import { toggleListening, initRelayWebSocket, toggleHandsFree, sendUserUtterance, unlockAudioContext } from './speech.js';
import { initUI } from './ui.js';

function setupGestureSettings() {
  try {
    const modal = document.getElementById('settings-modal');
    const openBtn = document.getElementById('open-settings-btn');
    const closeBtn = document.getElementById('close-settings-btn');
    const saveBtn = document.getElementById('save-settings-btn');
    const tabBtns = document.querySelectorAll('.tab-btn');

    if (!modal || !openBtn) return;

    const currentConfig = loadGestureConfig();

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
    if (closeBtn) closeBtn.addEventListener('click', () => { modal.style.display = 'none'; });

    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('tab-btn--active'));
        btn.classList.add('tab-btn--active');
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('tab-content--active'));
        const target = document.getElementById(btn.dataset.tab);
        if (target) target.classList.add('tab-content--active');
      });
    });

    if (saveBtn) {
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
  } catch (err) {
    console.warn('[app] setupGestureSettings warning:', err);
  }
}

function setupMediaSession() {
  try {
    if ('mediaSession' in navigator && window.MediaMetadata) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: 'Jarvis Voice Assistant',
        artist: 'Glasses AI',
        album: 'I CLUB'
      });

      const safeSetHandler = (action, handler) => {
        try { navigator.mediaSession.setActionHandler(action, handler); } catch (_) {}
      };

      safeSetHandler('play', () => executeGestureAction('activate_jarvis'));
      safeSetHandler('pause', () => toggleListening());
      safeSetHandler('nexttrack', () => {
        const cfg = loadGestureConfig();
        executeGestureAction(cfg.right_double || 'next_track');
      });
      safeSetHandler('previoustrack', () => {
        const cfg = loadGestureConfig();
        executeGestureAction(cfg.left_double || 'quick_note');
      });
    }
  } catch (e) {
    console.warn('[media-session] Setup warning:', e);
  }
}

function boot() {
  console.log('[jarvis] Booting mobile voice engine…');

  // 1. Ініціалізація UI
  try {
    initUI();
  } catch (e) {
    console.error('[jarvis] initUI error:', e);
  }

  // 2. Налаштування кнопок управління (Всі слухачі вішаються негайно!)
  const listenBtn = document.getElementById('listen-btn');
  if (listenBtn) {
    listenBtn.addEventListener('click', async () => {
      unlockAudioContext();
      await requestMicPermission();
      toggleListening(getSelectedInputId());
    });
  }

  const hfBtn = document.getElementById('hands-free-btn');
  if (hfBtn) {
    hfBtn.addEventListener('click', async () => {
      unlockAudioContext();
      await requestMicPermission();
      try {
        const active = await toggleHandsFree(getSelectedInputId());
        hfBtn.dataset.active = active ? 'true' : 'false';
        const lbl = hfBtn.querySelector('.ctrl-btn__label');
        if (lbl) lbl.textContent = active ? 'Вкл' : 'Авто';
      } catch (err) {
        console.error('[app] Hands-free toggle error:', err);
      }
    });
  }

  const settingsBtn = document.getElementById('settings-btn');
  const devicesRow = document.getElementById('devices-row');
  if (settingsBtn && devicesRow) {
    settingsBtn.addEventListener('click', () => {
      const isOpen = devicesRow.classList.toggle('open');
      settingsBtn.dataset.active = isOpen ? 'true' : 'false';
    });
  }

  // 3. Форма текстового вводу та швидкі кнопки
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

  // 4. Глобальне розблокування аудіо при першому дотику
  const unlockAudio = () => {
    unlockAudioContext();
  };
  window.addEventListener('click', unlockAudio, { passive: true });
  window.addEventListener('touchstart', unlockAudio, { passive: true });

  // 5. Підключення до WebSocket релея
  try {
    initRelayWebSocket();
  } catch (e) {
    console.error('[jarvis] initRelayWebSocket error:', e);
  }

  // 6. Сенсори очок та фонова реєстрація пристроїв
  setupGestureSettings();
  setupMediaSession();
  initAudioDevices().catch(() => {});

  // 7. Реєстрація Service Worker (PWA)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js?v=6').then(reg => {
      console.log('[jarvis] Service Worker active');
      reg.update();
    }).catch(err => {
      console.warn('[jarvis] SW error:', err);
    });
  }

  console.log('[jarvis] Engine booted successfully ✅');
}

// Запуск негайно або при завантаженні DOM
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
