// Menu view: the list of dishes and the form to create or edit them.

import { SECTION_ORDER, orderedCounters } from './domain.js';
import { uid } from './seed.js';
import { save, state } from './state.js';
import { $, closeSheet, deleteButton, dishGroups, h, openSheet, render, ui } from './ui.js';

// Value of the section dropdown option that asks for a new section name.
const NEW_SECTION = '__new__';

export function renderMenu() {
  $('#menu-list').replaceChildren(...(state.dishes.length
    ? dishGroups(state.dishes, (d) => ({ onclick: () => openDishForm(d) }))
    : [h('p', { class: 'hint' }, 'No hay platos todavía.')]));
}

function saveAndClose() {
  ui.idea = null;
  save();
  closeSheet();
  render();
}

function openDishForm(dish) {
  const name = h('input', { type: 'text', maxlength: 80, required: true, value: dish?.name ?? '' });

  const newSection = h('input', { type: 'text', maxlength: 40 });
  const newSectionField = h('label', { class: 'field', hidden: true }, h('span', {}, 'Nombre de la sección'), newSection);

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

  const checks = orderedCounters().map((c) => {
    const input = h('input', { type: 'checkbox', value: c.id });
    input.checked = Boolean(dish?.counts.includes(c.id));
    return h('label', { class: 'check' }, input, c.label);
  });

  const form = h('form', {
    onsubmit: (e) => {
      e.preventDefault();
      const data = {
        name: name.value.trim(),
        section: (section.value === NEW_SECTION ? newSection.value : section.value).trim(),
        counts: checks.map((label) => label.firstChild).filter((i) => i.checked).map((i) => i.value),
      };
      if (!data.name || !data.section) return;
      if (dish) Object.assign(dish, data);
      else state.dishes.push({ id: uid(), ...data });
      saveAndClose();
    },
  },
  h('label', { class: 'field' }, h('span', {}, 'Nombre'), name),
  h('label', { class: 'field' }, h('span', {}, 'Sección'), section),
  newSectionField,
  checks.length > 0 && h('p', { class: 'hint' }, 'Suma a'),
  checks,
  h('button', { class: 'btn primary block', type: 'submit' }, 'Guardar'),
  dish && deleteButton('Eliminar plato', 'Toca otra vez para eliminar', () => {
    state.dishes.splice(state.dishes.indexOf(dish), 1);
    saveAndClose();
  }));

  openSheet(dish ? 'Editar plato' : 'Nuevo plato', form);
  if (!dish) name.focus();
}

$('#add-dish').addEventListener('click', () => openDishForm(null));
