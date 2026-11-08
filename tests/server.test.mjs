import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudioServer } from '../tools/server.mjs';

test('HTTP配信は講義と公開ファイルに限定し、キー・設定・ルールを公開しない', async () => {
  const server = await createStudioServer({ port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await fetch(base); assert.equal(page.status, 200); assert.match(await page.text(), /src\/home.js/);
    for(const path of ['/player','/?lecture=demo','/?record=1'])assert.match(await(await fetch(base+path)).text(),/src\/player.js/);
    for (const path of ['/.env', '/config/tts.json', '/AGENTS.md', '/tools/tts.mjs', '/api/lecture?name=..%2Fconfig']) {
      const response = await fetch(base + path); assert.ok(response.status >= 400, path);
    }
    const result = await (await fetch(base + '/api/lecture?name=demo')).json();
    assert.equal(result.lecture.slides.length, 3); assert.equal('config' in result, false);
    const post = await fetch(base + '/api/lecture', { method: 'POST' }); assert.equal(post.status, 405);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test('別のホスト名で届いた要求（DNSリバインディング）には、講義・音声・画面のどれも返さない', async () => {
  const { request } = await import('node:http');
  const server = await createStudioServer({ port: 0 });
  const port = server.address().port;
  const get = (path, host) => new Promise((resolve, reject) => request({ host: '127.0.0.1', port, path, headers: { Host: host } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject).end());
  try {
    for (const path of ['/library', '/api/lecture?name=demo', '/api/library', '/api/lectures', '/audio/demo/001.wav', '/api/health']) assert.equal(await get(path, `attacker.example:${port}`), 403, path);
    assert.equal(await get('/api/lecture?name=demo', `127.0.0.1:${port}`), 200);
    assert.equal(await get('/api/lecture?name=demo', `localhost:${port}`), 200);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test('動画の書き出し：スタジオ画面からの要求だけ受け付け、同時に1つだけ実行し、進み具合と出力先を返す', async () => {
  const { createRenderJobs } = await import('../tools/lib/render-jobs.mjs');
  let finish;
  const renderJobs = createRenderJobs({
    precheck: async () => ({ count: 4 }),
    render: (name, { log }) => new Promise(resolve => { log('撮影 001（2画面）'); log('注意：画像が未生成です（001）'); finish = () => resolve({ output: `exports/${name}_001.mp4`, seconds: 12 }); }),
  });
  let opened = 0;
  const server = await createStudioServer({ port: 0, renderJobs, openFolder: () => opened++ });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, headers = { 'Content-Type': 'application/json', 'X-Studio-Editor': '1', Origin: base }) => fetch(base + path, { method: 'POST', headers, body: '{}' });
  try {
    assert.equal((await post('/api/render/start?name=demo', { 'Content-Type': 'application/json' })).status, 403);
    assert.equal((await post('/api/exports/open', { 'Content-Type': 'application/json', 'X-Studio-Editor': '1', Origin: 'http://evil.example' })).status, 403);
    assert.equal(opened, 0);
    assert.equal((await post('/api/render/start?name=..%2Fconfig')).status, 400);
    const started = await post('/api/render/start?name=demo');
    assert.equal(started.status, 202);
    assert.equal((await post('/api/render/start?name=business-design')).status, 409);
    await new Promise(resolve => setImmediate(resolve));
    let { job } = await (await fetch(`${base}/api/render/job?name=demo`)).json();
    assert.equal(job.state, 'running'); assert.equal(job.completed, 1); assert.equal(job.count, 4); assert.equal(job.warnings.length, 1);
    finish(); await new Promise(resolve => setImmediate(resolve));
    ({ job } = await (await fetch(`${base}/api/render/job?name=demo`)).json());
    assert.equal(job.state, 'completed'); assert.equal(job.output, 'exports/demo_001.mp4'); assert.equal(job.completed, 4);
    assert.equal((await post('/api/exports/open')).status, 200); assert.equal(opened, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test('サムネイル：スタジオ画面からの要求だけ受け付け、1枚目のJPGをダウンロードとして返す', async () => {
  const calls = [];
  const server = await createStudioServer({ port: 0, thumbnail: async (name, options) => { calls.push([name, options.base]); return Buffer.from([0xff, 0xd8, 0xff, 0xd9]); } });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, headers = { 'Content-Type': 'application/json', 'X-Studio-Editor': '1', Origin: base }) => fetch(base + path, { method: 'POST', headers, body: '{}' });
  try {
    assert.equal((await post('/api/thumbnail?name=demo', { 'Content-Type': 'application/json', Origin: 'http://evil.example' })).status, 403);
    assert.equal((await post('/api/thumbnail?name=..%2Fconfig')).status, 400);
    assert.equal(calls.length, 0);
    const response = await post('/api/thumbnail?name=demo');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/jpeg');
    assert.match(response.headers.get('content-disposition'), /attachment; filename="demo_thumbnail\.jpg"/);
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [0xff, 0xd8, 0xff, 0xd9]);
    assert.deepEqual(calls, [['demo', base]]);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test('PDF：スタジオ画面からの要求だけ受け付け、講義全体のPDFをダウンロードとして返す', async () => {
  const calls = [];
  const server = await createStudioServer({ port: 0, deckPdf: async (name, options) => { calls.push([name, options.base]); return Buffer.from('%PDF-1.4 %%EOF'); } });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, headers = { 'Content-Type': 'application/json', 'X-Studio-Editor': '1', Origin: base }) => fetch(base + path, { method: 'POST', headers, body: '{}' });
  try {
    assert.equal((await post('/api/pdf?name=demo', { 'Content-Type': 'application/json', Origin: 'http://evil.example' })).status, 403);
    assert.equal((await post('/api/pdf?name=..%2Fconfig')).status, 400);
    assert.equal(calls.length, 0);
    const response = await post('/api/pdf?name=demo');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/pdf');
    assert.match(response.headers.get('content-disposition'), /attachment; filename="demo\.pdf"/);
    assert.equal(Buffer.from(await response.arrayBuffer()).toString(), '%PDF-1.4 %%EOF');
    assert.deepEqual(calls, [['demo', base]]);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test('画面の部品（src/ 直下の .js・.css）は一覧に登録しなくても返し、それ以外の場所や存在しないファイルは返さない', async () => {
  const server = await createStudioServer({ port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const status = await fetch(`${base}/src/studio-status.js`); assert.equal(status.status, 200); assert.match(status.headers.get('content-type'), /javascript/);
    const css = await fetch(`${base}/src/presenter.css`); assert.equal(css.status, 200); assert.match(css.headers.get('content-type'), /text\/css/);
    for (const path of ['/src/no-such-file.js', '/src/..%2Ftools%2Ftts.mjs', '/src/.env', '/src/sub/dir.js', '/tools/lib/project.mjs']) assert.ok((await fetch(base + path)).status >= 400, path);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test('サーバーのプログラムが更新されたら知らせ、再起動はnpm startから起動したときだけ・書き出し中でないときだけ受け付ける', async () => {
  let stamp = 'a', exited = null, busy = null;
  const studio = { 'Content-Type': 'application/json', 'X-Studio-Editor': '1' };
  const make = restartable => createStudioServer({ port: 0, codeStamp: async () => stamp, restartable, exit: code => { exited = code; }, renderJobs: { runningJob: () => busy } });
  const server = await make(false), base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await (await fetch(`${base}/api/code-status`)).json()).stale, false);
    stamp = 'b';
    const info = await (await fetch(`${base}/api/code-status`)).json();
    assert.equal(info.stale, true); assert.equal(info.restartable, false);
    assert.equal((await fetch(`${base}/api/restart`, { method: 'POST', headers: { ...studio, Origin: base } })).status, 409);
  } finally { await new Promise(resolve => server.close(resolve)); }
  const supervised = await make(true), url = `http://127.0.0.1:${supervised.address().port}`;
  try {
    assert.equal((await fetch(`${url}/api/restart`, { method: 'POST', headers: { 'Content-Type': 'application/json' } })).status, 403);
    busy = { kind: 'render', name: 'demo' };
    const refused = await fetch(`${url}/api/restart`, { method: 'POST', headers: { ...studio, Origin: url } });
    assert.equal(refused.status, 409); assert.match((await refused.json()).error, /動画を書き出し中/);
    busy = null;
    assert.equal((await fetch(`${url}/api/restart`, { method: 'POST', headers: { ...studio, Origin: url } })).status, 202);
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(exited, 75);
  } finally { await new Promise(resolve => supervised.close(resolve)); }
});
test('再起動の要否は、サーバーが import でたどれるファイルだけで判断する', async () => {
  const { serverModuleFiles } = await import('../tools/lib/server-code.mjs');
  const files = (await serverModuleFiles()).map(file => file.split(String.fromCharCode(92)).join('/'));
  assert.ok(files.some(file => file.endsWith('/tools/server.mjs')));
  assert.ok(files.some(file => file.endsWith('/tools/lib/render-jobs.mjs')));
  assert.ok(files.some(file => file.endsWith('/src/core.js')));
  assert.ok(!files.some(file => file.endsWith('/src/presenter.js')));
});
