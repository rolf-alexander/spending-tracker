// Light / dark mode. "auto" follows the phone's setting.

import { state } from './store.js';

export function applyTheme() {
  const theme = state.settings.theme;
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
  const dark = theme === 'dark' || (theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => { m.content = dark ? '#0d0d0d' : '#f3f3f0'; });
}

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
