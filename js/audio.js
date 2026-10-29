/**
 * audio.js — Enumerate and select audio input/output devices.
 * Safe non-blocking device detection for mobile browsers.
 */

const inputSelect  = () => document.getElementById('audio-input-select');
const outputSelect = () => document.getElementById('audio-output-select');

let _selectedInputId  = '';
let _selectedOutputId = '';

export function getSelectedInputId()  { return _selectedInputId; }
export function getSelectedOutputId() { return _selectedOutputId; }

/**
 * Enumerate available audio devices safely without blocking permission dialogs.
 */
export async function initAudioDevices() {
  try {
    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
      await refreshDeviceList();
      try {
        navigator.mediaDevices.addEventListener('devicechange', refreshDeviceList);
      } catch (_) {}
    }
  } catch (err) {
    console.warn('[audio] Non-critical device enumeration warning:', err);
  }
}

export async function requestMicPermission() {
  try {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      await refreshDeviceList();
      return true;
    }
  } catch (err) {
    console.warn('[audio] Microphone permission request failed:', err);
    return false;
  }
  return false;
}

async function refreshDeviceList() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs  = devices.filter(d => d.kind === 'audioinput');
    const outputs = devices.filter(d => d.kind === 'audiooutput');

    populateSelect(inputSelect(),  inputs,  _selectedInputId,  id => { _selectedInputId  = id; });
    populateSelect(outputSelect(), outputs, _selectedOutputId, id => { _selectedOutputId = id; });
  } catch (err) {
    console.warn('[audio] refreshDeviceList error:', err);
  }
}

function populateSelect(select, devices, currentId, onChange) {
  if (!select) return;
  select.innerHTML = '';

  if (devices.length === 0) {
    setFallbackOption(select, 'По умолчанию');
    return;
  }

  devices.forEach((d, i) => {
    const opt        = document.createElement('option');
    opt.value        = d.deviceId;
    opt.textContent  = d.label || `Устройство ${i + 1}`;
    if (d.deviceId === currentId) opt.selected = true;
    select.appendChild(opt);
  });

  if (!currentId && select.options.length) {
    onChange(select.options[0].value);
  }

  select.addEventListener('change', (e) => onChange(e.target.value));
}

function setFallbackOption(select, label) {
  if (!select) return;
  select.innerHTML = `<option value="">${label}</option>`;
}
