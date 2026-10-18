// The app's data: loads everything from the database into memory and saves changes back.
//
// Every entry has a `kind`:
//   'expense' - money you spent (may be marked dad: 'owe' or 'owed')
//   'income'  - money you earned
//   'dad'     - money moving between you and Dad (dad: 'repay', 'repaid' or 'loan')

import * as db from './db.js';
import * as rates from './rates.js';
import { uid, todayISO, monthOf } from './util.js';

export const state = {
  expenses: [],   // all entries, newest first (the store is still called "expenses")
  categories: [], // spending and income categories, sorted by `order`
  rules: [],
  settings: {},
};

// Screen state that is not saved (selected month, filters…)
export const ui = {
  month: monthOf(todayISO()),
  scope: 'all',       // 'all' | 'everyday' (everyday = without trips)
  timeView: 'daily',  // 'daily' | 'monthly'
  list: { period: null, q: '', cat: '', trip: '', type: '' },
};

export const DEFAULT_CATEGORIES = [
  { id: 'food', name: 'Food', emoji: '🍽️' },
  { id: 'transport', name: 'Transport', emoji: '🚆' },
  { id: 'gear', name: 'Gear', emoji: '🎒' },
  { id: 'travel', name: 'Travel', emoji: '✈️' },
  { id: 'subscriptions', name: 'Subscriptions', emoji: '🔁' },
  { id: 'social', name: 'Social', emoji: '🎉' },
  { id: 'other', name: 'Other', emoji: '📦' },
];

export const DEFAULT_INCOME_CATEGORIES = [
  { id: 'salary', name: 'Salary', emoji: '💼' },
  { id: 'sidejob', name: 'Side job', emoji: '🛠️' },
  { id: 'gifts', name: 'Gifts', emoji: '🎁' },
  { id: 'refunds', name: 'Refunds', emoji: '↩️' },
  { id: 'otherincome', name: 'Other income', emoji: '💰' },
];

// Everything to do with Dad. `owe` says how an entry changes what you owe Dad.
export const DAD_TYPES = {
  owe: { emoji: '👨', label: 'Dad paid, I owe him', short: 'I owe Dad', owe: +1 },
  owed: { emoji: '👨', label: 'Paid for Dad, he owes me', short: 'Dad owes me', owe: -1 },
  repay: { emoji: '↩️', label: 'I paid Dad back', short: 'Paid Dad back', owe: -1, out: true },
  repaid: { emoji: '💸', label: 'Dad paid me back', short: 'Dad paid me back', owe: +1 },
  loan: { emoji: '🤝', label: 'Dad lent me money', short: 'Loan from Dad', owe: +1 },
};

const DEFAULT_SETTINGS = {
  warnThreshold: 0.8,
  theme: 'auto',
  lastCurrency: 'CHF',
  trips: [], // planned trips: [{ name, start, end }] (dates optional)
  lastBackupAt: null,
  seeded: false,
  seededIncome: false,
};

// Settings that belong in a backup (rates are re-downloaded instead).
export const BACKUP_SETTINGS = ['warnThreshold', 'theme', 'lastCurrency', 'trips'];

export const kindOf = e => e.kind || 'expense';
export const isSpending = e => kindOf(e) === 'expense' && e.dad !== 'owed'; // things bought for Dad are his spending
export const isIncome = e => kindOf(e) === 'income';
export const expenseCategories = () => state.categories.filter(c => c.kind !== 'income');
export const incomeCategories = () => state.categories.filter(c => c.kind === 'income');

const sortExpenses = () =>
  state.expenses.sort((a, b) => (a.date === b.date ? (b.createdAt || 0) - (a.createdAt || 0) : a.date < b.date ? 1 : -1));
const sortCategories = () => state.categories.sort((a, b) => a.order - b.order);

export async function load() {
  const [expenses, categories, rules, settings] = await Promise.all(
    ['expenses', 'categories', 'rules', 'settings'].map(s => db.getAll(s)),
  );
  state.settings = { ...DEFAULT_SETTINGS };
  for (const row of settings) if (!row.key.startsWith('rates:')) state.settings[row.key] = row.value;

  if (!state.settings.seeded) {
    const defaults = DEFAULT_CATEGORIES.map((c, i) => ({ ...c, slot: i + 1, budget: 0, order: i }));
    await db.putMany('categories', defaults);
    await setSetting('seeded', true);
    categories.push(...defaults);
  }
  if (!state.settings.seededIncome) {
    const start = Math.max(-1, ...categories.map(c => c.order)) + 1;
    const income = DEFAULT_INCOME_CATEGORIES
      .filter(c => !categories.some(x => x.id === c.id))
      .map((c, i) => ({ ...c, kind: 'income', slot: 0, budget: 0, order: start + i }));
    await db.putMany('categories', income);
    await setSetting('seededIncome', true);
    categories.push(...income);
  }
  // Version 1.0 had a single "active trip" instead of planned trips.
  if (state.settings.activeTrip) {
    const name = state.settings.activeTrip;
    if (!state.settings.trips.some(t => t.name === name)) await setSetting('trips', [...state.settings.trips, { name, start: '', end: '' }]);
    await db.del('settings', 'activeTrip');
    delete state.settings.activeTrip;
  }

  state.expenses = expenses;
  state.categories = categories;
  state.rules = rules;
  sortExpenses();
  sortCategories();
}

export async function setSetting(key, value) {
  state.settings[key] = value;
  await db.setSetting(key, value);
}

// ---- Entries ----

const MONEY_FIELDS = ['amount', 'currency', 'date'];

export async function saveExpense(input) {
  const prev = input.id ? state.expenses.find(e => e.id === input.id) : null;
  const e = { ...prev, ...input };
  e.kind = kindOf(e);
  e.trip = e.kind === 'expense' ? (e.trip || '').trim() : '';
  e.note = (e.note || '').trim();
  e.dad = e.dad || '';
  if (!e.id) {
    e.id = uid();
    e.createdAt = Date.now();
  }
  e.updatedAt = Date.now();
  if (!prev || e.chf == null || MONEY_FIELDS.some(f => prev[f] !== e[f])) {
    Object.assign(e, await rates.toCHF(e.amount, e.currency, e.date));
  }
  await db.put('expenses', e);
  if (prev) Object.assign(prev, e);
  else state.expenses.push(e);
  sortExpenses();
  return e;
}

// Adds many entries at once (bank import, CSV restore). Rates are fetched in one request.
export async function addExpenses(list) {
  const foreign = list.filter(e => e.currency !== rates.BASE).map(e => e.date).sort();
  if (foreign.length) await rates.prefetchRange(foreign[0], foreign[foreign.length - 1]);
  const now = Date.now();
  const out = [];
  for (const [i, input] of list.entries()) {
    const e = { kind: 'expense', trip: '', note: '', dad: '', ...input, id: input.id || uid(), createdAt: input.createdAt || now - i, updatedAt: now };
    if (e.chf == null) Object.assign(e, await rates.toCHF(e.amount, e.currency, e.date));
    out.push(e);
  }
  await db.putMany('expenses', out);
  const ids = new Set(out.map(e => e.id));
  state.expenses = state.expenses.filter(e => !ids.has(e.id)).concat(out);
  sortExpenses();
  return out;
}

export async function deleteExpense(id) {
  await db.del('expenses', id);
  state.expenses = state.expenses.filter(e => e.id !== id);
}

async function updateExpenses(changed) {
  if (!changed.length) return;
  await db.putMany('expenses', changed);
}

// Re-converts entries that were saved with estimated rates (e.g. while offline).
export async function fixEstimated() {
  const todo = state.expenses.filter(e => e.estimated && e.currency !== rates.BASE);
  if (!todo.length || !navigator.onLine) return 0;
  const dates = todo.map(e => e.date).sort();
  await rates.prefetchRange(dates[0], dates[dates.length - 1]);
  const changed = [];
  for (const e of todo) {
    const r = await rates.toCHF(e.amount, e.currency, e.date);
    if (!r.estimated) {
      Object.assign(e, r);
      changed.push(e);
    }
  }
  await updateExpenses(changed);
  return changed.length;
}

// ---- Categories ----

export const categoryById = id => state.categories.find(c => c.id === id) || { id, name: 'Unknown', emoji: '❔', slot: 0 };

const fallbackCategory = kind => {
  const list = kind === 'income' ? incomeCategories() : expenseCategories();
  const preferred = kind === 'income' ? 'otherincome' : 'other';
  return (list.find(c => c.id === preferred) || list[0])?.id || '';
};

export async function saveCategory(input) {
  const prev = input.id ? state.categories.find(c => c.id === input.id) : null;
  if (prev) {
    Object.assign(prev, input);
    await db.put('categories', prev);
    return prev;
  }
  // Spending categories get the next free chart colour; income ones stay neutral.
  const used = new Set(state.categories.map(c => c.slot));
  const slot = input.kind === 'income' ? 0 : [1, 2, 3, 4, 5, 6, 7, 8].find(s => !used.has(s)) || 0;
  const cat = { budget: 0, emoji: '🏷️', ...input, id: uid(), slot, order: Math.max(-1, ...state.categories.map(c => c.order)) + 1 };
  state.categories.push(cat);
  await db.put('categories', cat);
  return cat;
}

// Moves a category up or down among the categories of the same kind.
export async function moveCategory(id, delta) {
  const a = categoryById(id);
  const list = a.kind === 'income' ? incomeCategories() : expenseCategories();
  const b = list[list.indexOf(a) + delta];
  if (!b) return;
  [a.order, b.order] = [b.order, a.order];
  sortCategories();
  await db.putMany('categories', [a, b]);
}

// Deletes a category and moves its entries and rules to another one.
export async function deleteCategory(id, moveTo) {
  const changed = state.expenses.filter(e => e.category === id);
  for (const e of changed) e.category = moveTo;
  await updateExpenses(changed);
  const rules = state.rules.filter(r => r.category === id);
  for (const r of rules) r.category = moveTo;
  await db.putMany('rules', rules);
  await db.del('categories', id);
  state.categories = state.categories.filter(c => c.id !== id);
}

// ---- Targets: where an imported transaction goes ----
// A target is a category id, or 'dad:<type>' for the Dad options.
// Money going out can be spending or Dad; money coming in can be income or Dad.

export const DAD_TARGETS = { out: ['owed', 'repay'], in: ['repaid', 'loan'] };

export function targetIds(direction) {
  const cats = direction === 'in' ? incomeCategories() : expenseCategories();
  return [...cats.map(c => c.id), ...DAD_TARGETS[direction].map(d => `dad:${d}`)];
}

export function targetInfo(target) {
  if (target?.startsWith('dad:')) {
    const d = DAD_TYPES[target.slice(4)];
    return { emoji: d.emoji, name: d.label, slot: 0 };
  }
  return categoryById(target);
}

// Turns a target into the fields stored on an entry.
export function applyTarget(target) {
  if (target.startsWith('dad:')) {
    const dad = target.slice(4);
    return dad === 'owed'
      ? { kind: 'expense', category: fallbackCategory('expense'), dad }
      : { kind: 'dad', category: '', dad };
  }
  return { kind: categoryById(target).kind === 'income' ? 'income' : 'expense', category: target, dad: '' };
}

export const defaultTarget = direction => fallbackCategory(direction === 'in' ? 'income' : 'expense');

const directionOf = e => (isIncome(e) || ['repaid', 'loan'].includes(e.dad) ? 'in' : 'out');
const currentTarget = e => (kindOf(e) === 'dad' || e.dad === 'owed' ? `dad:${e.dad}` : e.category);

// ---- Auto-categorise rules ----

// Returns the target of the best matching rule (longest matching text wins), or null.
export function categorize(text, direction = 'out') {
  const t = (text || '').toLowerCase();
  const valid = new Set(targetIds(direction));
  let best = null;
  for (const r of state.rules) {
    const p = r.pattern.toLowerCase();
    if (p && valid.has(r.category) && t.includes(p) && (!best || p.length > best.pattern.length)) best = r;
  }
  return best ? best.category : null;
}

export async function saveRule(input) {
  const rule = { ...input, pattern: input.pattern.trim(), id: input.id || uid() };
  state.rules = state.rules.filter(r => r.id !== rule.id).concat(rule);
  await db.put('rules', rule);
  return rule;
}

export async function deleteRule(id) {
  await db.del('rules', id);
  state.rules = state.rules.filter(r => r.id !== id);
}

// Re-sorts imported entries using the current rules. Returns how many changed.
export async function applyRulesToImported() {
  const changed = [];
  for (const e of state.expenses) {
    if (e.source !== 'import') continue;
    const target = categorize(e.merchant || e.note, directionOf(e));
    if (target && target !== currentTarget(e)) {
      Object.assign(e, applyTarget(target));
      if (e.kind !== 'expense') e.trip = '';
      changed.push(e);
    }
  }
  await updateExpenses(changed);
  return changed.length;
}

// ---- Trips ----

export const tripRecords = () => state.settings.trips || [];

// The planned trip whose dates include this day ('' if none).
export const tripForDate = date => tripRecords().find(t => t.start && t.end && date >= t.start && date <= t.end)?.name || '';

// All trips (planned ones and any trip name used on an entry), current and upcoming first.
export function trips() {
  const map = new Map();
  for (const r of tripRecords()) map.set(r.name, { name: r.name, start: r.start || '', end: r.end || '', total: 0, count: 0, from: '', to: '' });
  for (const e of state.expenses) {
    if (!e.trip) continue;
    const t = map.get(e.trip) || { name: e.trip, start: '', end: '', total: 0, count: 0, from: '', to: '' };
    if (isSpending(e)) t.total += e.chf;
    t.count += 1;
    if (!t.from || e.date < t.from) t.from = e.date;
    if (!t.to || e.date > t.to) t.to = e.date;
    map.set(e.trip, t);
  }
  const today = todayISO();
  const rank = t => (t.end && t.end >= today) || (!t.end && t.start >= today && t.start) ? 0 : 1;
  return [...map.values()].sort((a, b) =>
    rank(a) - rank(b) || (rank(a) === 0 ? (a.start < b.start ? -1 : 1) : ((b.end || b.to) > (a.end || a.to) ? 1 : -1)));
}

// Creates or edits a planned trip. Renaming also renames the tag on its entries.
export async function saveTrip(prevName, { name, start, end }) {
  const list = tripRecords().filter(t => t.name !== prevName && t.name !== name);
  list.push({ name, start: start || '', end: end || '' });
  await setSetting('trips', list);
  if (prevName && prevName !== name) {
    const changed = state.expenses.filter(e => e.trip === prevName);
    for (const e of changed) e.trip = name;
    await updateExpenses(changed);
  }
}

// Removes a trip. Its entries are kept, just without the trip tag.
export async function deleteTrip(name) {
  const changed = state.expenses.filter(e => e.trip === name);
  for (const e of changed) e.trip = '';
  await updateExpenses(changed);
  await setSetting('trips', tripRecords().filter(t => t.name !== name));
}

// ---- Summaries ----

export const expensesInMonth = ym => state.expenses.filter(e => e.date.startsWith(ym));

export function byCategory(list) {
  const totals = new Map();
  for (const e of list) totals.set(e.category, (totals.get(e.category) || 0) + e.chf);
  return [...totals.entries()]
    .map(([id, total]) => ({ category: categoryById(id), total: Math.round(total * 100) / 100 }))
    .sort((a, b) => b.total - a.total);
}

// Budget status for each category with a budget, for one month. Trips are not counted.
export function budgets(ym) {
  const everyday = expensesInMonth(ym).filter(e => isSpending(e) && !e.trip);
  const threshold = state.settings.warnThreshold;
  return expenseCategories()
    .filter(c => c.budget > 0)
    .map(c => {
      const spent = Math.round(everyday.filter(e => e.category === c.id).reduce((t, e) => t + e.chf, 0) * 100) / 100;
      const ratio = spent / c.budget;
      const status = ratio > 1 ? 'over' : ratio >= threshold ? 'warn' : 'ok';
      return { category: c, spent, budget: c.budget, ratio, status };
    });
}

// What you owe Dad in CHF. Negative means Dad owes you.
export function dadBalance() {
  const total = state.expenses.reduce((t, e) => t + (e.dad && DAD_TYPES[e.dad] ? DAD_TYPES[e.dad].owe * e.chf : 0), 0);
  return Math.round(total * 100) / 100;
}

// ---- Backup ----

export function snapshot() {
  const settings = BACKUP_SETTINGS.map(key => ({ key, value: state.settings[key] }));
  return {
    app: 'spending-tracker',
    format: 2,
    exportedAt: new Date().toISOString(),
    expenses: state.expenses,
    categories: state.categories,
    rules: state.rules,
    settings,
  };
}

export async function restore(data, mode) {
  if (mode === 'replace') {
    const cachedRates = (await db.getAll('settings')).filter(s => s.key.startsWith('rates:'));
    await db.replaceAll({
      expenses: data.expenses,
      categories: data.categories,
      rules: data.rules || [],
      settings: [
        ...(data.settings || []),
        ...cachedRates,
        { key: 'seeded', value: true },
        { key: 'seededIncome', value: data.categories.some(c => c.kind === 'income') },
      ],
    });
  } else {
    // Merge: add anything whose id we don't have yet.
    const have = store => new Set(state[store].map(x => x.id));
    const cats = have('categories');
    const rules = have('rules');
    const exps = have('expenses');
    await db.putMany('categories', data.categories.filter(c => !cats.has(c.id)));
    await db.putMany('rules', (data.rules || []).filter(r => !rules.has(r.id)));
    await db.putMany('expenses', data.expenses.filter(e => !exps.has(e.id)));
    const trips = (data.settings || []).find(s => s.key === 'trips')?.value || [];
    const known = new Set(tripRecords().map(t => t.name));
    if (trips.some(t => !known.has(t.name))) await setSetting('trips', [...tripRecords(), ...trips.filter(t => !known.has(t.name))]);
  }
  await load();
}

export async function eraseEverything() {
  await db.clearAll();
  await load();
}
