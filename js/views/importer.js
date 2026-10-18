// Bank statement import: read a CSV, preview it, pick categories, import.

import { state, ui, categorize, addExpenses, categoryById } from '../store.js';
import { CURRENCIES } from '../rates.js';
import { esc, money, shortDate, readFile, toast, alertDialog } from '../util.js';
import { parseCSV, toObjects, detectBank, guessMapping, genericRow, BANKS } from '../csv.js';
import { setTitle } from './common.js';
import { editRule } from './settings.js';
import { notifyChange } from './editor.js';

let imp = null; // the file being imported

export function importer(root) {
  setTitle('Import bank statement', '#/settings');
  if (!imp) return intro(root);
  preview(root);
}

function intro(root) {
  root.innerHTML = `
    <section class="card">
      <p>Export your transactions as a <strong>CSV file</strong> from your bank's app or website, then choose it here.</p>
      <p class="muted small">${BANKS.map(b => b.name).filter((n, i, a) => a.indexOf(n) === i && !n.includes('(')).join(', ')} files are recognised automatically.
        For other banks you'll match up the columns once. Only spending is imported. Income, top-ups and
        transfers between your own currencies are skipped, and anything you've imported before is spotted and left out.</p>
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
    imp = { fileName: file.name, headers, records, bank, mapping: bank ? null : guessMapping(headers), trip: '' };
    buildRows();
    preview(root);
  };
}

function buildRows() {
  const known = new Set(state.expenses.map(e => e.importHash).filter(Boolean));
  const seen = new Map();
  const fallback = state.categories.some(c => c.id === 'other') ? 'other' : state.categories[0].id;
  imp.skipped = 0;
  imp.rows = [];
  for (const record of imp.records) {
    const t = imp.bank ? imp.bank.row(record) : genericRow(record, imp.mapping);
    if (!t) { imp.skipped++; continue; }
    const currency = (t.currency || '').toUpperCase();
    const description = (t.description || '').trim();
    const base = `${t.date}|${t.amount}|${currency}|${description.toLowerCase()}`;
    const n = (seen.get(base) || 0) + 1; // two identical coffees on one day are both real
    seen.set(base, n);
    const hash = `${base}#${n}`;
    const error = !t.date ? 'No valid date'
      : !(t.amount > 0) ? 'No valid amount'
      : !CURRENCIES.includes(currency) ? `${currency || 'Currency'} not supported` : '';
    const dup = known.has(hash);
    const ruled = categorize(description);
    imp.rows.push({
      ...t, currency, description, hash, error, dup,
      category: ruled || fallback, auto: Boolean(ruled), manual: false,
      include: !error && !dup,
    });
  }
}

function preview(root) {
  const included = imp.rows.filter(r => r.include);
  const dups = imp.rows.filter(r => r.dup).length;
  const errors = imp.rows.filter(r => r.error).length;
  const autoCount = imp.rows.filter(r => r.auto).length;

  root.innerHTML = `
    <section class="card">
      <p>📄 <strong>${esc(imp.fileName)}</strong></p>
      ${imp.bank
        ? `<p class="muted small">Recognised as a <strong>${esc(imp.bank.name)}</strong> export. <button type="button" class="link" id="manual">Not right? Choose columns</button></p>`
        : mappingForm()}
      <label class="field">Tag all as trip (optional)<input type="text" id="impTrip" value="${esc(imp.trip)}" placeholder="e.g. Japan 2027" autocomplete="off"></label>
      <p class="muted small">${imp.rows.length} expenses found · ${imp.skipped} income/other rows skipped
        ${dups ? ` · ${dups} already imported` : ''}${errors ? ` · ${errors} with problems` : ''}
        ${autoCount ? ` · ${autoCount} categorised by your rules` : ''}</p>
      <div class="btn-row">
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
            <span class="row-sub">${r.date ? esc(shortDate(r.date)) : '—'}
              ${r.dup ? ' · <span class="badge">already imported</span>' : ''}
              ${r.error ? ` · <span class="badge warn">${esc(r.error)}</span>` : ''}</span>
            <select data-cat="${i}" aria-label="Category" ${r.error ? 'disabled' : ''}>
              ${state.categories.map(c => `<option value="${esc(c.id)}" ${c.id === r.category ? 'selected' : ''}>${c.emoji} ${esc(c.name)}</option>`).join('')}
            </select>
          </div>
          <span class="row-amount num">${Number.isFinite(r.amount) ? money(r.amount, CURRENCIES.includes(r.currency) ? r.currency : 'CHF') : '—'}</span>
        </li>`).join('')}
    </ul>

    <div class="sticky-actions">
      <button type="button" class="btn ghost" id="cancelImp">Cancel</button>
      <button type="button" class="btn primary" id="doImport" ${included.length ? '' : 'disabled'}>Import ${included.length} expense${included.length === 1 ? '' : 's'}</button>
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
  root.querySelector('#impTrip').oninput = ev => { imp.trip = ev.target.value; };
  const setAll = on => {
    for (const r of imp.rows) if (!r.error) r.include = on;
    preview(root);
  };
  root.querySelector('#selAll').onclick = () => setAll(true);
  root.querySelector('#selNone').onclick = () => setAll(false);
  root.querySelectorAll('[data-i]').forEach(cb => {
    cb.onchange = () => { imp.rows[Number(cb.dataset.i)].include = cb.checked; preview(root); };
  });
  root.querySelectorAll('[data-cat]').forEach(sel => {
    sel.onchange = () => changeCategory(root, imp.rows[Number(sel.dataset.cat)], sel.value);
  });
  root.querySelector('#cancelImp').onclick = () => { imp = null; intro(root); };
  root.querySelector('#doImport').onclick = ev => doImport(root, ev.target);
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
      <label class="field">Expenses are<select data-map="sign">
        <option value="negative" ${m.sign === 'negative' ? 'selected' : ''}>negative (−12.50)</option>
        <option value="positive" ${m.sign === 'positive' ? 'selected' : ''}>positive (12.50)</option></select></label>
      <label class="field">Currency column<select data-map="currency">${opts(m.currency, '— same for all —')}</select></label>
      ${m.currency ? '' : `<label class="field">Currency<select data-map="fixedCurrency">${CURRENCIES.map(c => `<option ${c === m.fixedCurrency ? 'selected' : ''}>${c}</option>`).join('')}</select></label>`}
    </div>`;
}

// Suggests rule text from a merchant name: "MIGROS ZURICH HB 1234" -> "migros zurich"
const suggestPattern = d => d.toLowerCase().replace(/[0-9*#/\\]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 2).join(' ');

async function changeCategory(root, row, category) {
  row.category = category;
  row.manual = true;
  const name = categoryById(category).name;
  const saved = await editRule(null, {
    title: 'Remember this?',
    intro: `Put similar merchants in <strong>${esc(name)}</strong> automatically next time?`,
    pattern: suggestPattern(row.description),
    category,
    cancelLabel: 'Just this one',
  });
  if (saved) {
    // Apply the new rule to the rows you haven't changed by hand.
    for (const r of imp.rows) {
      if (r.manual) continue;
      const c = categorize(r.description);
      if (c) { r.category = c; r.auto = true; }
    }
    toast('Rule saved');
  }
  preview(root);
}

async function doImport(root, btn) {
  btn.disabled = true;
  btn.textContent = 'Importing…';
  const trip = imp.trip.trim();
  const list = imp.rows.filter(r => r.include && !r.error).map(r => ({
    date: r.date,
    amount: r.amount,
    currency: r.currency,
    category: r.category,
    note: '',
    merchant: r.note ? `${r.description} (${r.note})` : r.description,
    trip,
    source: 'import',
    importHash: r.hash,
  }));
  await addExpenses(list);
  imp = null;
  ui.list.period = 'all';
  notifyChange();
  toast(`Imported ${list.length} expense${list.length === 1 ? '' : 's'}`);
  location.hash = '#/list';
}
