// Week view: overview of the week and the editable counters.

import { addDays, cap, fmtDow, fmtShort, fromKey, todayKey, weekDays } from './dates.js';
import { daySlots, orderedCounters } from './domain.js';
import { save, state, uid } from './state.js';
import { renderSync } from './sync.js';
import { $, closeSheet, deleteButton, h, openSheet, render, showView, ui } from './ui.js';

const MAX_TARGET = 7;
const TYPE_LABELS = { min: 'Mínimo', max: 'Máximo' };

export function renderWeek() {
  const days = weekDays(ui.week);
  $('#week-label').textContent = `${fmtShort.format(fromKey(days[0]))} – ${fmtShort.format(fromKey(days[6]))}`;

  const today = todayKey();
  $('#week-list').replaceChildren(...days.map((key) => {
    const names = daySlots(key).map((slot) => slot.name);
    return h('li', {}, h('button', {
      class: `week-day${key === today ? ' today' : ''}`,
      onclick: () => {
        ui.day = key;
        ui.idea = null;
        showView('hoy');
      },
    },
    h('span', { class: 'week-dow' }, `${cap(fmtDow.format(fromKey(key)))} ${fromKey(key).getDate()}`),
    h('span', { class: `week-meal${names.length ? '' : ' empty'}` },
      names.length ? names.map((n) => h('span', { class: 'week-meal-line' }, n)) : '—')));
  }));

  renderCounters();
  renderSync();
}

function counterRow(counter) {
  const { label } = counter;
  const out = h('output', {}, counter.target);
  const change = (delta) => {
    counter.target = Math.max(0, Math.min(MAX_TARGET, counter.target + delta));
    save();
    out.textContent = counter.target;
  };
  return h('div', { class: 'stepper' },
    h('button', { class: 'counter-open', 'aria-label': `Editar ${label}`, onclick: () => openCounterForm(counter) },
      h('span', { class: 'counter-name' }, label),
      h('span', { class: 'counter-type' }, `${TYPE_LABELS[counter.type]} por semana`)),
    h('div', { class: 'stepper-ctrl' },
      h('button', { class: 'icon-btn', 'aria-label': `Bajar ${label}`, onclick: () => change(-1) }, '−'),
      out,
      h('button', { class: 'icon-btn', 'aria-label': `Subir ${label}`, onclick: () => change(1) }, '+')));
}

function renderCounters() {
  const counters = orderedCounters();
  $('#counters').replaceChildren(
    ...(counters.length ? counters.map(counterRow) : [h('p', { class: 'hint' }, 'No hay contadores todavía.')]),
    h('button', { class: 'btn block', onclick: () => openCounterForm(null) }, 'Añadir contador'),
  );
}

function saveAndClose() {
  save();
  closeSheet();
  render();
}

function deleteCounter(counter) {
  const strip = (holder) => {
    holder.counts = holder.counts.filter((id) => id !== counter.id);
  };
  state.counters = state.counters.filter((c) => c !== counter);
  state.dishes.forEach(strip);
  Object.keys(state.log).flatMap((day) => daySlots(day)).forEach(strip);
  saveAndClose();
}

function openCounterForm(counter) {
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
  const types = [['min', 'Mínimo: avisa de lo que falta'], ['max', 'Máximo: avisa si te pasas']].map(([value, label]) => {
    const input = h('input', { type: 'radio', name: 'counter-type', value });
    input.checked = value === (counter?.type ?? 'min');
    return [input, label];
  });
  const target = h('input', { type: 'number', min: 0, max: MAX_TARGET, step: 1, required: true, inputmode: 'numeric', value: counter?.target ?? 1 });
  const used = counter ? state.dishes.filter((d) => d.counts.includes(counter.id)).length : 0;

  const form = h('form', {
    onsubmit: (e) => {
      e.preventDefault();
      const data = { label: name.value.trim(), type: types.find(([i]) => i.checked)[0].value, target: Number(target.value) };
      if (!data.label) {
        name.focus();
        return;
      }
      if (counter) Object.assign(counter, data);
      else state.counters.push({ id: uid(), ...data });
      saveAndClose();
    },
  },
  h('label', { class: 'field' }, h('span', {}, 'Nombre'), name),
  h('fieldset', { class: 'choice' },
    h('legend', {}, 'Tipo'),
    types.map(([input, label]) => h('label', { class: 'check' }, input, label))),
  h('label', { class: 'field' }, h('span', {}, 'Veces por semana'), target),
  h('button', { class: 'btn primary block', type: 'submit' }, 'Guardar'),
  counter && deleteButton('Eliminar contador', `Toca otra vez: se quitará de ${used} ${used === 1 ? 'plato' : 'platos'}`, () => deleteCounter(counter)));

  openSheet(counter ? 'Editar contador' : 'Nuevo contador', form);
  if (!counter) name.focus();
}

$('#prev-week').addEventListener('click', () => {
  ui.week = addDays(ui.week, -7);
  renderWeek();
});
$('#next-week').addEventListener('click', () => {
  ui.week = addDays(ui.week, 7);
  renderWeek();
});
