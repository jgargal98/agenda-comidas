/*
 * The app's data and its copy on this device.
 *
 * state = {
 *   version,
 *   counters: [{ id, label, type: 'min' | 'max', target }],  // per week
 *   dishes:   [{ id, section, name, counts: [counterId] }],
 *   log:      { 'YYYY-MM-DD': [Slot] }  // any number of dishes, in any combination
 * }
 * Slot = { name, counts, dishId | null }
 *
 * The server stores this as one JSON document, so this file is the only place
 * that defines its shape. Each slot keeps its own copy of name and counts so
 * editing or deleting a dish never rewrites history.
 */

const STORAGE_KEY = 'carta-comidas:v1';
const VERSION = 10;
const PREVIOUS_VERSION = 9; // same data, but each day had a first and a second course
const MAX_TARGET = 7;

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Validates any object (stored, imported or from the server). Other versions are
// rejected instead of guessing what they mean, so they can never damage the data.
export function normalizeState(input) {
  const knownVersion = input?.version === VERSION || input?.version === PREVIOUS_VERSION;
  if (!knownVersion || !Array.isArray(input.counters) || !Array.isArray(input.dishes) || typeof input.log !== 'object') {
    throw new Error('Formato no válido');
  }

  const seen = new Set();
  const counters = [];
  for (const c of input.counters) {
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

  const dishes = input.dishes
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

  const log = {};
  for (const [key, entry] of Object.entries(input.log ?? {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
    const list = Array.isArray(entry) ? entry : [entry?.primero, entry?.segundo];
    const slots = list.map(validSlot).filter(Boolean);
    if (slots.length) log[key] = slots;
  }

  return { version: VERSION, counters, dishes, log };
}

const emptyState = () => ({ version: VERSION, counters: [], dishes: [], log: {} });

function loadState() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return emptyState();
  try {
    return normalizeState(JSON.parse(stored));
  } catch (err) {
    console.warn('Could not read stored data, starting empty', err);
    // The empty state is about to overwrite it, so keep what could not be read
    localStorage.setItem('carta-comidas:unreadable-backup', stored);
    return emptyState();
  }
}

export let state = loadState();

export function setState(next) {
  state = next;
}

export const isStateEmpty = () => !state.counters.length && !state.dishes.length && !Object.keys(state.log).length;

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
