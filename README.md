# Dan's Gym

A simple, offline-friendly fitness tracker for gym workouts with a **daily weigh-in**.
No account, no server, no install step — it's plain HTML/CSS/JS and your data stays on your device.

## Features

**Daily weigh-in**
- Log today's weight in one tap from the Today screen (or any past date from the Weight tab)
- Streak counter for consecutive days weighed in
- Trend chart with a **7-day moving average** (daily weight jumps around 1–2 kg from water/food; the average shows the real trend)
- 7-day and 30-day change, optional goal weight with "to go" tracking
- Notes per entry, edit/delete, CSV export

**Workouts**
- Start an empty workout or repeat a recent one
- Add exercises (autocomplete from a built-in list plus anything you've logged)
- Log weight × reps per set and tick sets off as you go
- Shows what you did **last time** for each exercise and pre-fills sets from it
- In-progress workouts are saved continuously, so closing the tab won't lose anything
- Workout timer, notes, weekly workout target and weekly volume

**Progress**
- Per-exercise chart of estimated 1-rep max (Epley formula) and heaviest set
- Personal records table

**Other**
- kg or lb (switch any time — data is stored in kg and converted)
- Light/dark mode follows your phone
- JSON backup export/import

## Using it

**Quickest:** open `index.html` in a browser.

**On your phone (recommended):** host it for free with GitHub Pages:
1. Repo → Settings → Pages → Source: *Deploy from a branch* → pick the branch and `/ (root)`.
2. Open the Pages URL on your phone, then *Share → Add to Home Screen* (iOS) or *Install app* (Android).
   It then opens full-screen like a normal app and works offline.

## Your data

Everything is saved in the browser's local storage on the device you use. That means:
- Data doesn't sync between devices.
- Clearing site data / browser history for the page will erase it.

Use **Settings → Export backup** regularly, and **Import backup** to restore or move to a new phone.
