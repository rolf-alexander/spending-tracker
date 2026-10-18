// Settings: categories & budgets, rules, exchange rates, backup, appearance.

import {
  state, setSetting, saveCategory, deleteCategory, moveCategory, categoryById, kindOf, dadBalance,
  saveRule, deleteRule, applyRulesToImported, snapshot, restore, eraseEverything, addExpenses, fixEstimated,
  expenseCategories, incomeCategories, targetInfo, DAD_TYPES,
} from '../store.js';
import { getLatest, refresh, CURRENCIES } from '../rates.js';
import { esc, money, toast, showDialog, confirmDialog, alertDialog, saveFile, readFile, todayISO, shortDate, notifyChange } from '../util.js';
import { parseCSV, toObjects, toCSV, parseAmount } from '../csv.js';
import { setTitle, segmented, bindSegmented, targetOptions, dadBalanceText } from './common.js';
import { applyTheme } from '../theme.js';
import { cloudConfig, checkSetup, remoteBackupExists, backupNow, listBackups, fetchBackup, disconnect } from '../cloud.js';

export function settings(root) {
  setTitle('Settings');
  const r = getLatest();
  const pct = Math.round(state.settings.warnThreshold * 100);
  const last = state.settings.lastBackupAt;

  root.innerHTML = `
    <ul class="rows card flush">
      <li><a class="row" href="#/categories"><span class="row-icon" aria-hidden="true">🏷️</span><span class="row-main"><span class="row-title">Categories & budgets</span><span class="row-sub">${expenseCategories().length} for spending · ${incomeCategories().length} for income · ${state.categories.filter(c => c.budget > 0).length} with a budget</span></span><span class="chev" aria-hidden="true">›</span></a></li>
      <li><a class="row" href="#/dad"><span class="row-icon" aria-hidden="true">👨</span><span class="row-main"><span class="row-title">Dad</span><span class="row-sub">${dadBalanceText(dadBalance()).replace(/<\/?strong>/g, '')}</span></span><span class="chev" aria-hidden="true">›</span></a></li>
      <li><a class="row" href="#/rules"><span class="row-icon" aria-hidden="true">🪄</span><span class="row-main"><span class="row-title">Auto-categorise rules</span><span class="row-sub">${state.rules.length} rule${state.rules.length === 1 ? '' : 's'} for bank imports</span></span><span class="chev" aria-hidden="true">›</span></a></li>
      <li><a class="row" href="#/import"><span class="row-icon" aria-hidden="true">🏦</span><span class="row-main"><span class="row-title">Import bank statement</span><span class="row-sub">UBS, Revolut, Wise, neon or any CSV</span></span><span class="chev" aria-hidden="true">›</span></a></li>
    </ul>

    <section class="card">
      <h2>Budget warning</h2>
      <label class="field inline">Warn me at
        <select id="threshold">
          ${[50, 60, 70, 75, 80, 85, 90, 95].map(v => `<option value="${v}" ${v === pct ? 'selected' : ''}>${v}%</option>`).join('')}
        </select>
        of a category's monthly budget
      </label>
    </section>

    <section class="card">
      <h2>Exchange rates</h2>
      <p class="muted small">${r.fallback
        ? 'Not downloaded yet. Using approximate built-in rates.'
        : `ECB rates from ${shortDate(r.date)}, downloaded ${new Date(r.fetchedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}.`}</p>
      <table class="rates">
        ${CURRENCIES.filter(c => c !== 'CHF').map(c => `<tr><td>1 CHF</td><td class="num">${r.rates[c].toLocaleString('de-CH', { maximumFractionDigits: 4 })} ${c}</td><td class="num muted">${c === 'JPY' ? 100 : 1} ${c} = ${money((c === 'JPY' ? 100 : 1) / r.rates[c])}</td></tr>`).join('')}
      </table>
      <button type="button" class="btn" id="refreshRates">Update rates now</button>
    </section>

    <section class="card" id="cloudBox"></section>

    <section class="card">
      <h2>Backup to a file</h2>
      <p class="muted small">Save a copy to Files or iCloud Drive, e.g. before changing phones.
        ${last ? `Last backup: ${shortDate(new Date(last).toISOString().slice(0, 10))}.` : '<strong>No backup yet.</strong>'}</p>
      <div class="btn-row">
        <button type="button" class="btn primary" id="exportJson">Back up (JSON)</button>
        <button type="button" class="btn" id="exportCsv">Export CSV</button>
      </div>
      <label class="btn file-btn">Restore from backup…<input type="file" id="restoreFile" accept=".json,.csv,application/json,text/csv"></label>
    </section>

    <section class="card">
      <h2>Appearance</h2>
      ${segmented('theme', [['auto', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']], state.settings.theme)}
    </section>

    <section class="card">
      <h2>Danger zone</h2>
      <button type="button" class="btn danger" id="erase">Erase all data</button>
    </section>

    <p class="muted small center pad" id="storageInfo">Spending Tracker</p>`;

  root.querySelector('#threshold').onchange = async ev => {
    await setSetting('warnThreshold', Number(ev.target.value) / 100);
    toast('Saved');
  };
  root.querySelector('#refreshRates').onclick = async ev => {
    ev.target.disabled = true;
    ev.target.textContent = 'Updating…';
    const ok = await refresh();
    if (ok) {
      const n = await fixEstimated();
      toast(n ? `Rates updated, ${n} expense${n === 1 ? '' : 's'} re-converted` : 'Rates updated');
      notifyChange();
    } else {
      toast("Couldn't reach the rate service. Are you online?");
      settings(root);
    }
  };
  renderCloud(root.querySelector('#cloudBox'));
  root.querySelector('#exportJson').onclick = exportJSON;
  root.querySelector('#exportCsv').onclick = exportCSV;
  root.querySelector('#restoreFile').onchange = async ev => {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (file) await restoreFrom(file);
  };
  bindSegmented(root, 'theme', async v => {
    await setSetting('theme', v);
    applyTheme();
    settings(root);
  });
  root.querySelector('#erase').onclick = async () => {
    if (!(await confirmDialog('Erase everything?', 'All expenses, categories, rules and settings on this device will be deleted. Make a backup first if you might want them back.', 'Erase all'))) return;
    await eraseEverything();
    notifyChange();
    toast('All data erased');
  };

  storageInfo(root.querySelector('#storageInfo'));
}

async function storageInfo(el) {
  const persisted = await navigator.storage?.persisted?.().catch(() => false);
  // The version is the one in sw.js (the offline cache is named after it).
  const cache = (await self.caches?.keys().catch(() => []))?.find(k => k.startsWith('spending-'));
  el.textContent = [
    `Spending Tracker${cache ? ` ${cache.slice('spending-'.length)}` : ''}`,
    `${state.expenses.length} expenses stored`,
    persisted ? 'storage protected' : '',
  ].filter(Boolean).join(' · ');
}

// ---- Backup ----

const stamp = () => todayISO();

async function markBackedUp() {
  await setSetting('lastBackupAt', Date.now());
  notifyChange();
}

async function exportJSON() {
  const ok = await saveFile(`spending-backup-${stamp()}.json`, JSON.stringify(snapshot(), null, 1), 'application/json');
  if (ok) { await markBackedUp(); toast('Backup saved'); }
}

// type: expense / income / dad. dad: owe, owed, repay, repaid or loan (empty if not Dad-related).
export const CSV_HEADER = ['id', 'date', 'type', 'amount', 'currency', 'amount_chf', 'rate', 'category', 'trip', 'dad', 'note', 'merchant'];

async function exportCSV() {
  const rows = [CSV_HEADER, ...state.expenses.map(e => [
    e.id, e.date, kindOf(e), e.amount, e.currency, e.chf, e.rate, e.category ? categoryById(e.category).name : '',
    e.trip, e.dad || '', e.note, e.merchant || '',
  ])];
  const ok = await saveFile(`spending-${stamp()}.csv`, toCSV(rows), 'text/csv');
  if (ok) { await markBackedUp(); toast('CSV exported'); }
}

async function restoreFrom(file) {
  const text = await readFile(file);
  try {
    if (file.name.toLowerCase().endsWith('.json') || text.trim().startsWith('{')) await restoreJSON(JSON.parse(text));
    else await restoreCSV(text);
  } catch (err) {
    await alertDialog("Couldn't restore", `This file doesn't look like a Spending Tracker backup. (${err.message})`);
  }
}

// ---- Automatic backup to GitHub ----

const when = ms => new Date(ms).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

function renderCloud(box) {
  const cfg = cloudConfig();
  if (!cfg?.token) {
    box.innerHTML = `
      <h2>Automatic backup</h2>
      <p class="muted small">Back up to a private GitHub repository automatically whenever something changes
        (while the app is open and online). You can go back to any earlier backup too.</p>
      <button type="button" class="btn primary" id="cloudSetup">Set up automatic backup</button>`;
    box.querySelector('#cloudSetup').onclick = () => setupCloud(box);
    return;
  }
  const err = state.settings.ghError;
  const last = state.settings.ghLastBackupAt;
  box.innerHTML = `
    <h2>Automatic backup</h2>
    <p class="${err ? 'alert over' : 'muted small'}">${err
      ? `<span aria-hidden="true">⚠️</span> <span>${esc(err)}</span>`
      : `✅ On. Backing up to <a href="https://github.com/${esc(cfg.repo)}/commits/main" target="_blank" rel="noopener">${esc(cfg.repo)}</a>.
         ${last ? `Last backup: ${esc(when(last))}.` : 'No backup yet.'}`}</p>
    <div class="btn-row">
      <button type="button" class="btn primary" id="cloudNow">Back up now</button>
      <button type="button" class="btn" id="cloudRestore">Restore…</button>
      <button type="button" class="btn ghost" id="cloudOff">Turn off</button>
    </div>
    ${err ? '<button type="button" class="btn small" id="cloudSetup">Set up again</button>' : ''}`;

  box.querySelector('#cloudNow').onclick = async ev => {
    ev.target.disabled = true;
    ev.target.textContent = 'Backing up…';
    try {
      const result = await backupNow({ manual: true });
      toast(result === 'done' ? 'Backed up to GitHub' : result === 'offline' ? "You're offline. It'll back up when you're online" : 'Nothing to back up yet');
    } catch (e) {
      toast("Backup didn't work. See the message in Settings");
    }
    renderCloud(box);
  };
  box.querySelector('#cloudRestore').onclick = () => restoreFromCloud();
  box.querySelector('#cloudOff').onclick = async () => {
    if (!(await confirmDialog('Turn off automatic backup?', 'Your backups stay on GitHub. You can set it up again later.', 'Turn off', 'primary'))) return;
    await disconnect();
    renderCloud(box);
  };
  box.querySelector('#cloudSetup')?.addEventListener('click', () => setupCloud(box));
}

async function setupCloud(box) {
  const result = await showDialog({
    title: 'Automatic backup',
    body: `
      <p class="small">Paste the GitHub token for your backup repository (it starts with <code>github_pat_</code>).
        It's stored only on this phone.</p>
      <label class="field">Token<input type="password" name="token" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      <label class="field">Repository<input type="text" name="repo" value="${esc(cloudConfig()?.repo || 'spending-backup')}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      <p class="form-error" role="alert"></p>`,
    buttons: [
      { label: 'Cancel', value: null, style: 'ghost' },
      { label: 'Connect', value: true, style: 'primary', validate: d => d.querySelector('[name=token]').value.trim() !== '' && d.querySelector('[name=repo]').value.trim() !== '' },
    ],
    collect: d => ({ token: d.querySelector('[name=token]').value.trim(), repo: d.querySelector('[name=repo]').value.trim() }),
  });
  if (!result) return;
  toast('Checking with GitHub…');
  let repo;
  try {
    repo = await checkSetup(result.token, result.repo);
  } catch (err) {
    await alertDialog("Couldn't connect", err.message || String(err));
    return;
  }
  await setSetting('ghBackup', { repo, token: result.token });
  await setSetting('ghError', '');
  await setSetting('ghLastHash', null);
  // A new or empty phone: offer the existing backup instead of overwriting it.
  if (!state.expenses.length && (await remoteBackupExists())) {
    renderCloud(box);
    if (await confirmDialog('Backup found', 'There is already a backup in this repository. Restore it onto this phone?', 'Choose backup', 'primary')) {
      await restoreFromCloud();
    }
    return;
  }
  try {
    await backupNow({ manual: true });
    toast('Connected. First backup done');
  } catch {
    toast("Connected, but the first backup didn't work");
  }
  renderCloud(box);
}

async function restoreFromCloud() {
  let backups;
  try {
    backups = await listBackups();
  } catch (err) {
    await alertDialog("Couldn't load backups", navigator.onLine ? err.message : "You're offline.");
    return;
  }
  if (!backups.length) {
    await alertDialog('No backups yet', 'Nothing has been backed up to this repository yet.');
    return;
  }
  const ref = await showDialog({
    title: 'Restore from GitHub',
    body: `<label class="field">Choose a backup<select name="ref">${backups.map((b, i) => `
      <option value="${esc(b.ref)}">${esc(when(Date.parse(b.date)))}: ${esc(b.message.replace(/^Backup: /, ''))}${i === 0 ? ' (latest)' : ''}</option>`).join('')}</select></label>`,
    buttons: [{ label: 'Cancel', value: null, style: 'ghost' }, { label: 'Next', value: true, style: 'primary' }],
    collect: d => d.querySelector('[name=ref]').value,
  });
  if (!ref) return;
  try {
    await restoreJSON(await fetchBackup(ref));
  } catch (err) {
    await alertDialog("Couldn't restore", err.message);
  }
}

async function restoreJSON(data) {
  if (data.app !== 'spending-tracker' || !Array.isArray(data.expenses) || !Array.isArray(data.categories) || !data.categories.length) {
    throw new Error('missing expenses or categories');
  }
  const mode = await showDialog({
    title: 'Restore backup',
    body: `<p>The backup from ${esc(shortDate(data.exportedAt.slice(0, 10)))} has ${data.expenses.length} entries.</p>
           <p class="muted small"><strong>Replace</strong> deletes what's on this phone and uses the backup instead.
           <strong>Merge</strong> only adds entries that aren't here yet.</p>`,
    buttons: [
      { label: 'Cancel', value: null, style: 'ghost' },
      { label: 'Merge', value: 'merge' },
      { label: 'Replace', value: 'replace', style: 'danger' },
    ],
  });
  if (!mode) return;
  await restore(data, mode);
  applyTheme();
  notifyChange();
  toast(mode === 'replace' ? 'Backup restored' : 'Backup merged');
}

// Restores (merges) a CSV made with "Export CSV". Missing categories are created.
async function restoreCSV(text) {
  const { headers, records } = toObjects(parseCSV(text));
  if (!['date', 'amount', 'currency', 'category'].every(h => headers.includes(h))) {
    throw new Error('expected the columns date, amount, currency, category. To import a bank statement, use "Import bank statement"');
  }
  const known = new Set(state.expenses.map(e => e.id));
  const fresh = records.filter(r => !r.id || !known.has(r.id));
  if (!(await confirmDialog('Import CSV', `Add ${fresh.length} entr${fresh.length === 1 ? 'y' : 'ies'} from this file? (${records.length - fresh.length} already here.)`, 'Add', 'primary'))) return;

  // Categories are matched by name (spending and income separately); missing ones are created.
  const key = (kind, name) => `${kind}|${name.toLowerCase()}`;
  const byName = new Map(state.categories.map(c => [key(c.kind === 'income' ? 'income' : 'expense', c.name), c.id]));
  const list = [];
  for (const r of fresh) {
    const kind = ['income', 'dad'].includes(r.type) ? r.type : 'expense';
    let cat = '';
    if (kind !== 'dad') {
      const name = r.category || (kind === 'income' ? 'Other income' : 'Other');
      cat = byName.get(key(kind, name));
      if (!cat) {
        cat = (await saveCategory({ name, ...(kind === 'income' ? { kind } : {}) })).id;
        byName.set(key(kind, name), cat);
      }
    }
    const amount = parseAmount(r.amount);
    if (!r.date || Number.isNaN(amount)) continue;
    const dad = DAD_TYPES[r.dad] ? r.dad : '';
    if (kind === 'dad' && !dad) continue;
    const e = { kind, date: r.date, amount, currency: r.currency || 'CHF', category: cat, dad, trip: kind === 'expense' ? r.trip || '' : '', note: r.note || '', source: 'csv' };
    if (r.id) e.id = r.id;
    if (r.merchant) e.merchant = r.merchant;
    const chf = parseAmount(r.amount_chf);
    if (!Number.isNaN(chf)) Object.assign(e, { chf, rate: parseAmount(r.rate) || 1, rateDate: r.date, estimated: false });
    list.push(e);
  }
  await addExpenses(list);
  notifyChange();
  toast(`Added ${list.length} entries`);
}

// ---- Categories & budgets ----

export function categoriesView(root) {
  setTitle('Categories & budgets', '#/settings');
  const rows = list => list.map(c => `
    <li><button type="button" class="row" data-id="${esc(c.id)}">
      <span class="row-icon" style="--dot: var(--c${c.slot})" aria-hidden="true">${c.emoji}</span>
      <span class="row-main"><span class="row-title">${esc(c.name)}</span>
      ${c.kind === 'income' ? '' : `<span class="row-sub">${c.budget > 0 ? `Budget ${money(c.budget, 'CHF', { whole: true })} / month` : 'No budget'}</span>`}</span>
      <span class="chev" aria-hidden="true">›</span>
    </button></li>`).join('');
  root.innerHTML = `
    <h2 class="pad-x section-title">Spending</h2>
    <p class="muted small pad-x">Set a monthly budget (in CHF) for any category. Leave it at 0 for no budget. Spending tagged with a trip doesn't count.</p>
    <ul class="rows card flush">${rows(expenseCategories())}</ul>
    <button type="button" class="btn primary wide" data-add="expense">Add spending category</button>

    <h2 class="pad-x section-title">Income</h2>
    <ul class="rows card flush">${rows(incomeCategories())}</ul>
    <button type="button" class="btn wide" data-add="income">Add income category</button>`;

  root.querySelectorAll('[data-id]').forEach(b => { b.onclick = () => editCategory(root, categoryById(b.dataset.id)); });
  root.querySelectorAll('[data-add]').forEach(b => { b.onclick = () => editCategory(root, null, b.dataset.add); });
}

async function editCategory(root, cat, newKind = 'expense') {
  const kind = cat ? (cat.kind === 'income' ? 'income' : 'expense') : newKind;
  const others = (kind === 'income' ? incomeCategories() : expenseCategories()).filter(c => c.id !== cat?.id);
  const result = await showDialog({
    title: cat ? 'Edit category' : kind === 'income' ? 'New income category' : 'New spending category',
    body: `
      <div class="field-row">
        <label class="field emoji-field">Icon<input type="text" name="emoji" value="${esc(cat?.emoji || '🏷️')}" maxlength="4" autocomplete="off"></label>
        <label class="field grow">Name<input type="text" name="name" value="${esc(cat?.name || '')}" autocomplete="off"></label>
      </div>
      ${kind === 'income' ? '' : `<label class="field">Monthly budget (CHF)<input type="number" name="budget" inputmode="decimal" min="0" step="10" value="${cat?.budget || ''}" placeholder="0 = no budget"></label>`}
      ${cat ? `<div class="btn-row">
        <button type="submit" class="btn small" value="up">↑ Move up</button>
        <button type="submit" class="btn small" value="down">↓ Move down</button>
      </div>` : ''}`,
    buttons: [
      ...(cat && others.length ? [{ label: 'Delete', value: 'delete', style: 'danger' }] : []),
      { label: 'Cancel', value: null, style: 'ghost' },
      { label: 'Save', value: 'save', style: 'primary', validate: d => d.querySelector('[name=name]').value.trim() !== '' },
    ],
    collect: (d, action) => ({
      action,
      name: d.querySelector('[name=name]').value.trim(),
      emoji: d.querySelector('[name=emoji]').value.trim() || '🏷️',
      budget: Math.max(0, Number(d.querySelector('[name=budget]')?.value) || 0),
    }),
  });
  if (!result) return;

  // The move buttons are plain submit buttons with values "up"/"down".
  if (result === 'up' || result === 'down') {
    await moveCategory(cat.id, result === 'up' ? -1 : 1);
  } else if (result.action === 'save') {
    await saveCategory({
      ...(cat ? { id: cat.id } : kind === 'income' ? { kind } : {}),
      name: result.name, emoji: result.emoji, budget: kind === 'income' ? 0 : result.budget,
    });
  } else if (result.action === 'delete') {
    const used = state.expenses.filter(e => e.category === cat.id).length;
    const moveTo = await showDialog({
      title: `Delete “${cat.name}”?`,
      body: `<p>${used ? `${used} entr${used === 1 ? 'y' : 'ies'} will be moved to:` : 'Its rules will be moved to:'}</p>
        <select name="moveTo" class="wide">${others.map(c => `<option value="${esc(c.id)}" ${['other', 'otherincome'].includes(c.id) ? 'selected' : ''}>${c.emoji} ${esc(c.name)}</option>`).join('')}</select>`,
      buttons: [{ label: 'Cancel', value: null, style: 'ghost' }, { label: 'Delete', value: true, style: 'danger' }],
      collect: d => d.querySelector('[name=moveTo]').value,
    });
    if (!moveTo) return;
    await deleteCategory(cat.id, moveTo);
  }
  notifyChange();
  categoriesView(root);
}

// ---- Rules ----

export function rulesView(root) {
  setTitle('Auto-categorise rules', '#/settings');
  const rules = [...state.rules].sort((a, b) => a.pattern.localeCompare(b.pattern));
  root.innerHTML = `
    <p class="muted small pad-x">When you import a bank statement, a merchant name containing the text of a rule
      is sorted the rule's way. Capital letters don't matter, and the longest matching text wins.
      Tip: a rule with Dad's name → “Dad paid me back” sorts his transfers automatically.</p>
    ${rules.length ? `<ul class="rows card flush">
      ${rules.map(r => {
        const c = targetInfo(r.category);
        return `<li><button type="button" class="row" data-id="${esc(r.id)}">
          <span class="row-icon" style="--dot: var(--c${c.slot})" aria-hidden="true">${c.emoji}</span>
          <span class="row-main"><span class="row-title">contains “${esc(r.pattern)}”</span><span class="row-sub">→ ${esc(c.name)}</span></span>
          <span class="chev" aria-hidden="true">›</span></button></li>`;
      }).join('')}
    </ul>` : '<p class="muted center pad">No rules yet. You can also create them while importing.</p>'}
    <div class="btn-row pad-x">
      <button type="button" class="btn primary" id="addRule">Add rule</button>
      <button type="button" class="btn" id="applyRules" ${rules.length ? '' : 'disabled'}>Apply to imported expenses</button>
    </div>`;

  root.querySelectorAll('[data-id]').forEach(b => {
    b.onclick = async () => { if (await editRule(state.rules.find(r => r.id === b.dataset.id))) rulesView(root); };
  });
  root.querySelector('#addRule').onclick = async () => { if (await editRule(null)) rulesView(root); };
  root.querySelector('#applyRules').onclick = async () => {
    const n = await applyRulesToImported();
    notifyChange();
    toast(n ? `Re-categorised ${n} expense${n === 1 ? '' : 's'}` : 'Everything already matches');
  };
}

// Opens the rule form. Returns true when something was saved or deleted.
export async function editRule(rule, defaults = {}) {
  const pattern = rule?.pattern ?? defaults.pattern ?? '';
  const category = rule?.category ?? defaults.category ?? expenseCategories()[0].id;
  const result = await showDialog({
    title: rule ? 'Edit rule' : defaults.title || 'New rule',
    body: `
      ${defaults.intro ? `<p>${defaults.intro}</p>` : ''}
      <label class="field">If the merchant name contains<input type="text" name="pattern" value="${esc(pattern)}" autocomplete="off" autocapitalize="off"></label>
      <label class="field">sort it as<select name="category">${targetOptions(category, defaults.direction || 'both')}</select></label>`,
    buttons: [
      ...(rule ? [{ label: 'Delete', value: 'delete', style: 'danger' }] : []),
      { label: defaults.cancelLabel || 'Cancel', value: null, style: 'ghost' },
      { label: 'Save rule', value: 'save', style: 'primary', validate: d => d.querySelector('[name=pattern]').value.trim() !== '' },
    ],
    collect: (d, action) => ({ action, pattern: d.querySelector('[name=pattern]').value.trim(), category: d.querySelector('[name=category]').value }),
  });
  if (!result) return false;
  if (result.action === 'delete') { await deleteRule(rule.id); return true; }
  return saveRule({ id: rule?.id, pattern: result.pattern, category: result.category });
}
