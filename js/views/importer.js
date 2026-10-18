// Bank statement import: read a CSV, sort each transaction (one by one or as a list), import.

import {
  state, ui, categorize, addExpenses, saveRule, trips, tripForDate, applyTarget, defaultTarget, targetInfo,
  expenseCategories, incomeCategories, DAD_TYPES, DAD_TARGETS,
} from '../store.js';
import { CURRENCIES } from '../rates.js';
import { esc, money, shortDate, readFile, toast, alertDialog, notifyChange } from '../util.js';
import { parseCSV, toObjects, detectBank, guessMapping, genericRow, BANKS } from '../csv.js';
import { setTitle, targetOptions } from './common.js';
import { editRule } from './settings.js';

let imp = null; // the file being imported

export function importer(root) {
  setTitle('Import bank statement', '#/settings');
  if (!imp) intro(root);
  else if (imp.mode === 'review') review(root);
  else preview(root);
}

function intro(root) {
  const names = [...new Set(BANKS.map(b => b.name.replace(/ \(.*\)$/, '')))];
  root.innerHTML = `
    <section class="card">
      <p>Export your transactions as a <strong>CSV file</strong> from your bank's app or website, then choose it here.</p>
      <p class="muted small">${names.join(', ')} files are recognised automatically. For other banks you'll match up
        the columns once. Spending and money coming in are both imported. Top-ups and exchanges between your own
        accounts are skipped, and anything you've imported before is spotted and left out.</p>
      <label class="btn primary file-btn wide">Choose CSV file<input type="file" id="csvFile" accept=".csv,text/csv,text/plain"></label>
    </section>
    <p class="muted small pad-x">💡 On iPhone: save the export to the Files app first, then pick it from there.</p>`;

  root.querySelector('#csvFile').onchange = async ev => {
    const file = ev.target.files[0];
    if (!file) return;
    const rows = parseCSV(await readFile(file));
    if (rows.length < 2) {
      await alertDialog('Empty file', "That file doesn't contain any rows.");
      return;
    }
    const { headers, records } = toObjects(rows);
    const bank = detectBank(headers);
    // Known banks go straight to sorting one by one; others first need their columns matched.
    imp = { fileName: file.name, headers, records, bank, mapping: bank ? null : guessMapping(headers), mode: bank ? 'review' : 'list', pos: 0 };
    buildRows();
    importer(root);
  };
}

function buildRows() {
  const known = new Set(state.expenses.map(e => e.importHash).filter(Boolean));
  const seen = new Map();
  imp.skipped = 0;
  imp.rows = [];
  for (const record of imp.records) {
    const t = imp.bank ? imp.bank.row(record) : genericRow(record, imp.mapping);
    if (!t) { imp.skipped++; continue; }
    const direction = t.direction || 'out';
    const currency = (t.currency || '').toUpperCase();
    const description = (t.description || '').trim();
    const base = `${direction === 'in' ? 'in|' : ''}${t.date}|${t.amount}|${currency}|${description.toLowerCase()}`;
    const n = (seen.get(base) || 0) + 1; // two identical coffees on one day are both real
    seen.set(base, n);
    const hash = `${base}#${n}`;
    const error = !t.date ? 'No valid date'
      : !(t.amount > 0) ? 'No valid amount'
      : !CURRENCIES.includes(currency) ? `${currency || 'Currency'} not supported` : '';
    const dup = known.has(hash);
    const ruled = categorize(description, direction);
    imp.rows.push({
      ...t, direction, currency, description, hash, error, dup,
      target: ruled || defaultTarget(direction), auto: Boolean(ruled), manual: false,
      trip: direction === 'out' && t.date ? tripForDate(t.date) : '',
      include: !error && !dup,
    });
  }
}

// After a new rule: re-sort the rows you haven't sorted by hand.
function reapplyRules() {
  for (const r of imp.rows) {
    if (r.manual) continue;
    const t = categorize(r.description, r.direction);
    if (t) { r.target = t; r.auto = true; }
  }
}

const reviewable = () => imp.rows.filter(r => !r.error && !r.dup);
const signed = r => `${r.direction === 'in' ? '+' : ''}${money(r.amount, CURRENCIES.includes(r.currency) ? r.currency : 'CHF')}`;
// Suggests rule text from a merchant name: "MIGROS ZURICH HB 1234" -> "migros zurich"
const suggestPattern = d => d.toLowerCase().replace(/[0-9*#/\\]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 2).join(' ');

function summaryLine() {
  const dups = imp.rows.filter(r => r.dup).length;
  const errors = imp.rows.filter(r => r.error).length;
  return [
    imp.bank ? `${imp.bank.name} export` : 'CSV file',
    `${imp.rows.length} transactions`,
    imp.skipped ? `${imp.skipped} skipped (own transfers etc.)` : '',
    dups ? `${dups} already imported` : '',
    errors ? `${errors} with problems` : '',
  ].filter(Boolean).join(' · ');
}

// ---------- One by one ----------

function review(root) {
  const list = reviewable();
  if (!list.length) { imp.mode = 'list'; preview(root); return; }
  if (imp.pos >= list.length) { reviewDone(root, list); return; }
  const r = list[imp.pos];
  const cats = r.direction === 'in' ? incomeCategories() : expenseCategories();
  const tripNames = trips().map(t => t.name);

  root.innerHTML = `
    <div class="review-top">
      <span class="muted small"><strong>${imp.pos + 1}</strong> of ${list.length}</span>
      <span>
        <button type="button" class="link small" id="toList">See all as a list</button> ·
        <button type="button" class="link small" id="cancelImp">Cancel import</button>
      </span>
    </div>
    <div class="progress" aria-hidden="true"><div style="width:${(imp.pos / list.length) * 100}%"></div></div>

    <section class="card review-card">
      <p class="review-dir ${r.direction}">${r.direction === 'in' ? '⬇ Money in' : '⬆ Money out'} · ${esc(shortDate(r.date))}</p>
      <p class="review-title">${esc(r.description || '(no description)')}</p>
      ${r.note ? `<p class="muted small">${esc(r.note)}</p>` : ''}
      <p class="review-amount num ${r.direction === 'in' ? 'pos' : ''}">${signed(r)}</p>
      ${!r.include ? '<p><span class="badge">Skipped, won\'t be imported</span></p>' : r.auto && !r.manual ? '<p class="muted small">🪄 Sorted by one of your rules: tap Next to accept</p>' : ''}
    </section>

    <div class="cat-grid review-grid" role="radiogroup" aria-label="Category">
      ${cats.map(c => targetButton(c.id, c.emoji, c.name, c.slot, r.target)).join('')}
      ${DAD_TARGETS[r.direction].map(d => targetButton(`dad:${d}`, DAD_TYPES[d].emoji, DAD_TYPES[d].label, 0, r.target, 'half')).join('')}
    </div>

    ${r.direction === 'out' ? `
      <select id="rvTrip" class="review-trip" aria-label="Trip">
        <option value="">🧳 No trip</option>
        ${tripNames.map(n => `<option value="${esc(n)}" ${n === r.trip ? 'selected' : ''}>🧳 ${esc(n)}</option>`).join('')}
      </select>` : ''}

    <label class="remember">
      <input type="checkbox" id="rvRemember">
      <span>Always sort merchants containing</span>
      <input type="text" id="rvPattern" value="${esc(suggestPattern(r.description))}" autocomplete="off" autocapitalize="off" aria-label="Merchant text">
    </label>

    <div class="review-actions">
      <button type="button" class="btn" id="rvBack" ${imp.pos === 0 ? 'disabled' : ''}>‹ Back</button>
      <button type="button" class="btn" id="rvSkip">Skip</button>
      <button type="button" class="btn primary" id="rvNext">Next ›</button>
    </div>
    <p class="muted small center">${esc(summaryLine())}</p>`;

  const next = () => { imp.pos++; review(root); window.scrollTo(0, 0); };
  root.querySelectorAll('[data-target]').forEach(b => {
    b.onclick = async () => {
      r.target = b.dataset.target;
      r.manual = true;
      r.include = true;
      await maybeRemember(root, r);
      next();
    };
  });
  root.querySelector('#rvTrip')?.addEventListener('change', ev => { r.trip = ev.target.value; });
  root.querySelector('#rvPattern').oninput = () => { root.querySelector('#rvRemember').checked = true; };
  root.querySelector('#rvNext').onclick = async () => { r.include = true; await maybeRemember(root, r); next(); };
  root.querySelector('#rvSkip').onclick = () => { r.include = false; next(); };
  root.querySelector('#rvBack').onclick = () => { imp.pos--; review(root); };
  root.querySelector('#toList').onclick = () => { imp.mode = 'list'; preview(root); };
  root.querySelector('#cancelImp').onclick = () => { imp = null; intro(root); };
}

function targetButton(target, emoji, name, slot, selected, extraClass = '') {
  return `
    <button type="button" role="radio" class="${extraClass}" data-target="${esc(target)}" aria-checked="${target === selected}" style="--dot: var(--c${slot || 1})">
      <span class="cat-emoji" aria-hidden="true">${emoji}</span><span class="cat-name">${esc(name)}</span>
    </button>`;
}

async function maybeRemember(root, r) {
  const pattern = root.querySelector('#rvPattern').value.trim();
  if (!root.querySelector('#rvRemember').checked || !pattern) return;
  await saveRule({ pattern, category: r.target });
  reapplyRules();
  toast(`Rule saved: “${pattern}” → ${targetInfo(r.target).name}`);
}

function reviewDone(root, list) {
  const chosen = list.filter(r => r.include);
  const outCount = chosen.filter(r => r.direction === 'out').length;
  root.innerHTML = `
    <section class="card center">
      <p class="big-emoji" aria-hidden="true">✅</p>
      <p><strong>All sorted!</strong></p>
      <p class="muted">${chosen.length} to import: ${outCount} money out, ${chosen.length - outCount} money in.
        ${list.length - chosen.length ? `${list.length - chosen.length} skipped.` : ''}</p>
      <div class="btn-row center-row">
        <button type="button" class="btn" id="toList">Check the list</button>
        <button type="button" class="btn primary" id="doImport" ${chosen.length ? '' : 'disabled'}>Import ${chosen.length}</button>
      </div>
    </section>`;
  root.querySelector('#toList').onclick = () => { imp.mode = 'list'; preview(root); };
  root.querySelector('#doImport').onclick = ev => doImport(ev.target);
}

// ---------- As a list ----------

function preview(root) {
  const included = imp.rows.filter(r => r.include);
  const tripNames = trips().map(t => t.name);

  root.innerHTML = `
    <section class="card">
      <p>📄 <strong>${esc(imp.fileName)}</strong></p>
      ${imp.bank
        ? `<p class="muted small">Recognised as a <strong>${esc(imp.bank.name)}</strong> export. <button type="button" class="link" id="manual">Not right? Choose columns</button></p>`
        : mappingForm()}
      <p class="muted small">${esc(summaryLine())}</p>
      <div class="btn-row">
        <button type="button" class="btn primary small" id="sortOne" ${reviewable().length ? '' : 'disabled'}>Sort one by one</button>
        <button type="button" class="btn small" id="selAll">Select all</button>
        <button type="button" class="btn small" id="selNone">Select none</button>
      </div>
    </section>

    <ul class="rows card flush import-rows">
      ${imp.rows.map((r, i) => `
        <li class="imp-row ${r.include ? '' : 'off'}">
          <label class="imp-check"><input type="checkbox" data-i="${i}" ${r.include ? 'checked' : ''} ${r.error ? 'disabled' : ''} aria-label="Import this row"></label>
          <div class="row-main">
            <span class="row-title">${esc(r.description || '(no description)')}</span>
            <span class="row-sub">${r.date ? esc(shortDate(r.date)) : '—'} · ${r.direction === 'in' ? 'money in' : 'money out'}
              ${r.dup ? ' · <span class="badge">already imported</span>' : ''}
              ${r.error ? ` · <span class="badge warn">${esc(r.error)}</span>` : ''}</span>
            <select data-target="${i}" aria-label="Category" ${r.error ? 'disabled' : ''}>${targetOptions(r.target, r.direction)}</select>
            ${r.direction === 'out' && tripNames.length && !r.error ? `
              <select data-trip="${i}" aria-label="Trip">
                <option value="">🧳 No trip</option>
                ${tripNames.map(n => `<option value="${esc(n)}" ${n === r.trip ? 'selected' : ''}>🧳 ${esc(n)}</option>`).join('')}
              </select>` : ''}
          </div>
          <span class="row-amount num ${r.direction === 'in' ? 'pos' : ''}">${Number.isFinite(r.amount) ? signed(r) : '—'}</span>
        </li>`).join('')}
    </ul>

    <div class="sticky-actions">
      <button type="button" class="btn ghost" id="cancelImp">Cancel</button>
      <button type="button" class="btn primary" id="doImport" ${included.length ? '' : 'disabled'}>Import ${included.length}</button>
    </div>`;

  root.querySelector('#manual')?.addEventListener('click', () => {
    imp.bank = null;
    imp.mapping = guessMapping(imp.headers);
    buildRows();
    preview(root);
  });
  root.querySelectorAll('[data-map]').forEach(sel => {
    sel.onchange = () => {
      imp.mapping[sel.dataset.map] = sel.value;
      buildRows();
      preview(root);
    };
  });
  const setAll = on => {
    for (const r of imp.rows) if (!r.error) r.include = on;
    preview(root);
  };
  root.querySelector('#sortOne').onclick = () => { imp.mode = 'review'; imp.pos = 0; review(root); window.scrollTo(0, 0); };
  root.querySelector('#selAll').onclick = () => setAll(true);
  root.querySelector('#selNone').onclick = () => setAll(false);
  root.querySelectorAll('[data-i]').forEach(cb => {
    cb.onchange = () => { imp.rows[Number(cb.dataset.i)].include = cb.checked; preview(root); };
  });
  root.querySelectorAll('select[data-target]').forEach(sel => {
    sel.onchange = () => changeTarget(root, imp.rows[Number(sel.dataset.target)], sel.value);
  });
  root.querySelectorAll('select[data-trip]').forEach(sel => {
    sel.onchange = () => { imp.rows[Number(sel.dataset.trip)].trip = sel.value; };
  });
  root.querySelector('#cancelImp').onclick = () => { imp = null; intro(root); };
  root.querySelector('#doImport').onclick = ev => doImport(ev.target);
}

function mappingForm() {
  const m = imp.mapping;
  const opts = (value, allowNone) => `
    ${allowNone ? `<option value="" ${value ? '' : 'selected'}>${allowNone}</option>` : ''}
    ${imp.headers.map(h => `<option value="${esc(h)}" ${h === value ? 'selected' : ''}>${esc(h)}</option>`).join('')}`;
  return `
    <p class="muted small">Tell me which column is which. Check the preview below.</p>
    <div class="map-grid">
      <label class="field">Date<select data-map="date">${opts(m.date, '— choose —')}</select></label>
      <label class="field">Date style<select data-map="dateOrder">
        <option value="dmy" ${m.dateOrder === 'dmy' ? 'selected' : ''}>Day first (31.12.2026)</option>
        <option value="mdy" ${m.dateOrder === 'mdy' ? 'selected' : ''}>Month first (12/31/2026)</option></select></label>
      <label class="field">Merchant / text<select data-map="description">${opts(m.description, '— none —')}</select></label>
      <label class="field">Amount<select data-map="amount">${opts(m.amount, '— choose —')}</select></label>
      <label class="field">That column holds<select data-map="sign">
        <option value="negative" ${m.sign === 'negative' ? 'selected' : ''}>in and out (out is −)</option>
        <option value="positive" ${m.sign === 'positive' ? 'selected' : ''}>money out only</option></select></label>
      <label class="field">Money in column<select data-map="credit">${opts(m.credit, '— none —')}</select></label>
      <label class="field">Currency column<select data-map="currency">${opts(m.currency, '— same for all —')}</select></label>
      ${m.currency ? '' : `<label class="field">Currency<select data-map="fixedCurrency">${CURRENCIES.map(c => `<option ${c === m.fixedCurrency ? 'selected' : ''}>${c}</option>`).join('')}</select></label>`}
    </div>`;
}

async function changeTarget(root, row, target) {
  row.target = target;
  row.manual = true;
  const saved = await editRule(null, {
    title: 'Remember this?',
    intro: `Sort similar transactions as <strong>${esc(targetInfo(target).name)}</strong> automatically next time?`,
    pattern: suggestPattern(row.description),
    category: target,
    direction: row.direction,
    cancelLabel: 'Just this one',
  });
  if (saved) {
    reapplyRules();
    toast('Rule saved');
  }
  preview(root);
}

async function doImport(btn) {
  btn.disabled = true;
  btn.textContent = 'Importing…';
  const list = imp.rows.filter(r => r.include && !r.error).map(r => {
    const t = applyTarget(r.target);
    return {
      ...t,
      date: r.date,
      amount: r.amount,
      currency: r.currency,
      note: '',
      merchant: r.note ? `${r.description} (${r.note})` : r.description,
      trip: t.kind === 'expense' ? r.trip : '',
      source: 'import',
      importHash: r.hash,
    };
  });
  await addExpenses(list);
  imp = null;
  ui.list.period = 'all';
  notifyChange();
  toast(`Imported ${list.length} transaction${list.length === 1 ? '' : 's'}`);
  location.hash = '#/list';
}
