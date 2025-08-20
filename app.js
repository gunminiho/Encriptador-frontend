// =========================
// CONFIG
// =========================
const API_BASE = 'https://crypto.omn.pe/api'; // <- CAMBIA ESTO
const ENDPOINTS = {
  encrypt: '/encryption_operations/v2/encrypt',
  decrypt: '/encryption_operations/v2/decrypt',
  massive: '/encryption_operations/v2/massive-encrypt'
};
const API_KEY = 'tenants API-Key 9fe1a2f9-a69c-4b6f-9e96-6ee13586c26b'; 

// =========================
// UTILS
// =========================
const $ = (sel) => document.querySelector(sel);

function parseFilenameFromCD(response) {
  const cd = response.headers.get('Content-Disposition') || '';
  // Soporta filename* (RFC 5987) y filename="..."
  let m = cd.match(/filename\*=(?:UTF-8'')?([^;]+)/i);
  if (m && m[1]) {
    try { return decodeURIComponent(m[1].replace(/["']/g, '').trim()); } catch { /* ignore */ }
  }
  m = cd.match(/filename="([^"]+)"/i) || cd.match(/filename=([^;]+)/i);
  if (m && m[1]) return m[1].trim().replace(/^utf-8''/i, '');
  return 'download.bin';
}

function bytes(n) {
  if (!n && n !== 0) return '—';
  const u = ['B','KB','MB','GB','TB'];
  const i = Math.floor(Math.log(n)/Math.log(1024));
  return (n/Math.pow(1024, i)).toFixed(i ? 1 : 0) + ' ' + u[i];
}

function setBusy(button, busy) {
  button.disabled = !!busy;
}

function updateProgressUI(progressEl, statusEl, loaded, total) {
  if (total > 0) {
    const pct = Math.max(0, Math.min(100, Math.round(loaded / total * 100)));
    progressEl.max = 100;
    progressEl.value = pct;
    const remain = 100 - pct;
    statusEl.textContent = `${pct}% — faltan ${remain}% (${bytes(total - loaded)} de ${bytes(total)})`;
  } else {
    // Indeterminado
    progressEl.removeAttribute('max');
    progressEl.value = null;
    statusEl.textContent = `descargando... (${bytes(loaded)} recibidos)`;
  }
}

async function downloadWithProgress({url, formData, button, progressEl, statusEl, initialLabel}) {
  setBusy(button, true);
  progressEl.value = 0; progressEl.max = 100; statusEl.textContent = 'Iniciando…';
  button.textContent = 'Descargando…';

  const headers = {};
  if (API_KEY) headers['Authorization'] = API_KEY;

  const resp = await fetch(url, { method: 'POST', body: formData, headers });

  if (!resp.ok) {
    setBusy(button, false);
    button.textContent = initialLabel;
    const text = await resp.text().catch(()=>'');
    throw new Error(`HTTP ${resp.status}: ${text || resp.statusText}`);
  }

  const total = Number(resp.headers.get('Content-Length')) || 0;
  const reader = resp.body?.getReader?.();
  if (!reader) {
    const blob = await resp.blob();
    return {blob, resp};
  }

  const chunks = [];
  let received = 0;
  updateProgressUI(progressEl, statusEl, received, total);

  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    updateProgressUI(progressEl, statusEl, received, total);

    const totalKnown = total > 0;
    if (totalKnown) {
      const pct = Math.round(received / total * 100);
      const remain = 100 - pct;
      button.textContent = `Descargando… ${remain}% restante`;
    } else {
      button.textContent = `Descargando…`;
    }
  }

  const blob = new Blob(chunks);
  return {blob, resp};
}

function triggerDownload(blob, response) {
  const filename = parseFilenameFromCD(response);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return filename;
}

function resetUI(button, progressEl, statusEl, initialLabel){
  button.textContent = initialLabel;
  setBusy(button, false);
  progressEl.value = 0; progressEl.max = 100;
  statusEl.textContent = '—';
}

// =========================
// ENCRIPTAR (single)
// =========================
(function setupEncrypt(){
  const fileEl = $('#enc-file');
  const passEl = $('#enc-pass');
  const btn = $('#enc-btn');
  const progressEl = $('#enc-progress');
  const statusEl = $('#enc-status');
  const initialLabel = 'Encriptar';

  btn.addEventListener('click', async () => {
    try{
      if (!fileEl.files?.length) throw new Error('Selecciona un archivo.');
      if (!passEl.value) throw new Error('Ingresa la contraseña.');
      const fd = new FormData();
      fd.append('password', passEl.value);
      fd.append('file', fileEl.files[0]);
      const {blob, resp} = await downloadWithProgress({
        url: API_BASE + ENDPOINTS.encrypt,
        formData: fd,
        button: btn,
        progressEl, statusEl,
        initialLabel
      });
      const name = triggerDownload(blob, resp);
      statusEl.textContent = `Completado: ${name}`;
      btn.textContent = 'Completado ✓';
      setTimeout(()=> resetUI(btn, progressEl, statusEl, initialLabel), 1200);
    }catch(err){
      console.error(err);
      statusEl.textContent = 'Error: ' + (err?.message || err);
      btn.textContent = 'Error';
      setBusy(btn, false);
      setTimeout(()=> resetUI(btn, progressEl, statusEl, initialLabel), 1500);
    }
  });
})();

// =========================
// DESENCRIPTAR
// =========================
(function setupDecrypt(){
  const fileEl = $('#dec-file');
  const passEl = $('#dec-pass');
  const btn = $('#dec-btn');
  const progressEl = $('#dec-progress');
  const statusEl = $('#dec-status');
  const initialLabel = 'Desencriptar';

  btn.addEventListener('click', async () => {
    try{
      if (!fileEl.files?.length) throw new Error('Selecciona el archivo encriptado.');
      if (!passEl.value) throw new Error('Ingresa la contraseña.');
      const fd = new FormData();
      fd.append('password', passEl.value);
      fd.append('file', fileEl.files[0]);

      const {blob, resp} = await downloadWithProgress({
        url: API_BASE + ENDPOINTS.decrypt,
        formData: fd,
        button: btn,
        progressEl, statusEl,
        initialLabel
      });
      const name = triggerDownload(blob, resp);
      statusEl.textContent = `Completado: ${name}`;
      btn.textContent = 'Completado ✓';
      setTimeout(()=> resetUI(btn, progressEl, statusEl, initialLabel), 1200);
    }catch(err){
      console.error(err);
      statusEl.textContent = 'Error: ' + (err?.message || err);
      btn.textContent = 'Error';
      setBusy(btn, false);
      setTimeout(()=> resetUI(btn, progressEl, statusEl, initialLabel), 1500);
    }
  });
})();

// =========================
// ENCRIPTAMIENTO MASIVO
// =========================
(function setupMassive(){
  const filesEl = $('#mass-files');
  const csvEl = $('#mass-csv');
  const passEl = $('#mass-pass');
  const btn = $('#mass-btn');
  const progressEl = $('#mass-progress');
  const statusEl = $('#mass-status');
  const initialLabel = 'Encriptar';

  btn.addEventListener('click', async () => {
    try{
      if (!filesEl.files?.length) throw new Error('Selecciona al menos un archivo.');
      const fd = new FormData();
      // múltiples archivos como "file"
      [...filesEl.files].forEach(f => fd.append('file', f));
      if (csvEl.files?.length) fd.append('passwords', csvEl.files[0]);
      if (passEl.value) fd.append('password', passEl.value);

      const {blob, resp} = await downloadWithProgress({
        url: API_BASE + ENDPOINTS.massive,
        formData: fd,
        button: btn,
        progressEl, statusEl,
        initialLabel
      });
      const name = triggerDownload(blob, resp);
      statusEl.textContent = `Completado: ${name}`;
      btn.textContent = 'Completado ✓';
      setTimeout(()=> resetUI(btn, progressEl, statusEl, initialLabel), 1200);
    }catch(err){
      console.error(err);
      statusEl.textContent = 'Error: ' + (err?.message || err);
      btn.textContent = 'Error';
      setBusy(btn, false);
      setTimeout(()=> resetUI(btn, progressEl, statusEl, initialLabel), 1500);
    }
  });
})();
