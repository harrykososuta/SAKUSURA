// 外部のAIツールや別の画面での lecture.json の変更を、編集画面へ知らせる仕組み（自動反映）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { createStudioServer } from '../tools/server.mjs';

test('lecture.json の変更通知は、このPCで開いた画面にだけ流す', async () => {
  const server = await createStudioServer({ port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const controller = new AbortController();
    const events = await fetch(`${base}/api/lecture/events?name=demo`, { signal: controller.signal });
    assert.match(events.headers.get('content-type'), /text\/event-stream/);
    const reader = events.body.getReader(); let text = '';
    while (!/event: change/.test(text)) text += new TextDecoder().decode((await reader.read()).value);
    assert.match(text, /event: change\ndata: \{"revision":"[0-9a-f]{64}"\}/);
    controller.abort();
    // 別サイトの名前で届いた要求（DNSリバインディング）には返さない。
    const foreign = await new Promise((resolve, reject) => request(`${base}/api/lecture/events?name=demo`, { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject).end());
    assert.equal(foreign, 403);
    // 削除した AI 連携（チャット・ターミナル起動・使用率・AIと使う）の窓口とファイルは残っていない。
    for (const path of ['/api/agent/start', '/api/terminal/open', '/api/agent/usage/refresh']) assert.equal((await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Editor': '1' }, body: '{}' })).status, 405, path);
    for (const path of ['/api/agent/overview', '/src/ai-panel.js', '/src/agent-panel.js']) assert.equal((await fetch(base + path)).status, 404, path);
  } finally { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); }
});
