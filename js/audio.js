/**
 * audio.js — Enumerate and select audio input/output devices.
 * ОНОВЛЕНО: Додано експорт getSelectedInputId для VAD.
 */

const inputSelect  = () => document.getElementById('audio-input-select');
const outputSelect = () => document.getElementById('audio-output-select');

let _selectedInputId  = '';
let _selectedOutputId = '';

export function getSelectedInputId()  { return _selectedInputId; }
export function getSelectedOutputId() { return _selectedOutputId; }

/**
 * Request microphone permission and populate device lists.
 */
export async function initAudioDevices() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(t => t.stop());

    await refreshDeviceList();
    navigator.mediaDevices.addEventListener('devicechange', refreshDeviceList);
  } catch (err) {
    console.error('[audio] Microphone permission denied:', err);
    setFallbackOption(inputSelect(),  'Нет доступа к микрофону');
    setFallbackOption(outputSelect(), 'Нет доступа');
  }
}

async function refreshDeviceList() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const inputs  = devices.filter(d => d.kind === 'audioinput');
  const outputs = devices.filter(d => d.kind === 'audiooutput');

  populateSelect(inputSelect(),  inputs,  _selectedInputId,  id => { _selectedInputId  = id; });
  populateSelect(outputSelect(), outputs, _selectedOutputId, id => { _selectedOutputId = id; });
}

function populateSelect(select, devices, currentId, onChange) {
  if (!select) return;
  select.innerHTML = '';

  if (devices.length === 0) {
    setFallbackOption(select, 'Не найдено');
    return;
  }

  devices.forEach((d, i) => {
    const opt        = document.createElement('option');
    opt.value        = d.deviceId;
    opt.textContent  = d.label || `Устройство ${i + 1}`;
    if (d.deviceId === currentId) opt.selected = true;
    select.appendChild(opt);
  });

  // Default: first device
  if (!currentId && select.options.length) {
    onChange(select.options[0].value);
  }

  // Persit on change
  select.addEventListener('change', (e) => onChange(e.target.value));
}

function setFallbackOption(select, label) {
  if (!select) return;
  select.innerHTML = `<option value="">${label}</option>`;
}
