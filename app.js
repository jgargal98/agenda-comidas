'use strict';

/* ------------------------------------------------------------------ *
 * Storage and data model
 *
 * state = {
 *   version: 2,
 *   counters: [{ id, label, type: 'min' | 'max', target }],  // per week
 *   dishes:   [{ id, course: 'primero' | 'segundo', section, name, counts: [counterId] }],
 *   log:      { 'YYYY-MM-DD': { primero: Slot | null, segundo: Slot | null } }
 * }
 * Slot = { name, counts, dishId | null }
 *
 * Each slot stores its own copy of name and counts so editing or deleting
 * a dish never rewrites history. A counter adds at most once per day: its
 * target means "lunches per week", not "dishes per week".
 * ------------------------------------------------------------------ */

const STORAGE_KEY = 'carta-comidas:v1';
const PRE_MIGRATION_KEY = 'carta-comidas:v1-backup';
const STATE_VERSION = 2;
const RECENT_DAYS = 3;
const MAX_TARGET = 7;

// Beyond these amounts the Today view stops being readable at a glance.
const RECOMMENDED = { min: 3, max: 2 };

const COURSES = [
  { key: 'primero', label: 'Primero', plural: 'Primeros' },
  { key: 'segundo', label: 'Segundo', plural: 'Segundos' },
];

const TYPE_LABELS = { min: 'Mínimo', max: 'Máximo' };

const SEED_COUNTERS = [
  { id: 'legumbres', label: 'Legumbres', type: 'min', target: 2 },
  { id: 'pescado', label: 'Pescado', type: 'min', target: 2 },
  { id: 'verdura', label: 'Verdura', type: 'min', target: 3 },
  { id: 'roja', label: 'Carne roja', type: 'max', target: 2 },
  { id: 'precocinado', label: 'Precocinado', type: 'max', target: 1 },
];

// Display order of sections in the menu; unknown sections go last.
const SECTION_ORDER = [
  'Legumbres', 'Guisos', 'Pescado', 'Carne blanca', 'Carne roja', 'Pasta', 'Arroz',
  'Noodles', 'Verdura y cremas', 'Frío', 'Huevo', 'Precocinado',
];

// [course, section, name, counts, isNew]. isNew marks dishes that did not exist
// in v1, the only ones a migration may add without restoring a deleted dish.
const SEED_DISHES = [
  ['primero', 'Legumbres', 'Lentejas', ['legumbres']],
  ['primero', 'Legumbres', 'Ensalada de garbanzos', ['legumbres', 'verdura']],
  ['primero', 'Guisos', 'Puchero con arroz', []],
  ['primero', 'Pasta', 'Carbonara', ['roja']],
  ['primero', 'Pasta', 'Boloñesa', ['roja']],
  ['primero', 'Pasta', 'Ensalada de pasta', []],
  ['primero', 'Arroz', 'Arroz salteado', []],
  ['primero', 'Arroz', 'Paella de pollo y gambas', []],
  ['primero', 'Noodles', 'Noodles con pollo', []],
  ['primero', 'Noodles', 'Noodles con ternera', ['roja']],
  ['primero', 'Noodles', 'Noodles con cerdo', ['roja']],
  ['primero', 'Noodles', 'Noodles con gambas', []],
  ['primero', 'Noodles', 'Noodles con salmón', ['pescado']],
  ['primero', 'Verdura y cremas', 'Crema de calabacín', ['verdura'], true],
  ['primero', 'Verdura y cremas', 'Crema de calabaza', ['verdura'], true],
  ['primero', 'Verdura y cremas', 'Salteado de verduras', ['verdura'], true],
  ['primero', 'Verdura y cremas', 'Verdura a la plancha', ['verdura'], true],
  ['primero', 'Frío', 'Ensaladilla rusa', []],
  ['primero', 'Frío', 'Ensalada completa', ['verdura'], true],
  ['segundo', 'Pescado', 'Salmón a la plancha', ['pescado']],
  ['segundo', 'Pescado', 'Salmón sobre arroz', ['pescado']],
  ['segundo', 'Carne blanca', 'Pollo a la plancha', [], true],
  ['segundo', 'Carne blanca', 'Pavo a la plancha', [], true],
  ['segundo', 'Carne roja', 'Ternera a la plancha', ['roja'], true],
  ['segundo', 'Carne roja', 'Cerdo a la plancha', ['roja'], true],
  ['segundo', 'Huevo', 'Tortilla', [], true],
  ['segundo', 'Huevo', 'Revuelto de verduras', ['verdura'], true],
  ['segundo', 'Precocinado', 'Pizza', ['precocinado'], true],
  ['segundo', 'Precocinado', 'Hamburguesa', ['precocinado'], true],
  ['segundo', 'Precocinado', 'Empanados', ['precocinado'], true],
].map(([course, section, name, counts, isNew = false]) => ({ course, section, name, counts, isNew }));

// v1 dish replaced by two separate dishes that can now be combined freely.
const V1_SPLIT_DISH = 'crema de calabacín y salmón';
// v1 seed dishes whose section changed, with the section they had. A dish the
// user moved somewhere else keeps its section.
const V1_MOVED_DISHES = { 'ensalada de garbanzos': 'Frío' };

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const seedDish = ({ course, section, name, counts }) => ({ id: uid(), course, section, name, counts: [...counts] });

function defaultState() {
  return {
    version: STATE_VERSION,
    counters: SEED_COUNTERS.map((c) => ({ ...c })),
    dishes: SEED_DISHES.map(seedDish),
    log: {},
  };
}

// Turns a v1 state (one dish per day, fixed goals) into the v2 shape.
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
      // Dishes created by the user: a main course is the safest guess
      dishes.push({ ...d, course: 'segundo' });
      continue;
    }
    const own = Array.isArray(d.counts) ? d.counts : [];
    dishes.push({
      ...d,
      course: seed.course,
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
    if (typeof entry?.name !== 'string') continue;
    const course = seeds.get(entry.name.trim().toLowerCase())?.course ?? 'segundo';
    log[key] = { primero: null, segundo: null, [course]: entry };
  }

  return { version: STATE_VERSION, counters, dishes, log };
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
  const raw = Array.isArray(input.counters) ? input : migrateV1(input);

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
      course: d.course === 'primero' ? 'primero' : 'segundo',
      section: (typeof d.section === 'string' && d.section.trim()) || 'Otros',
      name: d.name.trim(),
      counts: validCounts(d.counts),
    }));

  const validSlot = (slot) => (slot && typeof slot.name === 'string' && slot.name.trim()
    ? { name: slot.name.trim(), counts: validCounts(slot.counts), dishId: slot.dishId ?? null }
    : null);

  const log = {};
  for (const [key, entry] of Object.entries(raw.log || {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !entry) continue;
    const primero = validSlot(entry.primero);
    const segundo = validSlot(entry.segundo);
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
      if (!Array.isArray(parsed.counters)) localStorage.setItem(PRE_MIGRATION_KEY, stored);
      return normalizeState(parsed);
    }
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

// Minimums first, then maximums, keeping the order they were created in.
function orderedCounters() {
  return [...state.counters.filter((c) => c.type === 'min'), ...state.counters.filter((c) => c.type === 'max')];
}

// Counter ids the lunch of `key` adds to, optionally ignoring one course.
function dayCounts(key, skipCourse = null) {
  const ids = new Set();
  const entry = state.log[key];
  if (!entry) return ids;
  for (const { key: course } of COURSES) {
    if (course !== skipCourse) for (const id of entry[course]?.counts ?? []) ids.add(id);
  }
  return ids;
}

// Lunches of the week of `key` that add to each counter. `skipCourse` leaves
// out that course on the day `key` only, to evaluate replacing it.
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
 * A counter the other course already adds to today cannot change: it neither
 * helps a pending minimum nor pushes a maximum further.
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
    const entry = state.log[addDays(key, -i)];
    for (const { key: course } of COURSES) {
      if (entry?.[course]) names.add(entry[course].name.toLowerCase());
    }
  }
  return names;
}

/*
 * Picks a random dish of `course` for `key`, never one that breaks a maximum.
 * Priority 1: not eaten recently AND adds to a minimum still pending.
 * Priority 2: not eaten recently. Fallback: anything except `excludeId`.
 */
function suggestDish(key, course, excludeId) {
  const { pending, blocked } = courseImpact(key, course);
  const recent = recentNames(key);
  const pool = state.dishes.filter((d) => d.course === course && d.id !== excludeId && !d.counts.some((c) => blocked.has(c)));
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
  ideas: { primero: null, segundo: null }, // dishes proposed by "Dame una idea"
  notices: { primero: '', segundo: '' }, // shown once, on the next render
};

function clearIdeas() {
  ui.ideas = { primero: null, segundo: null };
}

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
  const notice = ui.notices[course];
  ui.notices[course] = '';

  // Choosing the other course may have turned this idea into an excess
  const { blocked } = courseImpact(key, course);
  if (ui.ideas[course]?.counts.some((c) => blocked.has(c))) ui.ideas[course] = null;
  const idea = ui.ideas[course];

  const askIdea = (excludeId) => {
    ui.ideas[course] = suggestDish(key, course, excludeId);
    if (!ui.ideas[course]) ui.notices[course] = 'No hay más ideas dentro de tus límites.';
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
        h('button', { class: 'btn primary', onclick: () => { setSlot(key, course, slotFromDish(idea)); ui.ideas[course] = null; renderToday(); } }, 'Me lo quedo'),
        h('button', { class: 'btn', onclick: () => askIdea(idea.id) }, 'Otra idea'),
        h('button', { class: 'btn', onclick: () => { ui.ideas[course] = null; renderToday(); } }, 'Cancelar')));
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
      h('button', { class: 'btn', onclick: () => openCustom(course, label) }, 'Otra cosa'),
      slot && h('button', { class: 'btn danger', onclick: () => { setSlot(key, course, null); renderToday(); } }, 'Quitar')),
    notice && h('p', { class: 'hint', role: 'status' }, notice));
}

function renderToday() {
  const key = ui.day;
  const isToday = key === todayKey();
  $('#day-label').textContent = isToday ? `Hoy, ${fmtLong.format(fromKey(key))}` : cap(fmtLong.format(fromKey(key)));
  $('#go-today').hidden = isToday;

  renderProgress($('#progress'), key);
  $('#slots').replaceChildren(...COURSES.map((c) => renderSlot(key, c)));
}

function openPicker(course, label) {
  const key = ui.day;
  const recent = recentNames(key);
  const { blocked } = courseImpact(key, course);
  const groups = groupBySection(state.dishes.filter((d) => d.course === course));
  const content = groups.length
    ? groups.map(([section, list]) => [
        h('h3', { class: 'group-title' }, section),
        h('ul', { class: 'dish-list' }, list.map((d) => {
          // A warning only: the person planning the menu has the last word
          const notes = [
            recent.has(d.name.toLowerCase()) && 'reciente',
            d.counts.some((c) => blocked.has(c)) && 'superaría un límite',
          ].filter(Boolean);
          return h('li', {}, h('button', {
            class: 'dish',
            onclick: () => { setSlot(key, course, slotFromDish(d)); ui.ideas[course] = null; closeSheet(); renderToday(); },
          },
          h('span', { class: 'dish-name' }, d.name,
            notes.length > 0 && h('span', { class: 'dish-note' }, ` · ${notes.join(' · ')}`)),
          tagList(d.counts)));
        })),
      ])
    : [h('p', { class: 'hint' }, 'No hay platos de este tipo. Añádelos en la pestaña Carta.')];
  openSheet(`Elegir ${label.toLowerCase()}`, ...content.flat());
}

function openCustom(course, label) {
  const key = ui.day;
  const stored = state.log[key]?.[course];
  const current = stored && !stored.dishId ? stored : null;
  const name = h('input', { type: 'text', maxlength: 80, placeholder: 'Por ejemplo: comida fuera', value: current?.name ?? '' });
  const checks = orderedCounters().map((c) => {
    const input = h('input', { type: 'checkbox', value: c.id });
    input.checked = Boolean(current?.counts.includes(c.id));
    return [input, h('label', { class: 'check' }, input, `Cuenta como ${c.label.toLowerCase()}`)];
  });
  const form = h('form', {
    onsubmit: (e) => {
      e.preventDefault();
      const text = name.value.trim();
      if (!text) { name.focus(); return; }
      setSlot(key, course, { name: text, counts: checks.filter(([i]) => i.checked).map(([i]) => i.value), dishId: null });
      ui.ideas[course] = null;
      closeSheet();
      renderToday();
    },
  },
  h('label', { class: 'field' }, h('span', {}, 'Qué has comido'), name),
  checks.map(([, check]) => check),
  h('button', { class: 'btn primary block', type: 'submit' }, 'Guardar'));
  openSheet(`Otro ${label.toLowerCase()}`, form);
  name.focus();
}

/* ---------- Menu view ---------- */

function renderMenu() {
  $('#menu-list').replaceChildren(
    ...COURSES.flatMap(({ key, plural }) => {
      const groups = groupBySection(state.dishes.filter((d) => d.course === key));
      return [
        h('h2', { class: 'course-title' }, plural),
        ...(groups.length
          ? groups.flatMap(([section, list]) => [
              h('h3', { class: 'group-title' }, section),
              h('ul', { class: 'dish-list' }, list.map((d) =>
                h('li', {}, h('button', { class: 'dish', onclick: () => openDishForm(d) },
                  h('span', { class: 'dish-name' }, d.name), tagList(d.counts))))),
            ])
          : [h('p', { class: 'hint' }, 'No hay platos todavía.')]),
      ];
    }),
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
  const course = radioGroup('Tipo', 'dish-course', COURSES.map((c) => [c.key, c.label]), dish?.course ?? 'primero');
  // Datalist offers existing sections but allows creating new ones
  const sections = [...new Set(state.dishes.map((d) => d.section))];
  const datalist = h('datalist', { id: 'section-options' }, sections.map((s) => h('option', { value: s })));
  const section = h('input', { type: 'text', maxlength: 40, list: 'section-options', required: true, value: dish?.section ?? '' });
  const counters = orderedCounters();
  const checks = counters.map((c) => {
    const input = h('input', { type: 'checkbox', value: c.id });
    input.checked = Boolean(dish?.counts.includes(c.id));
    return input;
  });

  const del = !isNew && deleteButton('Eliminar plato', 'Toca otra vez para eliminar', () => {
    state.dishes = state.dishes.filter((d) => d.id !== dish.id);
    clearIdeas();
    save();
    closeSheet();
    render();
  });

  const form = h('form', {
    onsubmit: (e) => {
      e.preventDefault();
      const data = {
        name: name.value.trim(),
        course: course.value(),
        section: section.value.trim(),
        counts: checks.filter((i) => i.checked).map((i) => i.value),
      };
      if (!data.name || !data.section) return;
      if (isNew) state.dishes.push({ id: uid(), ...data });
      else Object.assign(dish, data);
      clearIdeas();
      save();
      closeSheet();
      render();
    },
  },
  h('label', { class: 'field' }, h('span', {}, 'Nombre'), name),
  course.element,
  h('label', { class: 'field' }, h('span', {}, 'Sección'), section, datalist),
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
      const entry = state.log[key];
      const names = COURSES.map((c) => entry?.[c.key]?.name).filter(Boolean);
      return h('li', {}, h('button', {
        class: 'week-day' + (key === today ? ' today' : ''),
        onclick: () => { ui.day = key; clearIdeas(); showView('hoy'); },
      },
      h('span', { class: 'week-dow' }, `${cap(fmtDow.format(fromKey(key)))} ${fromKey(key).getDate()}`),
      h('span', { class: 'week-meal' + (names.length ? '' : ' empty') },
        names.length ? names.map((n) => h('span', { class: 'week-meal-line' }, n)) : '—')));
    }),
  );

  renderCounters();
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
    for (const entry of Object.values(state.log)) {
      for (const { key } of COURSES) if (entry[key]) strip(entry[key]);
    }
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
    clearIdeas();
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
$('#prev-day').addEventListener('click', () => { ui.day = addDays(ui.day, -1); clearIdeas(); renderToday(); });
$('#next-day').addEventListener('click', () => { ui.day = addDays(ui.day, 1); clearIdeas(); renderToday(); });
$('#go-today').addEventListener('click', () => { ui.day = todayKey(); clearIdeas(); renderToday(); });

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

save(); // persist the seed or the migrated data on first run
showView('hoy');

/* ---------- Service worker ---------- */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW registration failed', err));
  });
}
