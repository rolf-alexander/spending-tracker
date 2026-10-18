// Automatic backup to a private GitHub repository.
// While the app is open and online, a backup is uploaded shortly after anything changes.
// Every upload is a new version in the repository, so older backups can be restored too.
// (iPhone web apps can't run in the background, so nothing happens while the app is closed.)

import { state, snapshot, setSetting } from './store.js';

const API = 'https://api.github.com';
const FILE = 'spending-backup.json';
const DELAY = 15000; // wait for a quiet moment before uploading

// Saved on the device only (never in exported backups): { repo: 'owner/name', token }
export const cloudConfig = () => state.settings.ghBackup || null;

class GitHubError extends Error {
  constructor(status) {
    super({
      401: "GitHub didn't accept the token. It may have expired: create a new one and set up backup again.",
      403: "The token isn't allowed to write to the backup repository. It needs “Contents: Read and write”.",
      404: "The backup repository wasn't found. Check its name, and that the token includes it.",
    }[status] || `GitHub answered with error ${status}. Try again later.`);
    this.status = status;
  }
}

async function gh(path, { method = 'GET', body, raw = false, token = cloudConfig()?.token } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new GitHubError(res.status);
  return raw ? res.text() : res.json();
}

const filePath = () => `/repos/${cloudConfig().repo}/contents/${FILE}`;

// btoa() only handles plain ASCII, so encode the text as UTF-8 bytes first.
function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function fingerprint(text) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Checks a token and repository name. Returns the full 'owner/name'.
export async function checkSetup(token, repoName) {
  const user = await gh('/user', { token });
  const repo = repoName.includes('/') ? repoName : `${user.login}/${repoName}`;
  const info = await gh(`/repos/${repo}`, { token });
  if (!info.private) throw new Error(`“${repo}” is public, so anyone could read your backups. Make it private on GitHub first.`);
  if (info.permissions && !info.permissions.push) throw new GitHubError(403);
  return repo;
}

// Is there already a backup in the repository? (e.g. when setting up a new phone)
export async function remoteBackupExists() {
  try {
    await gh(filePath());
    return true;
  } catch (err) {
    if (err.status === 404) return false;
    throw err;
  }
}

let running = null;

// Uploads a backup. Skips when nothing changed since the last one (unless `manual`)
// and never uploads an empty backup, so it can't overwrite a real one with nothing.
export function backupNow({ manual = false } = {}) {
  if (!cloudConfig()?.token) return Promise.resolve('off');
  if (!navigator.onLine) return Promise.resolve('offline');
  if (running) return running;
  running = (async () => {
    const snap = snapshot();
    if (!snap.expenses.length) return 'empty';
    const hash = await fingerprint(JSON.stringify({ ...snap, exportedAt: null }));
    if (!manual && hash === state.settings.ghLastHash) return 'unchanged';

    let sha;
    try {
      sha = (await gh(filePath())).sha;
    } catch (err) {
      if (err.status !== 404) throw err; // 404 = first backup
    }
    await gh(filePath(), {
      method: 'PUT',
      body: {
        message: `Backup: ${snap.expenses.length} entries`,
        content: toBase64(JSON.stringify(snap, null, 1)),
        ...(sha ? { sha } : {}),
      },
    });
    const now = Date.now();
    await setSetting('ghLastHash', hash);
    await setSetting('ghLastBackupAt', now);
    await setSetting('ghError', '');
    await setSetting('lastBackupAt', now);
    return 'done';
  })()
    .catch(async err => {
      await setSetting('ghError', err.message);
      throw err;
    })
    .finally(() => { running = null; });
  return running;
}

// The most recent backups, newest first: [{ ref, date, message }]
export async function listBackups() {
  const commits = await gh(`/repos/${cloudConfig().repo}/commits?path=${FILE}&per_page=20`);
  return commits.map(c => ({ ref: c.sha, date: c.commit.committer.date, message: c.commit.message }));
}

export async function fetchBackup(ref) {
  return JSON.parse(await gh(`${filePath()}?ref=${ref}`, { raw: true }));
}

export async function disconnect() {
  for (const key of ['ghBackup', 'ghLastHash', 'ghLastBackupAt', 'ghError']) await setSetting(key, null);
}

// ---- Automatic backups ----

let timer;
let pending = false;

function schedule(delay = DELAY) {
  if (!cloudConfig()?.token) return;
  pending = true;
  clearTimeout(timer);
  timer = setTimeout(flush, delay);
}

function flush() {
  clearTimeout(timer);
  if (!pending) return;
  pending = false;
  backupNow().catch(() => { /* the error is shown in Settings and on the Overview */ });
}

export function startAutoBackup() {
  window.addEventListener('datachange', () => schedule());
  window.addEventListener('online', () => schedule(2000));
  // Leaving the app: upload straight away instead of waiting.
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
  schedule(3000); // catches changes made last time while offline
}
