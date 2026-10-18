// Exchange rates. Rates come from the free Frankfurter API (European Central Bank
// data, no account needed) and are cached on the device so conversion works offline.
// A rate means "how many units of that currency one CHF buys", so CHF = amount / rate.

import { getSetting, setSetting } from './db.js';

export const BASE = 'CHF';
export const CURRENCIES = ['CHF', 'EUR', 'GBP', 'JPY', 'CAD'];
const FOREIGN = CURRENCIES.filter(c => c !== BASE);
const API = 'https://api.frankfurter.dev/v1';

// Used only until the app has been online once. Expenses converted with these are
// marked as estimates and fixed automatically when real rates are downloaded.
const FALLBACK = {
  date: '2026-10-16',
  rates: { EUR: 1.0785, GBP: 0.9101, JPY: 191.78, CAD: 1.7186 },
  fetchedAt: 0,
  fallback: true,
};

const MAX_GAP_DAYS = 7; // weekends and holidays have no rates: use the closest earlier day

let latest = FALLBACK;
let history = {}; // { 'YYYY-MM-DD': { EUR: 1.07, ... } }

export async function init() {
  latest = (await getSetting('rates:latest', null)) || FALLBACK;
  history = (await getSetting('rates:history', null)) || {};
}

export const getLatest = () => latest;

async function fetchJSON(url, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`Rate service answered ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const saveHistory = () => setSetting('rates:history', history);

// Downloads today's rates. Returns true when it worked.
export async function refresh() {
  if (!navigator.onLine) return false;
  try {
    const j = await fetchJSON(`${API}/latest?base=${BASE}&symbols=${FOREIGN.join(',')}`);
    latest = { date: j.date, rates: j.rates, fetchedAt: Date.now() };
    history[j.date] = j.rates;
    await setSetting('rates:latest', latest);
    await saveHistory();
    return true;
  } catch {
    return false;
  }
}

// Downloads historical rates for a date range (used for imports and past dates).
export async function prefetchRange(from, to) {
  if (!navigator.onLine) return false;
  const start = shiftDays(from, -MAX_GAP_DAYS);
  const end = to > todayISO() ? todayISO() : to;
  if (start > end) return false;
  try {
    const j = await fetchJSON(`${API}/${start}..${end}?base=${BASE}&symbols=${FOREIGN.join(',')}`);
    Object.assign(history, j.rates);
    await saveHistory();
    return true;
  } catch {
    return false;
  }
}

// Finds cached rates for a date, or the closest earlier business day.
function lookup(date) {
  for (let i = 0; i <= MAX_GAP_DAYS; i++) {
    const d = shiftDays(date, -i);
    if (history[d]) return { date: d, rates: history[d] };
  }
  return null;
}

const round2 = n => Math.round(n * 100) / 100;

// Converts an amount to CHF for a given date.
// Returns { chf, rate, rateDate, estimated }.
export async function toCHF(amount, currency, date) {
  if (currency === BASE) return { chf: round2(amount), rate: 1, rateDate: date, estimated: false };

  let hit = lookup(date);
  if (!hit && navigator.onLine && date < latest.date) {
    await prefetchRange(date, date);
    hit = lookup(date);
  }
  let estimated = false;
  if (!hit) {
    // No rate for that day (offline, or rates not fetched yet): use the newest we have.
    hit = { date: latest.date, rates: latest.rates };
    estimated = true;
  }
  if (latest.fallback && hit.rates === latest.rates) estimated = true;
  const rate = hit.rates[currency];
  return { chf: round2(amount / rate), rate, rateDate: hit.date, estimated };
}

// Quick estimate for the live preview while typing an amount.
export function previewCHF(amount, currency) {
  if (currency === BASE) return amount;
  return amount / latest.rates[currency];
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function shiftDays(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}
