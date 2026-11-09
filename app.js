'use strict';

/* ------------------------------------------------------------------ *
 * Storage and data model
 *
 * state = {
 *   version: 1,
 *   goals:  { legumbres: 2, pescado: 2 },        // weekly minimums
 *   dishes: [{ id, section, name, counts: ['legumbres' | 'pescado'] }],
 *   log:    { 'YYYY-MM-DD': { name, counts, dishId|null } }
 * }
 *
 * Each log entry stores its own copy of name and counts so editing or
 * deleting a dish never rewrites history.
 * ------------------------------------------------------------------ */

const STORAGE_KEY = 'carta-comidas:v1';
const RECENT_DAYS = 3;

const GOALS = [
  { key: 'legumbres', label: 'Legumbres' },
  { key: 'pescado', label: 'Pescado' },
];

// Display order of sections in the menu; unknown sections go last.
const SECTION_ORDER = ['Legumbres', 'Guisos', 'Pescado', 'Noodles', 'Pasta', 'Arroz', 'Frío'];

const SEED_DISHES = [
  ['Legumbres', 'Lentejas', ['legumbres']],
  ['Guisos', 'Puchero con arroz', []],
  ['Pescado', 'Salmón a la plancha', ['pescado']],
  ['Pescado', 'Salmón sobre arroz', ['pescado']],
  ['Pescado', 'Crema de calabacín y salmón', ['pescado']],
  ['Noodles', 'Noodles con pollo', []],
  ['Noodles', 'Noodles con ternera', []],
  ['Noodles', 'Noodles con cerdo', []],
  ['Noodles', 'Noodles con gambas', []],
  ['Noodles', 'Noodles con salmón', ['pescado']],
  ['Pasta', 'Carbonara', []],
  ['Pasta', 'Boloñesa', []],
  ['Pasta', 'Ensalada de pasta', []],
  ['Arroz', 'Arroz salteado', []],
  ['Arroz', 'Paella de pollo y gambas', []],
  ['Frío', 'Ensalada de garbanzos', ['legumbres']],
  ['Frío', 'Ensaladilla rusa', []],
];

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function defaultState() {
  return {
    version: 1,
    goals: { legumbres: 2, pescado: 2 },
    dishes: SEED_DISHES.map(([section, name, counts]) => ({ id: uid(), section, name, counts })),
    log: {},
  };
}

// Validates and normalises any object (stored or imported) into a safe state.
function normalizeState(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.dishes) || typeof raw.log !== 'object') {
    throw new Error('Formato no válido');
  }
  const validCounts = (c) => (Array.isArray(c) ? c.filter((k) => GOALS.some((g) => g.key === k)) : []);
  const dishes = raw.dishes
    .filter((d) => d && typeof d.name === 'string' && d.name.trim())
    .map((d) => ({
      id: typeof d.id === 'string' ? d.id : uid(),
      section: (typeof d.section === 'string' && d.section.trim()) || 'Otros',
      name: d.name.trim(),
      counts: validCounts(d.counts),
    }));
  const log = {};
  for (const [key, entry] of Object.entries(raw.log || {})) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(key) && entry && typeof entry.name === 'string') {
      log[key] = { name: entry.name, counts: validCounts(entry.counts), dishId: entry.dishId ?? null };
    }
  }
  const goals = {};
  for (const g of GOALS) {
    const v = Number(raw.goals?.[g.key]);
    goals[g.key] = Number.isInteger(v) && v >= 0 && v <= 7 ? v : 2;
  }
  return { version: 1, goals, dishes, log };
}

function loadState() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return normalizeState(JSON.parse(stored));
  } catch (err) {
    console.warn('Could not read stored data, starting fresh', err);
  }
  return defaultState();
}

let state = loadState();

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.error('Could not save data', err);
  }
}

/* ------------------------------------------------------------------ *
 * Date helpers (always local time, weeks start on Monday)
 * ------------------------------------------------------------------ */

function toKey(d) {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function fromKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(key, n) {
  const d = fromKey(key);
  d.setDate(d.getDate() + n);
  return toKey(d);
}

function todayKey() {
  return toKey(new Date());
}

function weekStart(key) {
  const d = fromKey(key);
  const offset = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - offset);
  return toKey(d);
}

function weekDays(key) {
  const start = weekStart(key);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

const fmtLong = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtShort = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' });
const fmtDow = new Intl.DateTimeFormat('es-ES', { weekday: 'short' });

// Spanish dates are lower case; only the first letter of a label is capitalised.
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/* ------------------------------------------------------------------ *
 * Domain logic
 * ------------------------------------------------------------------ */

// Counts how many lunches in the week of `key` add to each goal.
function weekTotals(key) {
  const totals = Object.fromEntries(GOALS.map((g) => [g.key, 0]));
  for (const day of weekDays(key)) {
    const entry = state.log[day];
    if (!entry) continue;
    for (const c of entry.counts) totals[c] += 1;
  }
  return totals;
}

// Normalised names eaten in the RECENT_DAYS before `key`.
function recentNames(key) {
  const names = new Set();
  for (let i = 1; i <= RECENT_DAYS; i++) {
    const entry = state.log[addDays(key, -i)];
    if (entry) names.add(entry.name.toLowerCase());
  }
  return names;
}

/*
 * Picks a random dish for `key`.
 * Priority 1: not eaten recently AND adds to a goal still pending this week.
 * Priority 2: not eaten recently. Fallback: anything except `excludeId`.
 */
function suggestDish(key, excludeId) {
  const totals = weekTotals(key);
  // Do not count the current day's own lunch against the pending goals
  const current = state.log[key];
  if (current) for (const c of current.counts) totals[c] -= 1;

  const pending = GOALS.filter((g) => totals[g.key] < state.goals[g.key]).map((g) => g.key);
  const recent = recentNames(key);
  const pool = state.dishes.filter((d) => d.id !== excludeId);
  const fresh = pool.filter((d) => !recent.has(d.name.toLowerCase()));
  const useful = fresh.filter((d) => d.counts.some((c) => pending.includes(c)));

  const candidates = useful.length ? useful : fresh.length ? fresh : pool;
  if (!candidates.length) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function setLunch(key, entry) {
  if (entry) state.log[key] = entry;
  else delete state.log[key];
  save();
}

function entryFromDish(dish) {
  return { name: dish.name, counts: [...dish.counts], dishId: dish.id };
}

function groupBySection(dishes) {
  const groups = new Map();
  for (const d of dishes) {
    if (!groups.has(d.section)) groups.set(d.section, []);
    groups.get(d.section).push(d);
  }
  const rank = (s) => {
    const i = SECTION_ORDER.indexOf(s);
    return i === -1 ? SECTION_ORDER.length : i;
  };
  return [...groups.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0], 'es'))
    .map(([section, list]) => [section, list.sort((a, b) => a.name.localeCompare(b.name, 'es'))]);
}

/* ------------------------------------------------------------------ *
 * Tiny DOM helper: h('div', { class: 'x', onclick }, child, ...)
 * Text children are inserted as text nodes, so user input is never
 * interpreted as HTML.
 * ------------------------------------------------------------------ */

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const $ = (sel) => document.querySelector(sel);

function tagList(counts) {
  if (!counts.length) return null;
  return h('div', { class: 'tags' }, counts.map((c) => h('span', { class: 'tag' }, GOALS.find((g) => g.key === c).label)));
}

/* ------------------------------------------------------------------ *
 * UI state
 * ------------------------------------------------------------------ */

const ui = {
  view: 'hoy',
  day: todayKey(),
  week: weekStart(todayKey()),
  idea: null, // dish currently proposed by "Dame una idea"
};

/* ---------- Sheet (bottom panel) ---------- */

function openSheet(title, ...content) {
  $('#sheet-title').textContent = title;
  $('#sheet-body').replaceChildren(...content);
  $('#sheet').hidden = false;
  $('#sheet-backdrop').hidden = false;
}

function closeSheet() {
  $('#sheet').hidden = true;
  $('#sheet-backdrop').hidden = true;
}

$('#sheet-close').addEventListener('click', closeSheet);
$('#sheet-backdrop').addEventListener('click', closeSheet);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSheet();
});

/* ---------- Today view ---------- */

function renderProgress(container, key) {
  const totals = weekTotals(key);
  container.replaceChildren(
    ...GOALS.map((g) => {
      const goal = state.goals[g.key];
      const value = totals[g.key];
      const pct = goal ? Math.min(100, (value / goal) * 100) : 100;
      return h(
        'div',
        { class: 'goal-row' + (value >= goal ? ' met' : '') },
        h('span', {}, g.label),
        h('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': goal, 'aria-valuenow': value, 'aria-label': g.label },
          h('span', { style: `width:${pct}%` })),
        h('span', { class: 'goal-count' }, `${value}/${goal}`),
      );
    }),
  );
}

function renderToday() {
  const key = ui.day;
  const isToday = key === todayKey();
  $('#day-label').textContent = isToday ? `Hoy, ${fmtLong.format(fromKey(key))}` : cap(fmtLong.format(fromKey(key)));
  $('#go-today').hidden = isToday;

  renderProgress($('#progress'), key);

  const entry = state.log[key];
  const slot = $('#slot');
  const actions = $('#slot-actions');

  if (ui.idea) {
    // Show the pending suggestion with accept / retry
    slot.replaceChildren(
      h('p', { class: 'idea-label' }, 'Idea'),
      h('p', { class: 'slot-name' }, ui.idea.name),
      tagList(ui.idea.counts),
    );
    actions.replaceChildren(
      h('button', { class: 'btn primary', onclick: () => { setLunch(key, entryFromDish(ui.idea)); ui.idea = null; render(); } }, 'Me lo quedo'),
      h('button', { class: 'btn', onclick: () => { ui.idea = suggestDish(key, ui.idea.id); render(); } }, 'Otra idea'),
      h('button', { class: 'btn', onclick: () => { ui.idea = null; render(); } }, 'Cancelar'),
    );
    return;
  }

  slot.replaceChildren(
    entry
      ? h('div', {}, h('p', { class: 'slot-name' }, entry.name), tagList(entry.counts))
      : h('p', { class: 'slot-empty' }, 'Sin elegir'),
  );
  actions.replaceChildren(
    h('button', { class: 'btn primary', onclick: openPicker }, entry ? 'Cambiar' : 'Elegir de la carta'),
    h('button', { class: 'btn', onclick: () => { ui.idea = suggestDish(key, entry?.dishId); render(); }, disabled: !state.dishes.length }, 'Dame una idea'),
    h('button', { class: 'btn', onclick: openCustom }, 'Otra cosa'),
    entry && h('button', { class: 'btn danger', onclick: () => { setLunch(key, null); render(); } }, 'Quitar'),
  );
}

function openPicker() {
  const key = ui.day;
  const recent = recentNames(key);
  const groups = groupBySection(state.dishes);
  const content = groups.length
    ? groups.map(([section, list]) => [
        h('h3', { class: 'group-title' }, section),
        h('ul', { class: 'dish-list' }, list.map((d) =>
          h('li', {}, h('button', {
            class: 'dish' + (recent.has(d.name.toLowerCase()) ? ' recent' : ''),
            onclick: () => { setLunch(key, entryFromDish(d)); closeSheet(); render(); },
          }, h('span', { class: 'dish-name' }, d.name), tagList(d.counts))))),
      ])
    : [h('p', { class: 'hint' }, 'La carta está vacía. Añade platos en la pestaña Carta.')];
  openSheet('Elegir almuerzo', ...content.flat());
}

function openCustom() {
  const key = ui.day;
  const current = state.log[key];
  const name = h('input', { type: 'text', maxlength: 80, placeholder: 'Por ejemplo: comida fuera', value: current && !current.dishId ? current.name : '' });
  const checks = GOALS.map((g) => {
    const input = h('input', { type: 'checkbox', value: g.key });
    input.checked = Boolean(current && !current.dishId && current.counts.includes(g.key));
    return [input, h('label', { class: 'check' }, input, `Cuenta como ${g.label.toLowerCase()}`)];
  });
  const form = h('form', {
    onsubmit: (e) => {
      e.preventDefault();
      const text = name.value.trim();
      if (!text) { name.focus(); return; }
      setLunch(key, { name: text, counts: checks.filter(([i]) => i.checked).map(([i]) => i.value), dishId: null });
      closeSheet();
      render();
    },
  },
  h('label', { class: 'field' }, h('span', {}, 'Qué has comido'), name),
  checks.map(([, label]) => label),
  h('button', { class: 'btn primary block', type: 'submit' }, 'Guardar'));
  openSheet('Otra cosa', form);
  name.focus();
}

/* ---------- Menu view ---------- */

function renderMenu() {
  const groups = groupBySection(state.dishes);
  $('#menu-list').replaceChildren(
    ...(groups.length
      ? groups.flatMap(([section, list]) => [
          h('h3', { class: 'group-title' }, section),
          h('ul', { class: 'dish-list' }, list.map((d) =>
            h('li', {}, h('button', { class: 'dish', onclick: () => openDishForm(d) },
              h('span', { class: 'dish-name' }, d.name), tagList(d.counts))))),
        ])
      : [h('p', { class: 'hint' }, 'No hay platos todavía.')]),
  );
}

function openDishForm(dish) {
  const isNew = !dish;
  const name = h('input', { type: 'text', maxlength: 80, required: true, value: dish?.name ?? '' });
  // Datalist offers existing sections but allows creating new ones
  const sections = [...new Set(state.dishes.map((d) => d.section))];
  const datalist = h('datalist', { id: 'section-options' }, sections.map((s) => h('option', { value: s })));
  const section = h('input', { type: 'text', maxlength: 40, list: 'section-options', required: true, value: dish?.section ?? '' });
  const checks = GOALS.map((g) => {
    const input = h('input', { type: 'checkbox', value: g.key });
    input.checked = Boolean(dish?.counts.includes(g.key));
    return input;
  });

  // Delete needs a second tap instead of a confirm() dialog
  let armed = false;
  const del = !isNew && h('button', {
    type: 'button',
    class: 'btn danger block',
    onclick: (e) => {
      if (!armed) { armed = true; e.currentTarget.textContent = 'Toca otra vez para eliminar'; return; }
      state.dishes = state.dishes.filter((d) => d.id !== dish.id);
      save();
      closeSheet();
      render();
    },
  }, 'Eliminar plato');

  const form = h('form', {
    onsubmit: (e) => {
      e.preventDefault();
      const data = {
        name: name.value.trim(),
        section: section.value.trim(),
        counts: checks.filter((i) => i.checked).map((i) => i.value),
      };
      if (!data.name || !data.section) return;
      if (isNew) state.dishes.push({ id: uid(), ...data });
      else Object.assign(dish, data);
      save();
      closeSheet();
      render();
    },
  },
  h('label', { class: 'field' }, h('span', {}, 'Nombre'), name),
  h('label', { class: 'field' }, h('span', {}, 'Sección'), section, datalist),
  h('p', { class: 'hint' }, 'Suma a'),
  GOALS.map((g, i) => h('label', { class: 'check' }, checks[i], g.label)),
  h('button', { class: 'btn primary block', type: 'submit' }, 'Guardar'),
  del);

  openSheet(isNew ? 'Nuevo plato' : 'Editar plato', form);
  if (isNew) name.focus();
}

$('#add-dish').addEventListener('click', () => openDishForm(null));

/* ---------- Week view ---------- */

function renderWeek() {
  const days = weekDays(ui.week);
  const first = fromKey(days[0]);
  const last = fromKey(days[6]);
  $('#week-label').textContent = `${fmtShort.format(first)} – ${fmtShort.format(last)}`;

  const today = todayKey();
  $('#week-list').replaceChildren(
    ...days.map((key) => {
      const entry = state.log[key];
      return h('li', {}, h('button', {
        class: 'week-day' + (key === today ? ' today' : ''),
        onclick: () => { ui.day = key; ui.idea = null; showView('hoy'); },
      },
      h('span', { class: 'week-dow' }, `${cap(fmtDow.format(fromKey(key)))} ${fromKey(key).getDate()}`),
      h('span', { class: 'week-meal' + (entry ? '' : ' empty') }, entry ? entry.name : '—')));
    }),
  );

  $('#goals').replaceChildren(
    ...GOALS.map((g) => {
      const out = h('output', {}, state.goals[g.key]);
      const change = (delta) => {
        state.goals[g.key] = Math.max(0, Math.min(7, state.goals[g.key] + delta));
        save();
        out.textContent = state.goals[g.key];
      };
      return h('div', { class: 'stepper' },
        h('span', {}, `${g.label} (veces por semana)`),
        h('div', { class: 'stepper-ctrl' },
          h('button', { class: 'icon-btn', 'aria-label': `Menos ${g.label}`, onclick: () => change(-1) }, '−'),
          out,
          h('button', { class: 'icon-btn', 'aria-label': `Más ${g.label}`, onclick: () => change(1) }, '+')));
    }),
  );
}

$('#prev-week').addEventListener('click', () => { ui.week = addDays(ui.week, -7); renderWeek(); });
$('#next-week').addEventListener('click', () => { ui.week = addDays(ui.week, 7); renderWeek(); });

/* ---------- Backup ---------- */

$('#export-btn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: `carta-comidas-${todayKey()}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  $('#backup-msg').textContent = 'Copia descargada.';
});

$('#import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = ''; // allow importing the same file twice
  if (!file) return;
  try {
    state = normalizeState(JSON.parse(await file.text()));
    save();
    render();
    $('#backup-msg').textContent = 'Copia importada.';
  } catch {
    $('#backup-msg').textContent = 'El archivo no es una copia válida.';
  }
});

/* ---------- Install prompt ---------- */

let installEvent = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e;
  $('#install-btn').hidden = false;
});
$('#install-btn').addEventListener('click', async () => {
  if (!installEvent) return;
  installEvent.prompt();
  await installEvent.userChoice;
  installEvent = null;
  $('#install-btn').hidden = true;
});
window.addEventListener('appinstalled', () => { $('#install-btn').hidden = true; });

/* ---------- Navigation ---------- */

const TITLES = { hoy: 'Hoy', carta: 'Carta', semana: 'Semana' };

function showView(view) {
  ui.view = view;
  for (const v of Object.keys(TITLES)) $(`#view-${v}`).hidden = v !== view;
  for (const tab of document.querySelectorAll('.tab')) tab.classList.toggle('active', tab.dataset.view === view);
  $('#title').textContent = TITLES[view];
  if (view === 'semana') ui.week = weekStart(ui.day);
  render();
  window.scrollTo(0, 0);
}

function render() {
  if (ui.view === 'hoy') renderToday();
  else if (ui.view === 'carta') renderMenu();
  else renderWeek();
}

for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => { closeSheet(); showView(tab.dataset.view); });
}
$('#prev-day').addEventListener('click', () => { ui.day = addDays(ui.day, -1); ui.idea = null; renderToday(); });
$('#next-day').addEventListener('click', () => { ui.day = addDays(ui.day, 1); ui.idea = null; renderToday(); });
$('#go-today').addEventListener('click', () => { ui.day = todayKey(); ui.idea = null; renderToday(); });

// When the app is reopened on a new day, jump to the real today
let lastSeenToday = todayKey();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const now = todayKey();
  if (now !== lastSeenToday) {
    if (ui.day === lastSeenToday) ui.day = now;
    lastSeenToday = now;
    render();
  }
});

save(); // persist the seed on first run
showView('hoy');

/* ---------- Service worker ---------- */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW registration failed', err));
  });
}
