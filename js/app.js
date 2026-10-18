// Starts the app, switches between screens and keeps everything up to date.

import * as rates from './rates.js';
import { load, fixEstimated } from './store.js';
import { applyTheme } from './theme.js';
import { toast } from './util.js';
import { dashboard } from './views/dashboard.js';
import { list } from './views/list.js';
import { tripsView, tripDetail } from './views/trips.js';
import { settings, categoriesView, rulesView } from './views/settings.js';
import { importer } from './views/importer.js';
import { dadView } from './views/dad.js';
import { startAutoBackup } from './cloud.js';
import { openEditor, editorOpen } from './views/editor.js';

const routes = {
  home: dashboard,
  list,
  trips: tripsView,
  trip: tripDetail,
  settings,
  categories: categoriesView,
  rules: rulesView,
  import: importer,
  dad: dadView,
};
// Which tab is highlighted for each screen
const tabFor = { trip: 'trips', categories: 'settings', rules: 'settings', import: 'settings', dad: 'settings' };

const main = document.getElementById('main');

function currentRoute() {
  const [name, ...rest] = location.hash.replace(/^#\/?/, '').split('/');
  return { name: routes[name] ? name : 'home', arg: decodeURIComponent(rest.join('/')) };
}

function render() {
  const { name, arg } = currentRoute();
  routes[name](main, arg);
  const tab = tabFor[name] || name;
  document.querySelectorAll('.tabbar [data-tab]').forEach(a => {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

window.addEventListener('hashchange', () => {
  render();
  window.scrollTo(0, 0);
});
// Fired whenever data changes (an expense saved, a backup restored…)
window.addEventListener('datachange', () => render());

document.getElementById('addBtn').addEventListener('click', () => openEditor());

async function updateRates() {
  if (!(await rates.refresh())) return;
  const fixed = await fixEstimated();
  if (fixed) toast(`Exchange rates updated for ${fixed} expense${fixed === 1 ? '' : 's'}`);
  // Don't redraw underneath someone who is typing.
  if (!editorOpen() && !main.contains(document.activeElement)) render();
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  let updating = false;
  const offerUpdate = worker =>
    toast('A new version is ready', {
      label: 'Update',
      sticky: true,
      run: () => { updating = true; worker.postMessage('skipWaiting'); },
    });
  navigator.serviceWorker.register('sw.js').then(reg => {
    if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker.addEventListener('statechange', () => {
        // A new version finished downloading while the old one is running.
        if (worker.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(worker);
      });
    });
    // Check for updates whenever the app comes back to the foreground.
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  });
  // Reload once the new version has taken over (not on the very first install).
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!updating) return;
    updating = false;
    location.reload();
  });
}

async function boot() {
  await rates.init();
  await load();
  applyTheme();
  render();
  registerServiceWorker();
  // Ask the browser not to clear our data when the phone runs low on space.
  navigator.storage?.persist?.().catch(() => {});
  updateRates();
  window.addEventListener('online', updateRates);
  startAutoBackup();
}

boot().catch(err => {
  main.innerHTML = '<p class="notice"></p>';
  main.firstChild.textContent = `Something went wrong while starting: ${err.message || err}`;
  console.error(err);
});
