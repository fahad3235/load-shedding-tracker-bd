# TEST_RESULTS — load-shedding-tracker-bd (manual factory run #57, 2026-10-14)

## Node unit tests — 212/212 passed, 0 failed
`node tests/run-node-tests.js`

- Time helpers: `isTime` (midnight/23:59 valid; 24:00, 9:00, 12:60 rejected), `toMinutes`/`fromMinutes` round-trip, `fmtDuration` (150 → "2h 30m", 45 → "45m", 0 → "0m", BN digits), `weekStartISO` (Wed 2026-10-14 → Mon 2026-10-12; Sunday → same week's Monday), `isDate` (Feb 30 rejected).
- Overlap validation: partial / containing / contained overlaps rejected; touching endpoints (12:00 after 10:00–12:00) allowed; same time on a different day or different area allowed; end == start and end < start rejected; bad time, missing area, weekday 7 rejected.
- `statusAtArea` (Wednesday, windows 10:00–12:00 + 14:00–15:00): no windows → ON + no next change; 09:00 → ON, next 10:00 OFF, countdown 60; exactly 10:00 → OFF (start inclusive); 11:00 → OFF, countdown 60 to 12:00; exactly 12:00 → ON (end exclusive), next 14:00; 13:00 → ON; 15:00 → ON. Next-day window → dayOffset 1, countdown 18h. Same-weekday-only window after it passed → dayOffset 7. Other-area windows ignored.
- `windowDayStatus`: upcoming / ongoing / past (past at end).
- `logTotals` (asof Wed 2026-10-14, week Mon 2026-10-12–Sun 2026-10-18): today 90 min; week 180 min (excludes previous-week Sunday entry and other-area entry); weekStart/weekEnd correct. `logsFor` filters by area, newest first.
- `validateLogEntry`: valid accepted; future date, end == start, missing area rejected.
- `validateImport`: valid accepted; wrong app, non-array log, dangling areaId, overlapping import windows, duplicate ids, future log date, null payload all rejected with `importBad`.
- i18n: EN/BN key parity (all keys resolve in both languages), `tr` var substitution EN/BN, fallback to EN, `fmtWeekday`, `fmtDate` EN/BN.

Hand-verified math (fixed cases): 09:00 → 60 min to 10:00 OFF; 11:00 → 60 min to 12:00 ON; 15:00 Wed → 1080 min (18h) to Thu 09:00; log totals 90 today / 180 week.

## Headless-Chrome smoke — 48/48 passed, 0 failed
`node tests/smoke.mjs` (puppeteer-core, /opt/meta-chromium/chrome, file://, ?asof=2026-10-14&time=09:00)

Render + asof honored + empty states; add area via UI (persists); POWER ON + "No outage scheduled" with no schedule; add Wednesday window 10:00–12:00 (day list + weekly grid); live status ON at 09:00 with "1h" countdown; reload at 11:00 → POWER OFF + "1h" return + "Ongoing" chip (localStorage persists); overlap 11:00–13:00 rejected inline, window not saved; end ≤ start rejected; touching 12:00–13:00 window saved; log entry 10:00–11:30 → today/week totals "1h 30m" + note shown; future log date rejected; BN toggle → Bengali title + Bengali-digit totals, back to EN; export/import round-trip via `__LST_import` (areas replaced, "Imported" toast); malformed import rejected, data intact; clear-all wipes areas/windows/log; 390 px no-overflow on status/schedule/log; 0 console errors, 0 page errors, 0 network requests.

## Repairs (2, both genuine)
1. `SyntaxError: Unexpected token ')'` — `qs('#btnClear').onclick` block closed with `});` instead of `};`. Fixed to `};`.
2. `TypeError: FT.trimStr is not a function` — `trimStr` was defined in logic.js but missing from the module's export list. Added to exports. (Smoke test caught it: area save silently failed.)

## Hygiene
- `grep -P '[^\x00-\x7F]'` on shipped sources: zero matches (pure ASCII; Bengali as `\uXXXX` escapes, decoded + eyeballed: title, POWER OFF, Saturday, overlap error, footer all correct).
- Zero network requests by design; no secrets in code.
