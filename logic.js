/* load-shedding-tracker-bd -- pure logic (no DOM). Testable in node.
   All schedules are user-entered; nothing is pre-filled.
   Times are "HH:MM" 24h. Weekday: JS getDay() (0=Sunday..6=Saturday).
   All Bengali text is written as \uXXXX escapes (pure-ASCII sources). */
'use strict';

const LoadShed = (function () {
  const APP_ID = 'load-shedding-tracker-bd';
  const STORAGE_KEY = 'load-shedding-tracker-bd-v1';
  const LANG_KEY = 'load-shedding-tracker-bd-lang';

  // ---------- utils ----------
  function uid() {
    return 'x' + Date.now().toString(36) + Math.floor(Math.random() * 1679616).toString(36);
  }
  function trimStr(s) { return (s == null ? '' : String(s)).trim(); }
  function todayISO(d) {
    d = d || new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }
  function isDate(s) {
    const t = trimStr(s);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return false;
    const p = t.split('-').map(Number);
    const d = new Date(p[0], p[1] - 1, p[2]);
    return d.getFullYear() === p[0] && d.getMonth() === p[1] - 1 && d.getDate() === p[2];
  }
  function isTime(s) {
    const t = trimStr(s);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) return false;
    return true;
  }
  function toMinutes(hhmm) {
    const p = String(hhmm).split(':');
    return Number(p[0]) * 60 + Number(p[1]);
  }
  function fromMinutes(min) {
    const h = Math.floor(min / 60), m = min % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }
  function addDaysISO(iso, days) {
    const p = iso.split('-').map(Number);
    const d = new Date(p[0], p[1] - 1, p[2] + days);
    return todayISO(d);
  }
  function weekdayOf(iso) {
    const p = iso.split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]).getDay();
  }
  // Monday of the week containing `iso` (ISO week, Monday start)
  function weekStartISO(iso) {
    const wd = weekdayOf(iso); // 0=Sun..6=Sat
    const back = (wd + 6) % 7; // days since Monday
    return addDaysISO(iso, -back);
  }
  const BN_DIGITS = ['\u09E6', '\u09E7', '\u09E8', '\u09E9', '\u09EA',
                     '\u09EB', '\u09EC', '\u09ED', '\u09EE', '\u09EF'];
  function bnDigits(s) {
    return String(s).replace(/[0-9]/g, function (d) { return BN_DIGITS[Number(d)]; });
  }
  // "14:30" -> "14:30" (en) or Bengali digits (bn). 24h display, unambiguous.
  function fmtTime(hhmm, lang) {
    return lang === 'bn' ? bnDigits(hhmm) : hhmm;
  }
  // minutes -> "2h 30m" / "45m" (en) or Bengali digits with \u0998 / \u09ae\u09bf (bn)
  function fmtDuration(min, lang) {
    const h = Math.floor(min / 60), m = min % 60;
    let s;
    if (h > 0 && m > 0) s = h + 'h ' + m + 'm';
    else if (h > 0) s = h + 'h';
    else s = m + 'm';
    if (lang === 'bn') {
      s = s.replace('h', '\u0998').replace('m', '\u09ae\u09bf');
      s = bnDigits(s);
    }
    return s;
  }
  function fmtInt(n, lang) {
    const s = String(n);
    return lang === 'bn' ? bnDigits(s) : s;
  }

  // ---------- validation ----------
  function validateArea(raw) {
    const errs = [];
    if (!trimStr(raw.name)) errs.push('errAreaName');
    return errs;
  }
  // candidate: { areaId, weekday, start, end }. existing: other windows.
  // Returns error codes: errTime, errEndAfterStart, errOverlap, errArea, errWeekday
  function validateWindow(candidate, existing) {
    const errs = [];
    if (!trimStr(candidate.areaId)) errs.push('errArea');
    const wd = candidate.weekday;
    if (!Number.isInteger(wd) || wd < 0 || wd > 6) errs.push('errWeekday');
    if (!isTime(candidate.start) || !isTime(candidate.end)) errs.push('errTime');
    else {
      const s = toMinutes(candidate.start), e = toMinutes(candidate.end);
      if (e <= s) errs.push('errEndAfterStart');
      else {
        (existing || []).forEach(function (w) {
          if (w.areaId !== candidate.areaId) return;
          if (w.weekday !== wd) return;
          if (w.id && candidate.id && w.id === candidate.id) return;
          const ws = toMinutes(w.start), we = toMinutes(w.end);
          if (s < we && ws < e) errs.push('errOverlap');
        });
      }
    }
    return errs;
  }
  // log entry: { areaId, date, start, end, note? }
  // Returns error codes: errArea, errDate, errTime, errEndAfterStart
  function validateLogEntry(raw, asofISO) {
    const errs = [];
    if (!trimStr(raw.areaId)) errs.push('errArea');
    const dt = trimStr(raw.date);
    if (!isDate(dt)) errs.push('errDate');
    else if (dt > asofISO) errs.push('errDate'); // future date rejected
    if (!isTime(raw.start) || !isTime(raw.end)) errs.push('errTime');
    else if (toMinutes(raw.end) <= toMinutes(raw.start)) errs.push('errEndAfterStart');
    return errs;
  }

  // ---------- schedule queries ----------
  function windowsFor(windows, areaId, weekday) {
    return (windows || [])
      .filter(function (w) { return w.areaId === areaId && w.weekday === weekday; })
      .sort(function (a, b) { return toMinutes(a.start) - toMinutes(b.start); });
  }
  // Live status at (weekday, nowMin) for one area's windows.
  // Returns { off: bool, current: window|null, next: {dayOffset, minutes, type}|null }
  // type 'off' = power will go OFF at that time; 'on' = power will come back ON.
  function statusAtArea(windows, areaId, weekday, nowMin) {
    const todays = windowsFor(windows, areaId, weekday);
    for (let i = 0; i < todays.length; i++) {
      const w = todays[i];
      if (nowMin >= toMinutes(w.start) && nowMin < toMinutes(w.end)) {
        return { off: true, current: w, next: { dayOffset: 0, minutes: toMinutes(w.end), type: 'on' } };
      }
    }
    // not in an outage: find next window start today, else scan forward up to 7 days
    for (let i = 0; i < todays.length; i++) {
      if (toMinutes(todays[i].start) > nowMin) {
        return { off: false, current: null, next: { dayOffset: 0, minutes: toMinutes(todays[i].start), type: 'off' } };
      }
    }
    for (let d = 1; d <= 7; d++) {
      const wd = (weekday + d) % 7;
      const dayWins = windowsFor(windows, areaId, wd);
      if (dayWins.length) {
        return { off: false, current: null, next: { dayOffset: d, minutes: toMinutes(dayWins[0].start), type: 'off' } };
      }
    }
    return { off: false, current: null, next: null };
  }
  // minutes from now until next change (null when no schedule at all)
  function minutesUntilNext(status, nowMin) {
    if (!status || !status.next) return null;
    return status.next.dayOffset * 1440 + (status.next.minutes - nowMin);
  }
  // per-window status for today's list: 'past' | 'ongoing' | 'upcoming'
  function windowDayStatus(w, nowMin) {
    if (nowMin >= toMinutes(w.end)) return 'past';
    if (nowMin >= toMinutes(w.start)) return 'ongoing';
    return 'upcoming';
  }
  // outage-log totals (minutes) for one area: today + this ISO week (Mon-Sun)
  function logTotals(log, areaId, asofISO) {
    const ws = weekStartISO(asofISO);
    const we = addDaysISO(ws, 6);
    let todayMin = 0, weekMin = 0;
    (log || []).forEach(function (e) {
      if (e.areaId !== areaId) return;
      const dur = toMinutes(e.end) - toMinutes(e.start);
      if (e.date === asofISO) todayMin += dur;
      if (e.date >= ws && e.date <= we) weekMin += dur;
    });
    return { todayMin: todayMin, weekMin: weekMin, weekStart: ws, weekEnd: we };
  }
  function logsFor(log, areaId) {
    return (log || [])
      .filter(function (e) { return !areaId || e.areaId === areaId; })
      .sort(function (a, b) {
        if (a.date !== b.date) return a.date < b.date ? 1 : -1;
        return toMinutes(a.start) < toMinutes(b.start) ? 1 : -1;
      });
  }

  // ---------- import / export ----------
  function exportPayload(areas, windows, log, asofISO) {
    return {
      app: APP_ID, version: 1,
      exportedAt: asofISO || todayISO(),
      areas: areas, windows: windows, log: log
    };
  }
  // STRICT: malformed -> { error:'importBad' }, existing data untouched by caller.
  function validateImport(payload, asofISO) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { error: 'importBad' };
    if (payload.app !== APP_ID) return { error: 'importBad' };
    if (!Array.isArray(payload.areas) || !Array.isArray(payload.windows) || !Array.isArray(payload.log)) {
      return { error: 'importBad' };
    }
    const seen = {};
    function checkId(id) {
      if (!trimStr(id) || seen[id]) return false;
      seen[id] = true;
      return true;
    }
    const areas = [];
    for (let i = 0; i < payload.areas.length; i++) {
      const a = payload.areas[i];
      if (!a || typeof a !== 'object') return { error: 'importBad' };
      if (!checkId(a.id) || validateArea(a).length) return { error: 'importBad' };
      areas.push({ id: trimStr(a.id), name: trimStr(a.name) });
    }
    const areaIds = {};
    areas.forEach(function (a) { areaIds[a.id] = true; });
    const windows = [];
    for (let i = 0; i < payload.windows.length; i++) {
      const w = payload.windows[i];
      if (!w || typeof w !== 'object') return { error: 'importBad' };
      if (!checkId(w.id) || !areaIds[w.areaId]) return { error: 'importBad' };
      if (validateWindow(w, windows).length) return { error: 'importBad' };
      windows.push({ id: trimStr(w.id), areaId: w.areaId, weekday: w.weekday,
        start: trimStr(w.start), end: trimStr(w.end) });
    }
    const log = [];
    for (let i = 0; i < payload.log.length; i++) {
      const e = payload.log[i];
      if (!e || typeof e !== 'object') return { error: 'importBad' };
      if (!checkId(e.id) || !areaIds[e.areaId]) return { error: 'importBad' };
      if (validateLogEntry(e, asofISO).length) return { error: 'importBad' };
      log.push({ id: trimStr(e.id), areaId: e.areaId, date: trimStr(e.date),
        start: trimStr(e.start), end: trimStr(e.end), note: trimStr(e.note) });
    }
    return { areas: areas, windows: windows, log: log };
  }

  // ---------- i18n ----------
  const EN_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const BN_WEEKDAYS = ["\u09b0\u09ac\u09bf\u09ac\u09be\u09b0", "\u09b8\u09cb\u09ae\u09ac\u09be\u09b0", "\u09ae\u0999\u09cd\u0997\u09b2\u09ac\u09be\u09b0", "\u09ac\u09c1\u09a7\u09ac\u09be\u09b0", "\u09ac\u09c3\u09b9\u09b8\u09cd\u09aa\u09a4\u09bf\u09ac\u09be\u09b0", "\u09b6\u09c1\u0995\u09cd\u09b0\u09ac\u09be\u09b0", "\u09b6\u09a8\u09bf\u09ac\u09be\u09b0"];
  // Display order: Saturday first (Bangladesh week starts Saturday)
  const DISPLAY_WEEKDAYS = [6, 0, 1, 2, 3, 4, 5];
  function fmtWeekday(wd, lang) {
    return lang === 'bn' ? BN_WEEKDAYS[wd] : EN_WEEKDAYS[wd];
  }
  const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                     'July', 'August', 'September', 'October', 'November', 'December'];
  const BN_MONTHS = ["\u099c\u09be\u09a8\u09c1\u09af\u09bc\u09be\u09b0\u09bf", "\u09ab\u09c7\u09ac\u09cd\u09b0\u09c1\u09af\u09bc\u09be\u09b0\u09bf", "\u09ae\u09be\u09b0\u09cd\u099a", "\u098f\u09aa\u09cd\u09b0\u09bf\u09b2", "\u09ae\u09c7", "\u099c\u09c1\u09a8", "\u099c\u09c1\u09b2\u09be\u0987", "\u0986\u0997\u09b8\u09cd\u099f", "\u09b8\u09c7\u09aa\u09cd\u099f\u09c7\u09ae\u09cd\u09ac\u09b0", "\u0985\u0995\u09cd\u099f\u09cb\u09ac\u09b0", "\u09a8\u09ad\u09c7\u09ae\u09cd\u09ac\u09b0", "\u09a1\u09bf\u09b8\u09c7\u09ae\u09cd\u09ac\u09b0"];
  function fmtDate(iso, lang) {
    const y = iso.slice(0, 4), m = Number(iso.slice(5, 7)), d = Number(iso.slice(8, 10));
    if (lang === 'bn') return bnDigits(d) + ' ' + BN_MONTHS[m - 1] + ' ' + bnDigits(y);
    return EN_MONTHS[m - 1] + ' ' + d + ', ' + y;
  }

  const I18N = {
    en: {
      appTitle: "Load Shedding Tracker",
      appSub: "Power outage schedule tracker -- 100% offline",
      tabStatus: "Live Status",
      tabSchedule: "Schedule",
      tabLog: "Outage Log",
      tabTools: "Tools",
      areasLabel: "Area",
      addArea: "Add area",
      areaName: "Area name",
      deleteArea: "Delete area",
      confirmDelArea: "Delete this area, its schedule and its log?",
      noAreas: "No areas yet. Add your first area!",
      selectAreaHint: "Select an area to see live status.",
      powerOn: "POWER ON",
      powerOff: "POWER OFF",
      outageNow: "Outage in progress",
      nextOffIn: "Power goes off in {n}",
      nextOnIn: "Power returns in {n}",
      noSchedule: "No outage scheduled for this area.",
      todayTitle: "Today's schedule",
      noWindowsToday: "No outages scheduled today.",
      weeklyTitle: "Weekly schedule",
      noWindows: "No windows scheduled.",
      addWindow: "Add window",
      weekdayLabel: "Day",
      startLabel: "Start",
      endLabel: "End",
      save: "Save",
      cancel: "Cancel",
      del: "Delete",
      edit: "Edit",
      logTitle: "Outage log",
      logOutage: "Log outage",
      dateLabel: "Date",
      noteLabel: "Note (optional)",
      noLog: "No outages logged yet.",
      totalToday: "Total outage today",
      totalWeek: "Total outage this week",
      weekRange: "Week: {a} - {b}",
      statusPast: "Past",
      statusOngoing: "Ongoing",
      statusUpcoming: "Upcoming",
      confirmDelWindow: "Delete this window?",
      confirmDelLog: "Delete this log entry?",
      toolsTitle: "Data tools",
      toolsSub: "Your data stays in this browser (localStorage).",
      export: "Export JSON",
      import: "Import JSON",
      clearAll: "Clear all data",
      confirmClear: "Delete ALL areas, schedules and logs? This cannot be undone.",
      imported: "Imported {n} area(s), {m} window(s), {k} log entries.",
      importBad: "Invalid file -- data left unchanged.",
      cleared: "All data cleared.",
      saved: "Saved.",
      deleted: "Deleted.",
      errAreaName: "Area name is required.",
      errTime: "Invalid time.",
      errEndAfterStart: "End must be after start.",
      errOverlap: "This window overlaps another window on the same day.",
      errDate: "Date cannot be in the future.",
      errArea: "Please select an area.",
      errWeekday: "Invalid day.",
      footer: "Personal tracker, not an official schedule."
    },
    bn: {
      "appTitle": "\u09b2\u09cb\u09a1\u09b6\u09c7\u09a1\u09bf\u0982 \u099f\u09cd\u09b0\u09cd\u09af\u09be\u0995\u09be\u09b0",
      "appSub": "\u09ac\u09bf\u09a6\u09cd\u09af\u09c1\u09ce \u09ac\u09bf\u09ad\u09cd\u09b0\u09be\u099f\u09c7\u09b0 \u09b8\u09ae\u09af\u09bc\u09b8\u09c2\u099a\u09bf \u099f\u09cd\u09b0\u09cd\u09af\u09be\u0995\u09be\u09b0 \u2014 \u09b8\u09ae\u09cd\u09aa\u09c2\u09b0\u09cd\u09a3 \u0985\u09ab\u09b2\u09be\u0987\u09a8",
      "tabStatus": "\u09b2\u09be\u0987\u09ad \u09b8\u09cd\u099f\u09cd\u09af\u09be\u099f\u09be\u09b8",
      "tabSchedule": "\u09b8\u09ae\u09af\u09bc\u09b8\u09c2\u099a\u09bf",
      "tabLog": "\u09ac\u09bf\u09ad\u09cd\u09b0\u09be\u099f \u09b2\u0997",
      "tabTools": "\u099f\u09c1\u09b2\u09b8",
      "areasLabel": "\u098f\u09b2\u09be\u0995\u09be",
      "addArea": "\u098f\u09b2\u09be\u0995\u09be \u09af\u09cb\u0997 \u0995\u09b0\u09c1\u09a8",
      "areaName": "\u098f\u09b2\u09be\u0995\u09be\u09b0 \u09a8\u09be\u09ae",
      "deleteArea": "\u098f\u09b2\u09be\u0995\u09be \u09ae\u09c1\u099b\u09c1\u09a8",
      "confirmDelArea": "\u098f\u0987 \u098f\u09b2\u09be\u0995\u09be, \u09a4\u09be\u09b0 \u09b8\u09ae\u09af\u09bc\u09b8\u09c2\u099a\u09bf \u0993 \u09b2\u0997 \u09ae\u09c1\u099b\u09c7 \u09ab\u09c7\u09b2\u09ac\u09c7\u09a8?",
      "noAreas": "\u098f\u0996\u09a8\u09cb \u0995\u09cb\u09a8\u09cb \u098f\u09b2\u09be\u0995\u09be \u09a8\u09c7\u0987\u0964 \u09aa\u09cd\u09b0\u09a5\u09ae \u098f\u09b2\u09be\u0995\u09be \u09af\u09cb\u0997 \u0995\u09b0\u09c1\u09a8!",
      "selectAreaHint": "\u09b2\u09be\u0987\u09ad \u09b8\u09cd\u099f\u09cd\u09af\u09be\u099f\u09be\u09b8 \u09a6\u09c7\u0996\u09a4\u09c7 \u098f\u0995\u099f\u09bf \u098f\u09b2\u09be\u0995\u09be \u09a8\u09bf\u09b0\u09cd\u09ac\u09be\u099a\u09a8 \u0995\u09b0\u09c1\u09a8\u0964",
      "powerOn": "\u09ac\u09bf\u09a6\u09cd\u09af\u09c1\u09ce \u0986\u099b\u09c7",
      "powerOff": "\u09ac\u09bf\u09a6\u09cd\u09af\u09c1\u09ce \u09a8\u09c7\u0987",
      "outageNow": "\u098f\u0996\u09a8 \u09ac\u09bf\u09ad\u09cd\u09b0\u09be\u099f \u099a\u09b2\u099b\u09c7",
      "nextOffIn": "\u09ac\u09bf\u09a6\u09cd\u09af\u09c1\u09ce \u09ac\u09a8\u09cd\u09a7 \u09b9\u09ac\u09c7 {n} \u09aa\u09b0\u09c7",
      "nextOnIn": "\u09ac\u09bf\u09a6\u09cd\u09af\u09c1\u09ce \u0986\u09b8\u09ac\u09c7 {n} \u09aa\u09b0\u09c7",
      "noSchedule": "\u098f\u0987 \u098f\u09b2\u09be\u0995\u09be\u09b0 \u099c\u09a8\u09cd\u09af \u0995\u09cb\u09a8\u09cb \u09ac\u09bf\u09ad\u09cd\u09b0\u09be\u099f \u09a8\u09bf\u09b0\u09cd\u09a7\u09be\u09b0\u09bf\u09a4 \u09a8\u09c7\u0987\u0964",
      "todayTitle": "\u0986\u099c\u0995\u09c7\u09b0 \u09b8\u09ae\u09af\u09bc\u09b8\u09c2\u099a\u09bf",
      "noWindowsToday": "\u0986\u099c \u0995\u09cb\u09a8\u09cb \u09ac\u09bf\u09ad\u09cd\u09b0\u09be\u099f \u09a8\u09bf\u09b0\u09cd\u09a7\u09be\u09b0\u09bf\u09a4 \u09a8\u09c7\u0987\u0964",
      "weeklyTitle": "\u09b8\u09be\u09aa\u09cd\u09a4\u09be\u09b9\u09bf\u0995 \u09b8\u09ae\u09af\u09bc\u09b8\u09c2\u099a\u09bf",
      "noWindows": "\u0995\u09cb\u09a8\u09cb \u09b8\u09ae\u09af\u09bc \u09a8\u09bf\u09b0\u09cd\u09a7\u09be\u09b0\u09bf\u09a4 \u09a8\u09c7\u0987\u0964",
      "addWindow": "\u09b8\u09ae\u09af\u09bc \u09af\u09cb\u0997 \u0995\u09b0\u09c1\u09a8",
      "weekdayLabel": "\u09a6\u09bf\u09a8",
      "startLabel": "\u09b6\u09c1\u09b0\u09c1",
      "endLabel": "\u09b6\u09c7\u09b7",
      "save": "\u09b8\u0982\u09b0\u0995\u09cd\u09b7\u09a3",
      "cancel": "\u09ac\u09be\u09a4\u09bf\u09b2",
      "del": "\u09ae\u09c1\u099b\u09c1\u09a8",
      "edit": "\u09b8\u09ae\u09cd\u09aa\u09be\u09a6\u09a8\u09be",
      "logTitle": "\u09ac\u09bf\u09ad\u09cd\u09b0\u09be\u099f \u09b2\u0997",
      "logOutage": "\u09ac\u09bf\u09ad\u09cd\u09b0\u09be\u099f \u09b2\u0997 \u0995\u09b0\u09c1\u09a8",
      "dateLabel": "\u09a4\u09be\u09b0\u09bf\u0996",
      "noteLabel": "\u09a8\u09cb\u099f (\u0990\u099a\u09cd\u099b\u09bf\u0995)",
      "noLog": "\u0995\u09cb\u09a8\u09cb \u09ac\u09bf\u09ad\u09cd\u09b0\u09be\u099f \u09b2\u0997 \u09b9\u09af\u09bc\u09a8\u09bf\u0964",
      "totalToday": "\u0986\u099c \u09ae\u09cb\u099f \u09ac\u09bf\u09ad\u09cd\u09b0\u09be\u099f",
      "totalWeek": "\u098f\u0987 \u09b8\u09aa\u09cd\u09a4\u09be\u09b9\u09c7 \u09ae\u09cb\u099f \u09ac\u09bf\u09ad\u09cd\u09b0\u09be\u099f",
      "weekRange": "\u09b8\u09aa\u09cd\u09a4\u09be\u09b9: {a} - {b}",
      "statusPast": "\u0985\u09a4\u09c0\u09a4",
      "statusOngoing": "\u099a\u09b2\u09ae\u09be\u09a8",
      "statusUpcoming": "\u0986\u09b8\u09a8\u09cd\u09a8",
      "confirmDelWindow": "\u098f\u0987 \u09b8\u09ae\u09af\u09bc\u099f\u09bf \u09ae\u09c1\u099b\u09c7 \u09ab\u09c7\u09b2\u09ac\u09c7\u09a8?",
      "confirmDelLog": "\u098f\u0987 \u09b2\u0997\u099f\u09bf \u09ae\u09c1\u099b\u09c7 \u09ab\u09c7\u09b2\u09ac\u09c7\u09a8?",
      "toolsTitle": "\u09a1\u09c7\u099f\u09be \u099f\u09c1\u09b2\u09b8",
      "toolsSub": "\u0986\u09aa\u09a8\u09be\u09b0 \u09a1\u09c7\u099f\u09be \u098f\u0987 \u09ac\u09cd\u09b0\u09be\u0989\u099c\u09be\u09b0\u09c7\u0987 \u09a5\u09be\u0995\u09c7 (localStorage)\u0964",
      "export": "\u098f\u0995\u09cd\u09b8\u09aa\u09cb\u09b0\u09cd\u099f (JSON)",
      "import": "\u0987\u09ae\u09aa\u09cb\u09b0\u09cd\u099f (JSON)",
      "clearAll": "\u09b8\u09ac \u09a1\u09c7\u099f\u09be \u09ae\u09c1\u099b\u09c1\u09a8",
      "confirmClear": "\u09b8\u09ac \u098f\u09b2\u09be\u0995\u09be, \u09b8\u09ae\u09af\u09bc\u09b8\u09c2\u099a\u09bf \u0993 \u09b2\u0997 \u09ae\u09c1\u099b\u09c7 \u09af\u09be\u09ac\u09c7\u0964 \u098f\u099f\u09bf \u09ab\u09c7\u09b0\u09be\u09a8\u09cb \u09af\u09be\u09ac\u09c7 \u09a8\u09be\u0964",
      "imported": "{n}\u099f\u09bf \u098f\u09b2\u09be\u0995\u09be, {m}\u099f\u09bf \u09b8\u09ae\u09af\u09bc \u0993 {k}\u099f\u09bf \u09b2\u0997 \u0987\u09ae\u09aa\u09cb\u09b0\u09cd\u099f \u09b9\u09af\u09bc\u09c7\u099b\u09c7\u0964",
      "importBad": "\u0985\u09ac\u09c8\u09a7 \u09ab\u09be\u0987\u09b2 \u2014 \u09a1\u09c7\u099f\u09be \u0985\u09aa\u09b0\u09bf\u09ac\u09b0\u09cd\u09a4\u09bf\u09a4 \u0986\u099b\u09c7\u0964",
      "cleared": "\u09b8\u09ac \u09a1\u09c7\u099f\u09be \u09ae\u09c1\u099b\u09c7 \u09ab\u09c7\u09b2\u09be \u09b9\u09af\u09bc\u09c7\u099b\u09c7\u0964",
      "saved": "\u09b8\u0982\u09b0\u0995\u09cd\u09b7\u09a3 \u0995\u09b0\u09be \u09b9\u09af\u09bc\u09c7\u099b\u09c7\u0964",
      "deleted": "\u09ae\u09c1\u099b\u09c7 \u09ab\u09c7\u09b2\u09be \u09b9\u09af\u09bc\u09c7\u099b\u09c7\u0964",
      "errAreaName": "\u098f\u09b2\u09be\u0995\u09be\u09b0 \u09a8\u09be\u09ae \u0986\u09ac\u09b6\u09cd\u09af\u0995\u0964",
      "errTime": "\u09b8\u09ae\u09af\u09bc \u09b8\u09a0\u09bf\u0995 \u09a8\u09af\u09bc\u0964",
      "errEndAfterStart": "\u09b6\u09c7\u09b7\u09c7\u09b0 \u09b8\u09ae\u09af\u09bc \u09b6\u09c1\u09b0\u09c1\u09b0 \u09aa\u09b0\u09c7 \u09b9\u09a4\u09c7 \u09b9\u09ac\u09c7\u0964",
      "errOverlap": "\u098f\u0987 \u09b8\u09ae\u09af\u09bc \u0985\u09a8\u09cd\u09af \u09b8\u09ae\u09af\u09bc\u09c7\u09b0 \u09b8\u09be\u09a5\u09c7 \u09ae\u09bf\u09b2\u09c7 \u09af\u09be\u099a\u09cd\u099b\u09c7\u0964",
      "errDate": "\u09a4\u09be\u09b0\u09bf\u0996 \u09ad\u09ac\u09bf\u09b7\u09cd\u09af\u09a4\u09c7 \u09b9\u09a4\u09c7 \u09aa\u09be\u09b0\u09ac\u09c7 \u09a8\u09be\u0964",
      "errArea": "\u098f\u09b2\u09be\u0995\u09be \u09a8\u09bf\u09b0\u09cd\u09ac\u09be\u099a\u09a8 \u0995\u09b09c\u09c1\u09a8\u0964",
      "errWeekday": "\u09a6\u09bf\u09a8 \u09b8\u09a0\u09bf\u0995 \u09a8\u09af\u09bc\u0964",
      "footer": "\u09ac\u09cd\u09af\u0995\u09cd\u09a4\u09bf\u0997\u09a4 \u099f\u09cd\u09b0\u09cd\u09af\u09be\u0995\u09be\u09b0 \u2014 \u0985\u09ab\u09bf\u09b8\u09bf\u09af\u09bc\u09be\u09b2 \u09b8\u09ae\u09af\u09bc\u09b8\u09c2\u099a\u09bf \u09a8\u09af\u09bc\u0964"
    }
  };
  function tr(lang, key, vars) {
    let s = (I18N[lang] && I18N[lang][key]) || I18N.en[key] || key;
    if (vars) Object.keys(vars).forEach(function (k) {
      s = s.split('{' + k + '}').join(String(vars[k]));
    });
    return s;
  }

  return {
    APP_ID, STORAGE_KEY, LANG_KEY,
    uid, trimStr, todayISO, isDate, isTime, toMinutes, fromMinutes,
    addDaysISO, weekdayOf, weekStartISO,
    bnDigits, fmtTime, fmtDuration, fmtInt,
    validateArea, validateWindow, validateLogEntry,
    windowsFor, statusAtArea, minutesUntilNext, windowDayStatus,
    logTotals, logsFor,
    exportPayload, validateImport,
    DISPLAY_WEEKDAYS, fmtWeekday, fmtDate,
    I18N, tr
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LoadShed;
}
