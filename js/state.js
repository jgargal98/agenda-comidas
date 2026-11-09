/*
 * The app's data and its copy on this device.
 *
 * state = {
 *   version,
 *   counters: [{ id, label, type: 'min' | 'max', target }],  // per week
 *   dishes:   [{ id, section, name, counts: [counterId] }],
 *   log:      { 'YYYY-MM-DD': { primero: Slot | null, segundo: Slot | null } }
 * }
 * Slot = { name, counts, dishId | null }
 *
 * The server stores this as one JSON document, so this file is the only place
 * that defines its shape. Each slot keeps its own copy of name and counts so
 * editing or deleting a dish never rewrites history.
 */

import { upgrade } from './migrations.js';
import { STATE_VERSION, defaultState, uid } from './seed.js';

const STORAGE_KEY = 'carta-comidas:v1';
const MAX_TARGET = 7;

// Validates any object (stored, imported or from the server) into a safe state.
export function normalizeState(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.dishes) || typeof input.log !== 'object') {
    throw new Error('Formato no válido');
  }
  const raw = upgrade(input);

  const seen = new Set();
  const counters = [];
  for (const c of raw.counters) {
    if (typeof c?.label !== 'string' || !c.label.trim()) continue;
    const id = typeof c.id === 'string' && c.id && !seen.has(c.id) ? c.id : uid();
    seen.add(id);
    const target = Number(c.target);
    counters.push({
      id,
      label: c.label.trim(),
      type: c.type === 'max' ? 'max' : 'min',
      target: Number.isInteger(target) && target >= 0 && target <= MAX_TARGET ? target : 2,
    });
  }

  const validCounts = (list) => (Array.isArray(list) ? [...new Set(list.filter((id) => seen.has(id)))] : []);

  const dishes = raw.dishes
    .filter((d) => typeof d?.name === 'string' && d.name.trim())
    .map((d) => ({
      id: typeof d.id === 'string' ? d.id : uid(),
      section: (typeof d.section === 'string' && d.section.trim()) || 'Otros',
      name: d.name.trim(),
      counts: validCounts(d.counts),
    }));

  const validSlot = (slot) => (typeof slot?.name === 'string' && slot.name.trim()
    ? { name: slot.name.trim(), counts: validCounts(slot.counts), dishId: slot.dishId ?? null }
    : null);

  // Older versions stored a list of dishes. Beyond two, the rest join the second
  // course so that nothing already eaten disappears from the history.
  const joinSlots = (slots) => (slots.length < 2 ? slots[0] ?? null : {
    name: slots.map((s) => s.name).join(' + '),
    counts: [...new Set(slots.flatMap((s) => s.counts))],
    dishId: null,
  });

  const log = {};
  for (const [key, entry] of Object.entries(raw.log || {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !entry) continue;
    const list = Array.isArray(entry) ? entry.map(validSlot).filter(Boolean) : null;
    const primero = list ? list[0] ?? null : validSlot(entry.primero);
    const segundo = list ? joinSlots(list.slice(1)) : validSlot(entry.segundo);
    if (primero || segundo) log[key] = { primero, segundo };
  }

  return { version: STATE_VERSION, counters, dishes, log };
}

function loadState() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return defaultState();
  try {
    const parsed = JSON.parse(stored);
    // Keep an untouched copy in case a migration ever loses something
    const version = Number(parsed.version) || 1;
    if (version < STATE_VERSION) localStorage.setItem(`carta-comidas:v${version}-backup`, stored);
    return normalizeState(parsed);
  } catch (err) {
    console.warn('Could not read stored data, starting fresh', err);
    // The fresh state is about to overwrite it, so keep what could not be read
    localStorage.setItem('carta-comidas:unreadable-backup', stored);
    return defaultState();
  }
}

export let state = loadState();

export function setState(next) {
  state = next;
}

// Writes to this device only, for changes that are not the user's own edits.
export function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.error('Could not save data', err);
  }
}

let onSave = () => {};

export function setOnSave(listener) {
  onSave = listener;
}

// Saves a user's edit and tells whoever has to send it to the other devices.
export function save() {
  persist();
  onSave();
}
