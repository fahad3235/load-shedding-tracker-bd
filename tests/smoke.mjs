/* load-shedding-tracker-bd smoke tests -- headless Chromium via puppeteer-core.
   Run: NODE_PATH=../job-application-tracker-bd/node_modules node tests/smoke.mjs */
import puppeteer from 'puppeteer-core';

const BASE = 'file:///home/hatch/workspace/muse-project-factory/builds/load-shedding-tracker-bd/index.html';
const APP = BASE + '?asof=2026-10-14&time=09:00'; // Wednesday 09:00

let pass = 0, fail = 0;
function eq(name, actual, expected) {
  if (actual === expected) { pass++; }
  else { fail++; console.log('FAIL', name, '| actual:', JSON.stringify(actual), '| expected:', JSON.stringify(expected)); }
}
function ok(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.log('FAIL', name); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: '/opt/meta-chromium/chrome',
  headless: 'new',
  args: ['--no-sandbox', '--no-proxy-server', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
page.on('dialog', d => d.accept());
const consoleErrors = [], pageErrors = [];
let netRequests = 0;
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', e => pageErrors.push(String(e)));
page.on('request', r => { if (!r.url().startsWith('data:') && !r.url().startsWith('file:')) netRequests++; });

await page.goto(APP, { waitUntil: 'load' });
await page.waitForFunction(() => window.__LST_READY === true, { timeout: 8000 });

// 1. render + empty states
eq('asof honored', await page.evaluate(() => window.__LST_state().asof), '2026-10-14');
eq('h1 title', await page.$eval('#h-title', el => el.textContent.trim()), 'Load Shedding Tracker');
eq('lang button shows Bangla label', await page.$eval('#langBtn', el => el.textContent.trim()), '\u09ac\u09be\u0982\u09b2\u09be');
ok('empty areas hint', (await page.$eval('#todayList', el => el.textContent)).includes('Select an area'));
eq('add area form hidden initially', await page.evaluate(() => document.querySelector('#areaForm').hidden), true);

// 2. add area via UI
await page.click('#btnAddArea');
await page.type('#f-area-name', 'Home');
await page.click('#btnSaveArea');
await sleep(300);
eq('area added', await page.evaluate(() => window.__LST_state().areas.length), 1);
eq('area name', await page.evaluate(() => window.__LST_state().areas[0].name), 'Home');
eq('status shows POWER ON (no schedule)', await page.$eval('#statusBadge', el => el.textContent.trim()), 'POWER ON');
ok('no-schedule message', (await page.$eval('#statusSub', el => el.textContent)).includes('No outage scheduled'));

// 3. add window on Wednesday (schedule tab; Wednesday is the asof day)
await page.click('#tabSchedule');
await sleep(300);
// Wednesday chip: display order Sat, Sun, Mon, Tue, Wed -> index 4
await page.evaluate(() => { document.querySelectorAll('#dayChips .daychip')[4].click(); });
await sleep(200);
await page.evaluate(() => {
  document.querySelector('#f-win-start').value = '10:00';
  document.querySelector('#f-win-end').value = '12:00';
});
await page.click('#btnSaveWindow');
await sleep(300);
eq('window added', await page.evaluate(() => window.__LST_state().windows.length), 1);
ok('window in day list', (await page.$eval('#winList', el => el.textContent)).includes('10:00'));
ok('window in weekly grid', (await page.$eval('#weeklyGrid', el => el.textContent)).includes('10:00'));

// 4. live status at 09:00 -> ON, countdown 1h
await page.click('#tabStatus');
await sleep(300);
eq('status ON at 09:00', await page.$eval('#statusBadge', el => el.textContent.trim()), 'POWER ON');
ok('countdown 1h', (await page.$eval('#statusSub', el => el.textContent)).includes('1h'));
ok('today list shows window', (await page.$eval('#todayList', el => el.textContent)).includes('10:00'));

// 5. reload at 11:00 -> OFF, returns in 1h (localStorage persists)
await page.goto(BASE + '?asof=2026-10-14&time=11:00', { waitUntil: 'load' });
await page.waitForFunction(() => window.__LST_READY === true, { timeout: 8000 });
await sleep(300);
eq('areas persisted', await page.evaluate(() => window.__LST_state().areas.length), 1);
eq('status OFF at 11:00', await page.$eval('#statusBadge', el => el.textContent.trim()), 'POWER OFF');
ok('return countdown 1h', (await page.$eval('#statusSub', el => el.textContent)).includes('1h'));
ok('today list marks ongoing', (await page.$eval('#todayList', el => el.textContent)).includes('Ongoing'));

// 6. back to 09:00, overlap rejected inline
await page.goto(APP, { waitUntil: 'load' });
await page.waitForFunction(() => window.__LST_READY === true, { timeout: 8000 });
await page.click('#tabSchedule');
await sleep(300);
await page.evaluate(() => { document.querySelectorAll('#dayChips .daychip')[4].click(); });
await sleep(200);
await page.evaluate(() => {
  document.querySelector('#f-win-start').value = '11:00';
  document.querySelector('#f-win-end').value = '13:00';
});
await page.click('#btnSaveWindow');
await sleep(300);
ok('overlap error shown', (await page.$eval('#winErr', el => el.textContent)).length > 0);
eq('overlap not saved', await page.evaluate(() => window.__LST_state().windows.length), 1);
// end <= start rejected
await page.evaluate(() => {
  document.querySelector('#f-win-start').value = '13:00';
  document.querySelector('#f-win-end').value = '12:00';
});
await page.click('#btnSaveWindow');
await sleep(300);
ok('end<=start error shown', (await page.$eval('#winErr', el => el.textContent)).includes('after start'));
eq('bad window not saved', await page.evaluate(() => window.__LST_state().windows.length), 1);
// touching window allowed: 12:00-13:00
await page.evaluate(() => {
  document.querySelector('#f-win-start').value = '12:00';
  document.querySelector('#f-win-end').value = '13:00';
});
await page.click('#btnSaveWindow');
await sleep(300);
eq('touching window saved', await page.evaluate(() => window.__LST_state().windows.length), 2);

// 7. log entry + totals
await page.click('#tabLog');
await sleep(300);
await page.evaluate(() => {
  document.querySelector('#f-log-date').value = '2026-10-14';
  document.querySelector('#f-log-start').value = '10:00';
  document.querySelector('#f-log-end').value = '11:30';
  document.querySelector('#f-log-note').value = 'test outage';
});
await page.click('#btnSaveLog');
await sleep(300);
eq('log entry saved', await page.evaluate(() => window.__LST_state().log.length), 1);
eq('today total 1h 30m', await page.$eval('#v-today', el => el.textContent.trim()), '1h 30m');
eq('week total 1h 30m', await page.$eval('#v-week', el => el.textContent.trim()), '1h 30m');
ok('log row shows note', (await page.$eval('#logList', el => el.textContent)).includes('test outage'));
// future log date rejected
await page.evaluate(() => { document.querySelector('#f-log-date').value = '2026-10-15'; });
await page.click('#btnSaveLog');
await sleep(300);
ok('future log date error', (await page.$eval('#logErr', el => el.textContent)).length > 0);
eq('future log not saved', await page.evaluate(() => window.__LST_state().log.length), 1);

// 8. BN toggle: labels localize, Bengali digits in totals
await page.click('#langBtn');
await sleep(300);
eq('title in Bangla', await page.$eval('#h-title', el => el.textContent.trim()), '\u09b2\u09cb\u09a1\u09b6\u09c7\u09a1\u09bf\u0982 \u099f\u09cd\u09b0\u09cd\u09af\u09be\u0995\u09be\u09b0');
eq('today total Bangla digits', await page.$eval('#v-today', el => el.textContent.trim()), '\u09e7\u0998 \u09e9\u09e6\u09ae\u09bf');
await page.click('#langBtn');
await sleep(300);
eq('title back to English', await page.$eval('#h-title', el => el.textContent.trim()), 'Load Shedding Tracker');

// 9. export/import round-trip via hook
const payloadJson = await page.evaluate(() => JSON.stringify({
  app: 'load-shedding-tracker-bd', version: 1, exportedAt: '2026-10-14',
  areas: [{ id: 'a9', name: 'Office' }],
  windows: [{ id: 'w9', areaId: 'a9', weekday: 0, start: '09:00', end: '10:00' }],
  log: [{ id: 'l9', areaId: 'a9', date: '2026-10-14', start: '09:00', end: '09:30', note: '' }]
}));
await page.click('#tabTools');
await sleep(200);
const impRes = await page.evaluate(j => window.__LST_import(j), payloadJson);
eq('import ok', impRes.ok, true);
await sleep(300);
eq('areas replaced by import', await page.evaluate(() => window.__LST_state().areas.length), 1);
eq('imported area name', await page.evaluate(() => window.__LST_state().areas[0].name), 'Office');
ok('imported toast', (await page.$eval('#toast', el => el.textContent)).includes('Imported'));

// 10. malformed import rejected, data intact
const badRes = await page.evaluate(() => window.__LST_import('{"app":"nope"}'));
eq('malformed import rejected', badRes.ok, false);
await sleep(200);
eq('data intact after bad import', await page.evaluate(() => window.__LST_state().areas.length), 1);

// 11. clear-all wipes everything
await page.click('#btnClear');
await sleep(400);
eq('clear-all wipes areas', await page.evaluate(() => window.__LST_state().areas.length), 0);
eq('clear-all wipes windows', await page.evaluate(() => window.__LST_state().windows.length), 0);
eq('clear-all wipes log', await page.evaluate(() => window.__LST_state().log.length), 0);

// 12. mobile 390px -- no horizontal overflow
await page.setViewport({ width: 390, height: 844 });
await sleep(300);
await page.click('#tabStatus');
await sleep(300);
eq('no overflow on status at 390px', await page.evaluate(() => document.documentElement.scrollWidth <= 390), true);
await page.click('#tabSchedule');
await sleep(300);
eq('no overflow on schedule at 390px', await page.evaluate(() => document.documentElement.scrollWidth <= 390), true);
await page.click('#tabLog');
await sleep(300);
eq('no overflow on log at 390px', await page.evaluate(() => document.documentElement.scrollWidth <= 390), true);

// 13. errors & network
eq('console errors', consoleErrors.length, 0);
eq('page errors', pageErrors.length, 0);
eq('network requests (file/data only)', netRequests, 0);

await browser.close();
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
