import { seal, unseal, embed, extract, capacity, envelopeSize, MAX_PAYLOAD } from './steg.js';

const $ = id => document.getElementById(id);
const encode = new TextEncoder();
const state = { mode: 'hide', type: 'text', image: null, name: '', payload: { file: null, audio: null }, busy: false, output: null, history: [], resultUrl: null, loadId: 0 };
const format = size => size < 1024 ? `${size} B` : size < 1048576 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1048576).toFixed(2)} MB`;

function status(text, error = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', error);
  $('status').hidden = !text;
}
function resetResult() {
  $('result').hidden = true;
  $('recovered-text').hidden = true;
  $('recovered-text').textContent = '';
  $('recovered-audio').pause();
  $('recovered-audio').removeAttribute('src');
  $('recovered-audio').hidden = true;
  if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
  state.resultUrl = null;
  state.output = null;
}
function setBusy(value) {
  state.busy = value;
  document.querySelectorAll('form button, form input, form textarea, [data-mode], #theme, #use-result').forEach(el => { el.disabled = value; });
  $('run-label').textContent = value ? (state.mode === 'hide' ? 'Encrypting your secret…' : 'Unlocking your image…') : state.mode === 'hide' ? 'Encrypt & hide data' : 'Unlock & reveal data';
  $('workspace-form').setAttribute('aria-busy', String(value));
}

function switchMode(mode) {
  if (state.busy || !['hide', 'reveal'].includes(mode)) return;
  state.mode = mode;
  state.loadId++;
  state.image = null;
  state.name = '';
  $('cover-input').value = '';
  $('passphrase').value = '';
  $('passphrase').minLength = mode === 'hide' ? 8 : 1;
  $('passphrase').type = 'password';
  $('password-toggle').textContent = 'Show';
  $('password-toggle').setAttribute('aria-label', 'Show passphrase');
  $('password-toggle').setAttribute('aria-pressed', 'false');
  $('strength').textContent = mode === 'hide' ? 'Use at least 8 characters. A longer phrase is better.' : 'Use the exact passphrase from the sender.';
  $('payload-step').hidden = mode === 'reveal';
  $('demo-cover').hidden = mode === 'reveal';
  $('password-number').textContent = mode === 'hide' ? '03' : '02';
  $('page-title').replaceChildren();
  const emphasis = document.createElement('em');
  emphasis.textContent = mode === 'hide' ? 'keeping.' : 'inside.';
  $('page-title').append(mode === 'hide' ? 'A secret worth ' : 'Find the story ', emphasis);
  $('page-description').textContent = mode === 'hide' ? 'Hide a message, a file, or a little something inside an image. Only the right passphrase brings it back.' : 'Some images hold a little more than meets the eye. Unlock an original PNG with its secret passphrase.';
  $('crumb').textContent = mode === 'hide' ? 'Hide data' : 'Reveal data';
  $('workflow-title').textContent = mode === 'hide' ? 'Create your hidden message' : 'Recover your hidden message';
  $('image-heading').textContent = mode === 'hide' ? 'Choose your canvas' : 'Choose your encoded image';
  $('image-description').textContent = mode === 'hide' ? 'An ordinary image. An extraordinary hiding place.' : 'Use the original PNG exported from this web app.';
  $('cover-input').accept = mode === 'hide' ? 'image/png,image/jpeg,image/webp,image/bmp' : 'image/png';
  $('drop-subtitle').textContent = mode === 'hide' ? 'PNG, JPG, WebP or BMP · up to 25 MB / 16 megapixels' : 'Original PNG · up to 25 MB / 16 megapixels';
  $('run-label').textContent = mode === 'hide' ? 'Encrypt & hide data' : 'Unlock & reveal data';
  document.querySelectorAll('[data-mode]').forEach(button => {
    const active = button.dataset.mode === mode;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  resetResult(); status(''); updatePreview();
}

function getMeta() {
  const file = state.payload[state.type];
  return { type: state.type, name: state.type === 'text' ? 'secret-message.txt' : (file?.name || 'secret-file'), mime: state.type === 'text' ? 'text/plain;charset=utf-8' : file?.type || 'application/octet-stream' };
}
function payloadSize() { return state.type === 'text' ? encode.encode($('secret-text').value).length : state.payload[state.type]?.size || 0; }
function updateCapacity() {
  const raw = payloadSize();
  $('text-count').textContent = `${format(encode.encode($('secret-text').value).length)}`;
  const total = state.image ? capacity(state.image.data) : 0;
  const size = state.mode === 'hide' && raw ? envelopeSize(raw, getMeta()) : 0;
  const percent = total ? size / total * 100 : 0;
  $('space-used').textContent = state.mode === 'reveal' ? 'Read on unlock' : `${percent > 0 && percent < 1 ? '<1' : Math.round(percent)}%`;
  $('capacity-bar').value = Math.min(100, percent);
  $('capacity-bar').classList.toggle('over', size > total && total > 0);
  $('capacity-note').textContent = !total ? 'Choose an image to see available space.' : state.mode === 'reveal' ? 'Encrypted contents are checked when you unlock.' : size > total ? 'Too much data. Choose a larger cover image.' : `${format(size)} of ${format(total)} used, including encryption.`;
}
function updatePreview() {
  const canvas = $('preview');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (state.image) {
    const buffer = document.createElement('canvas');
    buffer.width = state.image.width; buffer.height = state.image.height;
    buffer.getContext('2d').putImageData(state.image, 0, 0);
    canvas.width = buffer.width; canvas.height = buffer.height;
    ctx.drawImage(buffer, 0, 0);
  }
  $('preview-empty').hidden = !!state.image;
  $('preview-label').hidden = !state.image;
  $('preview-label').textContent = state.mode === 'hide' ? 'ORIGINAL COVER' : 'ENCODED IMAGE';
  $('dimensions').textContent = state.image ? `${state.image.width} × ${state.image.height}` : '— × —';
  $('capacity').textContent = state.image ? format(capacity(state.image.data)) : '—';
  $('cover-name').textContent = state.image ? state.name : 'No image selected';
  $('cover-clear').hidden = !state.image;
  updateCapacity();
}

async function loadImage(file) {
  if (state.busy || !file) return;
  const id = ++state.loadId;
  try {
    if (file.size > 25 * 1024 * 1024) throw new Error('Choose an image smaller than 25 MB.');
    if (state.mode === 'reveal' && file.type !== 'image/png' && !file.name.toLowerCase().endsWith('.png')) throw new Error('Reveal data needs an original PNG exported by this web app.');
    if (!/^image\/(png|jpeg|webp|bmp|x-ms-bmp)$/.test(file.type) && !/\.(png|jpe?g|webp|bmp)$/i.test(file.name)) throw new Error('Choose a PNG, JPG, WebP or BMP image.');
    const bitmap = await createImageBitmap(file, { imageOrientation: 'none' });
    try {
      if (id !== state.loadId) return;
      if (bitmap.width * bitmap.height > 16000000) throw new Error('Choose an image with 16 megapixels or fewer.');
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      // Opaque covers prevent premultiplication from altering encoded RGB bits.
      if (state.mode === 'hide') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
      ctx.drawImage(bitmap, 0, 0);
      state.image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      state.name = file.name;
      resetResult(); status(''); updatePreview();
    } finally { bitmap.close(); }
  } catch (error) { if (id === state.loadId) status(error.message || 'This image could not be opened.', true); }
}

function sampleCover() {
  if (state.busy) return;
  state.loadId++;
  const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 800;
  const ctx = canvas.getContext('2d');
  const sky = ctx.createLinearGradient(0, 0, 0, 800); sky.addColorStop(0, '#f3ddc5'); sky.addColorStop(0.6, '#e4e5d2'); sky.addColorStop(1, '#b9ceb2');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, 1200, 800);
  ctx.fillStyle = '#fdf4d8'; ctx.beginPath(); ctx.arc(860, 230, 92, 0, Math.PI * 2); ctx.fill();
  for (const [y, color, offset] of [[440, '#a6bba0', 120], [530, '#78977d', -80], [650, '#426955', 50]]) {
    ctx.beginPath(); ctx.moveTo(0, 800); ctx.lineTo(0, y); ctx.bezierCurveTo(300, y - 200 + offset, 650, y + 160, 1200, y - 40); ctx.lineTo(1200, 800); ctx.closePath(); ctx.fillStyle = color; ctx.fill();
  }
  state.image = ctx.getImageData(0, 0, 1200, 800); state.name = 'quiet-hills-sample.png';
  $('cover-input').value = ''; resetResult(); status('Sample canvas loaded. Add a secret and your own passphrase.'); updatePreview();
}

function addHistory(success, mode) {
  state.history.unshift({ success, mode, time: new Date() });
  state.history = state.history.slice(0, 30);
  renderHistory();
}
function renderHistory() {
  $('history-count').textContent = String(state.history.length);
  const list = $('history-list'); list.replaceChildren();
  if (!state.history.length) { const item = document.createElement('li'); item.textContent = 'No activity yet. Your next secret starts here.'; list.append(item); }
  for (const entry of state.history) {
    const item = document.createElement('li'); const label = document.createElement('span'); const time = document.createElement('time');
    label.textContent = `${entry.success ? '✓' : '×'} ${entry.mode === 'hide' ? 'Hide data' : 'Reveal data'} ${entry.success ? 'completed' : 'failed'}`;
    time.dateTime = entry.time.toISOString(); time.textContent = entry.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    item.append(label, time); list.append(item);
  }
}

$('workspace-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (state.busy) return;
  resetResult();
  try {
    if (!crypto.subtle) throw new Error('Encryption needs HTTPS or localhost and a modern browser.');
    if (!state.image) throw new Error('Choose an image first, or try the sample canvas.');
    const password = $('passphrase').value;
    if (state.mode === 'hide') {
      if (password.length < 8) throw new Error('Use a passphrase with at least 8 characters.');
      const size = payloadSize();
      if (!size) throw new Error('Add a message, file, or audio clip first.');
      if (size > MAX_PAYLOAD) throw new Error('Payloads must be 4 MB or smaller.');
      if (envelopeSize(size, getMeta()) > capacity(state.image.data)) throw new Error('Your secret is too large for this image. Choose a larger cover or a smaller payload.');
      setBusy(true); status('Deriving your key and encrypting locally…');
      const data = state.type === 'text' ? encode.encode($('secret-text').value) : new Uint8Array(await state.payload[state.type].arrayBuffer());
      const envelope = await seal(data, password, getMeta());
      const pixels = embed(state.image.data, envelope);
      const canvas = document.createElement('canvas'); canvas.width = state.image.width; canvas.height = state.image.height;
      canvas.getContext('2d').putImageData(new ImageData(pixels, canvas.width, canvas.height), 0, 0);
      const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('PNG export failed. Try a smaller image.')), 'image/png'));
      const base = state.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80) || 'secret';
      state.output = { blob, name: `${base}-steg.png` };
      $('result-title').textContent = 'Your secret is ready.';
      $('result-description').textContent = 'Download the PNG and share it as a file. Keep the passphrase separate and the image unedited.';
      $('download').textContent = 'Download encrypted PNG ↓';
      $('use-result').hidden = false;
    } else {
      setBusy(true); status('Reading pixels and checking the passphrase locally…');
      const result = await unseal(extract(state.image.data), password);
      const name = result.meta.name.split(/[\\/]/).pop().replace(/[\x00-\x1f\x7f]/g, '').slice(0, 180) || 'recovered-file';
      // Download recovered files as binary; never interpret arbitrary payload HTML.
      const blob = new Blob([result.data], { type: 'application/octet-stream' });
      state.output = { blob, name };
      $('result-title').textContent = 'A little secret, revealed.';
      $('result-description').textContent = `Recovered ${format(result.data.length)} of ${result.meta.type === 'text' ? 'text' : result.meta.type === 'audio' ? 'audio' : 'file data'}.`;
      $('download').textContent = `Download recovered ${result.meta.type === 'text' ? 'message' : 'file'} ↓`;
      $('use-result').hidden = true;
      if (result.meta.type === 'text') { $('recovered-text').textContent = new TextDecoder().decode(result.data); $('recovered-text').hidden = false; }
      if (result.meta.type === 'audio') {
        const mime = typeof result.meta.mime === 'string' && /^audio\/[a-z0-9.+-]+$/i.test(result.meta.mime) ? result.meta.mime : 'audio/wav';
        state.resultUrl = URL.createObjectURL(new Blob([result.data], { type: mime }));
        $('recovered-audio').src = state.resultUrl; $('recovered-audio').hidden = false;
      }
    }
    $('result').hidden = false;
    $('passphrase').value = '';
    status('Complete. Your data stayed on this device.');
    addHistory(true, state.mode);
  } catch (error) {
    status(error.message || 'Something went wrong. Please try again.', true);
    addHistory(false, state.mode);
  } finally { setBusy(false); }
});

$('download').addEventListener('click', () => {
  if (!state.output) return;
  const url = URL.createObjectURL(state.output.blob);
  const link = document.createElement('a'); link.href = url; link.download = state.output.name;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
});
$('use-result').addEventListener('click', async () => {
  if (!state.output || state.busy) return;
  const file = new File([state.output.blob], state.output.name, { type: 'image/png' });
  switchMode('reveal'); await loadImage(file); $('passphrase').focus();
});
document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => { if (button.dataset.mode !== state.mode) switchMode(button.dataset.mode); }));
document.querySelectorAll('[data-type]').forEach(button => button.addEventListener('click', () => {
  state.type = button.dataset.type;
  document.querySelectorAll('[data-type]').forEach(tab => {
    const active = tab === button; tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
    $(`panel-${tab.dataset.type}`).hidden = !active;
  });
  resetResult(); status(''); updateCapacity();
}));
document.querySelector('.payload-tabs').addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault(); const tabs = [...document.querySelectorAll('[data-type]')];
  let index = tabs.findIndex(tab => tab.getAttribute('aria-selected') === 'true');
  index = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (event.key === 'ArrowRight' ? 1 : -1) + 3) % 3;
  tabs[index].click(); tabs[index].focus();
});
$('cover-pick').addEventListener('click', () => $('cover-input').click());
$('cover-input').addEventListener('change', event => loadImage(event.target.files[0]));
$('cover-clear').addEventListener('click', () => { state.loadId++; state.image = null; state.name = ''; $('cover-input').value = ''; resetResult(); status(''); updatePreview(); });
$('demo-cover').addEventListener('click', sampleCover);
for (const type of ['file', 'audio']) $('secret-' + type).addEventListener('change', event => {
  const file = event.target.files[0] || null;
  if (file && file.size > MAX_PAYLOAD) { event.target.value = ''; state.payload[type] = null; $(type + '-selection').textContent = 'No file selected'; status('Choose a payload of 4 MB or smaller.', true); updateCapacity(); return; }
  state.payload[type] = file;
  $(type + '-selection').textContent = file ? `${file.name} · ${format(file.size)}` : 'No file selected';
  resetResult(); status(''); updateCapacity();
});
$('secret-text').addEventListener('input', () => { resetResult(); status(''); updateCapacity(); });
$('passphrase').addEventListener('input', () => {
  const length = $('passphrase').value.length;
  $('strength').textContent = state.mode === 'reveal' ? 'Use the exact passphrase from the sender.' : length < 8 ? 'Use at least 8 characters. A longer phrase is better.' : length < 16 ? 'Ready. Consider a longer, unique phrase.' : 'Longer phrases help. Keep this one private.';
});
$('password-toggle').addEventListener('click', () => {
  const show = $('passphrase').type === 'password'; $('passphrase').type = show ? 'text' : 'password';
  $('password-toggle').textContent = show ? 'Hide' : 'Show'; $('password-toggle').setAttribute('aria-label', show ? 'Hide passphrase' : 'Show passphrase'); $('password-toggle').setAttribute('aria-pressed', String(show));
});
$('cover-pick').addEventListener('dragover', event => { event.preventDefault(); if (!state.busy) $('cover-pick').classList.add('dragging'); });
$('cover-pick').addEventListener('dragleave', () => $('cover-pick').classList.remove('dragging'));
$('cover-pick').addEventListener('drop', event => { event.preventDefault(); $('cover-pick').classList.remove('dragging'); if (!state.busy) loadImage(event.dataTransfer.files[0]); });
for (const id of ['help-open', 'how-open']) $(id).addEventListener('click', () => $('guide-dialog').showModal());
$('history-open').addEventListener('click', () => { renderHistory(); $('history-dialog').showModal(); });
$('history-clear').addEventListener('click', () => { state.history = []; renderHistory(); });
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => { if (event.target === dialog && (event.offsetX < 0 || event.offsetX > dialog.clientWidth || event.offsetY < 0 || event.offsetY > dialog.clientHeight)) dialog.close(); }));
$('theme').addEventListener('click', () => document.body.classList.toggle('dark'));
document.querySelectorAll('[data-type]').forEach(tab => { tab.tabIndex = tab.dataset.type === 'text' ? 0 : -1; });
if (!crypto.subtle) status('Open this app over HTTPS or localhost to enable browser encryption.', true);
updateCapacity();
