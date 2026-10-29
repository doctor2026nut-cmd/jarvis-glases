
import { loadGestureConfig, saveGestureConfig, ACTION_NAMES, executeGestureAction } from './gestures.js';

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

/**
 * app.js — Головна точка входу мобільного клієнта Jarvis.
 * Повна адаптація під смартфони та розумні окуляри (Hands-Free VAD, Bluetooth, PWA).
 */

import { initAudioDevices, getSelectedInputId } from './audio.js';
import { toggleListening, initRelayWebSocket, toggleHandsFree, isHandsFree } from './speech.js';
import { initUI }  from './ui.js';

async function boot() {
  console.log('[jarvis] Booting mobile engine…');

  // 1. Ініціалізація UI
  initUI();

  // 2. Підключення до WebSocket релея
  initRelayWebSocket();

  // 3. Сканування мікрофонів і навушників/окулярів (Bluetooth SCO/A2DP)
  await initAudioDevices();

  // 4. Кнопка ручного запису
  const listenBtn = document.getElementById('listen-btn');
  if (listenBtn) {
    listenBtn.addEventListener('click', () => {
      toggleListening(getSelectedInputId());
    });
  }

  // 5. Кнопка Hands-Free (VAD)
  const hfBtn = document.getElementById('hands-free-btn');
  if (hfBtn) {
    hfBtn.addEventListener('click', async () => {
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

  // 6. Кнопка налаштувань пристроїв (toggle панелі вибору мікрофона/динаміка)
  const settingsBtn = document.getElementById('settings-btn');
  const devicesRow = document.getElementById('devices-row');
  if (settingsBtn && devicesRow) {
    settingsBtn.addEventListener('click', () => {
      const isOpen = devicesRow.classList.toggle('open');
      settingsBtn.dataset.active = isOpen ? 'true' : 'false';
    });
  }

  // 7. Реєстрація Service Worker (PWA)
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('sw.js');
      console.log('[jarvis] Service Worker registered');
    } catch (err) {
      console.warn('[jarvis] Service Worker registration failed:', err);
    }
  }

  // 8. Розблокування аудіо-контексту при першому кліку (iOS / Android Audio Unlock)
  document.addEventListener('click', _unlockAudio, { once: true });
  document.addEventListener('touchstart', _unlockAudio, { once: true });

  console.log('[jarvis] Mobile PWA fully initialized 🚀');
}

function _unlockAudio() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') {
      ctx.resume().then(() => ctx.close());
    } else {
      ctx.close();
    }
  } catch (_) {}
}

document.addEventListener('DOMContentLoaded', boot);
