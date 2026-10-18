// Overview: this month's spending, money in & out, Dad, budgets and charts.

import { state, ui, expensesInMonth, byCategory, budgets, isSpending, isIncome, dadBalance, dadUnsure } from '../store.js';
import { getLatest } from '../rates.js';
import { esc, money, sum, monthLabel, monthName, addMonths, daysInMonth } from '../util.js';
import { barChart } from '../charts.js';
import { cloudConfig } from '../cloud.js';
import { setTitle, monthNav, bindMonthNav, segmented, bindSegmented, dadBalanceText } from './common.js';

export function dashboard(root) {
  setTitle('Overview');
  if (!state.expenses.length) {
    root.innerHTML = `
      ${notices()}
      <section class="card empty">
        <p class="big-emoji" aria-hidden="true">👋</p>
        <p><strong>Welcome!</strong></p>
        <p>Tap the blue <strong>+</strong> button below to add your first expense or income,
        or <a href="#/import">import a bank statement</a>.</p>
        <p class="muted small">Tip: set monthly budgets in <a href="#/categories">Settings → Categories & budgets</a>.</p>
      </section>`;
    return;
  }

  const ym = ui.month;
  const monthAll = expensesInMonth(ym);
  const spendingAll = monthAll.filter(isSpending);
  const scoped = list => (ui.scope === 'everyday' ? list.filter(e => !e.trip) : list);
  const list = scoped(spendingAll);
  const total = sum(list);
  const tripTotal = sum(spendingAll.filter(e => e.trip));
  const prevTotal = sum(scoped(expensesInMonth(addMonths(ym, -1)).filter(isSpending)));
  const earned = sum(monthAll.filter(isIncome));
  const spentAll = sum(spendingAll);
  const leftOver = Math.round((earned - spentAll) * 100) / 100;
  const hasIncome = state.expenses.some(isIncome);
  const hasDad = state.expenses.some(e => e.dad);
  const unsureCount = dadUnsure().items.length;
  const budgetRows = budgets(ym);
  const alerts = budgetRows.filter(b => b.status !== 'ok');

  root.innerHTML = `
    ${notices()}
    ${monthNav(ym)}
    ${segmented('scope', [['all', 'All spending'], ['everyday', 'Without trips']], ui.scope)}

    <section class="card hero">
      <p class="muted">Spent in ${esc(monthName(ym))}</p>
      <p class="hero-figure">${money(total)}</p>
      <p class="muted small">
        ${list.length} expense${list.length === 1 ? '' : 's'}
        ${ui.scope === 'all' && tripTotal ? ` · ${money(tripTotal)} on trips` : ''}
        ${prevTotal ? ` · ${delta(total, prevTotal)} vs ${esc(monthName(addMonths(ym, -1)))}` : ''}
      </p>
    </section>

    ${hasIncome ? `
      <section class="card">
        <h2>Money in & out</h2>
        <dl class="money-rows">
          <div><dt>Earned</dt><dd class="num pos">+${money(earned)}</dd></div>
          <div><dt>Spent</dt><dd class="num">−${money(spentAll)}</dd></div>
          <div class="total"><dt>${leftOver < 0 ? 'Overspent' : 'Left over'}</dt>
            <dd class="num ${leftOver < 0 ? 'neg' : ''}">${leftOver < 0 ? '−' : ''}${money(Math.abs(leftOver))}</dd></div>
        </dl>
      </section>` : ''}

    ${hasDad ? `
      <a class="card link-card" href="#/dad">
        <span class="row-icon" aria-hidden="true">👨</span>
        <span>${dadBalanceText(dadBalance())}${unsureCount ? `<br><span class="muted small">🤷 ${unsureCount} not decided yet</span>` : ''}</span>
        <span class="chev" aria-hidden="true">›</span>
      </a>` : ''}

    ${alerts.length ? `
      <section class="card alerts" role="alert">
        ${alerts.map(b => `
          <p class="alert ${b.status}">
            <span class="status-icon" aria-hidden="true">${b.status === 'over' ? '⛔' : '⚠️'}</span>
            <span><strong>${esc(b.category.name)}</strong>: ${b.status === 'over'
              ? `over budget by ${money(b.spent - b.budget)}`
              : `${Math.round(b.ratio * 100)}% of budget used, ${money(b.budget - b.spent)} left`}</span>
          </p>`).join('')}
      </section>` : ''}

    ${budgetRows.length ? `
      <section class="card">
        <h2>Budgets <span class="muted small">without trips</span></h2>
        ${budgetRows.map(budgetRow).join('')}
      </section>` : ''}

    <section class="card">
      <h2>By category</h2>
      ${categoryList(list)}
    </section>

    <section class="card">
      <div class="card-head">
        <h2>Over time</h2>
        ${segmented('timeView', [['daily', 'Days'], ['monthly', '12 months']], ui.timeView, 'small')}
      </div>
      <div id="timeChart"></div>
    </section>
  `;

  bindMonthNav(root, () => dashboard(root));
  bindSegmented(root, 'scope', v => { ui.scope = v; dashboard(root); });
  bindSegmented(root, 'timeView', v => { ui.timeView = v; dashboard(root); });
  drawTimeChart(root.querySelector('#timeChart'), m => scoped(expensesInMonth(m).filter(isSpending)));
}

function notices() {
  const out = [];
  if (getLatest().fallback) {
    out.push(`<p class="notice">📡 Exchange rates haven't been downloaded yet. Foreign amounts use approximate rates until you're online.</p>`);
  }
  if (cloudConfig()?.token && state.settings.ghError) {
    out.push(`<p class="notice">⚠️ Automatic backup isn't working. <a href="#/settings">See why</a></p>`);
  }
  const last = state.settings.lastBackupAt;
  const DAY = 86400000;
  if (state.expenses.length >= 5 && (!last || Date.now() - last > 30 * DAY)) {
    out.push(`<p class="notice">💾 ${last ? "You haven't backed up in over a month." : "You haven't made a backup yet."} <a href="#/settings">Back up now</a></p>`);
  }
  return out.join('');
}

function delta(now, before) {
  const pct = Math.round(((now - before) / before) * 100);
  return pct === 0 ? 'same' : `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}%`;
}

function budgetRow(b) {
  const pct = Math.min(100, b.ratio * 100);
  const label = { ok: 'On track', warn: 'Close to limit', over: 'Over budget' }[b.status];
  const icon = { ok: '✓', warn: '⚠', over: '⛔' }[b.status];
  return `
    <div class="meter-row">
      <div class="meter-head">
        <span>${b.category.emoji} ${esc(b.category.name)}</span>
        <span class="num">${money(b.spent, 'CHF', { whole: true })} <span class="muted">/ ${money(b.budget, 'CHF', { whole: true })}</span></span>
      </div>
      <div class="meter" role="meter" aria-valuemin="0" aria-valuemax="${b.budget}" aria-valuenow="${b.spent}" aria-label="${esc(b.category.name)} budget">
        <div class="meter-fill ${b.status}" style="width:${pct}%"></div>
      </div>
      <p class="meter-status ${b.status}"><span aria-hidden="true">${icon}</span> ${label} · ${Math.round(b.ratio * 100)}%</p>
    </div>`;
}

export function categoryList(list) {
  const rows = byCategory(list);
  if (!rows.length) return '<p class="muted">No expenses yet.</p>';
  const total = sum(list);
  const max = rows[0].total;
  return `<ul class="hbars">${rows.map(r => `
    <li>
      <div class="hbar-head">
        <span>${r.category.emoji} ${esc(r.category.name)}</span>
        <span class="num">${money(r.total)} <span class="muted">${Math.round((r.total / total) * 100)}%</span></span>
      </div>
      <div class="hbar"><div class="hbar-fill" style="width:${(r.total / max) * 100}%; background: var(--c${r.category.slot})"></div></div>
    </li>`).join('')}</ul>`;
}

// spendingIn(month) returns the spending entries to chart for a month.
function drawTimeChart(el, spendingIn) {
  const ym = ui.month;
  let data;
  let showLabel;
  if (ui.timeView === 'daily') {
    const days = daysInMonth(ym);
    const totals = new Array(days).fill(0);
    for (const e of spendingIn(ym)) totals[Number(e.date.slice(8)) - 1] += e.chf;
    data = totals.map((v, i) => ({
      label: String(i + 1),
      value: v,
      tip: `<strong>${money(v)}</strong><br>${i + 1} ${esc(monthName(ym, 'short'))}`,
    }));
    showLabel = i => i === 0 || (i + 1) % 5 === 0;
  } else {
    const months = Array.from({ length: 12 }, (_, i) => addMonths(ym, i - 11));
    data = months.map(m => {
      const v = sum(spendingIn(m));
      return { label: monthName(m, 'narrow'), value: v, tip: `<strong>${money(v)}</strong><br>${esc(monthLabel(m, 'short'))}` };
    });
    showLabel = () => true;
  }
  barChart(el, data, { showLabel });
}
