/**
 * audio.js — Enumerate and select audio input/output devices.
 */

const inputSelect  = () => document.getElementById('audio-input-select');
const outputSelect = () => document.getElementById('audio-output-select');

let _selectedInputId  = '';
let _selectedOutputId = '';

/**
 * Request microphone permission and populate device lists.
 */
export async function initAudioDevices() {
  try {
    // Need at least one getUserMedia call so labels are visible.
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(t => t.stop());

    await refreshDeviceList();

    // Re-populate when devices change (e.g., Bluetooth headset connected).
    navigator.mediaDevices.addEventListener('devicechange', refreshDeviceList);
  } catch (err) {
    console.error('[audio] Failed to get microphone permission:', err);
    setFallbackOption(inputSelect(),  'Нет доступа к микрофону');
    setFallbackOption(outputSelect(), 'Нет доступа');
  }
}

async function refreshDeviceList() {
  const devices = await navigator.mediaDevices.enumerateDevices();

  const inputs  = devices.filter(d => d.kind === 'audioinput');
  const outputs = devices.filter(d => d.kind === 'audiooutput');

  populateSelect(inputSelect(),  inputs,  _selectedInputId);
  populateSelect(outputSelect(), outputs, _selectedOutputId);

  // Persist selections.
  inputSelect().addEventListener('change',  (e) => { _selectedInputId  = e.target.value; });
  outputSelect().addEventListener('change', (e) => { _selectedOutputId = e.target.value; });
}

/**
 * @param {HTMLSelectElement} select
 * @param {MediaDeviceInfo[]} devices
 * @param {string} currentId
 */
function populateSelect(select, devices, currentId) {
  select.innerHTML = '';

  if (devices.length === 0) {
    setFallbackOption(select, 'Не найдено');
    return;
  }

  devices.forEach((d, i) => {
    const opt = document.createElement('option');
    opt.value = d.deviceId;
    opt.textContent = d.label || `Устройство ${i + 1}`;
    if (d.deviceId === currentId) opt.selected = true;
    select.appendChild(opt);
  });

  // If nothing was previously selected, pick the first.
  if (!currentId) {
    const selEl = select;
    if (selEl.options.length) {
      if (select === inputSelect())  _selectedInputId  = selEl.options[0].value;
      if (select === outputSelect()) _selectedOutputId = selEl.options[0].value;
    }
  }
}

function setFallbackOption(select, text) {
  select.innerHTML = `<option value="">${text}</option>`;
}

/** Get currently selected input device ID. */
export function getSelectedInputId() {
  return inputSelect()?.value ?? _selectedInputId;
}

/** Get currently selected output device ID. */
export function getSelectedOutputId() {
  return outputSelect()?.value ?? _selectedOutputId;
}
