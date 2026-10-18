// Trips: plan trips with dates, see what each one cost (including things bought beforehand).

import { state, trips, saveTrip, deleteTrip, isSpending } from '../store.js';
import { esc, money, sum, shortDate, todayISO, confirmDialog, toast, notifyChange } from '../util.js';
import { setTitle, expenseList, bindExpenseList } from './common.js';
import { categoryList } from './dashboard.js';
import { tripDialog } from './tripdialog.js';

const tripHref = name => `#/trip/${encodeURIComponent(name)}`;
const daysBetween = (from, to) => Math.round((new Date(to) - new Date(from)) / 86400000);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function status(t, today) {
  if (!t.start || !t.end) return '';
  if (today < t.start) return `<span class="badge">In ${plural(daysBetween(today, t.start), 'day')}</span>`;
  if (today <= t.end) return '<span class="badge now">Now</span>';
  return '';
}

function dateRange(t) {
  if (t.start && t.end) return `${shortDate(t.start)} – ${shortDate(t.end)}`;
  if (t.start) return `From ${shortDate(t.start)}`;
  if (t.from) return `${shortDate(t.from)} – ${shortDate(t.to)}`;
  return 'No dates';
}

export function tripsView(root) {
  setTitle('Trips');
  const today = todayISO();
  const all = trips();

  root.innerHTML = `
    <section class="card">
      <p class="muted small">Plan a trip with its dates and everything you add during the trip is tagged automatically.
        For things you buy beforehand, like flights or gear, pick the trip when you add them. Your everyday
        groceries stay untagged. Trip spending doesn't count towards your monthly budgets.</p>
      <button type="button" class="btn primary" id="planTrip">Plan a trip</button>
    </section>

    ${all.length ? `
      <ul class="rows card flush">
        ${all.map(t => `
          <li>
            <a class="row" href="${tripHref(t.name)}">
              <span class="row-icon" aria-hidden="true">🧳</span>
              <span class="row-main">
                <span class="row-title">${esc(t.name)} ${status(t, today)}</span>
                <span class="row-sub">${dateRange(t)} · ${plural(t.count, 'expense')}</span>
              </span>
              <span class="row-amount num">${money(t.total)}</span>
            </a>
          </li>`).join('')}
      </ul>` : ''}`;

  root.querySelector('#planTrip').onclick = async () => {
    const t = await tripDialog(null);
    if (!t) return;
    await saveTrip(null, t);
    toast(`Trip “${t.name}” created`);
    tripsView(root);
  };
}

export function tripDetail(root, name) {
  setTitle(name, '#/trips');
  const info = trips().find(t => t.name === name) || { name, start: '', end: '', total: 0 };
  const items = state.expenses.filter(e => e.trip === name);
  const spending = items.filter(isSpending);
  const before = info.start ? sum(spending.filter(e => e.date < info.start)) : 0;
  const during = sum(spending) - before;
  const tripDays = info.start && info.end ? daysBetween(info.start, info.end) + 1 : 0;
  const byCurrency = {};
  for (const e of spending) byCurrency[e.currency] = (byCurrency[e.currency] || 0) + e.amount;
  const currencies = Object.keys(byCurrency);

  root.innerHTML = `
    <section class="card hero">
      <p class="muted">Trip total</p>
      <p class="hero-figure">${money(sum(spending))}</p>
      <p class="muted small">${dateRange(info)}${tripDays ? ` · ${plural(tripDays, 'day')}` : ''}</p>
      ${before ? `<p class="muted small">Before the trip ${money(before)}${during ? ` · During ${money(during)}` : ''}</p>` : ''}
      ${during && tripDays ? `<p class="muted small">${money(during / tripDays)} a day during the trip</p>` : ''}
      ${currencies.length > 1 || (currencies[0] && currencies[0] !== 'CHF')
        ? `<p class="muted small">Paid: ${currencies.map(c => money(byCurrency[c], c)).join(' · ')}</p>` : ''}
    </section>
    <div class="btn-row">
      <button type="button" class="btn" id="editTrip">Edit trip</button>
      <button type="button" class="btn danger" id="deleteTrip">Delete trip</button>
    </div>
    <section class="card">
      <h2>By category</h2>
      ${categoryList(spending)}
    </section>
    <div id="tripList">${expenseList(items, { showTrip: false })}</div>`;

  bindExpenseList(root.querySelector('#tripList'));
  root.querySelector('#editTrip').onclick = async () => {
    const t = await tripDialog(info);
    if (!t) return;
    await saveTrip(name, t);
    notifyChange();
    if (t.name !== name) location.hash = tripHref(t.name);
  };
  root.querySelector('#deleteTrip').onclick = async () => {
    const ok = await confirmDialog('Delete this trip?',
      items.length ? `Its ${plural(items.length, 'expense')} will be kept, just without the trip tag.` : 'It has no expenses yet.');
    if (!ok) return;
    await deleteTrip(name);
    notifyChange();
    location.hash = '#/trips';
  };
}
