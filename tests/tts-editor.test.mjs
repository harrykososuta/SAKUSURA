import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, rm, access, unlink, readdir } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ROOT, loadTtsConfig } from '../tools/lib/project.mjs';
import { readEditableLecture } from '../tools/lib/editor-store.mjs';
import { planTts, generateTts } from '../tools/lib/tts.mjs';
import { createTtsJobs } from '../tools/lib/tts-jobs.mjs';
import { inspectAudio } from '../tools/lib/cache.mjs';
import { pcmToWav } from '../tools/lib/wav.mjs';
import { createStudioServer } from '../tools/server.mjs';

async function fixture(run) {
  const name = `zz-tts-editor-${randomUUID().slice(0, 8)}`, root = join(ROOT, 'lectures', name);
  const lecture = JSON.parse(await readFile(join(ROOT, 'lectures/demo/lecture.json'), 'utf8'));
  lecture.slides[0].ttsText = '音声に使う読み仮名原稿';
  await mkdir(root); await writeFile(join(root, 'lecture.json'), JSON.stringify(lecture));
  try { await run({ name, root, lecture, revision: (await readEditableLecture(name)).revision }); }
  finally { assert.ok(resolve(root).startsWith(resolve(ROOT, 'lectures') + sep) && name.startsWith('zz-tts-editor-')); await rm(root, { recursive: true, force: true }); }
}
const wav = () => {
  const pcm = Buffer.alloc(24000 * 4 * 2);
  for (let i = 0; i < pcm.length / 2; i++) pcm.writeInt16LE(Math.round(Math.sin(i / 10) * 6000), i * 2);
  return pcmToWav(pcm);
};
async function finished(manager, name, id) {
  for (let i = 0; i < 100; i++) { const job = manager.get(name, id); if (job.state !== 'running') return job; await new Promise(resolve => setTimeout(resolve, 20)); }
  throw new Error('テスト用生成が完了しません');
}

test('TTSの確認はAPIを呼ばず、優先原稿の文字数と差分だけを返す', () => fixture(async ({ name, root, revision, lecture }) => {
  let generated = 0;
  const manager = createTtsJobs({ generate: async () => { generated++; }, keyAvailable: () => true });
  const summary = await manager.plan(name, { scope: 'slide', slideId: '001', revision });
  assert.equal(summary.count, 1); assert.equal(summary.characters, lecture.slides[0].ttsText.length);
  assert.equal(summary.voice, 'clonevoice'); assert.equal(summary.slides[0].page, 1);
  assert.equal('config' in summary, false); assert.equal('text' in summary.slides[0], false);
  await assert.rejects(access(join(root, 'audio')));
  assert.equal(generated, 0);
  await assert.rejects(manager.plan(name, { scope: 'slide', revision }), /範囲/);
  await assert.rejects(manager.start(name, { token: '未確認', revision }), /確認期限/);
  await writeFile(join(root, 'lecture.json'), JSON.stringify({ ...lecture, title: '外部の変更' }));
  await assert.rejects(manager.start(name, { token: summary.token, revision }), /変更されました/);
  assert.equal(generated, 0);
}));

test('承認したスライドだけを生成し、キャッシュ・CLI共通ロック・APIキー未設定を扱う', () => fixture(async ({ name, root, revision, lecture }) => {
  const calls = [];
  const manager = createTtsJobs({ keyAvailable: () => true, generate: (plan, options) => generateTts(plan, { ...options, synthesizeAudio: async input => { calls.push(input); return wav(); } }) });
  const plan = await manager.plan(name, { scope: 'slide', slideId: '001', revision });
  const job = await manager.start(name, { token: plan.token, revision });
  assert.equal((await finished(manager, name, job.id)).state, 'completed');
  assert.equal(calls.length, 1); assert.equal(calls[0].text, '音声に使う読み仮名原稿');
  assert.equal(calls[0].voice, (await loadTtsConfig()).voice.id);
  assert.equal((await manager.plan(name, { scope: 'slide', slideId: '001', revision })).count, 0);
  assert.equal((await manager.plan(name, { scope: 'changed', revision })).count, 2);
  await assert.rejects(access(join(root, 'audio/002.wav')));
  const next = await planTts(name, { slideId: '002' });
  await writeFile(join(root, 'audio/.tts.lock'), '');
  await assert.rejects(generateTts(next, { synthesizeAudio: async () => { throw new Error('呼ばれてはいけません'); } }), /実行中/);
  await unlink(join(root, 'audio/.tts.lock'));
  const noKey = createTtsJobs({ keyAvailable: () => false });
  const missing = await noKey.plan(name, { scope: 'slide', slideId: '002', revision });
  await assert.rejects(noKey.start(name, { token: missing.token, revision }), /APIキーが未設定/);
  assert.equal((await inspectAudio(name, next.pending[0], next.config)).ready, false);
  const previousWav = await readFile(join(root, 'audio/001.wav')), previousMetadata = await readFile(join(root, 'audio/001.json'));
  lecture.slides[0].ttsText = '更新した原稿のテスト'; await writeFile(join(root, 'lecture.json'), JSON.stringify(lecture));
  const current = (await readEditableLecture(name)).revision;
  const update = await manager.plan(name, { scope: 'slide', slideId: '001', revision: current });
  const updated = await manager.start(name, { token: update.token, revision: current });
  assert.equal((await finished(manager, name, updated.id)).state, 'completed');
  const backups = await readdir(join(root, 'audio/backups'));
  assert.deepEqual(await readFile(join(root, 'audio/backups', backups.find(f => f.endsWith('.wav')))), previousWav);
  assert.deepEqual(await readFile(join(root, 'audio/backups', backups.find(f => f.endsWith('.json')))), previousMetadata);
}));

test('二重開始と空欄を拒否し、失敗本文をブラウザへ返さない', () => fixture(async ({ name, root, lecture, revision }) => {
  let release;
  const manager = createTtsJobs({ keyAvailable: () => true, generate: () => new Promise((_, reject) => { release = () => reject(new Error('非公開のAPIエラー本文')); }) });
  const plan = await manager.plan(name, { scope: 'slide', slideId: '001', revision });
  const jobs = await Promise.allSettled([manager.start(name, { token: plan.token, revision }), manager.start(name, { token: plan.token, revision })]);
  assert.equal(jobs.filter(j => j.status === 'fulfilled').length, 1);
  const job = jobs.find(j => j.status === 'fulfilled').value;
  await assert.rejects(manager.plan(name, { scope: 'changed', revision }), /生成中/);
  release(); const result = await finished(manager, name, job.id);
  assert.equal(result.state, 'failed'); assert.doesNotMatch(JSON.stringify(result), /非公開/); assert.match(result.error, /自動再試行はしていません/);
  lecture.slides[0].ttsText = '';
  await writeFile(join(root, 'lecture.json'), JSON.stringify(lecture));
  const current = (await readEditableLecture(name)).revision;
  const empty = await manager.plan(name, { scope: 'slide', slideId: '001', revision: current });
  assert.deepEqual(empty.empty, ['001']);
  await assert.rejects(manager.start(name, { token: empty.token, revision: current }), /空欄/);
}));

test('音声生成APIは同一Originと専用ヘッダーを要求する', () => fixture(async ({ name, revision }) => {
  let started = false;
  const manager = createTtsJobs({ keyAvailable: () => true, generate: async () => { started = true; } });
  const server = await createStudioServer({ port: 0, ttsJobs: manager });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const url = `${base}/api/tts/plan?name=${name}`;
    const body = JSON.stringify({ revision, scope: 'slide', slideId: '001' });
    assert.equal((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).status, 403);
    const response = await fetch(url, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', 'X-Studio-Editor': '1' }, body });
    assert.equal(response.status, 200); assert.equal((await response.json()).count, 1);
    assert.equal(started, false);
    assert.equal((await (await fetch(`${base}/api/tts/job?name=${name}`)).json()).job, null);
  } finally { await new Promise(resolve => server.close(resolve)); }
}));
