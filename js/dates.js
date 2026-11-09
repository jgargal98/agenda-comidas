// Date helpers, always in local time. Weeks start on Monday.

export function toKey(d) {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function fromKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key, n) {
  const d = fromKey(key);
  d.setDate(d.getDate() + n);
  return toKey(d);
}

export const todayKey = () => toKey(new Date());

export function weekStart(key) {
  const d = fromKey(key);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday = 0
  return toKey(d);
}

export function weekDays(key) {
  const start = weekStart(key);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export const fmtLong = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
export const fmtShort = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' });
export const fmtDow = new Intl.DateTimeFormat('es-ES', { weekday: 'short' });
export const fmtStamp = new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'short' });

// Spanish dates are lower case; only the first letter of a label is capitalised.
export const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
