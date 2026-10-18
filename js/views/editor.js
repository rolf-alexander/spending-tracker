// The quick-add / edit screen. Designed for one thumb: the number pad, category
// buttons and Save button sit in the lower part of the screen.

import { state, saveExpense, deleteExpense, setSetting, categoryById, trips } from '../store.js';
import { CURRENCIES, previewCHF } from '../rates.js';
import { esc, money, decimals, todayISO, dayLabel, toast, confirmDialog } from '../util.js';

const root = () => document.getElementById('editor');
let draft = null;

export const notifyChange = () => window.dispatchEvent(new CustomEvent('datachange'));

export function openEditor(id) {
  const e = id ? state.expenses.find(x => x.id === id) : null;
  draft = e
    ? { id: e.id, amountStr: String(e.amount), currency: e.currency, category: e.category, date: e.date, note: e.note || '', trip: e.trip || '', merchant: e.merchant || '' }
    : { amountStr: '', currency: state.settings.lastCurrency || 'CHF', category: '', date: todayISO(), note: '', trip: state.settings.activeTrip || '' };
  render();
  document.getElementById('toast').hidden = true;
  root().hidden = false;
  document.body.classList.add('editor-open');
}

export function closeEditor() {
  root().hidden = true;
  document.body.classList.remove('editor-open');
  draft = null;
}

export const editorOpen = () => draft !== null;

function render() {
  const el = root();
  const isEdit = Boolean(draft.id);
  el.innerHTML = `
    <div class="ed">
      <header class="ed-head">
        <button type="button" class="icon-btn" data-act="close" aria-label="Close">✕</button>
        <h2>${isEdit ? 'Edit expense' : 'New expense'}</h2>
        <label class="chip date-chip">
          <span aria-hidden="true">📅</span> <span id="edDateLabel"></span>
          <input type="date" id="edDate" value="${draft.date}" aria-label="Date">
        </label>
      </header>

      <div class="ed-amount">
        <p class="amount-display" aria-live="polite"><span class="cur" id="edCur"></span><span id="edAmount"></span></p>
        <p class="muted small" id="edConv">&nbsp;</p>
      </div>

      <div class="cur-row" role="radiogroup" aria-label="Currency">
        ${CURRENCIES.map(c => `<button type="button" role="radio" data-cur="${c}">${c}</button>`).join('')}
      </div>

      <div class="cat-grid" role="radiogroup" aria-label="Category">
        ${state.categories.map(c => `
          <button type="button" role="radio" data-cat="${esc(c.id)}" style="--dot: var(--c${c.slot})">
            <span class="cat-emoji" aria-hidden="true">${c.emoji}</span><span class="cat-name">${esc(c.name)}</span>
          </button>`).join('')}
      </div>

      <div class="ed-fields">
        <input type="text" id="edNote" placeholder="📝 Note" value="${esc(draft.note)}" autocomplete="off" enterkeyhint="done" aria-label="Note">
        <input type="text" id="edTrip" placeholder="🧳 Trip" value="${esc(draft.trip)}" list="edTrips" autocomplete="off" enterkeyhint="done" aria-label="Trip">
        <datalist id="edTrips">${trips().map(t => `<option value="${esc(t.name)}">`).join('')}</datalist>
      </div>
      ${draft.merchant ? `<p class="muted small ed-merchant">From bank: ${esc(draft.merchant)}</p>` : ''}

      <div class="keypad">
        ${['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'].map(k => `
          <button type="button" data-key="${k}" ${k === 'back' ? 'aria-label="Delete digit"' : ''}>${k === 'back' ? '⌫' : k}</button>`).join('')}
      </div>

      <div class="ed-actions">
        ${isEdit ? '<button type="button" class="btn danger" data-act="delete">Delete</button>' : ''}
        <button type="button" class="btn primary big" id="edSave"></button>
      </div>
    </div>`;

  el.querySelector('[data-act="close"]').onclick = closeEditor;
  el.querySelector('[data-act="delete"]')?.addEventListener('click', remove);
  el.querySelector('#edSave').onclick = save;
  el.querySelectorAll('[data-key]').forEach(b => { b.onclick = () => press(b.dataset.key); });
  el.querySelectorAll('[data-cur]').forEach(b => { b.onclick = () => setCurrency(b.dataset.cur); });
  el.querySelectorAll('[data-cat]').forEach(b => {
    b.onclick = () => { draft.category = b.dataset.cat; update(); };
  });
  const date = el.querySelector('#edDate');
  date.onchange = () => { if (date.value) { draft.date = date.value; update(); } };
  date.onclick = () => { try { date.showPicker?.(); } catch { /* not supported */ } };
  el.querySelector('#edNote').oninput = ev => { draft.note = ev.target.value; };
  el.querySelector('#edTrip').oninput = ev => { draft.trip = ev.target.value; };
  update();
}

// Refreshes the parts of the screen that change while typing.
function update() {
  const el = root();
  const amount = parseFloat(draft.amountStr) || 0;
  el.querySelector('#edCur').textContent = draft.currency;
  el.querySelector('#edAmount').textContent = displayAmount(draft.amountStr);
  el.querySelector('#edConv').innerHTML = draft.currency !== 'CHF' && amount
    ? `≈ ${money(previewCHF(amount, draft.currency))}`
    : '&nbsp;';
  el.querySelectorAll('[data-cur]').forEach(b => b.setAttribute('aria-checked', b.dataset.cur === draft.currency));
  el.querySelectorAll('[data-cat]').forEach(b => b.setAttribute('aria-checked', b.dataset.cat === draft.category));
  el.querySelector('#edDateLabel').textContent = dayLabel(draft.date, todayISO());
  const btn = el.querySelector('#edSave');
  btn.disabled = !(amount > 0 && draft.category);
  btn.textContent = !(amount > 0) ? 'Enter an amount' : !draft.category ? 'Pick a category' : draft.id ? 'Save changes' : 'Save';
}

function displayAmount(s) {
  if (!s) return '0';
  const [int, dec] = s.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '’');
  return dec === undefined ? grouped : `${grouped}.${dec}`;
}

function press(key) {
  let s = draft.amountStr;
  const maxDecimals = decimals(draft.currency);
  if (key === 'back') s = s.slice(0, -1);
  else if (key === '.') {
    if (maxDecimals === 0 || s.includes('.')) return;
    s = `${s || '0'}.`;
  } else {
    if (s.includes('.') && s.split('.')[1].length >= maxDecimals) return;
    if (s.replace('.', '').length >= 9) return;
    s = s === '0' ? key : s + key;
  }
  draft.amountStr = s;
  update();
}

function setCurrency(cur) {
  draft.currency = cur;
  if (decimals(cur) === 0 && draft.amountStr.includes('.')) {
    draft.amountStr = String(Math.round(parseFloat(draft.amountStr) || 0) || '');
  }
  update();
}

async function save() {
  const amount = parseFloat(draft.amountStr);
  if (!(amount > 0) || !draft.category) return;
  const { id, currency, category, date, note, trip } = draft;
  const btn = root().querySelector('#edSave');
  btn.disabled = true;
  const saved = await saveExpense({ id, amount, currency, category, date, note, trip });
  if (!id) await setSetting('lastCurrency', currency);
  closeEditor();
  notifyChange();
  const label = `${id ? 'Updated' : 'Saved'} ${money(saved.chf)} · ${categoryById(category).name}`;
  toast(label, id ? null : {
    label: 'Undo',
    run: async () => { await deleteExpense(saved.id); notifyChange(); },
  });
}

async function remove() {
  if (!(await confirmDialog('Delete this expense?', 'This cannot be undone.'))) return;
  await deleteExpense(draft.id);
  closeEditor();
  notifyChange();
  toast('Expense deleted');
}

// Typing on a computer keyboard also works.
document.addEventListener('keydown', ev => {
  if (!draft || document.getElementById('dialog').open) return;
  if (ev.key === 'Escape') { closeEditor(); return; }
  if (ev.target.matches('input, textarea, select')) return;
  if (/^[0-9]$/.test(ev.key)) press(ev.key);
  else if (ev.key === '.' || ev.key === ',') press('.');
  else if (ev.key === 'Backspace') press('back');
  else if (ev.key === 'Enter') save();
  else return;
  ev.preventDefault();
});
