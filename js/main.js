// App start: views, tabs, installation and service worker.

import './backup.js';
import { todayKey } from './dates.js';
import { renderMenu } from './menu.js';
import { runSync, scheduleSync } from './sync.js';
import { renderToday } from './today.js';
import { $, closeSheet, render, setViews, showView, ui } from './ui.js';
import { renderWeek } from './week.js';

setViews({
  hoy: { title: 'Hoy', render: renderToday },
  carta: { title: 'Carta', render: renderMenu },
  semana: { title: 'Semana', render: renderWeek },
});

for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => {
    closeSheet();
    showView(tab.dataset.view);
  });
}

// On returning to the app: look for changes from other devices and, if it is
// a new day, jump to the real today
let lastSeenToday = todayKey();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  scheduleSync(0);
  const now = todayKey();
  if (now === lastSeenToday) return;
  if (ui.day === lastSeenToday) ui.day = now;
  lastSeenToday = now;
  render();
});

let installEvent = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e;
  $('#install-btn').hidden = false;
});
$('#install-btn').addEventListener('click', async () => {
  installEvent.prompt();
  await installEvent.userChoice;
  installEvent = null;
  $('#install-btn').hidden = true;
});
window.addEventListener('appinstalled', () => {
  $('#install-btn').hidden = true;
});

showView('hoy');
runSync();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW registration failed', err));
}
