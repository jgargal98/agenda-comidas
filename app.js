'use strict';

/* ------------------------------------------------------------------ *
 * Storage and data model
 *
 * state = {
 *   version: 7,
 *   counters: [{ id, label, type: 'min' | 'max', target }],  // per week
 *   dishes:   [{ id, section, name, counts: [counterId] }],
 *   log:      { 'YYYY-MM-DD': { primero: Slot | null, segundo: Slot | null } }
 * }
 * Slot = { name, counts, dishId | null }
 *
 * Each slot stores its own copy of name and counts so editing or deleting
 * a dish never rewrites history. A counter adds at most once per day: its
 * target means "lunches per week", not "dishes per week". Any dish can be
 * chosen as either course, and either course can stay empty.
 * ------------------------------------------------------------------ */

const STORAGE_KEY = 'carta-comidas:v1';
const STATE_VERSION = 7;
const RECENT_DAYS = 3;
const MAX_TARGET = 7;

// Beyond these amounts the Today view stops being readable at a glance.
const RECOMMENDED = { min: 4, max: 4 };

const COURSES = [
  { key: 'primero', label: 'Primero' },
  { key: 'segundo', label: 'Segundo' },
];

const TYPE_LABELS = { min: 'Mínimo', max: 'Máximo' };

const SEED_COUNTERS = [
  { id: 'legumbres', label: 'Legumbres', type: 'min', target: 2 },
  { id: 'pescado', label: 'Pescado', type: 'min', target: 2 },
  { id: 'azul', label: 'Pescado azul', type: 'min', target: 1 },
  { id: 'verdura', label: 'Verdura', type: 'min', target: 3 },
  { id: 'roja', label: 'Carne roja', type: 'max', target: 2 },
  { id: 'procesado', label: 'Procesado', type: 'max', target: 1 },
  { id: 'precocinado', label: 'Precocinado', type: 'max', target: 1 },
  { id: 'frito', label: 'Frito', type: 'max', target: 1 },
  { id: 'refinados', label: 'Hidratos refinados', type: 'max', target: 4 },
];

// Display order of sections in the menu; unknown sections go last.
const SECTION_ORDER = [
  'Legumbres', 'Guisos', 'Pasta', 'Noodles', 'Arroz', 'Carne y pescado',
  'Verdura y cremas', 'Frío', 'Huevo', 'Precocinado',
];

// Value of the section dropdown option that asks for a new section name.
const NEW_SECTION = '__new__';

// [section, name, counts, isNew]. isNew marks dishes that did not exist in v1,
// the only ones that migration may add without restoring a deleted dish.
const SEED_DISHES = [
  ['Legumbres', 'Lentejas', ['legumbres']],
  ['Legumbres', 'Ensalada de garbanzos', ['legumbres', 'verdura']],
  ['Guisos', 'Puchero con arroz', ['refinados']],
  ['Pasta', 'Pasta', ['refinados'], true],
  ['Pasta', 'Carbonara', ['procesado']],
  ['Pasta', 'Boloñesa', ['roja']],
  ['Pasta', 'Ensalada de pasta', ['refinados']],
  ['Noodles', 'Noodles', ['refinados'], true],
  ['Arroz', 'Arroz blanco', ['refinados'], true],
  ['Arroz', 'Arroz salteado', ['refinados']],
  ['Arroz', 'Paella de pollo y gambas', ['refinados']],
  ['Carne y pescado', 'Salmón', ['pescado', 'azul']],
  ['Carne y pescado', 'Pollo', [], true],
  ['Carne y pescado', 'Pavo', [], true],
  ['Carne y pescado', 'Ternera', ['roja'], true],
  ['Carne y pescado', 'Cerdo', ['roja'], true],
  ['Carne y pescado', 'Gambas', [], true],
  ['Verdura y cremas', 'Patatas', [], true],
  ['Verdura y cremas', 'Ensalada', [], true],
  ['Verdura y cremas', 'Crema de calabacín', ['verdura'], true],
  ['Verdura y cremas', 'Crema de calabaza', ['verdura'], true],
  ['Verdura y cremas', 'Salteado de verduras', ['verdura'], true],
  ['Verdura y cremas', 'Verdura a la plancha', ['verdura'], true],
  ['Frío', 'Ensaladilla rusa', []],
  ['Frío', 'Ensalada completa', ['verdura'], true],
  ['Huevo', 'Tortilla', [], true],
  ['Huevo', 'Revuelto de verduras', ['verdura'], true],
  ['Precocinado', 'Pizza', ['precocinado', 'refinados'], true],
  ['Precocinado', 'Hamburguesa', ['precocinado', 'refinados'], true],
  ['Precocinado', 'Empanados', ['precocinado', 'frito'], true],
].map(([section, name, counts, isNew = false]) => ({ section, name, counts, isNew }));

// v1 dish replaced by two separate dishes that can now be combined freely.
const V1_SPLIT_DISH = 'crema de calabacín y salmón';
// v1 seed dishes whose section changed, with the section they had. A dish the
// user moved somewhere else keeps its section.
const V1_MOVED_DISHES = { 'ensalada de garbanzos': 'Frío' };

// v3 seed dishes that v4 splits into a base and a dish of another section.
const V3_REMOVED_DISHES = new Set([
  'noodles con pollo', 'noodles con ternera', 'noodles con cerdo', 'noodles con gambas',
  'noodles con salmón', 'salmón sobre arroz',
]);
// v3 seed dishes that become plain proteins, with the section they had.
const V3_PROTEINS = {
  'salmón a la plancha': ['Salmón', 'Pescado'],
  'pollo a la plancha': ['Pollo', 'Carne blanca'],
  'pavo a la plancha': ['Pavo', 'Carne blanca'],
  'ternera a la plancha': ['Ternera', 'Carne roja'],
  'cerdo a la plancha': ['Cerdo', 'Carne roja'],
};
const V3_SAUCES = new Set(['carbonara', 'boloñesa']);
const V4_ADDED_DISHES = new Set(['Pasta', 'Noodles', 'Arroz blanco', 'Gambas']);

// v5 sections that v6 drops, with the section their dishes move to.
const V5_RENAMED_SECTIONS = { 'Proteínas': 'Carne y pescado', Salsas: 'Pasta', Guarniciones: 'Verdura y cremas' };
const V6_ADDED_DISHES = new Set(['Patatas', 'Ensalada']);

// Counters added in v7, and the dishes with their original names that add to them.
const V7_COUNTERS = ['azul', 'procesado', 'frito', 'refinados'];
const V7_DISH_COUNTERS = {
  'salmón': ['azul'],
  'carbonara': ['procesado'],
  'empanados': ['frito'],
  'puchero con arroz': ['refinados'],
  'pasta': ['refinados'],
  'ensalada de pasta': ['refinados'],
  'noodles': ['refinados'],
  'arroz blanco': ['refinados'],
  'arroz salteado': ['refinados'],
  'paella de pollo y gambas': ['refinados'],
  'pizza': ['refinados'],
  'hamburguesa': ['refinados'],
};

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const seedDish = ({ section, name, counts }) => ({ id: uid(), section, name, counts: [...counts] });

function defaultState() {
  return {
    version: STATE_VERSION,
    counters: SEED_COUNTERS.map((c) => ({ ...c })),
    dishes: SEED_DISHES.map(seedDish),
    log: {},
  };
}

// Turns a v1 state (one dish per day, fixed goals) into the current shape.
function migrateV1(raw) {
  const seeds = new Map(SEED_DISHES.map((s) => [s.name.toLowerCase(), s]));

  const counters = SEED_COUNTERS.map((c) => {
    const stored = Number(raw.goals?.[c.id]);
    return { ...c, target: Number.isInteger(stored) ? stored : c.target };
  });

  const dishes = [];
  for (const d of raw.dishes) {
    if (typeof d?.name !== 'string') continue;
    const low = d.name.trim().toLowerCase();
    if (low === V1_SPLIT_DISH) continue;
    const seed = seeds.get(low);
    if (!seed) {
      dishes.push(d); // created by the user, nothing to adapt
      continue;
    }
    const own = Array.isArray(d.counts) ? d.counts : [];
    dishes.push({
      ...d,
      section: d.section === V1_MOVED_DISHES[low] ? seed.section : d.section,
      counts: [...new Set([...own, ...seed.counts])],
    });
  }
  const names = new Set(dishes.map((d) => d.name.trim().toLowerCase()));
  for (const s of SEED_DISHES) {
    if (s.isNew && !names.has(s.name.toLowerCase())) dishes.push(seedDish(s));
  }

  const log = {};
  for (const [key, entry] of Object.entries(raw.log || {})) {
    if (typeof entry?.name === 'string') log[key] = [entry];
  }

  return { version: 3, counters, dishes, log };
}

// Splits the v3 seed dishes into combinable ones. Dishes with another name are
// the user's and stay untouched; history keeps its own copies of the names.
function migrateToV4(raw) {
  const lowName = (d) => (typeof d?.name === 'string' ? d.name.trim().toLowerCase() : '');
  const names = new Set(raw.dishes.map(lowName));

  const dishes = [];
  for (const d of raw.dishes) {
    const low = lowName(d);
    if (V3_REMOVED_DISHES.has(low)) continue;
    const protein = V3_PROTEINS[low];
    if (protein && !names.has(protein[0].toLowerCase())) {
      const [name, oldSection] = protein;
      dishes.push({ ...d, name, section: d.section === oldSection ? 'Proteínas' : d.section });
    } else if (V3_SAUCES.has(low)) {
      dishes.push({ ...d, section: d.section === 'Pasta' ? 'Salsas' : d.section });
    } else {
      dishes.push(d);
    }
  }

  const present = new Set(dishes.map(lowName));
  for (const s of SEED_DISHES) {
    if (V4_ADDED_DISHES.has(s.name) && !present.has(s.name.toLowerCase())) dishes.push(seedDish(s));
  }
  return { ...raw, version: 4, dishes };
}

// Moves dishes out of the sections that only made sense for combining dishes.
// Sections created by the user stay, and an existing dish is not duplicated.
function migrateToV6(raw) {
  const lowName = (d) => (typeof d?.name === 'string' ? d.name.trim().toLowerCase() : '');
  const dishes = raw.dishes.map((d) => {
    if (lowName(d) === 'arroz blanco' && d.section === 'Guarniciones') return { ...d, section: 'Arroz' };
    return { ...d, section: V5_RENAMED_SECTIONS[d?.section] ?? d?.section };
  });
  const present = new Set(dishes.map(lowName));
  for (const s of SEED_DISHES) {
    if (V6_ADDED_DISHES.has(s.name) && !present.has(s.name.toLowerCase())) dishes.push(seedDish(s));
  }
  return { ...raw, version: 6, dishes };
}

// Adds the new counters and classifies the dishes. A counter the user already
// created with the same name is reused instead of duplicated. Carbonara moves
// from red meat to processed, since only its bacon made it count; history stays.
function migrateToV7(raw) {
  const counters = [...raw.counters];
  const ids = {};
  for (const id of V7_COUNTERS) {
    const seed = SEED_COUNTERS.find((c) => c.id === id);
    const low = seed.label.toLowerCase();
    const existing = counters.find((c) => c?.id === id || (typeof c?.label === 'string' && c.label.trim().toLowerCase() === low));
    if (!existing) counters.push({ ...seed });
    ids[id] = existing?.id ?? id;
  }

  const dishes = raw.dishes.map((d) => {
    const low = typeof d?.name === 'string' ? d.name.trim().toLowerCase() : '';
    const added = V7_DISH_COUNTERS[low];
    if (!added) return d;
    const own = Array.isArray(d.counts) ? d.counts : [];
    const kept = low === 'carbonara' ? own.filter((id) => id !== 'roja') : own;
    return { ...d, counts: [...new Set([...kept, ...added.map((id) => ids[id])])] };
  });

  return { ...raw, version: 7, counters, dishes };
}

const clampTarget = (value, fallback) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= MAX_TARGET ? n : fallback;
};

// Validates and normalises any object (stored or imported) into a safe state.
function normalizeState(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.dishes) || typeof input.log !== 'object') {
    throw new Error('Formato no válido');
  }
  const upgraded = Array.isArray(input.counters) ? input : migrateV1(input);
  const atV4 = (Number(upgraded.version) || 1) < 4 ? migrateToV4(upgraded) : upgraded;
  const atV6 = Number(atV4.version) < 6 ? migrateToV6(atV4) : atV4;
  const raw = Number(atV6.version) < 7 ? migrateToV7(atV6) : atV6;

  const seen = new Set();
  const counters = [];
  for (const c of raw.counters) {
    if (typeof c?.label !== 'string' || !c.label.trim()) continue;
    const id = typeof c.id === 'string' && c.id && !seen.has(c.id) ? c.id : uid();
    seen.add(id);
    counters.push({ id, label: c.label.trim(), type: c.type === 'max' ? 'max' : 'min', target: clampTarget(c.target, 2) });
  }

  const validCounts = (list) => (Array.isArray(list) ? [...new Set(list.filter((id) => seen.has(id)))] : []);

  const dishes = raw.dishes
    .filter((d) => d && typeof d.name === 'string' && d.name.trim())
    .map((d) => ({
      id: typeof d.id === 'string' ? d.id : uid(),
      section: (typeof d.section === 'string' && d.section.trim()) || 'Otros',
      name: d.name.trim(),
      counts: validCounts(d.counts),
    }));

  const validSlot = (slot) => (slot && typeof slot.name === 'string' && slot.name.trim()
    ? { name: slot.name.trim(), counts: validCounts(slot.counts), dishId: slot.dishId ?? null }
    : null);

  // v3 to v5 stored a list of dishes. Beyond two, the rest join the second
  // course so that nothing already eaten disappears from the history.
  const mergeSlots = (slots) => {
    if (slots.length < 2) return slots[0] ?? null;
    return { name: slots.map((s) => s.name).join(' + '), counts: [...new Set(slots.flatMap((s) => s.counts))], dishId: null };
  };

  const log = {};
  for (const [key, entry] of Object.entries(raw.log || {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !entry) continue;
    const list = Array.isArray(entry) ? entry.map(validSlot).filter(Boolean) : null;
    const primero = list ? list[0] ?? null : validSlot(entry.primero);
    const segundo = list ? mergeSlots(list.slice(1)) : validSlot(entry.segundo);
    if (primero || segundo) log[key] = { primero, segundo };
  }

  return { version: STATE_VERSION, counters, dishes, log };
}

function loadState() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Keep an untouched copy in case a migration ever loses something
      const version = Number(parsed.version) || 1;
      if (version < STATE_VERSION) localStorage.setItem(`carta-comidas:v${version}-backup`, stored);
      return normalizeState(parsed);
    }
  } catch (err) {
    console.warn('Could not read stored data, starting fresh', err);
  }
  return defaultState();
}

let state = loadState();

// Writes to this device only, for changes that are not the user's own edits.
function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.error('Could not save data', err);
  }
}

// Saves a user's edit and queues it for the other devices.
function save() {
  persist();
  markLocalEdit();
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

// Minimums first, then maximums, keeping the order they were created in.
function orderedCounters() {
  return [...state.counters.filter((c) => c.type === 'min'), ...state.counters.filter((c) => c.type === 'max')];
}

// The dishes chosen on `key`, optionally leaving one course out.
function daySlots(key, skipCourse = null) {
  return COURSES.filter((c) => c.key !== skipCourse).map((c) => state.log[key]?.[c.key]).filter(Boolean);
}

// Counter ids the lunch of `key` adds to, optionally leaving one course out.
function dayCounts(key, skipCourse = null) {
  return new Set(daySlots(key, skipCourse).flatMap((slot) => slot.counts));
}

// Lunches of the week of `key` that add to each counter. `skipCourse` leaves
// that course out on the day `key` only, to evaluate replacing it.
function weekTotals(key, skipCourse = null) {
  const totals = Object.fromEntries(state.counters.map((c) => [c.id, 0]));
  for (const day of weekDays(key)) {
    for (const id of dayCounts(day, day === key ? skipCourse : null)) {
      if (id in totals) totals[id] += 1;
    }
  }
  return totals;
}

/*
 * What choosing a dish for `course` on `key` would change this week.
 * A counter the other course already adds to cannot change: it neither helps
 * a pending minimum nor pushes a maximum further.
 */
function courseImpact(key, course) {
  const totals = weekTotals(key, course);
  const today = dayCounts(key, course);
  const open = state.counters.filter((c) => !today.has(c.id));
  return {
    pending: new Set(open.filter((c) => c.type === 'min' && totals[c.id] < c.target).map((c) => c.id)),
    blocked: new Set(open.filter((c) => c.type === 'max' && totals[c.id] >= c.target).map((c) => c.id)),
  };
}

// Normalised names eaten in the RECENT_DAYS before `key`.
function recentNames(key) {
  const names = new Set();
  for (let i = 1; i <= RECENT_DAYS; i++) {
    for (const slot of daySlots(addDays(key, -i))) names.add(slot.name.toLowerCase());
  }
  return names;
}

/*
 * Picks a random dish for `course` on `key`: never one already chosen that day
 * nor one that breaks a maximum.
 * Priority 1: not eaten recently AND adds to a minimum still pending.
 * Priority 2: not eaten recently. Fallback: anything except `excludeId`.
 */
function suggestDish(key, course, excludeId) {
  const { pending, blocked } = courseImpact(key, course);
  const recent = recentNames(key);
  const chosen = new Set(daySlots(key, course).map((slot) => slot.dishId));
  const pool = state.dishes.filter((d) => d.id !== excludeId && !chosen.has(d.id) && !d.counts.some((c) => blocked.has(c)));
  const fresh = pool.filter((d) => !recent.has(d.name.toLowerCase()));
  const useful = fresh.filter((d) => d.counts.some((c) => pending.has(c)));

  const candidates = useful.length ? useful : fresh.length ? fresh : pool;
  if (!candidates.length) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function setSlot(key, course, slot) {
  const entry = { primero: null, segundo: null, ...state.log[key], [course]: slot };
  if (entry.primero || entry.segundo) state.log[key] = entry;
  else delete state.log[key];
  save();
}

function slotFromDish(dish) {
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
  const tags = counts
    .map((id) => state.counters.find((c) => c.id === id))
    .filter(Boolean)
    .map((c) => h('span', { class: `tag ${c.type}` }, c.label));
  return tags.length ? h('div', { class: 'tags' }, tags) : null;
}

/* ------------------------------------------------------------------ *
 * UI state
 * ------------------------------------------------------------------ */

const ui = {
  view: 'hoy',
  day: todayKey(),
  week: weekStart(todayKey()),
  idea: null, // { course, dish } currently proposed by "Dame una idea"
  notice: null, // { course, text } shown once, on the next render
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
  // A sync that waited for the sheet can run now
  if (sync.deferred) scheduleSync(0);
}

$('#sheet-close').addEventListener('click', closeSheet);
$('#sheet-backdrop').addEventListener('click', closeSheet);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSheet();
});

/* ---------- Today view ---------- */

function renderProgress(container, key) {
  const counters = orderedCounters();
  if (!counters.length) {
    container.replaceChildren(h('p', { class: 'hint' }, 'No hay contadores. Créalos en la pestaña Semana.'));
    return;
  }
  const totals = weekTotals(key);
  container.replaceChildren(
    ...counters.map((c) => {
      const value = totals[c.id];
      const isMax = c.type === 'max';
      const excess = isMax ? value - c.target : 0;
      // A minimum of 0 is already met; a maximum of 0 is empty until exceeded
      const full = c.target ? (value / c.target) * 100 : isMax && !value ? 0 : 100;
      const state_ = isMax ? (excess > 0 ? ' over' : '') : value >= c.target ? ' met' : '';
      const text = isMax ? `${value} / máx. ${c.target}` : `${value}/${c.target}`;
      return h(
        'div',
        { class: `goal-row ${c.type}${state_}` },
        h('span', { class: 'goal-label' }, c.label),
        h('div', {
          class: 'bar',
          role: 'progressbar',
          'aria-label': c.label,
          'aria-valuemin': 0,
          'aria-valuemax': c.target,
          'aria-valuenow': Math.min(value, c.target),
          'aria-valuetext': text,
        }, h('span', { style: `width:${Math.min(100, full)}%` })),
        h('span', { class: 'goal-count' }, text),
        excess > 0 && h('p', { class: 'goal-note' }, `Te has pasado en ${excess}`),
      );
    }),
  );
}

function renderSlot(key, { key: course, label }) {
  const slot = state.log[key]?.[course] ?? null;
  const notice = ui.notice?.course === course ? ui.notice.text : '';
  if (notice) ui.notice = null;
  const idea = ui.idea?.course === course ? ui.idea.dish : null;

  const askIdea = (excludeId) => {
    const dish = suggestDish(key, course, excludeId);
    ui.idea = dish && { course, dish };
    if (!dish) ui.notice = { course, text: 'No hay más ideas dentro de tus límites.' };
    renderToday();
  };

  if (idea) {
    return h('div', { class: 'card' },
      h('h2', { class: 'card-title' }, label),
      h('div', { class: 'slot' },
        h('p', { class: 'idea-label' }, 'Idea'),
        h('p', { class: 'slot-name' }, idea.name),
        tagList(idea.counts)),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onclick: () => { setSlot(key, course, slotFromDish(idea)); ui.idea = null; renderToday(); } }, 'Me lo quedo'),
        h('button', { class: 'btn', onclick: () => askIdea(idea.id) }, 'Otra idea'),
        h('button', { class: 'btn', onclick: () => { ui.idea = null; renderToday(); } }, 'Cancelar')));
  }

  return h('div', { class: 'card' },
    h('h2', { class: 'card-title' }, label),
    h('div', { class: 'slot' },
      slot
        ? [h('p', { class: 'slot-name' }, slot.name), tagList(slot.counts)]
        : h('p', { class: 'slot-empty' }, 'Sin elegir')),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', onclick: () => openPicker(course, label) }, slot ? 'Cambiar' : 'Elegir de la carta'),
      h('button', { class: 'btn', onclick: () => askIdea(slot?.dishId) }, 'Dame una idea'),
      h('button', { class: 'btn', onclick: () => openCustom(course) }, 'Otra cosa'),
      slot && h('button', { class: 'btn danger', onclick: () => { setSlot(key, course, null); renderToday(); } }, 'Quitar')),
    notice && h('p', { class: 'hint', role: 'status' }, notice));
}

function renderToday() {
  const key = ui.day;
  const isToday = key === todayKey();
  $('#day-label').textContent = isToday ? `Hoy, ${fmtLong.format(fromKey(key))}` : cap(fmtLong.format(fromKey(key)));
  $('#go-today').hidden = isToday;

  renderProgress($('#progress'), key);
  $('#lunch').replaceChildren(...COURSES.map((c) => renderSlot(key, c)));
}

function openPicker(course, label) {
  const key = ui.day;
  const recent = recentNames(key);
  const { blocked } = courseImpact(key, course);
  const chosen = new Set(daySlots(key, course).map((slot) => slot.dishId));
  const groups = groupBySection(state.dishes);
  const content = groups.length
    ? groups.flatMap(([section, list]) => [
        h('h3', { class: 'group-title' }, section),
        h('ul', { class: 'dish-list' }, list.map((d) => {
          const isChosen = chosen.has(d.id);
          // A warning only: the person planning the menu has the last word
          const notes = [
            isChosen && 'ya elegido',
            recent.has(d.name.toLowerCase()) && 'reciente',
            d.counts.some((c) => blocked.has(c)) && 'superaría un límite',
          ].filter(Boolean);
          return h('li', {}, h('button', {
            class: 'dish',
            disabled: isChosen,
            onclick: () => { setSlot(key, course, slotFromDish(d)); ui.idea = null; closeSheet(); renderToday(); },
          },
          h('span', { class: 'dish-name' }, d.name,
            notes.length > 0 && h('span', { class: 'dish-note' }, ` · ${notes.join(' · ')}`)),
          tagList(d.counts)));
        })),
      ])
    : [h('p', { class: 'hint' }, 'La carta está vacía. Añade platos en la pestaña Carta.')];
  openSheet(`Elegir ${label.toLowerCase()}`, ...content);
}

function openCustom(course) {
  const key = ui.day;
  const name = h('input', { type: 'text', maxlength: 80, placeholder: 'Por ejemplo: comida fuera' });
  const checks = orderedCounters().map((c) => {
    const input = h('input', { type: 'checkbox', value: c.id });
    return [input, h('label', { class: 'check' }, input, `Cuenta como ${c.label.toLowerCase()}`)];
  });
  const form = h('form', {
    onsubmit: (e) => {
      e.preventDefault();
      const text = name.value.trim();
      if (!text) { name.focus(); return; }
      setSlot(key, course, { name: text, counts: checks.filter(([i]) => i.checked).map(([i]) => i.value), dishId: null });
      ui.idea = null;
      closeSheet();
      renderToday();
    },
  },
  h('label', { class: 'field' }, h('span', {}, 'Qué has comido'), name),
  checks.map(([, check]) => check),
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

// Radio group for a fixed list of [value, label] options, with its reader.
function radioGroup(legend, groupName, options, selected) {
  const inputs = options.map(([value]) => {
    const input = h('input', { type: 'radio', name: groupName, value });
    input.checked = value === selected;
    return input;
  });
  return {
    element: h('fieldset', { class: 'choice' },
      h('legend', {}, legend),
      options.map(([, label], i) => h('label', { class: 'check' }, inputs[i], label))),
    value: () => inputs.find((i) => i.checked).value,
  };
}

// Delete button that needs a second tap instead of a confirm() dialog.
function deleteButton(label, armedLabel, onConfirm) {
  let armed = false;
  return h('button', {
    type: 'button',
    class: 'btn danger block',
    onclick: (e) => {
      if (!armed) { armed = true; e.currentTarget.textContent = armedLabel; return; }
      onConfirm();
    },
  }, label);
}

function openDishForm(dish) {
  const isNew = !dish;
  const name = h('input', { type: 'text', maxlength: 80, required: true, value: dish?.name ?? '' });
  // Known sections first, then the user's own, plus a way to create a new one
  const own = state.dishes.map((d) => d.section).filter((s) => !SECTION_ORDER.includes(s)).sort((a, b) => a.localeCompare(b, 'es'));
  const section = h('select', {
    required: true,
    onchange: () => {
      const isNewSection = section.value === NEW_SECTION;
      newSectionField.hidden = !isNewSection;
      newSection.required = isNewSection;
      if (isNewSection) newSection.focus();
    },
  },
  h('option', { value: '' }, 'Elige una sección'),
  [...new Set([...SECTION_ORDER, ...own])].map((s) => h('option', { value: s }, s)),
  h('option', { value: NEW_SECTION }, 'Otra sección…'));
  section.value = dish?.section ?? '';
  const newSection = h('input', { type: 'text', maxlength: 40 });
  const newSectionField = h('label', { class: 'field', hidden: true }, h('span', {}, 'Nombre de la sección'), newSection);
  const counters = orderedCounters();
  const checks = counters.map((c) => {
    const input = h('input', { type: 'checkbox', value: c.id });
    input.checked = Boolean(dish?.counts.includes(c.id));
    return input;
  });

  const del = !isNew && deleteButton('Eliminar plato', 'Toca otra vez para eliminar', () => {
    state.dishes = state.dishes.filter((d) => d.id !== dish.id);
    ui.idea = null;
    save();
    closeSheet();
    render();
  });

  const form = h('form', {
    onsubmit: (e) => {
      e.preventDefault();
      const data = {
        name: name.value.trim(),
        section: (section.value === NEW_SECTION ? newSection.value : section.value).trim(),
        counts: checks.filter((i) => i.checked).map((i) => i.value),
      };
      if (!data.name || !data.section) return;
      if (isNew) state.dishes.push({ id: uid(), ...data });
      else Object.assign(dish, data);
      ui.idea = null;
      save();
      closeSheet();
      render();
    },
  },
  h('label', { class: 'field' }, h('span', {}, 'Nombre'), name),
  h('label', { class: 'field' }, h('span', {}, 'Sección'), section),
  newSectionField,
  counters.length > 0 && h('p', { class: 'hint' }, 'Suma a'),
  counters.map((c, i) => h('label', { class: 'check' }, checks[i], c.label)),
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
      const names = daySlots(key).map((slot) => slot.name);
      return h('li', {}, h('button', {
        class: 'week-day' + (key === today ? ' today' : ''),
        onclick: () => { ui.day = key; ui.idea = null; showView('hoy'); },
      },
      h('span', { class: 'week-dow' }, `${cap(fmtDow.format(fromKey(key)))} ${fromKey(key).getDate()}`),
      h('span', { class: 'week-meal' + (names.length ? '' : ' empty') },
        names.length ? names.map((n) => h('span', { class: 'week-meal-line' }, n)) : '—')));
    }),
  );

  renderCounters();
  renderSync();
}

function renderCounters() {
  const counters = orderedCounters();
  const crowded = Object.entries(RECOMMENDED).some(([type, limit]) => counters.filter((c) => c.type === type).length > limit);

  $('#counters').replaceChildren(
    ...counters.map((c) => {
      const out = h('output', {}, c.target);
      const change = (delta) => {
        c.target = Math.max(0, Math.min(MAX_TARGET, c.target + delta));
        save();
        out.textContent = c.target;
      };
      return h('div', { class: 'stepper' },
        h('button', { class: 'counter-open', 'aria-label': `Editar ${c.label}`, onclick: () => openCounterForm(c) },
          h('span', { class: 'counter-name' }, c.label),
          h('span', { class: 'counter-type' }, `${TYPE_LABELS[c.type]} por semana`)),
        h('div', { class: 'stepper-ctrl' },
          h('button', { class: 'icon-btn', 'aria-label': `Bajar ${c.label}`, onclick: () => change(-1) }, '−'),
          out,
          h('button', { class: 'icon-btn', 'aria-label': `Subir ${c.label}`, onclick: () => change(1) }, '+')));
    }),
    ...(counters.length ? [] : [h('p', { class: 'hint' }, 'No hay contadores todavía.')]),
    ...(crowded
      ? [h('p', { class: 'hint' }, `Con más de ${RECOMMENDED.min} mínimos o ${RECOMMENDED.max} máximos, la pantalla Hoy deja de leerse de un vistazo.`)]
      : []),
    h('button', { class: 'btn block', onclick: () => openCounterForm(null) }, 'Añadir contador'),
  );
}

function openCounterForm(counter) {
  const isNew = !counter;
  const name = h('input', {
    type: 'text',
    maxlength: 24,
    required: true,
    value: counter?.label ?? '',
    oninput: (e) => {
      const low = e.target.value.trim().toLowerCase();
      const taken = state.counters.some((c) => c !== counter && c.label.toLowerCase() === low);
      e.target.setCustomValidity(taken ? 'Ya hay un contador con este nombre' : '');
    },
  });
  const type = radioGroup('Tipo', 'counter-type', [['min', 'Mínimo: avisa de lo que falta'], ['max', 'Máximo: avisa si te pasas']], counter?.type ?? 'min');
  const target = h('input', { type: 'number', min: 0, max: MAX_TARGET, step: 1, required: true, inputmode: 'numeric', value: counter?.target ?? 1 });

  const used = isNew ? 0 : state.dishes.filter((d) => d.counts.includes(counter.id)).length;
  const del = !isNew && deleteButton('Eliminar contador', `Toca otra vez: se quitará de ${used} ${used === 1 ? 'plato' : 'platos'}`, () => {
    const strip = (holder) => { holder.counts = holder.counts.filter((id) => id !== counter.id); };
    state.counters = state.counters.filter((c) => c !== counter);
    state.dishes.forEach(strip);
    Object.keys(state.log).flatMap((day) => daySlots(day)).forEach(strip);
    save();
    closeSheet();
    render();
  });

  const form = h('form', {
    onsubmit: (e) => {
      e.preventDefault();
      const data = { label: name.value.trim(), type: type.value(), target: Number(target.value) };
      if (!data.label) { name.focus(); return; }
      if (isNew) state.counters.push({ id: uid(), ...data });
      else Object.assign(counter, data);
      save();
      closeSheet();
      render();
    },
  },
  h('label', { class: 'field' }, h('span', {}, 'Nombre'), name),
  type.element,
  h('label', { class: 'field' }, h('span', {}, 'Veces por semana'), target),
  h('button', { class: 'btn primary block', type: 'submit' }, 'Guardar'),
  del);

  openSheet(isNew ? 'Nuevo contador' : 'Editar contador', form);
  if (isNew) name.focus();
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
    ui.idea = null;
    save();
    render();
    $('#backup-msg').textContent = 'Copia importada.';
  } catch {
    $('#backup-msg').textContent = 'El archivo no es una copia válida.';
  }
});

/* ---------- Sync between devices ---------- *
 *
 * localStorage stays the working copy, so the app keeps working offline. The
 * server holds one document with a revision number; `revision` below is the
 * last one this device has seen and `dirty` means it has edits not uploaded yet.
 * Two different versions are never merged or overwritten silently: the user
 * chooses, and the discarded version is kept in CONFLICT_BACKUP_KEY.
 */

const SYNC_META_KEY = 'carta-comidas:sync';
const CONFLICT_BACKUP_KEY = 'carta-comidas:conflict-backup';
const SYNC_DELAY_MS = 1000;
const SYNC_TIMEOUT_MS = 10000;

function loadSyncMeta() {
  const empty = { key: '', revision: 0, dirty: false, lastSync: null };
  try {
    return { ...empty, ...JSON.parse(localStorage.getItem(SYNC_META_KEY)) };
  } catch {
    return empty;
  }
}

const sync = {
  meta: loadSyncMeta(),
  status: '',
  edits: 0, // local edits in this session, to notice one made during a request
  running: false,
  rerun: false,
  deferred: false,
  timer: null,
};

function saveSyncMeta() {
  try {
    localStorage.setItem(SYNC_META_KEY, JSON.stringify(sync.meta));
  } catch (err) {
    console.error('Could not save sync data', err);
  }
}

function setSyncStatus(text) {
  sync.status = text;
  if (ui.view === 'semana') renderSync();
}

function scheduleSync(delay = SYNC_DELAY_MS) {
  clearTimeout(sync.timer);
  sync.timer = setTimeout(runSync, delay);
}

function markLocalEdit() {
  sync.edits += 1;
  if (!sync.meta.key) return;
  sync.meta.dirty = true;
  saveSyncMeta();
  scheduleSync();
}

function syncRequest(method, body) {
  return fetch('/api/state', {
    method,
    headers: { Authorization: `Bearer ${sync.meta.key}`, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
  });
}

function syncDone(revision) {
  sync.meta.revision = revision;
  sync.meta.lastSync = new Date().toISOString();
  saveSyncMeta();
  setSyncStatus('Sincronizado.');
}

// Explains a failed answer. Returns true when the response can be used.
function checkSyncResponse(res) {
  if (res.ok) return true;
  if (res.status === 401) setSyncStatus('La clave no es correcta.');
  else if (res.status === 503) setSyncStatus('La sincronización no está configurada en el servidor.');
  else setSyncStatus('El servidor no ha podido sincronizar. Se reintentará más tarde.');
  return false;
}

async function uploadState(baseRevision) {
  const editsAtStart = sync.edits;
  const res = await syncRequest('PUT', { baseRevision, data: state });
  if (res.status === 409) {
    // Another device saved first: start over to see its version
    sync.rerun = true;
    return;
  }
  if (!checkSyncResponse(res)) return;
  const { revision } = await res.json();
  // An edit made during the upload still has to go up
  sync.meta.dirty = sync.edits !== editsAtStart;
  syncDone(revision);
  if (sync.meta.dirty) scheduleSync();
}

function adoptRemote(remote) {
  let incoming;
  try {
    incoming = normalizeState(remote.data);
  } catch {
    setSyncStatus('Los datos del servidor no son válidos. No se han aplicado.');
    return;
  }
  state = incoming;
  ui.idea = null;
  persist();
  sync.meta.dirty = false;
  syncDone(remote.revision);
  render();
}

// Keeps the version the user is about to discard, in case it was the wrong choice.
function backupDiscarded(data) {
  try {
    localStorage.setItem(CONFLICT_BACKUP_KEY, JSON.stringify(data));
  } catch (err) {
    console.error('Could not keep the discarded version', err);
  }
}

function openConflict(remote) {
  const describe = (data) => {
    const days = Object.keys(data.log ?? {}).length;
    return `${days} ${days === 1 ? 'día' : 'días'} con almuerzo, ${data.dishes.length} platos`;
  };
  const when = new Date(remote.updatedAt).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });

  const choose = async (action) => {
    closeSheet();
    try {
      await action();
    } catch {
      setSyncStatus('Sin conexión. Se sincronizará cuando vuelva la red.');
    }
    // This runs outside runSync, so a conflict on upload has to restart it here
    if (sync.rerun) {
      sync.rerun = false;
      scheduleSync(0);
    }
  };
  const keepLocal = () => choose(() => {
    backupDiscarded(remote.data);
    sync.meta.dirty = true;
    saveSyncMeta();
    return uploadState(remote.revision);
  });
  const keepRemote = () => choose(() => {
    backupDiscarded(state);
    adoptRemote(remote);
  });

  setSyncStatus('Hay dos versiones distintas. Elige cuál conservar.');
  openSheet('Hay dos versiones',
    h('p', {}, 'Este dispositivo y el servidor tienen datos distintos. Elige cuál conservar en todos tus dispositivos.'),
    h('button', { class: 'btn block', onclick: keepRemote }, `La del servidor (${when})`),
    h('p', { class: 'hint' }, describe(remote.data)),
    h('button', { class: 'btn block', onclick: keepLocal }, 'La de este dispositivo'),
    h('p', { class: 'hint' }, describe(state)));
}

async function syncOnce() {
  const { meta } = sync;
  const editsAtStart = sync.edits;
  const res = await syncRequest('GET');
  if (!checkSyncResponse(res)) return;
  const remote = await res.json();

  // An edit made during the request changes the decision: look again
  if (sync.edits !== editsAtStart) {
    sync.rerun = true;
    return;
  }
  // An older copy of the app must not rewrite data it does not fully understand
  if (Number(remote.data?.version) > STATE_VERSION) {
    setSyncStatus('Otro dispositivo usa una versión más nueva. Vuelve a abrir la app para actualizarla.');
    return;
  }
  // The sheet may have been opened during the request
  if (!$('#sheet').hidden) {
    sync.deferred = true;
    return;
  }

  if (remote.revision === 0) await uploadState(0);
  else if (remote.revision === meta.revision) {
    if (meta.dirty) await uploadState(remote.revision);
    else syncDone(remote.revision);
  } else if (meta.dirty || meta.revision === 0) openConflict(remote);
  else adoptRemote(remote);
}

async function runSync() {
  if (!sync.meta.key) return;
  if (sync.running) {
    sync.rerun = true;
    return;
  }
  // Replacing the state under an open form would lose what is being edited
  if (!$('#sheet').hidden) {
    sync.deferred = true;
    return;
  }
  sync.deferred = false;
  sync.running = true;
  try {
    await syncOnce();
  } catch {
    setSyncStatus('Sin conexión. Se sincronizará cuando vuelva la red.');
  } finally {
    sync.running = false;
    if (sync.rerun) {
      sync.rerun = false;
      scheduleSync(0);
    }
  }
}

function renderSync() {
  const { meta } = sync;
  if (!meta.key) {
    const key = h('input', { type: 'password', required: true, autocomplete: 'off' });
    $('#sync').replaceChildren(h('form', {
      onsubmit: (e) => {
        e.preventDefault();
        const value = key.value.trim();
        if (!value) return;
        Object.assign(sync.meta, { key: value, revision: 0, dirty: false, lastSync: null });
        saveSyncMeta();
        setSyncStatus('Conectando…');
        runSync();
      },
    },
    h('label', { class: 'field' }, h('span', {}, 'Clave de sincronización'), key),
    h('button', { class: 'btn primary', type: 'submit' }, 'Conectar')));
    return;
  }

  const last = meta.lastSync
    && `Última vez: ${new Date(meta.lastSync).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}.`;
  $('#sync').replaceChildren(
    h('p', { class: 'hint', role: 'status' }, sync.status || 'Conectado.', meta.dirty ? ' Hay cambios pendientes de subir.' : ''),
    last && h('p', { class: 'hint' }, last),
    h('div', { class: 'actions' },
      h('button', { class: 'btn', onclick: runSync }, 'Sincronizar ahora'),
      h('button', {
        class: 'btn danger',
        onclick: () => {
          // Only this device stops syncing: its data and the server's stay as they are
          clearTimeout(sync.timer);
          Object.assign(sync.meta, { key: '', revision: 0, dirty: false, lastSync: null });
          saveSyncMeta();
          sync.status = '';
          renderSync();
        },
      }, 'Desconectar')));
}

window.addEventListener('online', () => scheduleSync(0));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') scheduleSync(0);
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

persist(); // the seed or migrated data is not an edit to send to other devices
showView('hoy');
runSync();

/* ---------- Service worker ---------- */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW registration failed', err));
  });
}
