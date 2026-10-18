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

function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0];
  const counts = [',', ';', '\t'].map(d => [d, firstLine.split(d).length]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][0];
}

// Turns CSV rows into objects keyed by the header row.
export function toObjects(rows) {
  const headers = rows[0].map(h => h.trim());
  return {
    headers,
    records: rows.slice(1).map(r => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()]))),
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
const round2 = n => Math.round(n * 100) / 100;

// Each bank format turns one CSV record into
// { date, amount (positive), currency, description, note? } — or null to skip
// (income, transfers between your own accounts, failed payments…).
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
      if (!(amount < 0)) return null;
      const fee = Math.abs(parseAmount(r.Fee) || 0);
      return { date: parseDate(r['Started Date']), amount: round2(-amount + fee), currency: r.Currency, description: r.Description };
    },
  },
  {
    id: 'wise',
    name: 'Wise',
    detect: h => has(h, 'Direction', 'Source amount (after fees)', 'Source currency'),
    row(r) {
      if ((r.Direction || '').toUpperCase() !== 'OUT') return null;
      if (r.Status && r.Status.toUpperCase() !== 'COMPLETED') return null;
      const amount = parseAmount(r['Source amount (after fees)']) + (parseAmount(r['Source fee amount']) || 0);
      if (!(amount > 0)) return null;
      return { date: parseDate(r['Created on']), amount: round2(amount), currency: r['Source currency'], description: r['Target name'] || r.Reference || 'Wise' };
    },
  },
  {
    id: 'wise-statement',
    name: 'Wise (statement)',
    detect: h => has(h, 'TransferWise ID', 'Date', 'Amount', 'Currency', 'Description'),
    row(r) {
      const amount = parseAmount(r.Amount);
      if (!(amount < 0)) return null;
      const description = r.Description || '';
      if (/^BALANCE/i.test(r['TransferWise ID']) || /^Converted/i.test(description)) return null;
      return {
        date: parseDate(r.Date),
        amount: round2(-amount),
        currency: r.Currency,
        description: r.Merchant || r['Payee Name'] || description.replace(/^Card transaction of .*? issued by /i, ''),
      };
    },
  },
  {
    id: 'neon',
    name: 'neon',
    detect: h => has(h, 'Date', 'Amount', 'Original amount', 'Original currency', 'Description'),
    row(r) {
      const amount = parseAmount(r.Amount);
      if (!(amount < 0)) return null;
      const orig = r['Original currency'];
      const note = orig && orig !== 'CHF' && r['Original amount'] ? `${r['Original amount'].replace('-', '')} ${orig}` : '';
      // neon statements are in CHF: we keep the CHF amount you were actually charged.
      return { date: parseDate(r.Date), amount: round2(-amount), currency: 'CHF', description: r.Description || r.Subject, note };
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
    currency: find(/^currency$|währung|ccy/i),
    fixedCurrency: 'CHF',
    // How expenses appear. A separate "debit" column lists them as positive numbers.
    sign: /debit|belastung|lastschrift/i.test(amount) ? 'positive' : 'negative',
    dateOrder: 'dmy',
  };
}

export function genericRow(r, m) {
  let amount = parseAmount(r[m.amount]);
  if (Number.isNaN(amount)) return null;
  if (m.sign === 'negative') {
    if (!(amount < 0)) return null;
    amount = -amount;
  } else if (!(amount > 0)) return null;
  return {
    date: parseDate(r[m.date], m.dateOrder),
    amount: round2(amount),
    currency: (m.currency && r[m.currency]) || m.fixedCurrency,
    description: r[m.description] || '',
  };
}
