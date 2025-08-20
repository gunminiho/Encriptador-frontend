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

function setVisualProgress(visualEl, percent, determinate) {
  if (!visualEl) return;
  const fill = visualEl.querySelector('.fill');
  if (!fill) return;

  if (determinate) {
    visualEl.classList.remove('indeterminate');
    fill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  } else {
    visualEl.classList.add('indeterminate');
    fill.style.width = '40%';
  }
}

const sumSize = files => files.reduce((a, f) => a + (f?.size || 0), 0);


function parseFilenameFromCD(respOrHeader) {
  const cd = typeof respOrHeader === 'string'
    ? (respOrHeader || '')
    : (respOrHeader?.headers?.get?.('Content-Disposition') || '');
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
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  return (n / Math.pow(1024, i)).toFixed(i ? 1 : 0) + ' ' + u[i];
}

function setBusy(button, busy) {
  button.disabled = !!busy;
}

// function updateProgressUI(progressEl, statusEl, loaded, total, visualEl) {
//   if (total > 0) {
//     const pct = Math.max(0, Math.min(100, Math.round((loaded / total) * 100)));
//     progressEl.max = 100;
//     progressEl.value = pct;
//     statusEl.textContent = `${pct}% — faltan ${100 - pct}% (${bytes(total - loaded)} de ${bytes(total)})`;
//     setVisualProgress(visualEl, pct, true);
//   } else {
//     // Indeterminado
//     progressEl.removeAttribute('max');
//     progressEl.value = null;
//     statusEl.textContent = `descargando... (${bytes(loaded)} recibidos)`;
//     setVisualProgress(visualEl, 0, false);
//   }
// }

async function downloadWithProgress({ url, formData, button, progressEl, statusEl, initialLabel, visualEl, meta }) {
  const info = meta || {};
  const fileCount = info.fileCount ?? 1;
  const totalBytes = info.totalBytes ?? 0;

  // Resumen de envío
  LOGGER.info(`→ POST ${url}`);
  LOGGER.info(`Archivos: ${fileCount} — Peso total: ${bytes(totalBytes)}`);

  setBusy(button, true);
  progressEl.value = 0; progressEl.max = 100; statusEl.textContent = 'Iniciando…';
  button.textContent = 'Descargando…';

  const headers = {};
  if (API_KEY) headers['Authorization'] = API_KEY;

  let live = LOGGER.live(`Descarga: preparando…`);
  try {
    const resp = await fetch(url, { method: 'POST', body: formData, headers });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      LOGGER.fail(live, `Error HTTP ${resp.status} ${resp.statusText}`);
      throw new Error(`HTTP ${resp.status}: ${text || resp.statusText}`);
    }

    const total = Number(resp.headers.get('Content-Length')) || 0;
    if (total > 0) LOGGER.update(live, `Descarga: 0% de ${bytes(total)}`);
    else LOGGER.update(live, `Descarga: tamaño desconocido…`);

    const reader = resp.body?.getReader?.();
    if (!reader) {
      const blob = await resp.blob();
      LOGGER.ok(live, `Descarga completada (sin streaming)`);
      return { blob, resp };
    }

    const chunks = [];
    let received = 0;
    let lastPctLogged = 0;
    let lastBytesLogged = 0;

    updateProgressUI(progressEl, statusEl, received, total, visualEl);

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      updateProgressUI(progressEl, statusEl, received, total, visualEl);

      if (total > 0) {
        const pct = Math.round(received / total * 100);
        if (pct >= lastPctLogged + 5 || pct === 100) { // loguea cada +5%
          LOGGER.update(live, `Descarga: ${pct}% (${bytes(received)} de ${bytes(total)})`);
          lastPctLogged = pct;
        }
        button.textContent = `Descargando… ${100 - pct}% restante`;
      } else {
        if (received - lastBytesLogged >= 1 * 1024 * 1024) { // cada 1MB
          LOGGER.update(live, `Descarga: ${bytes(received)}…`);
          lastBytesLogged = received;
        }
        button.textContent = `Descargando…`;
      }
    }

    const blob = new Blob(chunks);
    LOGGER.ok(live, `Descarga completa ✓ (${bytes(received)})`);
    LOGGER.success(`✅ Respuesta ${resp.status} ${resp.statusText}`);
    return { blob, resp };

  } catch (err) {
    LOGGER.error(`❌ Falló la petición: ${err.message || err}`);
    setBusy(button, false);
    button.textContent = initialLabel;
    throw err;
  }
}

async function xhrWithProgress({ url, formData, button, progressEl, statusEl, initialLabel, visualEl, meta }) {
  return new Promise((resolve, reject) => {
    const info = meta || {};
    const fileCount = info.fileCount ?? 1;
    const totalBytes = info.totalBytes ?? 0;

    LOGGER.info(`→ POST ${url}`);
    LOGGER.info(`Archivos: ${fileCount} — Peso total: ${bytes(totalBytes)}`);

    setBusy(button, true);
    progressEl.value = 0; progressEl.max = 100; statusEl.textContent = 'Preparando…';
    setVisualProgress(visualEl, 0, false); // animación indeterminada mientras sube
    button.textContent = 'Subiendo…';

    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    if (API_KEY) xhr.setRequestHeader('Authorization', API_KEY);
    xhr.responseType = 'blob';

    const liveUp = LOGGER.live('Subiendo: preparando…');
    const liveDown = LOGGER.live('Descarga: esperando respuesta…');

    // --- Progreso de subida
    let lastUpPct = -1;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        if (pct !== lastUpPct) {
          LOGGER.update(liveUp, `Subiendo: ${pct}% (${bytes(e.loaded)} de ${bytes(e.total)})`);
          lastUpPct = pct;
        }
      } else {
        LOGGER.update(liveUp, `Subiendo: ${bytes(e.loaded)}…`);
      }
      // Mantén barra en modo indeterminado hasta que empiece la descarga
      statusEl.textContent = `Subiendo… ${bytes(e.loaded)} enviados`;
    };

    xhr.upload.onload = () => {
      LOGGER.ok(liveUp, 'Subida completa ✓');
      button.textContent = 'Procesando…';
      statusEl.textContent = 'Procesando en el servidor…';
    };

    // --- Progreso de descarga
    let lastPctLogged = 0;
    let lastBytesLogged = 0;
    let dlReceived = 0;

    xhr.onprogress = (e) => {
      dlReceived = e.loaded || dlReceived;
      const total = e.lengthComputable ? e.total : 0;

      // En cuanto hay descarga, cambia a barra determinada (si hay Content-Length)
      updateProgressUI(progressEl, statusEl, dlReceived, total, visualEl);
      button.textContent = total ? `Descargando… ${100 - Math.round((dlReceived / total) * 100)}% restante`
        : 'Descargando…';

      if (total > 0) {
        const pct = Math.round((dlReceived / total) * 100);
        if (pct >= lastPctLogged + 5 || pct === 100) {
          LOGGER.update(liveDown, `Descarga: ${pct}% (${bytes(dlReceived)} de ${bytes(total)})`);
          lastPctLogged = pct;
        }
      } else {
        if (dlReceived - lastBytesLogged >= 1 * 1024 * 1024) {
          LOGGER.update(liveDown, `Descarga: ${bytes(dlReceived)}…`);
          lastBytesLogged = dlReceived;
        }
      }
    };

    // --- Completado
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const cd = xhr.getResponseHeader('Content-Disposition') || '';
        LOGGER.ok(liveDown, `Descarga completa ✓ (${bytes(dlReceived)})`);
        LOGGER.success(`✅ Respuesta ${xhr.status} ${xhr.statusText || 'OK'}`);

        // Resp shim para reutilizar parseFilenameFromCD/triggerDownload
        const respShim = {
          headers: { get: (k) => (k && k.toLowerCase() === 'content-disposition') ? cd : null },
          status: xhr.status,
          statusText: xhr.statusText || 'OK'
        };

        resolve({ blob: xhr.response, resp: respShim });
      } else {
        LOGGER.fail(liveDown, `Error HTTP ${xhr.status} ${xhr.statusText || ''}`);
        setBusy(button, false);
        button.textContent = initialLabel;
        reject(new Error(`HTTP ${xhr.status}: ${xhr.statusText || 'Error'}`));
      }
    };

    xhr.onerror = () => {
      LOGGER.error('❌ Falló la petición (network error)');
      setBusy(button, false);
      button.textContent = initialLabel;
      reject(new Error('Network error'));
    };

    xhr.send(formData);
  });
}

// async function downloadWithProgress({ url, formData, button, progressEl, statusEl, initialLabel, visualEl }) {
//   setBusy(button, true);
//   progressEl.value = 0; progressEl.max = 100; statusEl.textContent = 'Iniciando…';
//   button.textContent = 'Descargando…';

//   const headers = {};
//   if (API_KEY) headers['Authorization'] = API_KEY;

//   const resp = await fetch(url, { method: 'POST', body: formData, headers });
//   if (!resp.ok) {
//     setBusy(button, false);
//     button.textContent = initialLabel;
//     const text = await resp.text().catch(() => '');
//     throw new Error(`HTTP ${resp.status}: ${text || resp.statusText}`);
//   }

//   const total = Number(resp.headers.get('Content-Length')) || 0;
//   const reader = resp.body?.getReader?.();
//   if (!reader) {
//     const blob = await resp.blob();
//     return { blob, resp };
//   }

//   const chunks = [];
//   let received = 0;
//   updateProgressUI(progressEl, statusEl, received, total, visualEl);

//   while (true) {
//     const { done, value } = await reader.read();
//     if (done) break;
//     chunks.push(value);
//     received += value.byteLength;
//     updateProgressUI(progressEl, statusEl, received, total, visualEl);

//     if (total > 0) {
//       const pct = Math.round((received / total) * 100);
//       button.textContent = `Descargando… ${100 - pct}% restante`;
//     } else {
//       button.textContent = `Descargando…`;
//     }
//   }

//   const blob = new Blob(chunks);
//   return { blob, resp };
// }


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

function resetUI(button, progressEl, statusEl, initialLabel) {
  button.textContent = initialLabel;
  setBusy(button, false);
  progressEl.value = 0; progressEl.max = 100;
  statusEl.textContent = '—';
}

// =========================
// ENCRIPTAR (single)
// =========================
(function setupEncrypt() {
  const fileEl = $('#enc-file');
  const passEl = $('#enc-pass');
  const btn = $('#enc-btn');
  const progressEl = $('#enc-progress');
  const statusEl = $('#enc-status');
  const visualEl = $('#enc-visual');
  const initialLabel = 'Encriptar';

  btn.addEventListener('click', async () => {
    try {
      if (!fileEl.files?.length) throw new Error('Selecciona un archivo.');
      if (!passEl.value) throw new Error('Ingresa la contraseña.');
      const fd = new FormData();
      fd.append('password', passEl.value);
      fd.append('file', fileEl.files[0]);

      const { blob, resp } = await xhrWithProgress({
        url: API_BASE + ENDPOINTS.encrypt,
        formData: fd,
        button: btn,
        progressEl, statusEl,
        initialLabel,
        visualEl,
        meta: {
          fileCount: 1,
          totalBytes: fileEl.files[0].size
        }
      });


      const name = triggerDownload(blob, resp);
      statusEl.textContent = `Completado: ${name}`;
      btn.textContent = 'Completado ✓';
      setTimeout(() => {
        resetUI(btn, progressEl, statusEl, initialLabel);
        setVisualProgress(visualEl, 0, true);
      }, 1200);
    } catch (err) {
      statusEl.textContent = 'Error: ' + (err?.message || err);
      btn.textContent = 'Error';
      setBusy(btn, false);
      setVisualProgress(visualEl, 0, true);
      setTimeout(() => resetUI(btn, progressEl, statusEl, initialLabel), 1500);
    }
  });
})();

// =========================
// DESENCRIPTAR
// =========================
(function setupDecrypt() {
  const fileEl = $('#dec-file');
  const passEl = $('#dec-pass');
  const btn = $('#dec-btn');
  const progressEl = $('#dec-progress');
  const statusEl = $('#dec-status');
  const visualEl = $('#dec-visual');
  const initialLabel = 'Desencriptar';

  btn.addEventListener('click', async () => {
    try {
      if (!fileEl.files?.length) throw new Error('Selecciona el archivo encriptado.');
      if (!passEl.value) throw new Error('Ingresa la contraseña.');
      const fd = new FormData();
      fd.append('password', passEl.value);
      fd.append('file', fileEl.files[0]);

      const { blob, resp } = await xhrWithProgress({
        url: API_BASE + ENDPOINTS.decrypt,
        formData: fd,
        button: btn,
        progressEl, statusEl,
        initialLabel,
        visualEl,
        meta: {
          fileCount: 1,
          totalBytes: fileEl.files[0].size
        }
      });


      const name = triggerDownload(blob, resp);
      statusEl.textContent = `Completado: ${name}`;
      btn.textContent = 'Completado ✓';
      setTimeout(() => {
        resetUI(btn, progressEl, statusEl, initialLabel);
        setVisualProgress(visualEl, 0, true);
      }, 1200);
    } catch (err) {
      statusEl.textContent = 'Error: ' + (err?.message || err);
      btn.textContent = 'Error';
      setBusy(btn, false);
      setVisualProgress(visualEl, 0, true);
      setTimeout(() => resetUI(btn, progressEl, statusEl, initialLabel), 1500);
    }
  });
})();

// =========================
// ENCRIPTAMIENTO MASIVO
// =========================
(function setupMassive() {
  const filesEl = $('#mass-files');
  const csvEl = $('#mass-csv');
  const btn = $('#mass-btn');
  const progressEl = $('#mass-progress');
  const statusEl = $('#mass-status');
  const visualEl = $('#mass-visual');
  const initialLabel = 'Encriptar';

  btn.addEventListener('click', async () => {
    try {
      if (!filesEl.files?.length) throw new Error('Selecciona al menos un archivo.');
      const fd = new FormData();
      const arr = [...filesEl.files];
      arr.forEach(f => fd.append('file', f));
      if (csvEl.files?.length) fd.append('passwords', csvEl.files[0]);

      const { blob, resp } = await xhrWithProgress({
        url: API_BASE + ENDPOINTS.massive,
        formData: fd,
        button: btn,
        progressEl, statusEl,
        initialLabel,
        visualEl,
        meta: {
          fileCount: arr.length + (csvEl.files?.length ? 1 : 0),
          totalBytes: sumSize(arr) + (csvEl.files?.[0]?.size || 0)
        }
      });


      const name = triggerDownload(blob, resp);
      statusEl.textContent = `Completado: ${name}`;
      btn.textContent = 'Completado ✓';
      setTimeout(() => {
        resetUI(btn, progressEl, statusEl, initialLabel);
        setVisualProgress(visualEl, 0, true);
      }, 1200);
    } catch (err) {
      statusEl.textContent = 'Error: ' + (err?.message || err);
      btn.textContent = 'Error';
      setBusy(btn, false);
      setVisualProgress(visualEl, 0, true);
      setTimeout(() => resetUI(btn, progressEl, statusEl, initialLabel), 1500);
    }
  });
})();

// =========================
// UI para logear en consola
// =========================
class UiLogger {
  constructor(container) {
    this.el = container;
    this.autoscroll = true;
  }
  _push(text, level = 'info') {
    const row = document.createElement('div');
    row.className = `log-line ${level}`;
    const ts = document.createElement('span');
    ts.className = 'ts';
    ts.textContent = `[${new Date().toLocaleTimeString()}]`;
    const msg = document.createElement('span');
    msg.className = 'msg';
    msg.textContent = text;
    row.append(ts, msg);
    this.el.appendChild(row);
    if (this.autoscroll) this.el.scrollTop = this.el.scrollHeight;
    return row;
  }
  info(t) { return this._push(t, 'info'); }
  success(t) { return this._push(t, 'ok'); }
  warn(t) { return this._push(t, 'warn'); }
  error(t) { return this._push(t, 'err'); }
  live(t) { return this._push(t, 'live'); }           // línea que se irá actualizando
  update(row, t) { if (row) row.querySelector('.msg').textContent = t; }
  ok(row, t) { if (row) { row.className = 'log-line ok'; this.update(row, t); } }
  fail(row, t) { if (row) { row.className = 'log-line err'; this.update(row, t); } }
  clear() { this.el.innerHTML = ''; }
}
const LOGGER = new UiLogger(document.getElementById('console-body'));
document.getElementById('log-clear').addEventListener('click', () => LOGGER.clear());
document.getElementById('log-autoscroll').addEventListener('change', e => LOGGER.autoscroll = e.target.checked);

