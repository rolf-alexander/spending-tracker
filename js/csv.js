// Reading and writing CSV files, plus the bank statement formats the importer understands.

// Parses CSV text into an array of rows (arrays of strings).
// Detects the separator (comma, semicolon or tab) and handles "quoted, fields".
export function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const delim = detectDelimiter(text);
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(f => f.trim() !== ''));
}

// Looks at the first lines (some banks put account details above the table).
function detectDelimiter(text) {
  const sample = text.split(/\r?\n/, 15).join('\n');
  const counts = [',', ';', '\t'].map(d => [d, sample.split(d).length]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][0];
}

// Finds the header row: a known bank's header, or else the first row that is as
// wide as most of the table (skipping account details some banks put on top).
function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    if (detectBank(rows[i].map(h => h.trim()))) return i;
  }
  const filled = r => r.filter(f => f.trim() !== '').length;
  const widths = new Map();
  for (const r of rows) widths.set(filled(r), (widths.get(filled(r)) || 0) + 1);
  const common = [...widths.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
  const i = rows.findIndex(r => filled(r) >= common);
  return i < 0 ? 0 : i;
}

// Turns CSV rows into objects keyed by the header row.
export function toObjects(rows) {
  const start = findHeaderRow(rows);
  const headers = rows[start].map(h => h.trim());
  return {
    headers,
    records: rows.slice(start + 1).map(r => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()]))),
  };
}

export function toCSV(rows) {
  return rows
    .map(r => r.map(v => {
      const s = v == null ? '' : String(v);
      return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(','))
    .join('\r\n');
}

// "1'234.50", "1.234,50", "-12,50", "CHF 9.90", "(5.00)" -> numbers
export function parseAmount(value) {
  if (typeof value === 'number') return value;
  let s = String(value || '').trim().replace(/[\s'’]/g, '').replace(/^[A-Za-z]{3}|[A-Za-z]{3}$/g, '');
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  if (s.endsWith('-')) { negative = true; s = s.slice(0, -1); }
  const dot = s.lastIndexOf('.');
  const comma = s.lastIndexOf(',');
  if (dot > -1 && comma > -1) {
    s = comma > dot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (comma > -1) {
    s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  }
  if (!/^[-+]?\d*\.?\d+$/.test(s)) return NaN;
  const n = parseFloat(s);
  return negative ? -Math.abs(n) : n;
}

// "2026-10-15 14:03", "15.10.2026", "15/10/26", "10/15/2026" -> "2026-10-15"
export function parseDate(value, order = 'dmy') {
  const s = String(value || '').trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return iso(m[1], m[2], m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    let [, a, b, y] = m;
    if (y.length === 2) y = `20${y}`;
    if (order === 'mdy' || (Number(b) > 12 && Number(a) <= 12)) [a, b] = [b, a];
    return iso(y, b, a);
  }
  return null;
}

function iso(y, m, d) {
  const mm = Number(m);
  const dd = Number(d);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

const has = (headers, ...names) => names.every(n => headers.includes(n));
const findCol = (headers, names) => names.find(n => headers.includes(n));
const round2 = n => Math.round(n * 100) / 100;
const out = (date, amount, currency, description, note = '') => ({ date, amount: round2(amount), currency, description, note, direction: 'out' });
const into = (date, amount, currency, description, note = '') => ({ date, amount: round2(amount), currency, description, note, direction: 'in' });

// UBS e-banking exports exist in English, German, French and Italian.
const UBS = {
  date: ['Trade date', 'Abschlussdatum', 'Date de transaction', 'Data dell\'operazione', 'Booking date', 'Buchungsdatum', 'Date de comptabilisation', 'Data di registrazione'],
  debit: ['Debit', 'Belastung', 'Débit', 'Addebito'],
  credit: ['Credit', 'Gutschrift', 'Crédit', 'Accredito'],
  currency: ['Currency', 'Währung', 'Monnaie', 'Divisa', 'Whr.'],
  desc1: ['Description1', 'Beschreibung1', 'Description 1', 'Beschreibung 1', 'Descrizione1', 'Descrizione 1'],
  desc2: ['Description2', 'Beschreibung2', 'Description 2', 'Beschreibung 2', 'Descrizione2', 'Descrizione 2'],
};

// Each bank format turns one CSV record into
// { date, amount (positive), direction: 'out' | 'in', currency, description, note? }
// or null to skip it (top-ups and exchanges between your own accounts, failed payments…).
export const BANKS = [
  {
    id: 'revolut',
    name: 'Revolut',
    detect: h => has(h, 'Started Date', 'Description', 'Amount', 'Currency'),
    row(r) {
      const status = (r.State || '').toUpperCase();
      if (['REVERTED', 'DECLINED', 'FAILED'].includes(status)) return null;
      const type = (r.Type || '').toUpperCase();
      if (['EXCHANGE', 'TOPUP'].includes(type)) return null;
      const amount = parseAmount(r.Amount);
      const date = parseDate(r['Started Date']);
      if (amount < 0) return out(date, -amount + Math.abs(parseAmount(r.Fee) || 0), r.Currency, r.Description);
      if (amount > 0) return into(date, amount, r.Currency, r.Description);
      return null;
    },
  },
  {
    id: 'wise',
    name: 'Wise',
    detect: h => has(h, 'Direction', 'Source amount (after fees)', 'Source currency'),
    row(r) {
      if (r.Status && r.Status.toUpperCase() !== 'COMPLETED') return null;
      const date = parseDate(r['Created on']);
      const direction = (r.Direction || '').toUpperCase();
      if (direction === 'OUT') {
        const amount = parseAmount(r['Source amount (after fees)']) + (parseAmount(r['Source fee amount']) || 0);
        return amount > 0 ? out(date, amount, r['Source currency'], r['Target name'] || r.Reference || 'Wise') : null;
      }
      if (direction === 'IN') {
        const amount = parseAmount(r['Target amount (after fees)']);
        return amount > 0 ? into(date, amount, r['Target currency'], r['Source name'] || r.Reference || 'Wise') : null;
      }
      return null; // NEUTRAL = converting between your own balances
    },
  },
  {
    id: 'wise-statement',
    name: 'Wise (statement)',
    detect: h => has(h, 'TransferWise ID', 'Date', 'Amount', 'Currency', 'Description'),
    row(r) {
      const amount = parseAmount(r.Amount);
      const description = r.Description || '';
      if (/^BALANCE/i.test(r['TransferWise ID']) || /^Converted/i.test(description)) return null;
      const date = parseDate(r.Date);
      if (amount < 0) {
        return out(date, -amount, r.Currency,
          r.Merchant || r['Payee Name'] || description.replace(/^Card transaction of .*? issued by /i, ''));
      }
      if (amount > 0) return into(date, amount, r.Currency, r['Payer Name'] || description);
      return null;
    },
  },
  {
    id: 'neon',
    name: 'neon',
    detect: h => has(h, 'Date', 'Amount', 'Original amount', 'Original currency', 'Description'),
    row(r) {
      const amount = parseAmount(r.Amount);
      const orig = r['Original currency'];
      const note = orig && orig !== 'CHF' && r['Original amount'] ? `${r['Original amount'].replace('-', '')} ${orig}` : '';
      const date = parseDate(r.Date);
      const description = r.Description || r.Subject;
      // neon statements are in CHF: we keep the CHF amount you were actually charged.
      if (amount < 0) return out(date, -amount, 'CHF', description, note);
      if (amount > 0) return into(date, amount, 'CHF', description, note);
      return null;
    },
  },
  {
    id: 'ubs',
    name: 'UBS',
    detect: h => Boolean(findCol(h, UBS.debit) && findCol(h, UBS.credit) && findCol(h, UBS.desc1) && findCol(h, UBS.date)),
    row(r) {
      const h = Object.keys(r);
      const get = names => r[findCol(h, names)] || '';
      const date = parseDate(get(UBS.date));
      const currency = get(UBS.currency) || 'CHF';
      const d1 = get(UBS.desc1);
      const d2 = get(UBS.desc2);
      const description = (d1 || d2).replace(/\s*;\s*$/, '');
      const note = d1 && d2 && d2 !== d1 ? d2 : '';
      // Debits may be written as negative or positive numbers depending on the export.
      const debit = parseAmount(get(UBS.debit));
      const credit = parseAmount(get(UBS.credit));
      if (debit) return out(date, Math.abs(debit), currency, description, note);
      if (credit) return into(date, Math.abs(credit), currency, description, note);
      return null; // e.g. the detail lines of a collective booking
    },
  },
];

export const detectBank = headers => BANKS.find(b => b.detect(headers)) || null;

// For any other bank: guess which column is which. The user can correct it.
export function guessMapping(headers) {
  const find = re => headers.find(h => re.test(h)) || '';
  const amount = find(/amount|betrag|debit|belastung|lastschrift/i);
  return {
    date: find(/date|datum|valuta|buchung/i),
    description: find(/merchant|description|beschreibung|text|details|payee|empfänger|booking/i),
    amount,
    credit: find(/credit|gutschrift/i),
    currency: find(/^currency$|währung|ccy/i),
    fixedCurrency: 'CHF',
    // 'negative' = one amount column, money out is negative.
    // 'positive' = the amount column only holds money out (a "debit" column).
    sign: /debit|belastung|lastschrift/i.test(amount) ? 'positive' : 'negative',
    dateOrder: 'dmy',
  };
}

export function genericRow(r, m) {
  const date = parseDate(r[m.date], m.dateOrder);
  const currency = (m.currency && r[m.currency]) || m.fixedCurrency;
  const description = r[m.description] || '';
  const amount = parseAmount(r[m.amount]);
  const credit = m.credit && m.credit !== m.amount ? parseAmount(r[m.credit]) : NaN;
  if (amount) {
    if (m.sign === 'positive' || amount < 0) return out(date, Math.abs(amount), currency, description);
    return into(date, amount, currency, description);
  }
  if (credit) return into(date, Math.abs(credit), currency, description);
  return null;
}
