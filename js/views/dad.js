// Dad: what you owe each other, things not decided yet, and every entry involving Dad.

import { state, dadBalance, dadUnsure, DAD_TYPES, saveExpense, categoryById } from '../store.js';
import { esc, money, showDialog, toast, notifyChange } from '../util.js';
import { setTitle, expenseList, bindExpenseList, dadBalanceText } from './common.js';
import { openEditor } from './editor.js';

// The quick buttons. Repayments are pre-filled with the amount needed to get square.
const ACTIONS = [
  { dad: 'repay', kind: 'dad', settles: b => b > 0 },
  { dad: 'repaid', kind: 'dad', settles: b => b < 0 },
  { dad: 'loan', kind: 'dad' },
  { dad: 'owe', kind: 'expense', label: 'Dad paid for something' },
  { dad: 'owed', kind: 'expense', label: 'I paid for something of Dad’s' },
  { dad: 'maybe-owed', kind: 'expense', label: 'Not sure who pays' },
];

// How an undecided entry can be settled: [new dad value, button text].
const DECISIONS = {
  'maybe-owed': [['owed', '👨 Dad will pay me back'], ['', '👤 It’s my own spending']],
  'maybe-owe': [['owe', '👨 I’ll pay Dad back'], ['gift', '🎁 It’s a gift from Dad']],
};

export function dadView(root) {
  setTitle('Dad', '#/settings');
  const balance = dadBalance();
  const unsure = dadUnsure();
  const items = state.expenses.filter(e => e.dad && !DAD_TYPES[e.dad]?.unsure);

  root.innerHTML = `
    <section class="card hero">
      <p class="hero-line">${dadBalanceText(balance)}</p>
      <p class="muted small">When you add an expense, choose <strong>👨 Dad paid (I owe him)</strong> or
        <strong>👨 For Dad (he owes me)</strong>. Things you buy for Dad don't count as your spending.
        If you don't know yet, choose one of the <strong>🤷 Not sure</strong> options and decide later.</p>
    </section>

    ${unsure.items.length ? `
      <section class="card">
        <h2>🤷 Not decided yet</h2>
        <dl class="money-rows">
          ${unsure.mightOweMe ? `<div><dt>Dad might owe you</dt><dd class="num">${money(unsure.mightOweMe)}</dd></div>` : ''}
          ${unsure.mightOweDad ? `<div><dt>You might owe Dad</dt><dd class="num">${money(unsure.mightOweDad)}</dd></div>` : ''}
        </dl>
        <p class="muted small">These don't change what you owe each other until you decide. Tap one to decide.</p>
        <div id="unsureList">${expenseList(unsure.items)}</div>
      </section>` : ''}

    <div class="choice-grid">
      ${ACTIONS.map((a, i) => `
        <button type="button" class="btn choice" data-action="${i}">
          <span aria-hidden="true">${DAD_TYPES[a.dad].emoji}</span> ${a.label || DAD_TYPES[a.dad].label}
        </button>`).join('')}
    </div>

    <h2 class="pad-x section-title">History</h2>
    <div id="dadList">${expenseList(items)}</div>`;

  bindExpenseList(root.querySelector('#dadList'));
  root.querySelectorAll('#unsureList .row[data-id]').forEach(btn => {
    btn.onclick = () => decide(state.expenses.find(e => e.id === btn.dataset.id));
  });
  root.querySelectorAll('[data-action]').forEach(btn => {
    btn.onclick = () => {
      const a = ACTIONS[Number(btn.dataset.action)];
      const preset = { kind: a.kind, dad: a.dad, trip: '' };
      if (a.settles?.(balance)) Object.assign(preset, { amountStr: String(Math.abs(balance)), currency: 'CHF' });
      openEditor(null, preset);
    };
  });
}

async function decide(e) {
  const title = e.note || e.merchant || categoryById(e.category).name;
  const choice = await showDialog({
    title: 'Decided?',
    body: `
      <p><strong>${esc(title)}</strong> · <span class="num">${money(e.chf)}</span><br>
        <span class="muted small">${esc(DAD_TYPES[e.dad].label)}</span></p>
      <div class="stack">
        ${DECISIONS[e.dad].map(([value, label]) =>
          `<button type="submit" class="btn choice" value="set:${value}">${esc(label)}</button>`).join('')}
      </div>`,
    buttons: [{ label: 'Edit', value: 'edit', style: 'ghost' }, { label: 'Not yet', value: null, style: 'ghost' }],
  });
  if (choice === 'edit') openEditor(e.id);
  if (!choice?.startsWith('set:')) return;
  const dad = choice.slice(4);
  await saveExpense({ id: e.id, dad });
  notifyChange();
  toast(dad ? `Marked: ${DAD_TYPES[dad].short}` : 'Marked as your own spending');
}
