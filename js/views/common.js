// Building blocks shared by several screens.

import { ui, categoryById } from '../store.js';
import { esc, money, sum, monthLabel, addMonths, dayLabel, todayISO, monthOf } from '../util.js';
import { openEditor } from './editor.js';

export function setTitle(title, back) {
  document.getElementById('topbar').innerHTML = `
    ${back ? `<a class="back" href="${back}" aria-label="Back">‹</a>` : ''}
    <h1>${esc(title)}</h1>`;
}

export function monthNav(ym) {
  const isCurrent = ym >= monthOf(todayISO());
  return `
    <div class="month-nav">
      <button type="button" class="icon-btn" data-month="-1" aria-label="Previous month">‹</button>
      <strong>${esc(monthLabel(ym))}</strong>
      <button type="button" class="icon-btn" data-month="1" aria-label="Next month" ${isCurrent ? 'disabled' : ''}>›</button>
    </div>`;
}

export function bindMonthNav(root, rerender) {
  root.querySelectorAll('[data-month]').forEach(btn => {
    btn.onclick = () => {
      ui.month = addMonths(ui.month, Number(btn.dataset.month));
      rerender();
    };
  });
}

export function segmented(name, options, value, extraClass = '') {
  return `
    <div class="segmented ${extraClass}" role="radiogroup" data-seg="${name}">
      ${options.map(([v, label]) => `<button type="button" role="radio" aria-checked="${v === value}" data-value="${esc(v)}">${esc(label)}</button>`).join('')}
    </div>`;
}

export function bindSegmented(root, name, onChange) {
  root.querySelectorAll(`[data-seg="${name}"] button`).forEach(btn => {
    btn.onclick = () => onChange(btn.dataset.value);
  });
}

// A list of expenses grouped by day. Tapping a row opens it for editing.
export function expenseList(list, { showTrip = true } = {}) {
  if (!list.length) return '<p class="muted center pad">Nothing here yet.</p>';
  const today = todayISO();
  const groups = [];
  for (const e of list) {
    const g = groups[groups.length - 1];
    if (g && g.date === e.date) g.items.push(e);
    else groups.push({ date: e.date, items: [e] });
  }
  return groups.map(g => `
    <section class="day">
      <h3><span>${esc(dayLabel(g.date, today))}</span><span class="num">${money(sum(g.items))}</span></h3>
      <ul class="rows">
        ${g.items.map(e => expenseRow(e, showTrip)).join('')}
      </ul>
    </section>`).join('');
}

function expenseRow(e, showTrip) {
  const cat = categoryById(e.category);
  const title = e.note || e.merchant || cat.name;
  const sub = [cat.name, showTrip && e.trip ? `🧳 ${e.trip}` : ''].filter(Boolean).join(' · ');
  return `
    <li>
      <button type="button" class="row" data-id="${esc(e.id)}">
        <span class="row-icon" style="--dot: var(--c${cat.slot})" aria-hidden="true">${cat.emoji}</span>
        <span class="row-main">
          <span class="row-title">${esc(title)}</span>
          <span class="row-sub">${esc(sub)}</span>
        </span>
        <span class="row-amount">
          <span class="num">${money(e.chf)}</span>
          ${e.currency !== 'CHF' ? `<span class="row-sub num">${money(e.amount, e.currency)}${e.estimated ? ' · est.' : ''}</span>` : ''}
        </span>
      </button>
    </li>`;
}

export function bindExpenseList(root) {
  root.querySelectorAll('.row[data-id]').forEach(btn => {
    btn.onclick = () => openEditor(btn.dataset.id);
  });
}
