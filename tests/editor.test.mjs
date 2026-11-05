import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createStudioServer } from '../tools/server.mjs';
import { ROOT } from '../tools/lib/project.mjs';
import { validateLecture, validateDeckStructure, withSlideId, slideFilePairs } from '../src/core.js';
import { newShape } from '../src/shapes.js';
import { shapeNotices } from '../tools/qa.mjs';

test('配置情報は既存データを変更せず、不明な要素・不正値を拒否する', async () => {
  const lecture = JSON.parse(await readFile(join(ROOT, 'lectures/demo/lecture.json'), 'utf8'));
  lecture.slides[0].placement = { title: { x: 24, y: -8, width: 1000 }, 'block:intro': { x: 0, y: 16 } };
  assert.deepEqual(validateLecture(lecture), []);
  lecture.slides[0].placement.title.width = -1;
  lecture.slides[0].placement['#brand'] = { x: 1 };
  lecture.slides[0].placement['block:intro'].height = 100;
  assert.equal(validateLecture(lecture).filter(e => e.includes('placement')).length, 3);
});

test('追加した図形・文字：共通デザインの色・文字サイズだけを許し、スライドの外や不明な項目を拒否する。cueは任意', async () => {
  const lecture = JSON.parse(await readFile(join(ROOT, 'lectures/demo/lecture.json'), 'utf8'));
  const slide = lecture.slides[0];
  slide.shapes = ['text', 'rect', 'circle', 'arrow', 'line'].map((kind, i) => newShape(kind, `shape-${i + 1}`));
  slide.shapes[3].angle = -45;
  assert.deepEqual(validateLecture(lecture), []);
  slide.cues.push({ at: 0, target: 'shape-2' });
  assert.deepEqual(validateLecture(lecture), []);
  slide.shapes[0].color = 'accent';
  slide.shapes[0].size = 32;
  slide.shapes[1].color = 'red';
  slide.shapes[1].x = 1800;
  slide.shapes[2].fontSize = 20;
  slide.shapes[4].height = 10;
  slide.shapes.push({ ...newShape('text', 'shape-1') });
  const errors = validateLecture(lecture).join('\n');
  for (const pattern of [/shape-1: color/, /size は 28 \/ 40/, /shape-2: color/, /右端/, /fontSize は使えません/, /height は使えません/, /重複しない/]) assert.match(errors, pattern);
  const clash = JSON.parse(await readFile(join(ROOT, 'lectures/demo/lecture.json'), 'utf8'));
  clash.slides[0].shapes = [newShape('rect', clash.slides[0].blocks[0].id)];
  assert.match(validateLecture(clash).join(), /重複しています/);
});

test('最終チェック：ナレーションで読まれていない追加文字と、表示タイミング未設定の図形を知らせる', () => {
  const lecture = { slides: [
    { id: '001', narration: 'ここが「狭窄部」です。', cues: [{ at: 1, target: 'b' }], shapes: [{ ...newShape('text', 'a'), text: '**狭窄部**' }, newShape('arrow', 'b')] },
    { id: '002', narration: '本文です。', ttsText: '読み仮名の原稿', cues: [], shapes: [{ ...newShape('text', 'c'), text: '要注意' }] },
  ] };
  const notices = shapeNotices(lecture);
  assert.deepEqual(notices.unread.map(item => [item.page, item.text]), [[2, '要注意']]);
  assert.deepEqual(notices.untimed.map(item => [item.page, item.id]), [[1, 'a'], [2, 'c']]);
});

test('編集の保存は同一Origin・検証・版の一致が必要。バックアップし競合を拒否する', async () => {
  const name = `zz-editor-test-${randomUUID().slice(0, 8)}`;
  const root = join(ROOT, 'lectures', name);
  const original = await readFile(join(ROOT, 'lectures/demo/lecture.json'));
  const server = await createStudioServer({ port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  const url = `${base}/api/lecture?name=${name}`;
  const headers = { Origin: base, 'Content-Type': 'application/json', 'X-Studio-Editor': '1' };
  try {
    await mkdir(root); await writeFile(join(root, 'lecture.json'), original);
    assert.equal((await fetch(`${base}/editor`)).status, 200);
    const data = await (await fetch(url)).json(); assert.match(data.revision, /^[a-f0-9]{64}$/);
    const body = () => JSON.stringify({ lecture: data.lecture, revision: data.revision });
    assert.equal((await fetch(url, { method: 'PUT', headers: { ...headers, Origin: 'https://example.com' }, body: body() })).status, 403);
    assert.equal((await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: body() })).status, 403);
    data.lecture.slides[0].placement = { title: { x: 24, y: 16 } };
    const results = await Promise.all([fetch(url, { method: 'PUT', headers, body: body() }), fetch(url, { method: 'PUT', headers, body: body() })]);
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    const result = await results.find(r => r.status === 200).json();
    assert.deepEqual(await readFile(join(root, result.backup)), original);
    assert.equal((await readdir(join(root, 'backups'))).length, 1);
    assert.equal((await fetch(`${base}/lectures/${name}/${result.backup}`)).status, 404);
    assert.equal((await fetch(`${base}/api/lecture?name=..%2Fconfig`, { method: 'PUT', headers, body: body() })).status, 400);
    data.revision = result.revision; data.lecture.slides[0].placement.title.x = '24px';
    assert.equal((await fetch(url, { method: 'PUT', headers, body: body() })).status, 422);
    const unchanged = await (await fetch(url)).json(); assert.equal(unchanged.revision, result.revision);
    assert.equal(unchanged.audio['001'].ready, false);
    assert.equal((await readdir(root)).some(file => file.endsWith('.tmp')), false);
  } finally {
    await new Promise(resolve => server.close(resolve));
    assert.ok(resolve(root).startsWith(resolve(ROOT, 'lectures') + sep) && name.startsWith('zz-editor-test-'));
    await rm(root, { recursive: true, force: true });
  }
});

test('スライドの挿入：新しいIDに合わせて画像の既定ファイル名を付け直し、写すファイルの組を返す', () => {
  const slide = { id: '005', layout: 'flow', image: { alt: 'a', prompt: 'p', file: 'anatomy.jpg', labels: ['x'] }, blocks: [{ id: 'g1', text: 't', image: { alt: 'a', prompt: 'p' } }, { id: 'g2', text: 't' }] };
  const copy = withSlideId(slide, '013');
  assert.equal(copy.id, '013'); assert.equal(slide.id, '005');
  assert.equal(copy.image.file, '013.jpg'); assert.equal(copy.blocks[0].image.file, undefined);
  assert.deepEqual(slideFilePairs(slide, copy), [
    ['audio/005.wav', 'audio/013.wav'], ['audio/005.json', 'audio/013.json'],
    ['images/anatomy.jpg', 'images/013.jpg'], ['images/anatomy.labels.json', 'images/013.labels.json'],
    ['images/005-g1.png', 'images/013-g1.png'],
  ]);
});

test('枚数・並びは生成時のルール：編集画面で並べ替えた講義（slidesEdited）は検査を外し、番号・強調記法は確かめる', async () => {
  const lecture = JSON.parse(await readFile(join(ROOT, 'lectures/business-design/lecture.json'), 'utf8'));
  assert.deepEqual(validateDeckStructure(lecture), []);
  // 最終枚（Take Home Message）を先頭へ動かし、本編を1枚複製して13枚にする。
  const edited = { ...lecture, slides: [lecture.slides.at(-1), ...lecture.slides.slice(0, -1), withSlideId(lecture.slides[4], '099')] };
  assert.match(validateDeckStructure(edited).join('\n'), /合計12枚/);
  edited.slidesEdited = true;
  assert.deepEqual(validateDeckStructure(edited), []);
  assert.deepEqual(validateLecture(edited), []);
  edited.slides[1].title = '**閉じていない';
  assert.match(validateDeckStructure(edited).join(), /強調記法/);
  assert.match(validateLecture({ ...edited, slidesEdited: 'yes' }).join(), /slidesEdited/);
});

test('挿入したスライドを保存すると、元の講義の画像・音声を新しいIDで写す。保存済みのスライドは上書きしない', async () => {
  const id = randomUUID().slice(0, 8), source = `zz-editor-test-src-${id}`, target = `zz-editor-test-dst-${id}`;
  const [sourceRoot, targetRoot] = [source, target].map(item => join(ROOT, 'lectures', item));
  const demo = JSON.parse(await readFile(join(ROOT, 'lectures/demo/lecture.json'), 'utf8'));
  const server = await createStudioServer({ port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { Origin: base, 'Content-Type': 'application/json', 'X-Studio-Editor': '1' };
  try {
    for (const root of [sourceRoot, targetRoot]) { await mkdir(join(root, 'audio'), { recursive: true }); await writeFile(join(root, 'lecture.json'), `${JSON.stringify(demo, null, 2)}\n`); }
    await writeFile(join(sourceRoot, 'audio', '002.wav'), 'wav-002'); await writeFile(join(sourceRoot, 'audio', '002.json'), '{"hash":"x"}');
    await writeFile(join(targetRoot, 'audio', '001.wav'), 'keep');
    const data = await (await fetch(`${base}/api/lecture?name=${target}`)).json();
    const from = demo.slides[1];
    data.lecture.slides.splice(1, 0, withSlideId(from, '004'));
    data.lecture.slidesEdited = true;
    const put = imports => fetch(`${base}/api/lecture?name=${target}`, { method: 'PUT', headers, body: JSON.stringify({ lecture: data.lecture, revision: data.revision, imports }) });
    // 保存済みのスライド（001）を写し先にする要求は拒否する。
    assert.equal((await put([{ id: '001', from: { lecture: source, slide: from } }])).status, 422);
    assert.equal((await put([{ id: '004', from: { lecture: '../config', slide: from } }])).status, 422);
    const response = await put([{ id: '004', from: { lecture: source, slide: from } }, { id: '777', from: { lecture: source, slide: from } }]);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).copied, 2);
    assert.equal(await readFile(join(targetRoot, 'audio', '004.wav'), 'utf8'), 'wav-002');
    assert.equal(await readFile(join(targetRoot, 'audio', '001.wav'), 'utf8'), 'keep');
    const saved = JSON.parse(await readFile(join(targetRoot, 'lecture.json'), 'utf8'));
    assert.deepEqual(saved.slides.map(s => s.id), ['001', '004', '002', '003']);
  } finally {
    await new Promise(resolve => server.close(resolve));
    for (const root of [sourceRoot, targetRoot]) { assert.ok(resolve(root).startsWith(resolve(ROOT, 'lectures') + sep) && root.includes('zz-editor-test-')); await rm(root, { recursive: true, force: true }); }
  }
});
