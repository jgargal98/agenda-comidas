// What the counters mean and how they guide the choice of each dish.

import { addDays, weekDays } from './dates.js';
import { save, state } from './state.js';

const RECENT_DAYS = 3;

// Display order of sections in the menu; unknown sections go last.
export const SECTION_ORDER = [
  'Legumbres', 'Guisos', 'Hidratos', 'Salsas', 'Carne y pescado',
  'Verdura y cremas', 'Frío', 'Huevo', 'Precocinado',
];

// Minimums first, then maximums, keeping the order they were created in.
export function orderedCounters() {
  return [...state.counters.filter((c) => c.type === 'min'), ...state.counters.filter((c) => c.type === 'max')];
}

export const daySlots = (key) => state.log[key] ?? [];

// A counter adds at most once per day: its target means lunches, not dishes.
const dayCounts = (key) => new Set(daySlots(key).flatMap((slot) => slot.counts));

// Lunches of the week of `key` that add to each counter.
export function weekTotals(key) {
  const totals = Object.fromEntries(state.counters.map((c) => [c.id, 0]));
  for (const day of weekDays(key)) {
    for (const id of dayCounts(day)) {
      if (id in totals) totals[id] += 1;
    }
  }
  return totals;
}

/*
 * What adding one more dish on `key` would change this week.
 * A counter that lunch already adds to cannot change: it neither helps a
 * pending minimum nor pushes a maximum further.
 */
export function addImpact(key) {
  const totals = weekTotals(key);
  const today = dayCounts(key);
  const open = state.counters.filter((c) => !today.has(c.id));
  return {
    pending: new Set(open.filter((c) => c.type === 'min' && totals[c.id] < c.target).map((c) => c.id)),
    blocked: new Set(open.filter((c) => c.type === 'max' && totals[c.id] >= c.target).map((c) => c.id)),
  };
}

// Normalised names eaten in the RECENT_DAYS before `key`.
export function recentNames(key) {
  const names = new Set();
  for (let i = 1; i <= RECENT_DAYS; i++) {
    for (const slot of daySlots(addDays(key, -i))) names.add(slot.name.toLowerCase());
  }
  return names;
}

/*
 * Picks a random dish to add on `key`: never one already chosen that day nor
 * one that breaks a maximum.
 * Priority 1: not eaten recently AND adds to a minimum still pending.
 * Priority 2: not eaten recently. Fallback: anything except `excludeId`.
 */
export function suggestDish(key, excludeId) {
  const { pending, blocked } = addImpact(key);
  const recent = recentNames(key);
  const chosen = new Set(daySlots(key).map((slot) => slot.dishId));
  const pool = state.dishes.filter((d) => d.id !== excludeId && !chosen.has(d.id) && !d.counts.some((c) => blocked.has(c)));
  const fresh = pool.filter((d) => !recent.has(d.name.toLowerCase()));
  const useful = fresh.filter((d) => d.counts.some((c) => pending.has(c)));

  const candidates = useful.length ? useful : fresh.length ? fresh : pool;
  return candidates.length ? candidates[Math.floor(Math.random() * candidates.length)] : null;
}

export function addSlot(key, slot) {
  state.log[key] = [...daySlots(key), slot];
  save();
}

export function removeSlot(key, index) {
  const slots = daySlots(key).filter((_, i) => i !== index);
  if (slots.length) state.log[key] = slots;
  else delete state.log[key];
  save();
}

export const slotFromDish = (dish) => ({ name: dish.name, counts: [...dish.counts], dishId: dish.id });

export function groupBySection(dishes) {
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
