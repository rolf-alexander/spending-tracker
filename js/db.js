// A small wrapper around IndexedDB, the browser's built-in database.
// Everything the app knows is stored here, on the device only.

const DB_NAME = 'spending-tracker';
const DB_VERSION = 1;
export const STORES = ['expenses', 'categories', 'rules', 'settings'];

let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        const expenses = db.createObjectStore('expenses', { keyPath: 'id' });
        expenses.createIndex('date', 'date');
        db.createObjectStore('categories', { keyPath: 'id' });
        db.createObjectStore('rules', { keyPath: 'id' });
        db.createObjectStore('settings', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

// Runs fn inside a transaction and resolves when the transaction has committed.
async function run(stores, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    const req = fn(t);
    t.oncomplete = () => resolve(req && 'result' in req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const getAll = store => run(store, 'readonly', t => t.objectStore(store).getAll());
export const get = (store, key) => run(store, 'readonly', t => t.objectStore(store).get(key));
export const put = (store, value) => run(store, 'readwrite', t => { t.objectStore(store).put(value); });
export const del = (store, key) => run(store, 'readwrite', t => { t.objectStore(store).delete(key); });

export const putMany = (store, values) => run(store, 'readwrite', t => {
  const s = t.objectStore(store);
  for (const v of values) s.put(v);
});

export const delMany = (store, keys) => run(store, 'readwrite', t => {
  const s = t.objectStore(store);
  for (const k of keys) s.delete(k);
});

// Replaces the contents of several stores in one go (used by "restore backup").
export const replaceAll = data => run(STORES, 'readwrite', t => {
  for (const name of STORES) {
    if (!data[name]) continue;
    const s = t.objectStore(name);
    s.clear();
    for (const v of data[name]) s.put(v);
  }
});

export const clearAll = () => run(STORES, 'readwrite', t => {
  for (const name of STORES) t.objectStore(name).clear();
});

export async function getSetting(key, fallback) {
  const row = await get('settings', key);
  return row ? row.value : fallback;
}

export const setSetting = (key, value) => put('settings', { key, value });
