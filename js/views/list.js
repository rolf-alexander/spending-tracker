// All expenses, with search and filters. Tap one to edit or delete it.

import { state, ui, trips } from '../store.js';
import { esc, money, sum, monthLabel, monthOf } from '../util.js';
import { setTitle, expenseList, bindExpenseList } from './common.js';

export function list(root) {
  setTitle('Expenses');
  const f = ui.list;
  if (f.period !== 'all') f.period = ui.month; // follows the month chosen on the overview
  const months = [...new Set(state.expenses.map(e => monthOf(e.date)))];
  if (!months.includes(ui.month)) months.push(ui.month);
  months.sort().reverse();

  root.innerHTML = `
    <div class="filters">
      <input type="search" id="q" placeholder="Search notes and merchants" value="${esc(f.q)}" aria-label="Search">
      <div class="filter-row">
        <select id="period" aria-label="Period">
          <option value="all" ${f.period === 'all' ? 'selected' : ''}>All time</option>
          ${months.map(m => `<option value="${m}" ${f.period === m ? 'selected' : ''}>${esc(monthLabel(m))}</option>`).join('')}
        </select>
        <select id="cat" aria-label="Category">
          <option value="">All categories</option>
          ${state.categories.map(c => `<option value="${esc(c.id)}" ${f.cat === c.id ? 'selected' : ''}>${c.emoji} ${esc(c.name)}</option>`).join('')}
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
      (!f.cat || e.category === f.cat) &&
      (!f.trip || (f.trip === '__none' ? !e.trip : e.trip === f.trip)) &&
      (!q || `${e.note} ${e.merchant || ''} ${e.trip}`.toLowerCase().includes(q)));
    root.querySelector('#summary').textContent = `${items.length} expense${items.length === 1 ? '' : 's'} · ${money(sum(items))}`;
    const results = root.querySelector('#results');
    results.innerHTML = expenseList(items);
    bindExpenseList(results);
  };

  root.querySelector('#q').oninput = ev => { f.q = ev.target.value; draw(); };
  root.querySelector('#period').onchange = ev => { f.period = ev.target.value; if (f.period !== 'all') ui.month = f.period; draw(); };
  root.querySelector('#cat').onchange = ev => { f.cat = ev.target.value; draw(); };
  root.querySelector('#trip').onchange = ev => { f.trip = ev.target.value; draw(); };
  draw();
}
