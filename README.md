# Spending Tracker

A personal spending tracker that runs as an app on your iPhone. It works completely
offline and keeps all your data on your phone. Nothing is sent to a server.

- Add expenses in CHF, EUR, GBP, JPY or CAD. Everything is converted to CHF using
  European Central Bank rates (from the free [Frankfurter](https://frankfurter.dev) service),
  which are saved on the phone for offline use.
- Categories with monthly budgets, and a warning when you get close (80% by default).
- Trips (e.g. "Japan 2027") with their own totals. Trip spending doesn't count towards your monthly budgets.
- Import bank statements (Revolut, Wise and neon are recognised automatically, or any CSV),
  with rules that sort merchants into categories.
- Backup and restore as JSON or CSV.

## Installing on your iPhone

1. Open the app's web address in **Safari** (it has to be Safari).
2. Tap the **Share** button (the square with an arrow pointing up).
3. Scroll down and tap **Add to Home Screen**, then **Add**.
4. Open it from the new **Spending** icon. It runs full-screen, and works without internet.

## Backing up (important!)

Your data lives only inside the app on your phone. If you delete the app from your
home screen, or the phone is lost or reset, the data is gone, so back up regularly.
The app reminds you if you haven't backed up for a month.

**To back up:** Settings → **Back up (JSON)** → choose **Save to Files** → pick
**iCloud Drive** (or anywhere you like).

- **JSON** is the complete backup: expenses, categories, budgets and rules. Use this one.
- **Export CSV** gives a spreadsheet of your expenses (opens in Numbers or Excel).

**To restore:** Settings → **Restore from backup…** → pick the file.
- **Replace** swaps everything on the phone for the backup (e.g. on a new phone).
- **Merge** only adds expenses that aren't on the phone yet.

## Updating the app

The app's files live in this folder and on GitHub. To change something:

1. Edit the files (or ask Claude to make the change).
2. Open `sw.js` and increase the version number, e.g. `const VERSION = '1.0.0';` → `'1.0.1'`.
   **This step matters.** Without it, phones keep using the old saved copy.
3. Publish the change:
   ```
   git add -A
   git commit -m "Describe what you changed"
   git push
   ```
4. Wait a minute or two for GitHub Pages to update. The next time you open the app
   with internet, it shows **"A new version is ready" → Update**. Your data is not touched by updates.

Settings shows the version you're running at the very bottom.

## Trying it on your computer

From this folder, run `python -m http.server 8000`, then open <http://localhost:8000>.

## How it's built (for the curious)

Plain HTML, CSS and JavaScript. No frameworks and no build step.

| File | What it does |
|---|---|
| `index.html` | The page skeleton and the tab bar |
| `css/app.css` | All styling, including dark mode |
| `js/app.js` | Starts the app and switches between screens |
| `js/store.js` | The data: expenses, categories, budgets, rules, trips, backups |
| `js/db.js` | Saving to the phone's built-in database (IndexedDB) |
| `js/rates.js` | Exchange rates and conversion to CHF |
| `js/csv.js` | Reading CSV files and the bank formats |
| `js/charts.js` | The bar chart |
| `js/views/*.js` | One file per screen |
| `sw.js` | The "service worker" that makes the app work offline |
| `manifest.webmanifest`, `icons/` | What makes it installable, with its name and icon |
