// TTSのAPIキーを登録しない人向けの無音制作：表示時間の決め方・書き出しジョブの受け渡し・作成依頼のフック。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT } from '../tools/lib/project.mjs';
import { silentSeconds, retime, SPEECH_RATE } from '../tools/timing.mjs';
import { createRenderJobs } from '../tools/lib/render-jobs.mjs';
import { createStudioServer } from '../tools/server.mjs';

test('無音の表示時間：原稿の文字数（空白を除く）÷ 約5.1文字/秒、短い原稿も4秒以上', () => {
  assert.equal(SPEECH_RATE, 5.1);
  assert.equal(silentSeconds({ narration: 'あ'.repeat(102) }), 20);
  assert.equal(silentSeconds({ narration: 'あ い\nう' }), 4);
  // 読み補助原稿（ttsText）があれば、実際に読む原稿で測る。
  assert.equal(silentSeconds({ narration: '短い', ttsText: 'あ'.repeat(51) }), 10);
});
test('無音の表示時間を変えると、cue を同じ比率で動かし、終わりの0.5秒前までに収める', () => {
  const slide = retime({ plannedSeconds: 50, cues: [{ at: 0, target: 'a' }, { at: 25, target: 'b' }, { at: 49.9, target: 'c' }] }, 10);
  assert.equal(slide.plannedSeconds, 10);
  assert.deepEqual(slide.cues.map(cue => cue.at), [0, 5, 9.5]);
});
test('書き出しジョブ：無音の指定を確認と書き出しへ渡し、結果にも残す', async () => {
  const calls = [];
  const jobs = createRenderJobs({ precheck: async (name, options) => { calls.push(['check', options.silent]); return { count: 2 }; }, render: async (name, options) => { calls.push(['render', options.silent]); return { output: join(ROOT, 'exports', `${name}_001.mp4`), seconds: 3 }; } });
  const job = await jobs.start('demo', { silent: true });
  assert.equal(job.silent, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [['check', true], ['render', true]]);
  assert.equal(jobs.get('demo').state, 'completed');
});
test('再生画面の書き出しAPI：silent=1 のときだけ無音で書き出す', async () => {
  const requests = [];
  const renderJobs = { start: async (name, options) => { requests.push(options.silent); return { id: 'x', name, state: 'running' }; }, get: () => null };
  const server = await createStudioServer({ port: 0, renderJobs });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = path => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Editor': '1', Origin: base }, body: '{}' });
  try {
    assert.equal((await post('/api/render/start?name=demo')).status, 202);
    assert.equal((await post('/api/render/start?name=demo&silent=1')).status, 202);
    assert.deepEqual(requests, [false, true]);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test('作成依頼のフック：作成の依頼にだけ、デザインの確認・代替案・TTSの登録状況を伝える', () => {
  const hook = prompt => spawnSync(process.execPath, ['tools/hooks/design-reminder.mjs'], { cwd: ROOT, input: JSON.stringify({ prompt }), encoding: 'utf8' });
  const created = hook('input に置いたワードで演題番号17のスライドを作成して');
  assert.equal(created.status, 0);
  const context = JSON.parse(created.stdout).hookSpecificOutput.additionalContext;
  assert.match(context, /どのデザインで作るか/); assert.match(context, /sakusura-standard/); assert.match(context, /PDFから追加/); assert.match(context, /TTSのAPIキー/);
  assert.doesNotMatch(context, /GEMINI_API_KEY=[^<\s]/); // キーの値は出さない
  for (const prompt of ['音声を再生成して', 'このスライドの見出しを直して']) { const other = hook(prompt); assert.equal(other.status, 0); assert.equal(other.stdout, ''); }
});
