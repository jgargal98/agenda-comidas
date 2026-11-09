// Today view: weekly progress and the two courses of the selected day.

import { addDays, cap, fmtLong, fromKey, todayKey } from './dates.js';
import { COURSES, courseImpact, daySlots, orderedCounters, recentNames, setSlot, slotFromDish, suggestDish, weekTotals } from './domain.js';
import { state } from './state.js';
import { $, closeSheet, dishGroups, h, openSheet, tagList, ui } from './ui.js';

function progressRow(counter, value) {
  const { label, target } = counter;
  const isMax = counter.type === 'max';
  const excess = isMax ? value - target : 0;
  // A minimum of 0 is already met; a maximum of 0 is empty until exceeded
  const percent = target ? (value / target) * 100 : isMax && !value ? 0 : 100;
  const status = isMax ? (excess > 0 ? ' over' : '') : value >= target ? ' met' : '';
  const text = isMax ? `${value} / máx. ${target}` : `${value}/${target}`;

  // Set as a property because the content security policy blocks style attributes
  const fill = h('span');
  fill.style.width = `${Math.min(100, percent)}%`;

  return h('div', { class: `goal-row ${counter.type}${status}` },
    h('span', { class: 'goal-label' }, label),
    h('div', {
      class: 'bar',
      role: 'progressbar',
      'aria-label': label,
      'aria-valuemin': 0,
      'aria-valuemax': target,
      'aria-valuenow': Math.min(value, target),
      'aria-valuetext': text,
    }, fill),
    h('span', { class: 'goal-count' }, text),
    excess > 0 && h('p', { class: 'goal-note' }, `Te has pasado en ${excess}`));
}

function renderProgress(key) {
  const counters = orderedCounters();
  const totals = weekTotals(key);
  $('#progress').replaceChildren(...(counters.length
    ? counters.map((c) => progressRow(c, totals[c.id]))
    : [h('p', { class: 'hint' }, 'No hay contadores. Créalos en la pestaña Semana.')]));
}

function button(text, onclick, variant = '') {
  return h('button', { class: `btn ${variant}`, onclick }, text);
}

function courseCard(key, { key: course, label }) {
  const slot = state.log[key]?.[course] ?? null;
  const idea = ui.idea?.course === course ? ui.idea.dish : null;
  const notice = ui.notice?.course === course ? ui.notice.text : '';
  if (notice) ui.notice = null;

  const clearIdea = () => {
    ui.idea = null;
    renderToday();
  };
  const askIdea = (excludeId) => {
    const dish = suggestDish(key, course, excludeId);
    ui.idea = dish && { course, dish };
    if (!dish) ui.notice = { course, text: 'No hay más ideas dentro de tus límites.' };
    renderToday();
  };
  const choose = (chosen) => {
    setSlot(key, course, chosen);
    clearIdea();
  };

  const content = idea
    ? [h('p', { class: 'idea-label' }, 'Idea'), h('p', { class: 'slot-name' }, idea.name), tagList(idea.counts)]
    : slot
      ? [h('p', { class: 'slot-name' }, slot.name), tagList(slot.counts)]
      : [h('p', { class: 'slot-empty' }, 'Sin elegir')];

  const actions = idea
    ? [
        button('Me lo quedo', () => choose(slotFromDish(idea)), 'primary'),
        button('Otra idea', () => askIdea(idea.id)),
        button('Cancelar', clearIdea),
      ]
    : [
        button(slot ? 'Cambiar' : 'Elegir de la carta', () => openPicker(course, label), 'primary'),
        button('Dame una idea', () => askIdea(slot?.dishId)),
        button('Otra cosa', () => openCustom(course)),
        slot && button('Quitar', () => choose(null), 'danger'),
      ];

  return h('div', { class: 'card' },
    h('h2', { class: 'card-title' }, label),
    content,
    h('div', { class: 'actions' }, actions),
    notice && h('p', { class: 'hint', role: 'status' }, notice));
}

export function renderToday() {
  const key = ui.day;
  const date = fmtLong.format(fromKey(key));
  const isToday = key === todayKey();
  $('#day-label').textContent = isToday ? `Hoy, ${date}` : cap(date);
  $('#go-today').hidden = isToday;

  renderProgress(key);
  $('#lunch').replaceChildren(...COURSES.map((c) => courseCard(key, c)));
}

function openPicker(course, label) {
  const key = ui.day;
  const recent = recentNames(key);
  const { blocked } = courseImpact(key, course);
  const chosen = new Set(daySlots(key, course).map((slot) => slot.dishId));

  const content = state.dishes.length
    ? dishGroups(state.dishes, (d) => ({
        disabled: chosen.has(d.id),
        // A warning only: the person planning the menu has the last word
        notes: [
          chosen.has(d.id) && 'ya elegido',
          recent.has(d.name.toLowerCase()) && 'reciente',
          d.counts.some((c) => blocked.has(c)) && 'superaría un límite',
        ].filter(Boolean),
        onclick: () => {
          setSlot(key, course, slotFromDish(d));
          ui.idea = null;
          closeSheet();
          renderToday();
        },
      }))
    : [h('p', { class: 'hint' }, 'La carta está vacía. Añade platos en la pestaña Carta.')];
  openSheet(`Elegir ${label.toLowerCase()}`, ...content);
}

function openCustom(course) {
  const key = ui.day;
  const name = h('input', { type: 'text', maxlength: 80, placeholder: 'Por ejemplo: comida fuera' });
  const checks = orderedCounters().map((c) => [h('input', { type: 'checkbox', value: c.id }), c.label]);
  const form = h('form', {
    onsubmit: (e) => {
      e.preventDefault();
      const text = name.value.trim();
      if (!text) {
        name.focus();
        return;
      }
      setSlot(key, course, { name: text, counts: checks.filter(([i]) => i.checked).map(([i]) => i.value), dishId: null });
      ui.idea = null;
      closeSheet();
      renderToday();
    },
  },
  h('label', { class: 'field' }, h('span', {}, 'Qué has comido'), name),
  checks.map(([input, label]) => h('label', { class: 'check' }, input, `Cuenta como ${label.toLowerCase()}`)),
  h('button', { class: 'btn primary block', type: 'submit' }, 'Guardar'));
  openSheet('Otra cosa', form);
  name.focus();
}

function goToDay(key) {
  ui.day = key;
  ui.idea = null;
  renderToday();
}

$('#prev-day').addEventListener('click', () => goToDay(addDays(ui.day, -1)));
$('#next-day').addEventListener('click', () => goToDay(addDays(ui.day, 1)));
$('#go-today').addEventListener('click', () => goToDay(todayKey()));
