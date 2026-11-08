import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, utimes } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { pacificDay, nextPacificReset, recordTtsAttempt, recordTtsExhausted, ttsUsage } from '../tools/lib/tts-usage.mjs';
import { homeSnapshot, inspectLectureStatus, lectureSourceTime } from '../tools/lib/lecture-status.mjs';
import { readHomeMarks, updateHomeMarks } from '../tools/lib/home-marks.mjs';
import { geminiRequest } from '../tools/lib/gemini.mjs';
import { createStudioServer } from '../tools/server.mjs';
import { rank, HOME_COMMAND } from '../src/command-search.js';

async function temporary(run) { const root = await mkdtemp(join(tmpdir(), 'sakusura-home-test-')); try { await run(root); } finally { assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep)); await rm(root, { recursive: true, force: true }); } }
const model = 'gemini-3.8-flash-lite-tts';
test('Pacific midnight follows DST, including 23/25 hour days', () => {
  assert.equal(pacificDay(new Date('2026-11-07T07:59:59Z')), '2026-11-06');
  assert.equal(nextPacificReset(new Date('2026-11-07T08:00:00Z')), '2026-11-08T08:00:00.000Z');
  assert.equal(nextPacificReset(new Date('2026-03-08T08:00:00Z')), '2026-03-09T07:00:00.000Z');
  assert.equal(nextPacificReset(new Date('2026-11-01T07:00:00Z')), '2026-11-02T08:00:00.000Z');
});
test('usage survives concurrent writes, separates models/days and prioritizes 429', () => temporary(async root => {
  const file = join(root, 'usage.json'), now = new Date('2026-11-07T15:00:00Z');
  await Promise.all(Array.from({ length: 20 }, () => recordTtsAttempt(model, { file, now })));
  await recordTtsAttempt('other-tts', { file, now });
  await recordTtsExhausted(model, { file, day: pacificDay(now) });
  const view = await ttsUsage({ file, model, now }); assert.equal(view.current.count, 20); assert.equal(view.current.remaining, 0); assert.equal(view.current.exhausted, true); assert.equal(view.models[1].count, 1); assert.equal(view.models[1].limit, null);
  assert.equal((await ttsUsage({ file, model, now: new Date('2026-11-08T10:00:00Z') })).current.remaining, 100);
  await writeFile(file, '{broken'); await assert.rejects(ttsUsage({ file, model, now }), /記録/);
}));
test('counts real synthesis request attempts, including connection failures and HTTP 429, but not voice listing', () => temporary(async root => {
  const usageFile = join(root, 'usage.json'), original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('{}');
    await geminiRequest('voices', { key: 'test' });
    assert.equal((await ttsUsage({ file: usageFile, model })).current.count, 0);
    const body = { model, response_format: { type: 'audio' } };
    await geminiRequest('interactions', { key: 'test', body, usageFile });
    globalThis.fetch = async () => { throw new Error('secret error'); };
    await assert.rejects(geminiRequest('interactions', { key: 'test', body, usageFile }), /接続/);
    globalThis.fetch = async () => new Response('secret provider body', { status: 429 });
    await assert.rejects(geminiRequest('interactions', { key: 'test', body, usageFile }), error => /429/.test(error.message) && !/secret/.test(error.message));
    const view = await ttsUsage({ file: usageFile, model }); assert.equal(view.current.count, 3); assert.equal(view.current.exhausted, true);
    await assert.rejects(geminiRequest('interactions', { key: '', body, usageFile })); assert.equal((await ttsUsage({ file: usageFile, model })).current.count, 3);
  } finally { globalThis.fetch = original; }
}));
test('lecture states read image/audio/harness/export and imported share.json, excluding demos/trash', () => temporary(async root => {
  const directory = join(root, 'lectures', 'sample'), reports = join(root, 'reports', 'sample');
  await mkdir(join(directory, 'images'), { recursive: true }); await mkdir(reports, { recursive: true }); await mkdir(join(root, 'exports'));
  const lecture = { slides: [{ id: 's1', narration: 'hello', image: { file: 'missing.png' }, blocks: [], cues: [] }] }, config = { model, voice: { id: 'test' }, defaultStyle: '' };
  await writeFile(join(directory, 'lecture.json'), JSON.stringify(lecture));
  await writeFile(join(directory, 'share.json'), JSON.stringify({ version: 1, id: 'SKS-TEST-1234', revision: 3, author: '送り主', importedAt: '2026-11-07T12:00:00Z', inbox: true }));
  const item = { name: 'sample', title: 'Test', updatedAt: Date.now(), slides: 1 }, inspect = async () => ({ ready: false });
  let value = await inspectLectureStatus(item, { root, config, inspect }); assert.deepEqual(value.statuses, ['images', 'audio', 'validation']); assert.equal(value.share.revision, 3);
  await writeFile(join(directory, 'images', 'missing.png'), 'image'); await writeFile(join(reports, 'harness.json'), JSON.stringify({ passed: true }));
  const future = new Date(Date.now() + 1000); await utimes(join(reports, 'harness.json'), future, future);
  await writeFile(join(root, 'exports', 'sample_001.mp4'), 'video');
  const libraryStore = { snapshot: async () => ({ lectures: [item, { ...item, name: 'demo', demo: true }] }) };
  const snapshot = await homeSnapshot({ root, config, inspect: async () => ({ ready: true }), libraryStore }); assert.equal(snapshot.lectures.length, 1); assert.equal(snapshot.excludedDemos, 1); assert.equal(snapshot.counts.ready, 1); assert.equal(snapshot.counts.exported, 1); assert.equal(snapshot.imported[0].share.author, '送り主');
  const old = new Date(0); await utimes(join(reports, 'harness.json'), old, old); assert.deepEqual((await inspectLectureStatus(item, { root, config, inspect: async () => ({ ready: true }) })).statuses, ['validation']);
  await writeFile(join(directory, 'share.json'), JSON.stringify({ version: 1, id: 'SKS-TEST-1234' })); assert.equal((await inspectLectureStatus(item, { root, config, inspect })).share, null);
}));
test('manual marks: done lectures count as ready until edited, checked image jobs hide until the task changes', () => temporary(async root => {
  const directory = join(root, 'lectures', 'silent'), file = join(root, 'library', 'home-marks.json');
  await mkdir(join(directory, 'images'), { recursive: true });
  const config = { model, voice: { id: 'test' }, defaultStyle: '' }, item = { name: 'silent', title: 'Silent', updatedAt: Date.now(), slides: 1 };
  await writeFile(join(directory, 'lecture.json'), JSON.stringify({ slides: [{ id: 's1', narration: 'hello', blocks: [], cues: [] }] }));
  const inspect = async () => ({ ready: false });
  assert.deepEqual((await inspectLectureStatus(item, { root, config, inspect })).statuses, ['audio', 'validation']);
  const sourceTime = await lectureSourceTime('silent', undefined, root);
  await Promise.all([updateHomeMarks(marks => { marks.lectures.silent = { doneAt: '2026-11-08T00:00:00Z', sourceTime }; }, file), updateHomeMarks(marks => { marks.lectures.other = { doneAt: 'x', sourceTime: 1 }; }, file)]);
  const marks = await readHomeMarks(file); assert.ok(marks.lectures.silent && marks.lectures.other);
  const done = await inspectLectureStatus(item, { root, config, inspect, marks });
  assert.deepEqual(done.statuses, ['ready']); assert.deepEqual(done.manualDone.statuses, ['audio', 'validation']);
  const later = new Date(sourceTime + 5000); await utimes(join(directory, 'lecture.json'), later, later);
  assert.deepEqual((await inspectLectureStatus(item, { root, config, inspect, marks })).statuses, ['audio', 'validation']);
  await updateHomeMarks(value => { delete value.lectures.silent; }, file); assert.equal((await readHomeMarks(file)).lectures.silent, undefined);
  const task = { jobId: 'job-1', phase: 'failed', createdAt: '2026-10-25T00:00:00Z' };
  await writeFile(join(directory, 'images', 'ORCA_TASK.json'), JSON.stringify(task));
  const libraryStore = { snapshot: async () => ({ lectures: [item] }) };
  const jobsWith = async jobs => (await homeSnapshot({ root, config, inspect, libraryStore, overview: true, readMarks: async () => ({ version: 1, lectures: {}, jobs }) })).imageJobs.length;
  assert.equal(await jobsWith({}), 1);
  assert.equal(await jobsWith({ silent: { jobId: 'job-1', phase: 'failed' } }), 0);
  assert.equal(await jobsWith({ silent: { jobId: 'job-1', phase: 'launch-unknown' } }), 1);
  assert.equal(await jobsWith({ silent: { jobId: 'job-0', phase: 'failed' } }), 1);
}));
test('HOME mark API accepts only studio requests and valid lectures, writing to the given marks file', () => temporary(async root => {
  const homeMarksFile = join(root, 'home-marks.json');
  const server = await createStudioServer({ port: 0, homeMarksFile });
  const base = `http://127.0.0.1:${server.address().port}`, studio = { 'Content-Type': 'application/json', 'X-Studio-Editor': '1', Origin: base };
  const post = (path, body, headers = studio) => fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) });
  try {
    assert.equal((await post('/api/home/mark', { name: 'x', done: true }, { 'Content-Type': 'application/json' })).status, 403);
    assert.equal((await post('/api/home/mark', { name: 'x', done: true }, { ...studio, Origin: 'https://evil.example' })).status, 403);
    assert.equal((await post('/api/home/mark', { name: '../config', done: true })).status, 400);
    assert.equal((await post('/api/home/mark', { name: '__proto__', done: true })).status, 400);
    assert.equal((await post('/api/home/mark', { name: 'no-such-lecture-zz', done: true })).status, 404);
    assert.equal((await post('/api/home/job-check', { name: 'no-such-lecture-zz' })).status, 404);
    await assert.rejects(readFile(homeMarksFile, 'utf8'), { code: 'ENOENT' });
    assert.equal((await post('/api/home/mark', { name: 'no-such-lecture-zz', done: false })).status, 200);
    assert.deepEqual(JSON.parse(await readFile(homeMarksFile, 'utf8')), { version: 1, lectures: {}, jobs: {} });
  } finally { await new Promise(resolve => server.close(resolve)); }
}));
test('HTML imports use share.json and do not require external audio/images', () => temporary(async root => {
  const directory = join(root, 'lectures', 'html'); await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'html-deck.json'), '{}'); await writeFile(join(directory, 'slides.html'), '<html>');
  await writeFile(join(directory, 'share.json'), JSON.stringify({ version: 1, importedAt: '2026-11-07T00:00:00Z', author: '<script>' }));
  const result = await inspectLectureStatus({ name: 'html', format: 'html' }, { root }); assert.deepEqual(result.statuses, ['validation']); assert.equal(result.pendingAudio, 0); assert.equal(result.share.author, '<script>');
}));
test('HOME routes, navigation, palette and local-only usage data', async () => {
  const server = await createStudioServer({ port: 0, getHomeSnapshot: async () => ({ lectures: [] }), getTtsUsage: async () => ({ current: { count: 2 } }) });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const path of ['/', '/home']) { const response = await fetch(base + path); assert.equal(response.status, 200); assert.match(await response.text(), /src\/home.js/); }
    assert.equal((await (await fetch(base + '/api/home')).json()).usage.current.count, 2);
    assert.equal((await fetch(base + '/home-assets/studio-flow.webp')).headers.get('content-type'), 'image/webp');
    for (const path of ['/library', '/editor', '/design', '/design/new', '/design/detail', '/player', '/settings']) assert.match(await (await fetch(base + path)).text(), /href="\/home"/);
    assert.match(await (await fetch(base + '/?lecture=demo')).text(), /src\/player.js/);
    for (const path of ['/reports/tts-usage.json', '/reports/tts-usage.json.lock']) assert.equal((await fetch(base + path)).status, 404);
    assert.equal(rank([{ label: HOME_COMMAND[0], keywords: HOME_COMMAND[2] }], 'ダッシュボード').length, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
