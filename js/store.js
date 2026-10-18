// The app's data: loads everything from the database into memory and saves changes back.

import * as db from './db.js';
import * as rates from './rates.js';
import { uid, todayISO, monthOf } from './util.js';

export const state = {
  expenses: [],   // sorted newest first
  categories: [], // sorted by `order`
  rules: [],
  settings: {},
};

// Screen state that is not saved (selected month, filters…)
export const ui = {
  month: monthOf(todayISO()),
  scope: 'all',       // 'all' | 'everyday' (everyday = without trips)
  timeView: 'daily',  // 'daily' | 'monthly'
  list: { period: null, q: '', cat: '', trip: '' },
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

const DEFAULT_SETTINGS = {
  warnThreshold: 0.8,
  theme: 'auto',
  lastCurrency: 'CHF',
  activeTrip: '',
  lastBackupAt: null,
  seeded: false,
};

// Settings that belong in a backup (rates are re-downloaded instead).
export const BACKUP_SETTINGS = ['warnThreshold', 'theme', 'lastCurrency', 'activeTrip'];

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

// ---- Expenses ----

const MONEY_FIELDS = ['amount', 'currency', 'date'];

export async function saveExpense(input) {
  const prev = input.id ? state.expenses.find(e => e.id === input.id) : null;
  const e = { ...prev, ...input, trip: (input.trip ?? prev?.trip ?? '').trim(), note: (input.note ?? prev?.note ?? '').trim() };
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

// Adds many expenses at once (bank import, CSV restore). Rates are fetched in one request.
export async function addExpenses(list) {
  const foreign = list.filter(e => e.currency !== rates.BASE).map(e => e.date).sort();
  if (foreign.length) await rates.prefetchRange(foreign[0], foreign[foreign.length - 1]);
  const now = Date.now();
  const out = [];
  for (const [i, input] of list.entries()) {
    const e = { trip: '', note: '', ...input, id: input.id || uid(), createdAt: input.createdAt || now - i, updatedAt: now };
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

// Re-converts expenses that were saved with estimated rates (e.g. while offline).
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

export async function saveCategory(input) {
  const prev = input.id ? state.categories.find(c => c.id === input.id) : null;
  if (prev) {
    Object.assign(prev, input);
    await db.put('categories', prev);
    return prev;
  }
  const used = new Set(state.categories.map(c => c.slot));
  const slot = [1, 2, 3, 4, 5, 6, 7, 8].find(s => !used.has(s)) || 0; // 0 = neutral gray
  const cat = { budget: 0, emoji: '🏷️', ...input, id: uid(), slot, order: Math.max(-1, ...state.categories.map(c => c.order)) + 1 };
  state.categories.push(cat);
  await db.put('categories', cat);
  return cat;
}

export async function moveCategory(id, delta) {
  const i = state.categories.findIndex(c => c.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= state.categories.length) return;
  const a = state.categories[i];
  const b = state.categories[j];
  [a.order, b.order] = [b.order, a.order];
  sortCategories();
  await db.putMany('categories', [a, b]);
}

// Deletes a category and moves its expenses and rules to another one.
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

// ---- Auto-categorise rules ----

// Returns the category of the best matching rule (longest matching text wins), or null.
export function categorize(text) {
  const t = (text || '').toLowerCase();
  let best = null;
  for (const r of state.rules) {
    const p = r.pattern.toLowerCase();
    if (p && t.includes(p) && (!best || p.length > best.pattern.length)) best = r;
  }
  return best && state.categories.some(c => c.id === best.category) ? best.category : null;
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

// Re-categorises imported expenses using the current rules. Returns how many changed.
export async function applyRulesToImported() {
  const changed = [];
  for (const e of state.expenses) {
    if (e.source !== 'import') continue;
    const cat = categorize(e.merchant || e.note);
    if (cat && cat !== e.category) {
      e.category = cat;
      changed.push(e);
    }
  }
  await updateExpenses(changed);
  return changed.length;
}

// ---- Trips ----

export function trips() {
  const map = new Map();
  for (const e of state.expenses) {
    if (!e.trip) continue;
    const t = map.get(e.trip) || { name: e.trip, total: 0, count: 0, from: e.date, to: e.date };
    t.total += e.chf;
    t.count += 1;
    if (e.date < t.from) t.from = e.date;
    if (e.date > t.to) t.to = e.date;
    map.set(e.trip, t);
  }
  return [...map.values()].sort((a, b) => (a.to < b.to ? 1 : -1));
}

export async function renameTrip(from, to) {
  const changed = state.expenses.filter(e => e.trip === from);
  for (const e of changed) e.trip = to;
  await updateExpenses(changed);
  if (state.settings.activeTrip === from) await setSetting('activeTrip', to);
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
  const everyday = expensesInMonth(ym).filter(e => !e.trip);
  const threshold = state.settings.warnThreshold;
  return state.categories
    .filter(c => c.budget > 0)
    .map(c => {
      const spent = Math.round(everyday.filter(e => e.category === c.id).reduce((t, e) => t + e.chf, 0) * 100) / 100;
      const ratio = spent / c.budget;
      const status = ratio > 1 ? 'over' : ratio >= threshold ? 'warn' : 'ok';
      return { category: c, spent, budget: c.budget, ratio, status };
    });
}

// ---- Backup ----

export function snapshot() {
  const settings = BACKUP_SETTINGS.map(key => ({ key, value: state.settings[key] }));
  return {
    app: 'spending-tracker',
    format: 1,
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
      settings: [...(data.settings || []), ...cachedRates, { key: 'seeded', value: true }],
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
  }
  await load();
}

export async function eraseEverything() {
  await db.clearAll();
  await load();
}
