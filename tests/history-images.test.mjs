import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createStudioServer } from '../tools/server.mjs';
import { ROOT } from '../tools/lib/project.mjs';
import { lectureChanges, restoreLectureVersion } from '../src/history-data.js';
import { validCrop, croppedPoint } from '../src/image-data.js';
import { validateLecture } from '../src/core.js';
import { MAX_IMAGE_BYTES } from '../tools/lib/image-upload.mjs';
import { newShape } from '../src/shapes.js';
import { TEST_PNG } from './fixtures/image.mjs';

test('履歴はIDで比較し、1ページだけ戻しても他ページと図形・cue・並びを保つ。構成編集済みは外さない', async () => {
  const before = JSON.parse(await readFile(join(ROOT, 'lectures/demo/lecture.json'), 'utf8'));
  const current = structuredClone(before); current.slidesEdited = true;
  current.slides.reverse(); current.slides[0].title = '変更後';
  current.slides[0].shapes = [newShape('text', 's1')]; current.slides[0].cues.push({ target: 's1', at: 1 });
  const changes = lectureChanges(before, current);
  assert.equal(changes.pages[0].id, '003'); assert.equal(changes.pages[0].beforePage, 3); assert.equal(changes.pages[0].currentPage, 1);
  assert.equal(changes.pages[0].moved, true); assert.ok(changes.pages[0].fields.some(field => field.key === 'shapes'));
  const restored = restoreLectureVersion(current, before, '001');
  assert.deepEqual(restored.slides.map(s => s.id), current.slides.map(s => s.id));
  assert.deepEqual(restored.slides[0], current.slides[0]); assert.deepEqual(restored.slides[0].shapes, current.slides[0].shapes);
  assert.equal(restoreLectureVersion(current, before).slidesEdited, true);
  assert.deepEqual(before.slides.map(s => s.id), ['001', '002', '003']);
  assert.throws(() => restoreLectureVersion(current, before, 'missing'), /履歴にありません/);
});

test('画像の範囲・ラベル座標を検証し、トリミング後も構造を指す座標に変換する', async () => {
  const lecture = JSON.parse(await readFile(join(ROOT, 'lectures/demo/lecture.json'), 'utf8'));
  const image = { alt: '説明', prompt: '手元の図', crop: { x: .2, y: .1, width: .5, height: .5 }, labels: ['構造'], labelPositions: [{ text: '構造', x: .45, y: .35, side: 'right' }] };
  lecture.slides[0].image = image;
  assert.deepEqual(validateLecture(lecture), []); const point = croppedPoint(image.labelPositions[0], image.crop);
  assert.ok(Math.abs(point.x - .5) < .000001 && Math.abs(point.y - .5) < .000001);
  for (const crop of [{ x: .8, y: 0, width: .5, height: 1 }, { x: 0, y: 0, width: 0, height: 1 }, { x: 0, y: 0, width: 1, height: 1, other: 1 }]) assert.equal(!!validCrop(crop), false);
  image.labelPositions[0].x = 2; assert.match(validateLecture(lecture).join(), /labelPositions/);
});

test('保存履歴と画像API：保存前の版を読める・復元の保存も控えを残す・画像は上書きせず保持・Originと形式を検査', async () => {
  const name = `zz-history-test-${randomUUID().slice(0, 8)}`, root = join(ROOT, 'lectures', name);
  const original = await readFile(join(ROOT, 'lectures/demo/lecture.json'));
  const png = TEST_PNG;
  const server = await createStudioServer({ port: 0 }); const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { Origin: base, 'X-Studio-Editor': '1', 'Content-Type': 'application/json' };
  const url = `${base}/api/lecture?name=${name}`, historyUrl = `${base}/api/lecture/history?name=${name}`, uploadUrl = `${base}/api/lecture/images?name=${name}`;
  try {
    await mkdir(root); await writeFile(join(root, 'lecture.json'), original);
    assert.deepEqual(await (await fetch(historyUrl)).json(), { versions: [], total: 0 });
    let data = await (await fetch(url)).json();
    data.lecture.slides[0].shapes = [newShape('rect', 'manual')];
    data.lecture.slides[0].title = '更新した見出し';
    const saved = await (await fetch(url, { method: 'PUT', headers, body: JSON.stringify({ lecture: data.lecture, revision: data.revision }) })).json();
    let history = await (await fetch(historyUrl)).json(); assert.equal(history.versions.length, 1);
    assert.ok(Number.isFinite(Date.parse(history.versions[0].at)));
    const prior = await (await fetch(`${historyUrl}&file=${encodeURIComponent(history.versions[0].file)}`)).json();
    assert.deepEqual(prior.lecture, JSON.parse(original));
    assert.equal((await fetch(`${historyUrl}&file=..%2Flecture.json`)).status, 400);
    assert.equal((await fetch(historyUrl, { headers: { Origin: 'https://evil.example' } })).status, 403);
    const badFile = 'lecture-2026-10-25T00-00-00-000Z-00000000.json';
    await writeFile(join(root, 'backups', badFile), '{}');
    assert.equal((await fetch(`${historyUrl}&file=${badFile}`)).status, 422);
    await rm(join(root, 'backups', badFile));
    assert.equal((await fetch(url, { method: 'PUT', headers, body: JSON.stringify({ lecture: prior.lecture, revision: data.revision }) })).status, 409);
    assert.equal((await fetch(url, { method: 'PUT', headers, body: JSON.stringify({ lecture: prior.lecture, revision: saved.revision }) })).status, 200);
    history = await (await fetch(historyUrl)).json(); assert.equal(history.versions.length, 2);
    const uploadHeaders = { ...headers, 'Content-Type': 'application/octet-stream' };
    assert.equal((await fetch(uploadUrl, { method: 'POST', headers: { ...uploadHeaders, Origin: 'https://evil.example' }, body: png })).status, 403);
    assert.equal((await fetch(uploadUrl, { method: 'POST', headers: uploadHeaders, body: Buffer.from('<svg>wrong</svg>') })).status, 422);
    assert.equal((await fetch(uploadUrl, { method: 'POST', headers: uploadHeaders, body: Buffer.alloc(MAX_IMAGE_BYTES + 1) })).status, 413);
    const uploaded = [];
    for (let i = 0; i < 2; i++) { const response = await fetch(uploadUrl, { method: 'POST', headers: uploadHeaders, body: png }); assert.equal(response.status, 201); uploaded.push(await response.json()); }
    assert.notEqual(uploaded[0].file, uploaded[1].file);
    for (const entry of uploaded) { assert.deepEqual(await readFile(join(root, 'images', entry.file)), png); assert.equal((await fetch(base + entry.url)).headers.get('content-type'), 'image/png'); }
    // アップロードだけでは講義を変更しない。適用後は既存の保存経路を通る。
    data = await (await fetch(url)).json(); assert.deepEqual(data.lecture, prior.lecture);
    data.lecture.slides[0].image = { alt: '手元の図', prompt: 'アップロード', file: uploaded[0].file, crop: { x: .1, y: 0, width: .9, height: 1 }, labels: ['構造'], labelPositions: [{ text: '構造', x: .5, y: .5, side: 'left' }] };
    assert.equal((await fetch(url, { method: 'PUT', headers, body: JSON.stringify({ lecture: data.lecture, revision: data.revision }) })).status, 200);
    const fresh = await (await fetch(url)).json(); assert.equal(fresh.images['001'].ready, true); assert.deepEqual(fresh.images['001'].labelProblems, []); assert.equal(fresh.images['001'].labels[0].text, '構造');
    assert.equal((await readdir(join(root, 'images'))).length, 2);
  } finally {
    await new Promise(resolve => server.close(resolve));
    assert.ok(resolve(root).startsWith(resolve(ROOT, 'lectures') + sep) && name.startsWith('zz-history-test-'));
    await rm(root, { recursive: true, force: true });
  }
});
