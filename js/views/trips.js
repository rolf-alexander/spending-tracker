// Trips: totals per trip tag, plus an "active trip" that new expenses are tagged with.

import { state, trips, setSetting, renameTrip } from '../store.js';
import { esc, money, shortDate, showDialog, confirmDialog, toast } from '../util.js';
import { setTitle, expenseList, bindExpenseList } from './common.js';
import { categoryList } from './dashboard.js';
import { notifyChange } from './editor.js';

const tripHref = name => `#/trip/${encodeURIComponent(name)}`;
const days = (from, to) => Math.round((new Date(to) - new Date(from)) / 86400000) + 1;

export function tripsView(root) {
  setTitle('Trips');
  const active = state.settings.activeTrip;
  const all = trips();
  if (active && !all.some(t => t.name === active)) all.unshift({ name: active, total: 0, count: 0 });

  root.innerHTML = `
    <section class="card">
      ${active
        ? `<p>🧳 You're on <strong>${esc(active)}</strong>. New expenses are tagged with it automatically.</p>
           <button type="button" class="btn" id="endTrip">End trip</button>`
        : `<p class="muted">Start a trip and every new expense gets tagged with it, so you can see what the whole trip cost. Trip spending doesn't count towards your monthly budgets.</p>
           <button type="button" class="btn primary" id="startTrip">Start a trip</button>`}
    </section>

    ${all.length ? `
      <ul class="rows card flush">
        ${all.map(t => `
          <li>
            <a class="row" href="${tripHref(t.name)}">
              <span class="row-icon" aria-hidden="true">🧳</span>
              <span class="row-main">
                <span class="row-title">${esc(t.name)} ${t.name === active ? '<span class="badge">Active</span>' : ''}</span>
                <span class="row-sub">${t.count ? `${shortDate(t.from)} – ${shortDate(t.to)} · ${t.count} expense${t.count === 1 ? '' : 's'}` : 'No expenses yet'}</span>
              </span>
              <span class="row-amount num">${money(t.total)}</span>
            </a>
          </li>`).join('')}
      </ul>` : '<p class="muted center pad">No trips yet. You can also type a trip name when adding an expense.</p>'}`;

  root.querySelector('#startTrip')?.addEventListener('click', async () => {
    const name = await askTripName('Start a trip', '');
    if (!name) return;
    await setSetting('activeTrip', name);
    toast(`New expenses will be tagged “${name}”`);
    tripsView(root);
  });
  root.querySelector('#endTrip')?.addEventListener('click', async () => {
    await setSetting('activeTrip', '');
    tripsView(root);
  });
}

export function tripDetail(root, name) {
  setTitle(name, '#/trips');
  const items = state.expenses.filter(e => e.trip === name);
  const info = trips().find(t => t.name === name);
  const isActive = state.settings.activeTrip === name;
  const byCurrency = {};
  for (const e of items) byCurrency[e.currency] = (byCurrency[e.currency] || 0) + e.amount;

  root.innerHTML = `
    <section class="card hero">
      <p class="muted">Trip total</p>
      <p class="hero-figure">${money(info?.total || 0)}</p>
      ${info ? `<p class="muted small">${shortDate(info.from)} – ${shortDate(info.to)} · ${days(info.from, info.to)} day${days(info.from, info.to) === 1 ? '' : 's'} ·${money(info.total / days(info.from, info.to))} per day</p>` : ''}
      ${Object.keys(byCurrency).length > 1 || (Object.keys(byCurrency)[0] && Object.keys(byCurrency)[0] !== 'CHF')
        ? `<p class="muted small">Paid: ${Object.entries(byCurrency).map(([c, v]) => money(v, c)).join(' · ')}</p>` : ''}
    </section>
    <div class="btn-row">
      <button type="button" class="btn" id="toggleActive">${isActive ? 'End trip' : 'Make active'}</button>
      <button type="button" class="btn" id="rename">Rename</button>
    </div>
    <section class="card">
      <h2>By category</h2>
      ${categoryList(items)}
    </section>
    <div id="tripList">${expenseList(items, { showTrip: false })}</div>`;

  bindExpenseList(root.querySelector('#tripList'));
  root.querySelector('#toggleActive').onclick = async () => {
    await setSetting('activeTrip', isActive ? '' : name);
    toast(isActive ? 'Trip ended' : `New expenses will be tagged “${name}”`);
    tripDetail(root, name);
  };
  root.querySelector('#rename').onclick = async () => {
    const to = await askTripName('Rename trip', name);
    if (!to || to === name) return;
    if (trips().some(t => t.name === to) && !(await confirmDialog('Merge trips?', `A trip called “${to}” already exists. The two will be combined.`, 'Merge', 'primary'))) return;
    await renameTrip(name, to);
    notifyChange();
    location.hash = tripHref(to);
  };
}

function askTripName(title, value) {
  return showDialog({
    title,
    body: `<label class="field">Trip name<input type="text" name="trip" value="${esc(value)}" placeholder="e.g. Japan 2027" autocomplete="off"></label>`,
    buttons: [
      { label: 'Cancel', value: null, style: 'ghost' },
      { label: 'OK', value: true, style: 'primary', validate: d => d.querySelector('[name=trip]').value.trim() !== '' },
    ],
    onOpen: d => d.querySelector('input').focus(),
    collect: d => d.querySelector('[name=trip]').value.trim(),
  });
}
