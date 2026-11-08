import test from 'node:test';
import assert from 'node:assert/strict';
import { jobLine, relative } from '../src/job-format.js';
import { createStudioServer } from '../tools/server.mjs';
import { createRenderJobs } from '../tools/lib/render-jobs.mjs';

test('作業状況の1行：進み具合・完了からの時間・出力先・失敗の理由を出す', () => {
  const now = 10 * 60000;
  assert.equal(jobLine({ kind: 'render', state: 'running', count: 4, completed: 1, step: '撮影 002' }, now), '書き出し中 25%（撮影 002）');
  assert.equal(jobLine({ kind: 'tts', state: 'running', count: 12, completed: 5 }, now), '生成中 5 / 12枚');
  assert.equal(jobLine({ kind: 'render', state: 'completed', finishedAt: now - 3 * 60000, output: 'exports/a_001.mp4' }, now), '完了・3分前：exports/a_001.mp4');
  assert.equal(jobLine({ kind: 'tts', state: 'failed', finishedAt: now, error: 'APIキーを確認' }, now), '失敗・たった今：APIキーを確認');
  assert.deepEqual([30000, 5 * 60000, 2 * 3600000, 50 * 3600000].map(relative), ['たった今', '5分前', '2時間前', '2日前']);
});

test('/api/jobs は書き出し・音声生成を新しい順にまとめ、開始と終了の時刻を返す', async () => {
  let finish;
  const renderJobs = createRenderJobs({ precheck: async () => ({ count: 2 }), render: (name, { log }) => new Promise(resolve => { log('撮影 001（1画面）'); finish = () => resolve({ output: `exports/${name}_001.mp4`, seconds: 5 }); }) });
  const ttsJobs = { list: () => [{ kind: 'tts', id: 't1', name: 'old', state: 'completed', count: 3, completed: 3, startedAt: 1, finishedAt: 2 }] };
  const server = await createStudioServer({ port: 0, renderJobs, ttsJobs });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await renderJobs.start('demo');
    let { jobs } = await (await fetch(`${base}/api/jobs`)).json();
    assert.deepEqual(jobs.map(job => [job.kind, job.name, job.state]), [['render', 'demo', 'running'], ['tts', 'old', 'completed']]);
    assert.ok(jobs[0].startedAt > 0); assert.equal(jobs[0].finishedAt, null);
    finish(); await new Promise(resolve => setTimeout(resolve, 20));
    ({ jobs } = await (await fetch(`${base}/api/jobs`)).json());
    assert.equal(jobs[0].state, 'completed'); assert.ok(jobs[0].finishedAt >= jobs[0].startedAt); assert.equal(jobs[0].output, 'exports/demo_001.mp4');
  } finally { await new Promise(resolve => server.close(resolve)); }
});
