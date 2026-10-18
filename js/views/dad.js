// Dad: what you owe each other, and every entry involving Dad.

import { state, dadBalance, DAD_TYPES } from '../store.js';
import { setTitle, expenseList, bindExpenseList, dadBalanceText } from './common.js';
import { openEditor } from './editor.js';

// The quick buttons. Repayments are pre-filled with the amount needed to get square.
const ACTIONS = [
  { dad: 'repay', kind: 'dad', settles: b => b > 0 },
  { dad: 'repaid', kind: 'dad', settles: b => b < 0 },
  { dad: 'loan', kind: 'dad' },
  { dad: 'owe', kind: 'expense', label: 'Dad paid for something' },
  { dad: 'owed', kind: 'expense', label: 'I paid for something of Dad’s' },
];

export function dadView(root) {
  setTitle('Dad', '#/settings');
  const balance = dadBalance();
  const items = state.expenses.filter(e => e.dad);

  root.innerHTML = `
    <section class="card hero">
      <p class="hero-line">${dadBalanceText(balance)}</p>
      <p class="muted small">When you add an expense, choose <strong>👨 Dad paid (I owe him)</strong> or
        <strong>👨 For Dad (he owes me)</strong>. Things you buy for Dad don't count as your spending.</p>
    </section>

    <div class="choice-grid">
      ${ACTIONS.map((a, i) => `
        <button type="button" class="btn choice" data-action="${i}">
          <span aria-hidden="true">${DAD_TYPES[a.dad].emoji}</span> ${a.label || DAD_TYPES[a.dad].label}
        </button>`).join('')}
    </div>

    <h2 class="pad-x section-title">History</h2>
    <div id="dadList">${expenseList(items)}</div>`;

  bindExpenseList(root.querySelector('#dadList'));
  root.querySelectorAll('[data-action]').forEach(btn => {
    btn.onclick = () => {
      const a = ACTIONS[Number(btn.dataset.action)];
      const preset = { kind: a.kind, dad: a.dad, trip: '' };
      if (a.settles?.(balance)) Object.assign(preset, { amountStr: String(Math.abs(balance)), currency: 'CHF' });
      openEditor(null, preset);
    };
  });
}
