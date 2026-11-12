# Daybook

A personal tracker for routines, tasks and projects. It runs as an iPhone Home Screen app, keeps its data in CSV files in a **private** GitHub repo, and sends reminders as push notifications from a scheduled GitHub Action. There are no third-party services and nothing to pay for.

```
daybook (public repo, GitHub Pages)      daybook-data (private repo)
  the app: HTML / CSS / JS        ──API──►  data/*.csv   ← your tasks
  remind.yml / remind.py (templates)        .github/workflows/remind.yml  (installed by the app)
                                            scripts/remind.py             (installed by the app)
                                                 │  every 30 min
                                                 ▼
                                        push notification → iPhone
```

## Setup (about 10 minutes, all of it doable on the iPhone)

### 1. Public repo for the app
1. On github.com, create a new **public** repo named `daybook`.
2. Choose **Add file › Upload files** and upload every file from this folder: `index.html`, `app.css`, `app.js`, `sw.js`, `manifest.webmanifest`, the three `icon-*.png` files, `remind.yml`, `remind.py` and `README.md`. Then commit.
3. In the repo's **Settings › Pages**, set Source to *Deploy from a branch*, Branch to `main` and the folder to `/ (root)`, then save.
4. After a minute or so the app is live at `https://YOUR-USERNAME.github.io/daybook/`.

This repo holds code only. Anyone who opens the URL sees just the Connect screen.

### 2. Private repo for your data
Create a new **private** repo named `daybook-data`. It can start empty. The app creates everything else in it.

### 3. Access token
Go to **Settings › Developer settings › Personal access tokens › Fine-grained tokens › Generate new token**.
- **Repository access:** *Only select repositories* › `daybook-data`
- **Permissions › Repository permissions:**
  - Contents: **Read and write**
  - Actions: **Read and write** (needed for the test notification button)
  - Workflows: **Read and write** (lets the app install the reminder workflow)
- **Expiration:** up to a year. Set a calendar reminder to renew it. When it expires, create a new token and reconnect.

Copy the token. GitHub only shows it once.

### 4. Install on the iPhone
1. Open `https://YOUR-USERNAME.github.io/daybook/` in **Safari**.
2. Tap **Share › Add to Home Screen**, then open Daybook from the Home Screen.
3. Enter your name, your GitHub username, `daybook-data` and the token, then tap **Connect**. The app creates your data files and installs the reminder workflow.
4. Go to **Settings › Turn on notifications** and tap Allow. Then tap **Send test notification**; it should arrive within about a minute.

Push notifications only work when Daybook is opened from the Home Screen (iOS 16.4 or later), not from a Safari tab.

## How reminders work
- The workflow runs every 30 minutes from 05:00 to 23:59 Doha time.
- **Morning summary** (default 06:30): today's routines, tasks due, anything overdue and the first timed item.
- **Timed items:** any routine or task with a time and *Notify me* switched on. It is sent once its time minus the lead time (Settings, default 15 min) has passed, at most 2 hours late, and never twice.
- **Evening wrap-up** (default 21:00): what is still open.
- GitHub's scheduler can run a few minutes late, so treat reminders as "around this time", not an alarm.
- Usage is roughly 1,100–1,200 Actions minutes a month, under the 2,000 included free for private repos.
- To change the active hours or time zone, edit the `cron` line in `.github/workflows/remind.yml` in the data repo. Cron times are in UTC; Doha is UTC+3.

## Your data (data repo)
| File | Columns |
|---|---|
| `data/tasks.csv` | `id, title, category, kind (task / routine / project), repeat (daily / weekdays / weekends / custom), days, time (HH:MM), due (YYYY-MM-DD), project (id), priority, status, remind (1/0), notes, created, done_at` |
| `data/categories.csv` | `name, color`. Add, rename, recolor or delete categories in Settings. |
| `data/log.csv` | `date, id`: one row per routine check-in, used for history and streaks |
| `data/settings.csv` | `key, value`: name, timezone, weekend, digest, wrap, lead |
| `data/push.json` | Your devices' push subscriptions and the app's push signing key. Keep this repo private. |
| `data/sent.csv` | Reminders already sent in the last 7 days |

Every change in the app is a commit, so GitHub's history works as an undo log. You can also edit the CSVs directly on GitHub. The app picks up the changes the next time it opens.

**Weekdays** follow the weekend days you set in Settings. The default is Fri + Sat, so weekdays are Sun–Thu.

## Updating the app
Upload changed files to the `daybook` repo. The app checks the network first, so the new version loads on the next open. If you change `remind.py` or `remind.yml`, tap **Settings › Reinstall reminder workflow** to copy them into the data repo.
