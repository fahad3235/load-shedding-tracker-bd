/* Node unit tests for logic.js -- run: node tests/run-node-tests.js */
'use strict';
const LS = require('../logic.js');

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; }
  else { fail++; console.log('FAIL:', name); }
}
function eq(a, b, name) { ok(a === b, name + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }

const A1 = 'area1', A2 = 'area2';
function W(id, area, wd, s, e) { return { id: id, areaId: area, weekday: wd, start: s, end: e }; }

// ---------- time helpers ----------
ok(LS.isTime('00:00'), 'isTime midnight');
ok(LS.isTime('23:59'), 'isTime 23:59');
ok(!LS.isTime('24:00'), 'isTime 24:00 invalid');
ok(!LS.isTime('9:00'), 'isTime 9:00 needs zero-pad');
ok(!LS.isTime('12:60'), 'isTime 12:60 invalid');
eq(LS.toMinutes('14:30'), 870, 'toMinutes 14:30 = 870');
eq(LS.fromMinutes(870), '14:30', 'fromMinutes 870 = 14:30');
eq(LS.fromMinutes(0), '00:00', 'fromMinutes 0');
eq(LS.fmtDuration(150, 'en'), '2h 30m', 'fmtDuration 150 en');
eq(LS.fmtDuration(45, 'en'), '45m', 'fmtDuration 45 en');
eq(LS.fmtDuration(120, 'en'), '2h', 'fmtDuration 120 en');
eq(LS.fmtDuration(0, 'en'), '0m', 'fmtDuration 0 en');
eq(LS.fmtDuration(150, 'bn'), '\u09e8\u0998 \u09e9\u09e6\u09ae\u09bf', 'fmtDuration 150 bn digits');
eq(LS.fmtTime('14:30', 'bn'), '\u09e7\u09ea:\u09e9\u09e6', 'fmtTime bn digits');
eq(LS.weekdayOf('2026-10-14'), 3, 'weekdayOf 2026-10-14 = Wednesday (3)');
eq(LS.weekStartISO('2026-10-14'), '2026-10-12', 'weekStartISO Wed -> Monday');
eq(LS.weekStartISO('2026-10-12'), '2026-10-12', 'weekStartISO Monday -> itself');
eq(LS.weekStartISO('2026-10-18'), '2026-10-12', 'weekStartISO Sunday -> Monday of same week');
eq(LS.addDaysISO('2026-10-12', 6), '2026-10-18', 'addDaysISO +6');
ok(LS.isDate('2026-02-28'), 'isDate valid');
ok(!LS.isDate('2026-02-30'), 'isDate Feb 30 invalid');

// ---------- validateWindow ----------
const EXIST = [W('w1', A1, 3, '10:00', '12:00'), W('w2', A1, 3, '14:00', '15:00')];
eq(LS.validateWindow({ areaId: A1, weekday: 3, start: '12:00', end: '13:00' }, EXIST).length, 0,
  'touching window (12:00 after 10-12) allowed');
ok(LS.validateWindow({ areaId: A1, weekday: 3, start: '11:00', end: '13:00' }, EXIST).indexOf('errOverlap') >= 0,
  'partial overlap rejected');
ok(LS.validateWindow({ areaId: A1, weekday: 3, start: '09:00', end: '16:00' }, EXIST).indexOf('errOverlap') >= 0,
  'containing overlap rejected');
ok(LS.validateWindow({ areaId: A1, weekday: 3, start: '11:00', end: '11:30' }, EXIST).indexOf('errOverlap') >= 0,
  'contained overlap rejected');
eq(LS.validateWindow({ areaId: A1, weekday: 4, start: '11:00', end: '13:00' }, EXIST).length, 0,
  'same time different day allowed');
eq(LS.validateWindow({ areaId: A2, weekday: 3, start: '11:00', end: '13:00' }, EXIST).length, 0,
  'same time different area allowed');
ok(LS.validateWindow({ areaId: A1, weekday: 3, start: '12:00', end: '12:00' }, EXIST).indexOf('errEndAfterStart') >= 0,
  'end == start rejected');
ok(LS.validateWindow({ areaId: A1, weekday: 3, start: '13:00', end: '12:00' }, EXIST).indexOf('errEndAfterStart') >= 0,
  'end < start rejected');
ok(LS.validateWindow({ areaId: A1, weekday: 3, start: '25:00', end: '26:00' }, EXIST).indexOf('errTime') >= 0,
  'bad time rejected');
ok(LS.validateWindow({ areaId: '', weekday: 3, start: '10:00', end: '11:00' }, EXIST).indexOf('errArea') >= 0,
  'missing area rejected');
ok(LS.validateWindow({ areaId: A1, weekday: 7, start: '10:00', end: '11:00' }, EXIST).indexOf('errWeekday') >= 0,
  'weekday 7 rejected');
eq(LS.validateArea({ name: '  ' }).length, 1, 'empty area name rejected');
eq(LS.validateArea({ name: 'Home' }).length, 0, 'valid area');

// ---------- statusAtArea ----------
// Wednesday (3). Windows: 10:00-12:00, 14:00-15:00.
let st = LS.statusAtArea([], A1, 3, 600);
eq(st.off, false, 'no windows -> power on');
eq(st.next, null, 'no windows -> no next change');
st = LS.statusAtArea(EXIST, A1, 3, 540); // 09:00, before first
eq(st.off, false, '09:00 before first window -> on');
eq(st.next.minutes, 600, '09:00 next change = 10:00');
eq(st.next.type, 'off', '09:00 next change type off');
eq(st.next.dayOffset, 0, '09:00 next change today');
eq(LS.minutesUntilNext(st, 540), 60, 'countdown 09:00 -> 60 min');
st = LS.statusAtArea(EXIST, A1, 3, 600); // exactly 10:00 = start
eq(st.off, true, 'exactly at start -> off (start inclusive)');
eq(st.next.minutes, 720, 'at start next = end 12:00');
eq(st.next.type, 'on', 'at start next type on');
st = LS.statusAtArea(EXIST, A1, 3, 660); // 11:00 inside
eq(st.off, true, '11:00 inside window -> off');
eq(LS.minutesUntilNext(st, 660), 60, 'countdown 11:00 -> 60 min to 12:00');
st = LS.statusAtArea(EXIST, A1, 3, 720); // exactly 12:00 = end
eq(st.off, false, 'exactly at end -> on (end exclusive)');
eq(st.next.minutes, 840, 'at end next = 14:00');
st = LS.statusAtArea(EXIST, A1, 3, 780); // 13:00 between windows
eq(st.off, false, '13:00 between windows -> on');
eq(st.next.minutes, 840, '13:00 next = 14:00');
st = LS.statusAtArea(EXIST, A1, 3, 900); // 15:00 = end of last
eq(st.off, false, '15:00 after last window -> on');
// window only on Thursday (4): 09:00-10:00 -> next day
const THU = [W('w9', A1, 4, '09:00', '10:00')];
st = LS.statusAtArea(THU, A1, 3, 900);
eq(st.next.dayOffset, 1, 'next-day window -> dayOffset 1');
eq(st.next.minutes, 540, 'next-day window -> 09:00');
eq(LS.minutesUntilNext(st, 900), 1080, 'countdown 15:00 Wed -> 18h to Thu 09:00');
st = LS.statusAtArea(THU, A1, 3, 900);
// window only same weekday next week: dayOffset 7
const WEDONLY = [W('w8', A1, 3, '10:00', '11:00')];
st = LS.statusAtArea(WEDONLY, A1, 3, 900); // 15:00 Wed, window passed
eq(st.next.dayOffset, 7, 'same-weekday next week -> dayOffset 7');
eq(LS.minutesUntilNext(st, 900), 7 * 1440 - 300, 'countdown to next-week window');
// area isolation: other area windows ignored
st = LS.statusAtArea([W('w7', A2, 3, '10:00', '12:00')], A1, 3, 660);
eq(st.off, false, 'other area window does not affect this area');

// ---------- windowDayStatus ----------
eq(LS.windowDayStatus(W('x', A1, 3, '10:00', '12:00'), 540), 'upcoming', 'day status upcoming');
eq(LS.windowDayStatus(W('x', A1, 3, '10:00', '12:00'), 660), 'ongoing', 'day status ongoing');
eq(LS.windowDayStatus(W('x', A1, 3, '10:00', '12:00'), 720), 'past', 'day status past at end');

// ---------- log totals ----------
// asof Wed 2026-10-14. Week Mon 2026-10-12 .. Sun 2026-10-18.
const LOG = [
  { id: 'l1', areaId: A1, date: '2026-10-14', start: '10:00', end: '11:30', note: '' }, // 90 today
  { id: 'l2', areaId: A1, date: '2026-10-13', start: '09:00', end: '10:00', note: '' }, // 60 same week
  { id: 'l3', areaId: A1, date: '2026-10-12', start: '08:00', end: '08:30', note: '' }, // 30 Monday
  { id: 'l4', areaId: A1, date: '2026-10-11', start: '08:00', end: '09:00', note: '' }, // 60 prev week (Sun)
  { id: 'l5', areaId: A2, date: '2026-10-14', start: '10:00', end: '12:00', note: '' }, // other area
];
let tot = LS.logTotals(LOG, A1, '2026-10-14');
eq(tot.todayMin, 90, 'logTotals today = 90');
eq(tot.weekMin, 180, 'logTotals week = 90+60+30 (excludes prev week + other area)');
eq(tot.weekStart, '2026-10-12', 'logTotals weekStart Monday');
eq(tot.weekEnd, '2026-10-18', 'logTotals weekEnd Sunday');
eq(LS.logsFor(LOG, A1).length, 4, 'logsFor filters by area');
eq(LS.logsFor(LOG, A1)[0].id, 'l1', 'logsFor newest first');

// ---------- validateLogEntry ----------
eq(LS.validateLogEntry({ areaId: A1, date: '2026-10-14', start: '10:00', end: '11:00' }, '2026-10-14').length, 0,
  'valid log entry');
ok(LS.validateLogEntry({ areaId: A1, date: '2026-10-15', start: '10:00', end: '11:00' }, '2026-10-14').indexOf('errDate') >= 0,
  'future log date rejected');
ok(LS.validateLogEntry({ areaId: A1, date: '2026-10-14', start: '11:00', end: '11:00' }, '2026-10-14').indexOf('errEndAfterStart') >= 0,
  'log end == start rejected');
ok(LS.validateLogEntry({ areaId: '', date: '2026-10-14', start: '10:00', end: '11:00' }, '2026-10-14').indexOf('errArea') >= 0,
  'log missing area rejected');

// ---------- validateImport ----------
const GOOD = {
  app: 'load-shedding-tracker-bd', version: 1, exportedAt: '2026-10-14',
  areas: [{ id: 'a1', name: 'Home' }],
  windows: [{ id: 'w1', areaId: 'a1', weekday: 3, start: '10:00', end: '12:00' }],
  log: [{ id: 'l1', areaId: 'a1', date: '2026-10-14', start: '10:00', end: '11:00', note: '' }]
};
ok(!LS.validateImport(GOOD, '2026-10-14').error, 'valid import accepted');
eq(LS.validateImport(GOOD, '2026-10-14').areas.length, 1, 'import areas count');
ok(LS.validateImport({ app: 'nope', areas: [], windows: [], log: [] }, '2026-10-14').error === 'importBad',
  'wrong app rejected');
ok(LS.validateImport({ app: 'load-shedding-tracker-bd', areas: [], windows: [], log: 'x' }, '2026-10-14').error === 'importBad',
  'non-array log rejected');
const DANGLING = JSON.parse(JSON.stringify(GOOD));
DANGLING.windows[0].areaId = 'ghost';
ok(LS.validateImport(DANGLING, '2026-10-14').error === 'importBad', 'dangling areaId rejected');
const OVERLAP = JSON.parse(JSON.stringify(GOOD));
OVERLAP.windows.push({ id: 'w2', areaId: 'a1', weekday: 3, start: '11:00', end: '13:00' });
ok(LS.validateImport(OVERLAP, '2026-10-14').error === 'importBad', 'overlapping import windows rejected');
const DUP = JSON.parse(JSON.stringify(GOOD));
DUP.areas.push({ id: 'a1', name: 'Copy' });
ok(LS.validateImport(DUP, '2026-10-14').error === 'importBad', 'duplicate ids rejected');
const FUTURE = JSON.parse(JSON.stringify(GOOD));
FUTURE.log[0].date = '2026-10-15';
ok(LS.validateImport(FUTURE, '2026-10-14').error === 'importBad', 'future log date in import rejected');
ok(LS.validateImport(null, '2026-10-14').error === 'importBad', 'null import rejected');

// ---------- i18n parity ----------
const enKeys = Object.keys(LS.I18N.en).sort();
const bnKeys = Object.keys(LS.I18N.bn).sort();
eq(JSON.stringify(enKeys), JSON.stringify(bnKeys), 'i18n key parity en/bn');
enKeys.forEach(function (k) {
  ok(LS.tr('en', k) !== k, 'en key resolves: ' + k);
  ok(LS.tr('bn', k) !== k, 'bn key resolves: ' + k);
});
eq(LS.tr('en', 'nextOffIn', { n: '1h 5m' }), 'Power goes off in 1h 5m', 'tr var substitution en');
ok(LS.tr('bn', 'nextOffIn', { n: 'X' }).indexOf('X') >= 0, 'tr var substitution bn');
eq(LS.tr('xx', 'save'), 'Save', 'tr falls back to en');
eq(LS.fmtWeekday(6, 'en'), 'Saturday', 'fmtWeekday Sat en');
eq(LS.fmtDate('2026-10-14', 'en'), 'October 14, 2026', 'fmtDate en');
eq(LS.fmtDate('2026-10-14', 'bn'), '\u09e7\u09ea \u0985\u0995\u09cd\u099f\u09cb\u09ac\u09b0 \u09e8\u09e6\u09e8\u09ec', 'fmtDate bn');

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
