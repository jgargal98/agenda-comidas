// Converts data saved by older versions of the app to the final format. This
// whole file can go once every device and the server hold version 9.

import { SEED_COUNTERS, SEED_DISHES, seedDish, uid } from './seed.js';

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
  'pasta': ['refinados'],
  'ensalada de pasta': ['refinados'],
  'noodles': ['refinados'],
  'arroz blanco': ['refinados'],
  'arroz salteado': ['refinados'],
  'paella de pollo y gambas': ['refinados'],
  'pizza': ['refinados'],
  'hamburguesa': ['refinados'],
};

const V8_CARB_SECTIONS = ['Pasta', 'Noodles', 'Arroz'];

const lowName = (d) => (typeof d?.name === 'string' ? d.name.trim().toLowerCase() : '');
const countsOf = (d) => (Array.isArray(d?.counts) ? d.counts : []);
const unique = (list) => [...new Set(list)];
// Counters are found by name too, since the user may have created their own.
const findCounter = (counters, id, label) => counters.find((c) => c?.id === id || (typeof c?.label === 'string' && c.label.trim().toLowerCase() === label));

// Adds the seed dishes in `names` that are not on the menu yet.
function withAddedDishes(dishes, names) {
  const present = new Set(dishes.map(lowName));
  const added = SEED_DISHES.filter((s) => names.has(s.name) && !present.has(s.name.toLowerCase()));
  return [...dishes, ...added.map(seedDish)];
}

// One dish per day and fixed goals become counters and a list of dishes.
function migrateV1(raw) {
  const seeds = new Map(SEED_DISHES.map((s) => [s.name.toLowerCase(), s]));

  const counters = SEED_COUNTERS.map((c) => {
    const stored = Number(raw.goals?.[c.id]);
    return { ...c, target: Number.isInteger(stored) ? stored : c.target };
  });

  const dishes = [];
  for (const d of raw.dishes) {
    const low = lowName(d);
    if (!low || low === V1_SPLIT_DISH) continue;
    const seed = seeds.get(low);
    dishes.push(seed
      ? {
          ...d,
          section: d.section === V1_MOVED_DISHES[low] ? seed.section : d.section,
          counts: unique([...countsOf(d), ...seed.counts]),
        }
      : d);
  }

  const log = {};
  for (const [key, entry] of Object.entries(raw.log || {})) {
    if (typeof entry?.name === 'string') log[key] = [entry];
  }

  const newDishes = new Set(SEED_DISHES.filter((s) => s.isNew).map((s) => s.name));
  return { version: 3, counters, dishes: withAddedDishes(dishes, newDishes), log };
}

// Splits the v3 seed dishes. Dishes with another name are the user's and stay
// untouched; history keeps its own copies of the names.
function migrateToV4(raw) {
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
  return { ...raw, version: 4, dishes: withAddedDishes(dishes, V4_ADDED_DISHES) };
}

// Moves dishes out of the sections that only made sense for combining dishes.
function migrateToV6(raw) {
  const dishes = raw.dishes.map((d) => {
    if (lowName(d) === 'arroz blanco' && d.section === 'Guarniciones') return { ...d, section: 'Arroz' };
    return { ...d, section: V5_RENAMED_SECTIONS[d?.section] ?? d?.section };
  });
  return { ...raw, version: 6, dishes: withAddedDishes(dishes, V6_ADDED_DISHES) };
}

// Adds the new counters and classifies the dishes. Carbonara moves from red
// meat to processed, since only its bacon made it count; history stays.
function migrateToV7(raw) {
  const counters = [...raw.counters];
  const ids = {};
  for (const id of V7_COUNTERS) {
    const seed = SEED_COUNTERS.find((c) => c.id === id);
    const existing = findCounter(counters, id, seed.label.toLowerCase()) ?? findCounter(counters, id, 'hidratos refinados');
    if (!existing) counters.push({ ...seed });
    ids[id] = existing?.id ?? id;
  }

  const dishes = raw.dishes.map((d) => {
    const low = lowName(d);
    const added = V7_DISH_COUNTERS[low];
    if (!added) return d;
    const kept = low === 'carbonara' ? countsOf(d).filter((id) => id !== 'roja') : countsOf(d);
    return { ...d, counts: unique([...kept, ...added.map((id) => ids[id])]) };
  });

  return { ...raw, version: 7, counters, dishes };
}

// Shellfish counts as fish, and the rice in a stew is not its main ingredient.
function migrateToV8(raw) {
  const fishId = findCounter(raw.counters, 'pescado', 'pescado')?.id;
  const refinedId = findCounter(raw.counters, 'refinados', 'hidratos refinados')?.id;

  const dishes = raw.dishes.map((d) => {
    const low = lowName(d);
    if (low === 'gambas' && fishId) return { ...d, counts: unique([...countsOf(d), fishId]) };
    if (low === 'puchero con arroz') return { ...d, counts: countsOf(d).filter((id) => id !== refinedId) };
    return d;
  });
  return { ...raw, version: 8, dishes };
}

// Joins pasta, noodles and rice in one section with a single carbs counter, and
// adds fried potatoes. Other sections and counters stay as they are.
function migrateToV9(raw) {
  const carbs = findCounter(raw.counters, null, 'hidratos') ?? findCounter(raw.counters, 'refinados', 'hidratos refinados');
  const fried = findCounter(raw.counters, 'frito', 'frito');
  const counters = raw.counters.map((c) => (c === carbs ? { ...c, label: 'Hidratos' } : c));

  const asCarbs = (d) => ({ ...d, section: 'Hidratos', counts: unique([...countsOf(d), ...(carbs ? [carbs.id] : [])]) });
  const dishes = raw.dishes.map((d) => {
    if (V8_CARB_SECTIONS.includes(d?.section)) return asCarbs(d);
    if (lowName(d) === 'patatas' && d.section === 'Verdura y cremas') return asCarbs(d);
    return d;
  });

  if (!dishes.some((d) => lowName(d) === 'patatas fritas')) {
    dishes.push(asCarbs({ id: uid(), name: 'Patatas fritas', counts: fried ? [fried.id] : [] }));
  }
  return { ...raw, version: 9, counters, dishes };
}

// Runs every migration newer than the version of `input`, in order.
export function upgrade(input) {
  const version = (data) => Number(data.version) || 1;
  const steps = [[4, migrateToV4], [6, migrateToV6], [7, migrateToV7], [8, migrateToV8], [9, migrateToV9]];
  const start = Array.isArray(input.counters) ? input : migrateV1(input);
  return steps.reduce((data, [target, migrate]) => (version(data) < target ? migrate(data) : data), start);
}
