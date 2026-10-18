# Spending Tracker

A personal spending tracker that runs as an app on your iPhone. It works completely
offline and keeps all your data on your phone. Nothing is sent to a server.

- Add money you **spent** or **earned** in CHF, EUR, GBP, JPY or CAD. Everything is converted to CHF using
  European Central Bank rates (from the free [Frankfurter](https://frankfurter.dev) service),
  which are saved on the phone for offline use.
- Categories with monthly budgets, and a warning when you get close (80% by default).
  The Overview shows what you earned, spent and have left over each month.
- **Trips** (e.g. "Japan 2027") with dates. Anything added during the trip is tagged automatically.
  For things bought beforehand (flights, gear), pick the trip when adding them.
  Trip spending doesn't count towards your monthly budgets.
- **Dad:** mark an expense "Dad paid (I owe him)" or "For Dad (he owes me)", and record repayments
  and loans. The Dad screen (Settings → Dad) shows who owes whom. Things bought for Dad don't count as your spending.
  Not sure yet? Choose **🤷 Not sure if Dad pays me back** or **🤷 Dad paid, not sure if I owe him**. These don't change
  the balance; they wait under "Not decided yet" on the Dad screen until you tap one and decide
  (e.g. "Dad will pay me back", "It's my own spending" or "It's a gift from Dad").
- Import bank statements. **UBS**, Revolut, Wise and neon are recognised automatically, or use any CSV.
  Sort the transactions one by one (tap a category and the next one appears) and create rules
  that sort merchants automatically next time.
- Backup and restore as JSON or CSV.

## Installing on your iPhone

1. Open the app's web address in **Safari** (it has to be Safari).
2. Tap the **Share** button (the square with an arrow pointing up).
3. Scroll down and tap **Add to Home Screen**, then **Add**.
4. Open it from the new **Spending** icon. It runs full-screen, and works without internet.

## Backing up (important!)

Your data lives only inside the app on your phone. If you delete the app from your
home screen, or the phone is lost or reset, the data is gone, so back up.

### Automatic backup to GitHub (recommended)

While the app is open and online, it uploads a backup to the **private** repository
[rolf-alexander/spending-backup](https://github.com/rolf-alexander/spending-backup)
shortly after anything changes, and right away when you switch to another app.
Every upload is kept as a separate version. (iPhone web apps can't run in the background,
so nothing is uploaded while the app is closed.)

**One-time set-up** (easiest on your iPhone in Safari, so you can copy and paste):
1. Go to **github.com/settings/personal-access-tokens/new** and log in.
2. **Token name:** `Spending app backup`. **Expiration:** the longest option offered.
3. **Repository access:** *Only select repositories* → pick **spending-backup**.
4. **Permissions** → **Repository permissions** → **Contents** → **Read and write**.
5. Tap **Generate token** and copy it (it starts with `github_pat_`).
6. In the app: **Settings → Automatic backup → Set up automatic backup**, paste the token, tap **Connect**.

If the token expires, the app shows "Automatic backup isn't working". Make a new token
(steps 1–5) and tap **Set up again**.

**Restore:** Settings → Automatic backup → **Restore…** → pick a backup (the newest is
at the top) → **Replace**. On a new phone, install the app, then set up automatic
backup with a token. The app finds the existing backup and offers to restore it.

### Backup to a file

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
| `js/cloud.js` | Automatic backup to GitHub |
| `js/csv.js` | Reading CSV files and the bank formats |
| `js/charts.js` | The bar chart |
| `js/views/*.js` | One file per screen (`editor.js` is the quick-add screen, `dad.js` the Dad screen) |
| `sw.js` | The "service worker" that makes the app work offline |
| `manifest.webmanifest`, `icons/` | What makes it installable, with its name and icon |
