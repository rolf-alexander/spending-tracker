// Building blocks shared by several screens.

import { ui, categoryById, kindOf, isSpending, expenseCategories, incomeCategories, DAD_TYPES, DAD_TARGETS } from '../store.js';
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

// <option>s for choosing where a transaction goes: a category or one of the Dad options.
// direction: 'out' (money out), 'in' (money in) or 'both' (rules).
export function targetOptions(selected, direction) {
  const group = (label, items) => `<optgroup label="${label}">${items.map(([v, text]) =>
    `<option value="${esc(v)}" ${v === selected ? 'selected' : ''}>${esc(text)}</option>`).join('')}</optgroup>`;
  const cats = list => list.map(c => [c.id, `${c.emoji} ${c.name}`]);
  const dads = list => list.map(d => [`dad:${d}`, `${DAD_TYPES[d].emoji} ${DAD_TYPES[d].label}`]);
  const out = [];
  if (direction !== 'in') out.push(group('Spent', cats(expenseCategories())));
  if (direction !== 'out') out.push(group('Earned', cats(incomeCategories())));
  const dadList = direction === 'both' ? [...DAD_TARGETS.out, ...DAD_TARGETS.in] : DAD_TARGETS[direction];
  out.push(group('Dad', dads(dadList)));
  return out.join('');
}

// A list of entries grouped by day. Tapping a row opens it for editing.
export function expenseList(list, { showTrip = true } = {}) {
  if (!list.length) return '<p class="muted center pad">Nothing here yet.</p>';
  const today = todayISO();
  const groups = [];
  for (const e of list) {
    const g = groups[groups.length - 1];
    if (g && g.date === e.date) g.items.push(e);
    else groups.push({ date: e.date, items: [e] });
  }
  return groups.map(g => {
    const spent = sum(g.items.filter(isSpending));
    return `
    <section class="day">
      <h3><span>${esc(dayLabel(g.date, today))}</span><span class="num">${spent ? money(spent) : ''}</span></h3>
      <ul class="rows">
        ${g.items.map(e => expenseRow(e, showTrip)).join('')}
      </ul>
    </section>`;
  }).join('');
}

function expenseRow(e, showTrip) {
  const kind = kindOf(e);
  let icon;
  let slot = 0;
  let title;
  let sub;
  let sign = '';
  if (kind === 'dad') {
    const d = DAD_TYPES[e.dad] || DAD_TYPES.repay;
    icon = d.emoji;
    title = e.note || e.merchant || d.label;
    sub = title === d.label ? 'Dad' : d.label;
    sign = d.out ? '−' : '+';
  } else {
    const cat = categoryById(e.category);
    icon = cat.emoji;
    slot = cat.slot;
    title = e.note || e.merchant || cat.name;
    sub = [cat.name, showTrip && e.trip ? `🧳 ${e.trip}` : '', e.dad ? `👨 ${DAD_TYPES[e.dad].short}` : ''].filter(Boolean).join(' · ');
    if (kind === 'income') sign = '+';
  }
  return `
    <li>
      <button type="button" class="row" data-id="${esc(e.id)}">
        <span class="row-icon" style="--dot: var(--c${slot})" aria-hidden="true">${icon}</span>
        <span class="row-main">
          <span class="row-title">${esc(title)}</span>
          <span class="row-sub">${esc(sub)}</span>
        </span>
        <span class="row-amount ${sign === '+' ? 'pos' : ''}">
          <span class="num">${sign}${money(e.chf)}</span>
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

// "You owe Dad CHF 50" / "Dad owes you CHF 20" / "You and Dad are square"
export function dadBalanceText(balance) {
  if (balance > 0.004) return `You owe Dad <strong>${money(balance)}</strong>`;
  if (balance < -0.004) return `Dad owes you <strong>${money(-balance)}</strong>`;
  return 'You and Dad are square';
}
