// Everything you've added or imported, with search and filters. Tap an entry to edit or delete it.

import { state, ui, trips, kindOf, isSpending, isIncome, expenseCategories, incomeCategories } from '../store.js';
import { esc, money, sum, monthLabel, monthOf } from '../util.js';
import { setTitle, expenseList, bindExpenseList } from './common.js';

const TYPES = [['', 'Everything'], ['spending', 'Spending'], ['income', 'Earned'], ['dad', 'Dad']];
const typeMatches = (e, type) =>
  !type || (type === 'spending' ? kindOf(e) === 'expense' : type === 'income' ? isIncome(e) : Boolean(e.dad));

export function list(root) {
  setTitle('History');
  const f = ui.list;
  if (f.period !== 'all') f.period = ui.month; // follows the month chosen on the overview
  const months = [...new Set(state.expenses.map(e => monthOf(e.date)))];
  if (!months.includes(ui.month)) months.push(ui.month);
  months.sort().reverse();
  const catOption = c => `<option value="${esc(c.id)}" ${f.cat === c.id ? 'selected' : ''}>${c.emoji} ${esc(c.name)}</option>`;

  root.innerHTML = `
    <div class="filters">
      <input type="search" id="q" placeholder="Search notes and merchants" value="${esc(f.q)}" aria-label="Search">
      <div class="filter-row four">
        <select id="period" aria-label="Period">
          <option value="all" ${f.period === 'all' ? 'selected' : ''}>All time</option>
          ${months.map(m => `<option value="${m}" ${f.period === m ? 'selected' : ''}>${esc(monthLabel(m))}</option>`).join('')}
        </select>
        <select id="type" aria-label="Type">
          ${TYPES.map(([v, label]) => `<option value="${v}" ${f.type === v ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
        <select id="cat" aria-label="Category">
          <option value="">All categories</option>
          <optgroup label="Spent">${expenseCategories().map(catOption).join('')}</optgroup>
          <optgroup label="Earned">${incomeCategories().map(catOption).join('')}</optgroup>
        </select>
        <select id="trip" aria-label="Trip">
          <option value="">Any trip</option>
          <option value="__none" ${f.trip === '__none' ? 'selected' : ''}>No trip</option>
          ${trips().map(t => `<option value="${esc(t.name)}" ${f.trip === t.name ? 'selected' : ''}>🧳 ${esc(t.name)}</option>`).join('')}
        </select>
      </div>
    </div>
    <p class="summary" id="summary"></p>
    <div id="results"></div>`;

  const draw = () => {
    const q = f.q.trim().toLowerCase();
    const items = state.expenses.filter(e =>
      (f.period === 'all' || e.date.startsWith(f.period)) &&
      typeMatches(e, f.type) &&
      (!f.cat || e.category === f.cat) &&
      (!f.trip || (f.trip === '__none' ? !e.trip : e.trip === f.trip)) &&
      (!q || `${e.note} ${e.merchant || ''} ${e.trip}`.toLowerCase().includes(q)));
    const spent = sum(items.filter(isSpending));
    const earned = sum(items.filter(isIncome));
    root.querySelector('#summary').textContent = [
      `${items.length} entr${items.length === 1 ? 'y' : 'ies'}`,
      spent ? `spent ${money(spent)}` : '',
      earned ? `earned +${money(earned)}` : '',
    ].filter(Boolean).join(' · ');
    const results = root.querySelector('#results');
    results.innerHTML = expenseList(items);
    bindExpenseList(results);
  };

  root.querySelector('#q').oninput = ev => { f.q = ev.target.value; draw(); };
  root.querySelector('#period').onchange = ev => { f.period = ev.target.value; if (f.period !== 'all') ui.month = f.period; draw(); };
  root.querySelector('#type').onchange = ev => { f.type = ev.target.value; draw(); };
  root.querySelector('#cat').onchange = ev => { f.cat = ev.target.value; draw(); };
  root.querySelector('#trip').onchange = ev => { f.trip = ev.target.value; draw(); };
  draw();
}
