// Shared UI: DOM helper, bottom sheet, navigation and common pieces of the views.

import { todayKey, weekStart } from './dates.js';
import { groupBySection } from './domain.js';
import { state } from './state.js';

export const $ = (sel) => document.querySelector(sel);

/*
 * h('div', { class: 'x', onclick }, child, ...)
 * Text children are inserted as text nodes, so user input is never interpreted
 * as HTML.
 */
export function h(tag, props = {}, ...children) {
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

export const ui = {
  view: 'hoy',
  day: todayKey(),
  week: weekStart(todayKey()),
  idea: null, // dish currently proposed by "Dame una idea"
  notice: '', // shown once, on the next render
};

/* ---------- Bottom sheet ---------- */

let onSheetClose = () => {};

export function setOnSheetClose(listener) {
  onSheetClose = listener;
}

export function openSheet(title, ...content) {
  $('#sheet-title').textContent = title;
  $('#sheet-body').replaceChildren(...content);
  $('#sheet').hidden = false;
  $('#sheet-backdrop').hidden = false;
}

export function closeSheet() {
  $('#sheet').hidden = true;
  $('#sheet-backdrop').hidden = true;
  onSheetClose();
}

export const isSheetOpen = () => !$('#sheet').hidden;

$('#sheet-close').addEventListener('click', closeSheet);
$('#sheet-backdrop').addEventListener('click', closeSheet);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSheet();
});

/* ---------- Navigation ---------- */

let views = {};

// `definitions` maps each view name to its { title, render }.
export function setViews(definitions) {
  views = definitions;
}

export function render() {
  views[ui.view].render();
}

export function showView(view) {
  ui.view = view;
  for (const name of Object.keys(views)) $(`#view-${name}`).hidden = name !== view;
  for (const tab of document.querySelectorAll('.tab')) tab.classList.toggle('active', tab.dataset.view === view);
  $('#title').textContent = views[view].title;
  if (view === 'semana') ui.week = weekStart(ui.day);
  render();
  window.scrollTo(0, 0);
}

/* ---------- Common pieces ---------- */

export function tagList(counts) {
  const tags = counts
    .map((id) => state.counters.find((c) => c.id === id))
    .filter(Boolean)
    .map((c) => h('span', { class: `tag ${c.type}` }, c.label));
  return tags.length ? h('div', { class: 'tags' }, tags) : null;
}

// The dishes grouped by section, as lists of buttons. `options(dish)` gives each
// button its onclick and, optionally, its notes and disabled state.
export function dishGroups(dishes, options) {
  return groupBySection(dishes).flatMap(([section, list]) => [
    h('h3', { class: 'group-title' }, section),
    h('ul', { class: 'dish-list' }, list.map((d) => {
      const { onclick, notes = [], disabled = false } = options(d);
      return h('li', {}, h('button', { class: 'dish', disabled, onclick },
        h('span', { class: 'dish-name' }, d.name,
          notes.length > 0 && h('span', { class: 'dish-note' }, ` · ${notes.join(' · ')}`)),
        tagList(d.counts)));
    })),
  ]);
}

// Delete button that needs a second tap instead of a confirm() dialog.
export function deleteButton(label, armedLabel, onConfirm) {
  let armed = false;
  return h('button', {
    type: 'button',
    class: 'btn danger block',
    onclick: (e) => {
      if (!armed) {
        armed = true;
        e.currentTarget.textContent = armedLabel;
        return;
      }
      onConfirm();
    },
  }, label);
}
