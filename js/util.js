// Small helpers shared by every screen.

export { todayISO, shiftDays } from './rates.js';

// Makes text safe to put inside HTML.
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export const sum = (list, key = 'chf') => Math.round(list.reduce((t, e) => t + (e[key] || 0), 0) * 100) / 100;

export const decimals = currency => (currency === 'JPY' ? 0 : 2);

const formatters = {};
export function money(value, currency = 'CHF', { whole = false } = {}) {
  const d = whole ? 0 : decimals(currency);
  const key = `${currency}${d}`;
  formatters[key] ||= new Intl.NumberFormat('de-CH', {
    style: 'currency', currency, currencyDisplay: 'code', minimumFractionDigits: d, maximumFractionDigits: d,
  });
  return formatters[key].format(value || 0);
}

// Short axis labels: 1200 -> "1.2k"
export function compact(n) {
  if (n >= 1000) return `${Math.round(n / 100) / 10}k`.replace('.0k', 'k');
  return String(Math.round(n));
}

// ---- Dates (stored as 'YYYY-MM-DD' strings in local time) ----

export const monthOf = iso => iso.slice(0, 7);

export function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

export function daysInMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const asDate = iso => new Date(`${iso.length === 7 ? `${iso}-01` : iso}T12:00:00`);

export const monthLabel = (ym, style = 'long') =>
  asDate(ym).toLocaleDateString('en-GB', { month: style, year: 'numeric' });

export const monthName = (ym, style = 'long') => asDate(ym).toLocaleDateString('en-GB', { month: style });

export function dayLabel(iso, today) {
  if (iso === today) return 'Today';
  if (iso === shiftDaysLocal(today, -1)) return 'Yesterday';
  return asDate(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: iso.slice(0, 4) === today.slice(0, 4) ? undefined : 'numeric' });
}

export const shortDate = iso => asDate(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

function shiftDaysLocal(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// ---- Toast (small message at the bottom of the screen) ----

let toastTimer;
export function toast(message, action) {
  const el = document.getElementById('toast');
  el.innerHTML = `<span>${esc(message)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  el.hidden = false;
  if (action) el.querySelector('button').onclick = () => { el.hidden = true; action.run(); };
  clearTimeout(toastTimer);
  if (!action?.sticky) toastTimer = setTimeout(() => { el.hidden = true; }, action ? 5000 : 2500);
}

// ---- Dialogs ----

// Shows a dialog. `body` is HTML; `buttons` is a list of { label, value, style }.
// Resolves with the clicked button's value, or null when dismissed.
// `onOpen(dialogEl)` can wire up inputs; `collect(dialogEl)` turns inputs into a result.
export function showDialog({ title, body = '', buttons, onOpen, collect }) {
  const dlg = document.getElementById('dialog');
  dlg.innerHTML = `
    <form method="dialog" class="dlg">
      ${title ? `<h2>${esc(title)}</h2>` : ''}
      <div class="dlg-body">${body}</div>
      <div class="dlg-actions">
        ${buttons.map((b, i) => `<button type="submit" value="${i}" class="btn ${b.style || ''}">${esc(b.label)}</button>`).join('')}
      </div>
    </form>`;
  return new Promise(resolve => {
    const form = dlg.querySelector('form');
    // Enter in a text field presses the last (main) button.
    form.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' && ev.target.matches('input')) {
        ev.preventDefault();
        form.querySelector('.dlg-actions button:last-child').click();
      }
    });
    form.addEventListener('submit', ev => {
      const raw = ev.submitter?.value ?? String(buttons.length - 1);
      // Extra submit buttons inside `body` (not in `buttons`) resolve with their own value.
      if (!/^\d+$/.test(raw)) { dlg.close(); resolve(raw); return; }
      const b = buttons[Number(raw)];
      if (b.value !== null && b.validate && !b.validate(dlg)) { ev.preventDefault(); return; }
      const result = b.value !== null && collect ? collect(dlg, b.value) : b.value;
      dlg.close();
      resolve(result);
    });
    dlg.addEventListener('cancel', () => resolve(null), { once: true });
    dlg.showModal();
    onOpen?.(dlg);
  });
}

export const confirmDialog = (title, message, confirmLabel = 'Delete', style = 'danger') =>
  showDialog({
    title,
    body: `<p>${esc(message)}</p>`,
    buttons: [{ label: 'Cancel', value: false, style: 'ghost' }, { label: confirmLabel, value: true, style }],
  }).then(Boolean);

export const alertDialog = (title, message) =>
  showDialog({ title, body: `<p>${esc(message)}</p>`, buttons: [{ label: 'OK', value: true, style: 'primary' }] });

// ---- Files ----

const isTouch = () => matchMedia('(pointer: coarse)').matches;

// On iPhone this opens the share sheet ("Save to Files", AirDrop, Mail…);
// on a computer it downloads the file.
export async function saveFile(filename, text, mime) {
  const file = new File([text], filename, { type: mime });
  if (isTouch() && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return true;
    } catch (err) {
      if (err.name === 'AbortError') return false;
    }
  }
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return true;
}

export function readFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}
