/*
 * Sync between devices.
 *
 * localStorage stays the working copy, so the app keeps working offline. The
 * server holds one document with a revision number; `revision` below is the
 * last one this device has seen and `dirty` means it has edits not uploaded yet.
 * Two different versions are never merged or overwritten silently: the user
 * chooses, and the discarded version is kept in CONFLICT_BACKUP_KEY.
 */

import { fmtStamp } from './dates.js';
import { isStateEmpty, normalizeState, persist, setOnSave, setState, state } from './state.js';
import { $, closeSheet, h, isSheetOpen, openSheet, render, setOnSheetClose, ui } from './ui.js';

const SYNC_META_KEY = 'carta-comidas:sync';
const CONFLICT_BACKUP_KEY = 'carta-comidas:conflict-backup';
const SYNC_DELAY_MS = 1000;
const SYNC_TIMEOUT_MS = 10000;
const OFFLINE_MESSAGE = 'Sin conexión. Se sincronizará cuando vuelva la red.';
const DISCONNECTED = { key: '', revision: 0, dirty: false, lastSync: null };

function loadMeta() {
  try {
    return { ...DISCONNECTED, ...JSON.parse(localStorage.getItem(SYNC_META_KEY)) };
  } catch {
    return { ...DISCONNECTED };
  }
}

const meta = loadMeta();
let status = '';
let edits = 0; // local edits in this session, to notice one made during a request
let running = false;
let rerun = false;
let deferred = false;
let timer = null;

function saveMeta() {
  try {
    localStorage.setItem(SYNC_META_KEY, JSON.stringify(meta));
  } catch (err) {
    console.error('Could not save sync data', err);
  }
}

function setStatus(text) {
  status = text;
  if (ui.view === 'semana') renderSync();
}

export function scheduleSync(delay = SYNC_DELAY_MS) {
  clearTimeout(timer);
  timer = setTimeout(runSync, delay);
}

function request(method, body) {
  return fetch('/api/state', {
    method,
    headers: { Authorization: `Bearer ${meta.key}`, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
  });
}

function markSynced(revision) {
  meta.revision = revision;
  meta.lastSync = new Date().toISOString();
  saveMeta();
  setStatus('Sincronizado.');
}

// Explains a failed answer. Returns true when the response can be used.
function isUsable(res) {
  if (res.ok) return true;
  if (res.status === 401) setStatus('La clave no es correcta.');
  else if (res.status === 503) setStatus('La sincronización no está configurada en el servidor.');
  else setStatus('El servidor no ha podido sincronizar. Se reintentará más tarde.');
  return false;
}

async function upload(baseRevision) {
  const editsAtStart = edits;
  const res = await request('PUT', { baseRevision, data: state });
  if (res.status === 409) {
    // Another device saved first: start over to see its version
    rerun = true;
    return;
  }
  if (!isUsable(res)) return;
  const { revision } = await res.json();
  // An edit made during the upload still has to go up
  meta.dirty = edits !== editsAtStart;
  markSynced(revision);
  if (meta.dirty) scheduleSync();
}

function adopt(remote) {
  let incoming;
  try {
    incoming = normalizeState(remote.data);
  } catch {
    setStatus('Los datos del servidor no son válidos. No se han aplicado.');
    return;
  }
  setState(incoming);
  ui.idea = null;
  persist();
  meta.dirty = false;
  markSynced(remote.revision);
  render();
}

// Keeps the version the user is about to discard, in case it was the wrong choice.
function keepDiscarded(data) {
  try {
    localStorage.setItem(CONFLICT_BACKUP_KEY, JSON.stringify(data));
  } catch (err) {
    console.error('Could not keep the discarded version', err);
  }
}

function retryIfNeeded() {
  if (!rerun) return;
  rerun = false;
  scheduleSync(0);
}

function openConflict(remote) {
  const describe = (data) => {
    const days = Object.keys(data.log ?? {}).length;
    return `${days} ${days === 1 ? 'día' : 'días'} con almuerzo, ${data.dishes.length} platos`;
  };
  const choose = async (action) => {
    closeSheet();
    try {
      await action();
    } catch {
      setStatus(OFFLINE_MESSAGE);
    }
    retryIfNeeded();
  };
  const keepRemote = () => choose(() => {
    keepDiscarded(state);
    adopt(remote);
  });
  const keepLocal = () => choose(() => {
    keepDiscarded(remote.data);
    meta.dirty = true;
    saveMeta();
    return upload(remote.revision);
  });

  setStatus('Hay dos versiones distintas. Elige cuál conservar.');
  openSheet('Hay dos versiones',
    h('p', {}, 'Este dispositivo y el servidor tienen datos distintos. Elige cuál conservar en todos tus dispositivos.'),
    h('button', { class: 'btn block', onclick: keepRemote }, `La del servidor (${fmtStamp.format(new Date(remote.updatedAt))})`),
    h('p', { class: 'hint' }, describe(remote.data)),
    h('button', { class: 'btn block', onclick: keepLocal }, 'La de este dispositivo'),
    h('p', { class: 'hint' }, describe(state)));
}

async function syncOnce() {
  const editsAtStart = edits;
  const res = await request('GET');
  if (!isUsable(res)) return;
  const remote = await res.json();

  // An edit made during the request changes the decision: look again
  if (edits !== editsAtStart) {
    rerun = true;
    return;
  }
  // The sheet may have been opened during the request
  if (isSheetOpen()) {
    deferred = true;
    return;
  }
  // An empty device has nothing to lose or to offer: it never uploads, so it can
  // not wipe the server, and it takes the server's data without asking
  if (isStateEmpty() && !meta.dirty) {
    if (remote.revision > 0) adopt(remote);
    else setStatus('Conectado. Todavía no hay datos.');
    return;
  }

  if (remote.revision === 0) await upload(0);
  else if (remote.revision === meta.revision) {
    if (meta.dirty) await upload(remote.revision);
    else markSynced(remote.revision);
  } else if (meta.dirty || meta.revision === 0) openConflict(remote);
  else adopt(remote);
}

export async function runSync() {
  if (!meta.key) return;
  if (running) {
    rerun = true;
    return;
  }
  // Replacing the state under an open form would lose what is being edited
  if (isSheetOpen()) {
    deferred = true;
    return;
  }
  deferred = false;
  running = true;
  try {
    await syncOnce();
  } catch {
    setStatus(OFFLINE_MESSAGE);
  } finally {
    running = false;
    retryIfNeeded();
  }
}

function connect(key) {
  Object.assign(meta, DISCONNECTED, { key });
  saveMeta();
  setStatus('Conectando…');
  runSync();
}

// Only this device stops syncing: its data and the server's stay as they are.
function disconnect() {
  clearTimeout(timer);
  Object.assign(meta, DISCONNECTED);
  saveMeta();
  setStatus('');
}

export function renderSync() {
  if (!meta.key) {
    const key = h('input', { type: 'password', required: true, autocomplete: 'off' });
    $('#sync').replaceChildren(h('form', {
      onsubmit: (e) => {
        e.preventDefault();
        if (key.value.trim()) connect(key.value.trim());
      },
    },
    h('label', { class: 'field' }, h('span', {}, 'Clave de sincronización'), key),
    h('button', { class: 'btn primary', type: 'submit' }, 'Conectar')));
    return;
  }

  $('#sync').replaceChildren(
    h('p', { class: 'hint', role: 'status' }, status || 'Conectado.', meta.dirty ? ' Hay cambios pendientes de subir.' : ''),
    meta.lastSync && h('p', { class: 'hint' }, `Última vez: ${fmtStamp.format(new Date(meta.lastSync))}.`),
    h('div', { class: 'actions' },
      h('button', { class: 'btn', onclick: runSync }, 'Sincronizar ahora'),
      h('button', { class: 'btn danger', onclick: disconnect }, 'Desconectar')));
}

setOnSave(() => {
  edits += 1;
  if (!meta.key) return;
  meta.dirty = true;
  saveMeta();
  scheduleSync();
});

// A sync that waited for the sheet can run now
setOnSheetClose(() => {
  if (deferred) scheduleSync(0);
});

window.addEventListener('online', () => scheduleSync(0));
