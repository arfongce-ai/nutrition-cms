import test from 'node:test';
import assert from 'node:assert/strict';
import { diaryStats, dateKey, periodBounds, periodFeedback, readJournal, saveJournalDay } from '../src/services/diaryInsights.js';
import { exifLocalTime, readPhotoTiming } from '../src/services/photoTiming.js';
import { collectNutritionUpdates, parseWhoGuide, fetchPubMed } from '../functions/api/nutrition-updates.js';
import { build } from 'esbuild';

const meal = (time, calories = 300) => ({ mealId: time, createdAt: time, items: [{ foodName: '밥', nutrients: { calories } }], totals: { calories, carb: 40, protein: 10, fat: 5, sodium: 100, sugar: 3 } });
const now = new Date('2026-09-15T18:00:00');
test('calendar weeks cross month boundaries and cap the current week at now', () => {
  const week = periodBounds('week', '2026-09-01', now);
  assert.equal(dateKey(week.start), '2026-08-31');
  assert.equal(dateKey(week.end), '2026-09-06');
  assert.equal(week.days.length, 7);
  assert.equal(periodBounds('week', '2026-09-15', now).days.length, 2);
});
test('calendar handles leap day, past months and future months', () => {
  assert.equal(periodBounds('month', '2024-02-15', now).days.length, 29);
  assert.equal(periodBounds('month', '2026-09-15', now).days.length, 15);
  assert.equal(periodBounds('month', '2026-10-01', now).days.length, 0);
});
test('averages exclude missing days; known zero and unknown calories remain distinguishable', () => {
  const rows = [meal('2026-09-01T23:59:00', 600), meal('2026-09-02T00:00:00', 0), meal('2026-09-16T12:00:00', 900), meal('invalid', 800)];
  const stats = diaryStats(rows, 'month', '2026-09-15', now);
  assert.equal(stats.dailyAverage, 300);
  assert.equal(stats.recordedDays, 2);
  assert.equal(stats.chartDays[1].recorded, true);
  assert.equal(stats.chartDays[2].recorded, false);
  rows[0].items[0].isPendingInfo = true;
  assert.ok(diaryStats(rows, 'month', '2026-09-15', now).totals.missingNutrients.includes('calories'));
});
test('moving a meal between dates changes day and month membership', () => {
  const row = meal('2026-09-01T00:01:00');
  assert.equal(diaryStats([row], 'today', '2026-09-01', now).mealCount, 1);
  row.createdAt = '2026-08-31T23:59:00';
  assert.equal(diaryStats([row], 'month', '2026-09-01', now).mealCount, 0);
  assert.equal(diaryStats([row], 'month', '2026-08-31', now).mealCount, 1);
});
test('EXIF uses camera wall time and validates malformed and missing timestamps', async () => {
  assert.equal(exifLocalTime('2026:09:02 08:12:33'), '2026-09-02T08:12');
  for (const value of ['2026:02:30 08:00:00', '2026:09:01 28:00:00', '', null]) assert.equal(exifLocalTime(value), '');
  const timing = await readPhotoTiming(new Blob(['invalid image']), now);
  assert.equal(timing.timeSource, 'manual');
  assert.equal(timing.timeConfirmed, false);
  const tiff = Buffer.alloc(64);
  tiff.write('II'); tiff.writeUInt16LE(42, 2); tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8); tiff.writeUInt16LE(0x8769, 10); tiff.writeUInt16LE(4, 12); tiff.writeUInt32LE(1, 14); tiff.writeUInt32LE(26, 18);
  tiff.writeUInt16LE(1, 26); tiff.writeUInt16LE(0x9003, 28); tiff.writeUInt16LE(2, 30); tiff.writeUInt32LE(20, 32); tiff.writeUInt32LE(44, 36);
  tiff.write('2026:09:02 08:12:33\0', 44);
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0, 72]), Buffer.from('Exif\0\0'), tiff, Buffer.from([0xff, 0xd9])]);
  const fromExif = await readPhotoTiming(jpeg, now);
  assert.equal(fromExif.dateTime, '2026-09-02T08:12');
  assert.equal(fromExif.timeSource, 'exif');
});
function memoryStorage() { const data = new Map(); return { getItem: (k) => data.get(k) || null, setItem: (k, v) => data.set(k, v) }; }
test('journal persists notes and water without deleting previous dates', () => {
  const storage = memoryStorage();
  saveJournalDay('2026-09-01', { note: '산책', waterMl: 200, waterRecorded: true, foodGroups: ['fruit'], complete: true }, storage);
  saveJournalDay('2026-09-02', { note: '수영', waterMl: 0 }, storage);
  assert.equal(readJournal(storage)['2026-09-01'].note, '산책');
  assert.equal(readJournal(storage)['2026-09-02'].waterRecorded, false);
  assert.throws(() => saveJournalDay('2026-09-03', { waterMl: -10 }, storage));
  assert.throws(() => saveJournalDay('2026-09-03', { waterMl: 100 }, { ...storage, setItem() { throw Error('quota'); } }));
});
test('feedback discloses partial days and missing nutrition instead of diagnosing deficiency', () => {
  const row = meal('2026-09-01T12:00:00'); row.items[0].isPendingInfo = true;
  const stats = diaryStats([row], 'month', '2026-09-15', now);
  const feedback = periodFeedback(stats, {}).join(' ');
  assert.match(feedback, /일부만 기록/);
  assert.match(feedback, /잠정적/);
  assert.match(feedback, /물 기록/);
  assert.match(periodFeedback(diaryStats([], 'week', '2026-09-15', now), {}).join(''), /아직 식사 기록이 없어요/);
});
test('source parser rejects layout changes instead of fabricating an update date', () => {
  assert.equal(parseWhoGuide('<h1>Healthy diet</h1>{"dateModified":"2026-01-26T16:40:58Z"}')[0].publishedAt, '2026-01-26');
  assert.throws(() => parseWhoGuide('<html>access denied</html>'));
});
test('updater keeps successful sources when another is blocked', async () => {
  const data = await collectNutritionUpdates(async (url) => url.includes('who.int') ? new Response('<h1>Healthy diet</h1>{"dateModified":"2026-01-26"}') : new Response('blocked', { status: 403 }), now);
  assert.equal(data.sources[0].status, 'fresh');
  assert.equal(data.sources[1].status, 'unavailable');
  assert.equal(data.sources[1].checkedAt, null);
  assert.equal(data.sources[1].items.length, 0);
});
test('PubMed uses publication bounds, strips markup, and links primary records', async () => {
  const urls = [];
  const items = await fetchPubMed(async (url) => {
    urls.push(new URL(url));
    return Response.json(url.includes('esearch') ? { esearchresult: { idlist: ['1234'] } } : { result: { '1234': { uid: '1234', title: '<i>Dietary</i> review', pubdate: '2026 Sep 1', fulljournalname: 'Journal' } } });
  }, now);
  assert.equal(items[0].url, 'https://pubmed.ncbi.nlm.nih.gov/1234/');
  assert.equal(items[0].title, 'Dietary review');
  assert.match(urls[0].searchParams.get('term'), /2026\/09\/15/);
  await assert.rejects(() => fetchPubMed(async () => Response.json({ error: 'rate limit' })));
});

test('store preserves past consumption time, keeps over 120 meals, and updates calendar date', async () => {
  const bundle = await build({ entryPoints: ['src/services/reportStore.js'], bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent', plugins: [{ name: 'local-only', setup(b) {
    b.onResolve({ filter: /^\.\.\/firebase$/ }, () => ({ path: 'local-only', namespace: 'test' }));
    b.onResolve({ filter: /^firebase\// }, () => ({ path: 'sdk', namespace: 'test' }));
    b.onLoad({ filter: /.*/, namespace: 'test' }, (args) => ({ contents: args.path === 'local-only' ? 'export const auth=null, db=null, firebaseEnabled=false;' : 'export const deleteDoc=()=>{}, doc=()=>{}, getDoc=()=>{}, serverTimestamp=()=>{}, setDoc=()=>{}, updateDoc=()=>{}, signInAnonymously=()=>{};', loader: 'js' }));
  } }] });
  const store = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
  const originalStorage = globalThis.localStorage;
  globalThis.localStorage = memoryStorage();
  try {
    globalThis.localStorage.setItem('nutritionReports.v1', JSON.stringify(Array.from({ length: 121 }, (_, i) => ({ ...meal('2026-08-01T12:00:00'), mealId: `old-${i}` }))));
    const report = { items: [{ name: '밥', calories: 300, carb: 50, protein: 4, fat: 1, grams: 100 }], profile: { mode: 'adult' }, totals: { calories: 300, carb: 50, protein: 4, fat: 1 } };
    const result = await store.saveNutritionReport(report, { createdAt: '2026-09-01T08:00:00+09:00', mealType: '아침' });
    assert.equal(result.saved, true);
    let rows = store.readLocalReports();
    assert.equal(rows.length, 122);
    assert.equal(rows[0].createdAt, '2026-08-31T23:00:00.000Z');
    assert.notEqual(rows[0].recordedAt, rows[0].createdAt);
    assert.equal((await store.updateNutritionReport(result.mealId, { createdAt: '2026-08-01T10:00:00Z' })).success, true);
    assert.equal(store.readLocalReports()[0].createdAt, '2026-08-01T10:00:00.000Z');
    assert.equal((await store.saveNutritionReport(report, { createdAt: '2100-01-01' })).saved, false);
    assert.equal(store.readLocalReports().length, 122);
  } finally { if (originalStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = originalStorage; }
});
