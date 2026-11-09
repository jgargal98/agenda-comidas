// Final format version of the stored data, and the menu a new device starts with.

export const STATE_VERSION = 9;

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export const SEED_COUNTERS = [
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

// [section, name, counts, isNew]. isNew marks dishes that did not exist in v1,
// the only ones that migration may add without restoring a deleted dish.
export const SEED_DISHES = [
  ['Legumbres', 'Lentejas', ['legumbres']],
  ['Legumbres', 'Ensalada de garbanzos', ['legumbres', 'verdura']],
  ['Guisos', 'Puchero con arroz', []],
  ['Hidratos', 'Pasta', ['refinados'], true],
  ['Hidratos', 'Pasta integral', [], true],
  ['Hidratos', 'Ensalada de pasta', ['refinados']],
  ['Hidratos', 'Noodles', ['refinados'], true],
  ['Hidratos', 'Arroz blanco', ['refinados'], true],
  ['Hidratos', 'Arroz integral', [], true],
  ['Hidratos', 'Arroz salteado', ['refinados']],
  ['Hidratos', 'Paella de pollo y gambas', ['refinados']],
  ['Hidratos', 'Patatas', [], true],
  ['Hidratos', 'Patatas fritas', ['frito'], true],
  ['Salsas', 'Carbonara', ['procesado']],
  ['Salsas', 'Boloñesa', ['roja']],
  ['Carne y pescado', 'Gambas al pilpil', ['pescado'], true],
  ['Carne y pescado', 'Salmón', ['pescado', 'azul']],
  ['Carne y pescado', 'Pollo', [], true],
  ['Carne y pescado', 'Pavo', [], true],
  ['Carne y pescado', 'Ternera', ['roja'], true],
  ['Carne y pescado', 'Cerdo', ['roja'], true],
  ['Carne y pescado', 'Gambas', ['pescado'], true],
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

export const seedDish = ({ section, name, counts }) => ({ id: uid(), section, name, counts: [...counts] });

export function defaultState() {
  return {
    version: STATE_VERSION,
    counters: SEED_COUNTERS.map((c) => ({ ...c })),
    dishes: SEED_DISHES.map(seedDish),
    log: {},
  };
}
