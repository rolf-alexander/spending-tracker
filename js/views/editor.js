// The quick-add / edit screen. Designed for one thumb: the number pad, category
// buttons and Save button sit in the lower part of the screen.
// Three modes: Spent (expense), Earned (income) and Dad (money between you and Dad).

import {
  state, saveExpense, deleteExpense, setSetting, kindOf, trips, tripForDate, saveTrip,
  expenseCategories, incomeCategories, targetInfo, DAD_TYPES,
} from '../store.js';
import { CURRENCIES, previewCHF } from '../rates.js';
import { esc, money, decimals, todayISO, dayLabel, toast, confirmDialog, notifyChange } from '../util.js';
import { tripDialog } from './tripdialog.js';

const MODES = [['expense', 'Spent'], ['income', 'Earned'], ['dad', 'Dad']];
const DAD_MOVES = ['repay', 'repaid', 'loan']; // the buttons in Dad mode

const root = () => document.getElementById('editor');
let draft = null;

// `preset` pre-fills a new entry, e.g. { kind: 'dad', dad: 'repay', amountStr: '50' }.
export function openEditor(id, preset = {}) {
  const e = id ? state.expenses.find(x => x.id === id) : null;
  const today = todayISO();
  draft = e
    ? {
      id: e.id, kind: kindOf(e), amountStr: String(e.amount), currency: e.currency, category: e.category || '',
      dad: e.dad || '', date: e.date, note: e.note || '', trip: e.trip || '', tripTouched: true, merchant: e.merchant || '',
    }
    : {
      kind: 'expense', amountStr: '', currency: state.settings.lastCurrency || 'CHF', category: '', dad: '',
      date: today, note: '', trip: tripForDate(today), tripTouched: false, ...preset,
    };
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
  el.innerHTML = `
    <div class="ed">
      <header class="ed-head">
        <button type="button" class="icon-btn" data-act="close" aria-label="Close">✕</button>
        <div class="segmented ed-modes" role="radiogroup" aria-label="Type">
          ${MODES.map(([v, label]) => `<button type="button" role="radio" data-mode="${v}">${label}</button>`).join('')}
        </div>
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

      <div class="cat-grid" id="edGrid" role="radiogroup" aria-label="Category"></div>
      <div class="ed-fields" id="edFields"></div>
      ${draft.merchant ? `<p class="muted small ed-merchant">From bank: ${esc(draft.merchant)}</p>` : ''}

      <div class="keypad">
        ${['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'].map(k => `
          <button type="button" data-key="${k}" ${k === 'back' ? 'aria-label="Delete digit"' : ''}>${k === 'back' ? '⌫' : k}</button>`).join('')}
      </div>

      <div class="ed-actions">
        ${draft.id ? '<button type="button" class="btn danger" data-act="delete">Delete</button>' : ''}
        <button type="button" class="btn primary big" id="edSave"></button>
      </div>
    </div>`;

  el.querySelector('[data-act="close"]').onclick = closeEditor;
  el.querySelector('[data-act="delete"]')?.addEventListener('click', remove);
  el.querySelector('#edSave').onclick = save;
  el.querySelectorAll('[data-key]').forEach(b => { b.onclick = () => press(b.dataset.key); });
  el.querySelectorAll('[data-cur]').forEach(b => { b.onclick = () => setCurrency(b.dataset.cur); });
  el.querySelectorAll('[data-mode]').forEach(b => { b.onclick = () => setMode(b.dataset.mode); });
  const date = el.querySelector('#edDate');
  date.onchange = () => {
    if (!date.value) return;
    draft.date = date.value;
    // Follow the trip dates unless a trip was picked by hand.
    if (!draft.tripTouched) { draft.trip = tripForDate(draft.date); renderFields(); }
    update();
  };
  date.onclick = () => { try { date.showPicker?.(); } catch { /* not supported */ } };
  renderGrid();
  renderFields();
  update();
}

function setMode(kind) {
  if (kind === draft.kind) return;
  draft.kind = kind;
  draft.category = '';
  draft.dad = '';
  renderGrid();
  renderFields();
  update();
}

// The big buttons: categories, or the three Dad money moves.
function renderGrid() {
  const grid = root().querySelector('#edGrid');
  if (draft.kind === 'dad') {
    grid.innerHTML = DAD_MOVES.map(d => `
      <button type="button" role="radio" class="wide-choice" data-dadmove="${d}" style="--dot: var(--c1)">
        <span class="cat-emoji" aria-hidden="true">${DAD_TYPES[d].emoji}</span><span class="cat-name">${esc(DAD_TYPES[d].label)}</span>
      </button>`).join('');
    grid.querySelectorAll('[data-dadmove]').forEach(b => { b.onclick = () => { draft.dad = b.dataset.dadmove; update(); }; });
    return;
  }
  const cats = draft.kind === 'income' ? incomeCategories() : expenseCategories();
  grid.innerHTML = cats.map(c => `
    <button type="button" role="radio" data-cat="${esc(c.id)}" style="--dot: var(--c${c.slot})">
      <span class="cat-emoji" aria-hidden="true">${c.emoji}</span><span class="cat-name">${esc(c.name)}</span>
    </button>`).join('');
  grid.querySelectorAll('[data-cat]').forEach(b => { b.onclick = () => { draft.category = b.dataset.cat; update(); }; });
}

// Note, plus trip and Dad pickers for spending.
function renderFields() {
  const box = root().querySelector('#edFields');
  const note = `<input type="text" id="edNote" placeholder="📝 Note" value="${esc(draft.note)}" autocomplete="off" enterkeyhint="done" aria-label="Note">`;
  if (draft.kind !== 'expense') {
    box.className = 'ed-fields single';
    box.innerHTML = note;
  } else {
    const names = trips().map(t => t.name);
    if (draft.trip && !names.includes(draft.trip)) names.unshift(draft.trip);
    box.className = 'ed-fields';
    box.innerHTML = `
      ${note}
      <select id="edTrip" aria-label="Trip">
        <option value="">🧳 No trip</option>
        ${names.map(n => `<option value="${esc(n)}" ${n === draft.trip ? 'selected' : ''}>🧳 ${esc(n)}</option>`).join('')}
        <option value="__new">＋ New trip…</option>
      </select>
      <select id="edDad" aria-label="Dad">
        <option value="">👤 Just me</option>
        <option value="owe" ${draft.dad === 'owe' ? 'selected' : ''}>👨 Dad paid (I owe him)</option>
        <option value="owed" ${draft.dad === 'owed' ? 'selected' : ''}>👨 For Dad (he owes me)</option>
      </select>`;
    const trip = box.querySelector('#edTrip');
    trip.onchange = async () => {
      if (trip.value === '__new') {
        const t = await tripDialog(null);
        if (t) {
          await saveTrip(null, t);
          draft.trip = t.name;
        }
        renderFields();
      } else draft.trip = trip.value;
      draft.tripTouched = true;
    };
    box.querySelector('#edDad').onchange = ev => { draft.dad = ev.target.value; };
  }
  box.querySelector('#edNote').oninput = ev => { draft.note = ev.target.value; };
}

const isReady = amount => amount > 0 && (draft.kind === 'dad' ? Boolean(draft.dad) : Boolean(draft.category));

// Refreshes the parts of the screen that change while typing.
function update() {
  const el = root();
  const amount = parseFloat(draft.amountStr) || 0;
  el.querySelector('#edCur').textContent = draft.currency;
  el.querySelector('#edAmount').textContent = displayAmount(draft.amountStr);
  el.querySelector('#edConv').innerHTML = draft.currency !== 'CHF' && amount
    ? `≈ ${money(previewCHF(amount, draft.currency))}`
    : '&nbsp;';
  el.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-checked', b.dataset.mode === draft.kind));
  el.querySelectorAll('[data-cur]').forEach(b => b.setAttribute('aria-checked', b.dataset.cur === draft.currency));
  el.querySelectorAll('[data-cat]').forEach(b => b.setAttribute('aria-checked', b.dataset.cat === draft.category));
  el.querySelectorAll('[data-dadmove]').forEach(b => b.setAttribute('aria-checked', b.dataset.dadmove === draft.dad));
  el.querySelector('#edDateLabel').textContent = dayLabel(draft.date, todayISO());
  const btn = el.querySelector('#edSave');
  btn.disabled = !isReady(amount);
  btn.textContent = !(amount > 0) ? 'Enter an amount'
    : !isReady(amount) ? (draft.kind === 'dad' ? 'Pick what happened' : 'Pick a category')
    : draft.id ? 'Save changes' : 'Save';
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
  if (!isReady(amount)) return;
  const { id, kind, currency, category, dad, date, note, trip } = draft;
  const btn = root().querySelector('#edSave');
  btn.disabled = true;
  const saved = await saveExpense({
    id, kind, amount, currency, date, note,
    category: kind === 'dad' ? '' : category,
    dad: kind === 'income' ? '' : dad,
    trip: kind === 'expense' ? trip : '',
  });
  if (!id) await setSetting('lastCurrency', currency);
  closeEditor();
  notifyChange();
  const what = kind === 'dad' ? DAD_TYPES[dad].label : targetInfo(category).name;
  const label = `${id ? 'Updated' : 'Saved'} ${kind === 'income' ? '+' : ''}${money(saved.chf)} · ${what}`;
  toast(label, id ? null : {
    label: 'Undo',
    run: async () => { await deleteExpense(saved.id); notifyChange(); },
  });
}

async function remove() {
  if (!(await confirmDialog('Delete this entry?', 'This cannot be undone.'))) return;
  await deleteExpense(draft.id);
  closeEditor();
  notifyChange();
  toast('Deleted');
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
