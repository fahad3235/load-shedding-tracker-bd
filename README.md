# Load Shedding Tracker BD

Offline bilingual (EN/বাংলা) load-shedding (power outage) schedule tracker for Bangladesh. Create areas (home, office, …), each with its own weekly outage schedule, see live POWER ON / POWER OFF status with a countdown to the next change, and log actual outages with totals.

## Problem

Load-shedding schedules in Bangladesh are usually shared as images or word of mouth and are hard to track per location. This app keeps one personal, offline record: your areas, your schedules, your logs.

## Features

1. **Area profiles** — create areas (e.g. home, office), each with its own weekly schedule. Delete removes the area, its schedule and its log.
2. **Live status** — for the selected area, shows POWER ON / POWER OFF right now from the schedule, plus a countdown to the next change (refreshes every 30 s).
3. **Today's schedule** — today's outage windows with Past / Ongoing / Upcoming status per window.
4. **Weekly grid** — 7-day schedule view (Saturday-first, Bangladesh week) for the selected area.
5. **Outage log** — log actual outages (date, start, end, note) with total outage hours today and this week (Monday–Sunday).
6. **Data tools** — JSON export download, JSON import with strict validation (malformed files rejected, data untouched), clear-all with confirm.
7. **Bilingual** — EN/বাংলা toggle persisted, Bengali digits, localStorage, 390 px mobile, zero network requests.

## Rules enforced

- Schedule window: end must be after start; no overlapping windows on the same day for the same area (touching endpoints allowed).
- Log entries: date cannot be in the future; end must be after start.
- Everything ships EMPTY — all schedules and logs are user-entered. No pre-filled data, no fabricated claims.

## Stack

- Vanilla HTML/CSS/JS, no dependencies, no build step.
- `logic.js` — pure logic (no DOM), unit-tested in node.
- `index.html` — UI + app glue.
- `tests/` — node unit tests + headless-Chrome smoke tests.

## Install

No install needed. Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
# open http://localhost:8000/
```

## Dev commands

```sh
node tests/run-node-tests.js   # node unit tests
node tests/smoke.mjs           # headless-Chrome smoke (needs the node_modules symlink + /opt/meta-chromium/chrome)
```

## Testing

- `node tests/run-node-tests.js` — 212/212 assertions (status-at-time, countdown, overlap validation, log totals, import validation, i18n parity).
- `node tests/smoke.mjs` — 48/48 checks (render, add area/window/log, live status at fixed times, overlap + future-date rejection, BN toggle, export/import round-trip, clear-all, 390 px no-overflow, 0 console/page errors, 0 network requests).

## Deployment

Static site. Any static host works (e.g. GitHub Pages: publish from `main` / root).

## Limitations

- Schedules are user-entered; the app does not fetch any official load-shedding schedule (there is no public machine-readable feed used here).
- No overnight windows: end must be after start within the same day.
- No background notifications; the countdown only updates while the page is open.
- Data lives in one browser's localStorage; no sync across devices.
- Personal tracker, not an official schedule.

## Status

Built and tested (manual factory run #57). Not yet published to GitHub.
