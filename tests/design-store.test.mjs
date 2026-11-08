import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, mkdir, writeFile } from 'node:fs/promises';
import { createCategoryDesignStore } from '../tools/lib/category-design-store.mjs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { standardDesign, validateDesign, STANDARD_DESIGN_ID, designDeck, designCategoryKey } from '../src/design-theme.js';
import { createDesignStore } from '../tools/lib/design-store.mjs';
import { createStudioServer } from '../tools/server.mjs';
import { makeDesignSample } from '../src/design-sample.js';

async function temporaryStore() {
  const directory = await mkdtemp(join(tmpdir(), 'sakusura-design-test-'));
  return { directory, store: createDesignStore({ directory, lecturesDirectory: join(directory, 'lectures') }), async close() { assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep)); await rm(directory, { recursive: true, force: true }); } };
}
const copy = name => ({ ...standardDesign(), name });

test('デザインの収納・削除・復元：分類は再起動後も保持、ゴミ箱は通常一覧と直接編集から除き、原本を保持する', async () => {
  const f = await temporaryStore();
  try {
    const created = await f.store.change({ op: 'create', design: copy('収納するデザイン') });
    const raw = await readFile(join(f.directory, `${created.id}.json`));
    const unused = await f.store.change({ op: 'move', id: created.id, revision: created.revision, folder: 'unused' });
    assert.equal(unused.folder, 'unused');
    assert.equal((await createDesignStore({ directory: f.directory }).get(created.id)).folder, 'unused');
    assert.deepEqual(await readFile(join(f.directory, `${created.id}.json`)), raw);
    await assert.rejects(f.store.change({ op: 'move', id: created.id, revision: created.revision, folder: 'active' }), { status: 409 });
    const edited = await f.store.change({ op: 'update', id: created.id, revision: unused.revision, design: { ...unused.design, description: '収納中に編集' } });
    assert.equal(edited.folder, 'unused');
    const trashed = await f.store.change({ op: 'trash', id: created.id, revision: edited.revision });
    assert.equal((await f.store.list()).designs.length, 1);
    assert.equal((await f.store.list({ includeTrash: true })).designs.length, 2);
    await assert.rejects(f.store.get(created.id), { status: 404 });
    await assert.rejects(f.store.change({ op: 'update', id: created.id, revision: trashed.revision, design: edited.design }), { status: 404 });
    await assert.rejects(f.store.change({ op: 'create', design: edited.design }), { status: 409 });
    const restored = await f.store.change({ op: 'restore', id: created.id, revision: trashed.revision });
    assert.equal(restored.folder, 'unused'); assert.deepEqual(restored.design, edited.design);
    const deletedAgain = await f.store.change({ op: 'trash', id: restored.id, revision: restored.revision });
    await assert.rejects(f.store.change({ op: 'restore', id: restored.id, revision: deletedAgain.revision, folder: '../outside' }), { status: 422 });
    const restoredToDestination = await f.store.change({ op: 'restore', id: restored.id, revision: deletedAgain.revision, folder: 'active' });
    assert.equal(restoredToDestination.folder, 'active');
    const builtin = await f.store.get(STANDARD_DESIGN_ID);
    const hidden = await f.store.change({ op: 'move', id: builtin.id, revision: builtin.revision, folder: 'unused' });
    assert.deepEqual(hidden.design, standardDesign());
    await assert.rejects(f.store.change({ op: 'trash', id: builtin.id, revision: hidden.revision }), { status: 403 });
    await assert.rejects(f.store.change({ op: 'move', id: '../../config', revision: null, folder: 'unused' }), { status: 400 });
    await assert.rejects(f.store.change({ op: 'move', id: created.id, revision: restoredToDestination.revision, folder: '../outside' }), { status: 422 });
  } finally { await f.close(); }
});

test('使用中のデザインは削除しない：カテゴリ・講義の参照を保護し、割り当てと削除は競合しても一方だけ成功する', async () => {
  const f = await temporaryStore();
  try {
    const entry = await f.store.change({ op: 'create', design: copy('使用中') });
    const bindings = createCategoryDesignStore({ directory: f.directory, designStore: f.store });
    let config = await bindings.get(); config.categories = [{ id: 'cat-c', name: 'カテゴリC', designId: entry.id }]; config = await bindings.save(config);
    await assert.rejects(f.store.change({ op: 'trash', id: entry.id, revision: entry.revision }), error => error.status === 409 && error.message.includes('カテゴリC'));
    config.categories[0].designId = null; config = await bindings.save(config);
    const lectureRoot = join(f.directory, 'lectures', 'example'); await mkdir(lectureRoot, { recursive: true });
    await writeFile(join(lectureRoot, 'lecture.json'), JSON.stringify({ title: '参照する講義', design: entry.id }));
    await assert.rejects(f.store.change({ op: 'trash', id: entry.id, revision: entry.revision }), error => error.status === 409 && error.message.includes('参照する講義'));
    await rm(join(lectureRoot, 'lecture.json'));
    config.categories[0].designId = entry.id;
    const result = await Promise.allSettled([bindings.save(config), f.store.change({ op: 'trash', id: entry.id, revision: entry.revision })]);
    assert.equal(result.filter(item => item.status === 'fulfilled').length, 1);
    assert.ok((await f.store.get(entry.id)).id, '割り当てを先に確定したデザインは残す');
  } finally { await f.close(); }
});

test('デザインの文字編集はページごとに保存・複製され、不明なパスや長すぎる文字は拒否する', async () => {
  const f = await temporaryStore();
  try {
    const design = copy('文字編集'); design.deck = designDeck(design);
    design.deck.slides[2].texts = { 'blocks.0.text': '**編集した本文**', 'blocks.0.label': '小見出し' };
    design.layoutTexts = { statement: { title: '共通の見出し' }, table: { 'columns.0': '変更した列名', 'blocks.0.cells.0': '変更したセル' } };
    design.deck.slides[2].purpose = 'このページの見出し';
    const entry = await f.store.change({ op: 'create', design });
    const restored = (await f.store.get(entry.id)).design;
    const edited = makeDesignSample(restored, 'statement', restored.deck.slides[2]);
    assert.equal(edited.blocks[0].text, '**編集した本文**');
    assert.equal(edited.title, 'このページの見出し');
    assert.notEqual(makeDesignSample(restored, 'statement', restored.deck.slides[3]).blocks[0].text, edited.blocks[0].text);
    const table = makeDesignSample(restored, 'table'); assert.equal(table.columns[0], '変更した列名'); assert.equal(table.blocks[0].cells[0], '変更したセル');
    for (const path of ['__proto__.polluted', 'blocks.0.value', 'blocks.999.text', 'placement.title']) {
      const bad = structuredClone(design); bad.deck.slides[2].texts[path] = '不正'; assert.ok(validateDesign(bad).length);
    }
    const bad = structuredClone(design); bad.layoutTexts.table['columns.0'] = 'x'.repeat(6001); assert.ok(validateDesign(bad).length);
    assert.equal({}.polluted, undefined);
    assert.equal(standardDesign().layoutTexts, undefined);
  } finally { await f.close(); }
});

test('デザイン設定は任意のCSS・書体・範囲外の数値・不明な項目を保存しない', () => {
  assert.deepEqual(validateDesign(copy('自分のデザイン')), []);
  assert.deepEqual(validateDesign({ ...copy('複数行の説明'), description: '1行目\n2行目' }), []);
  for (const mutate of [d => { d.settings.colors.paper = 'url(https://example.com)'; }, d => { d.settings.font = 'custom; color:red'; }, d => { d.settings.typography.body = 5; }, d => { d.settings.spacing.left = NaN; }, d => { d.settings.layouts.extra = {}; }, d => { d.name = ' '; }, d => { d.brand = 'x\ny'; }]) {
    const design = copy('テスト'); mutate(design); assert.ok(validateDesign(design).length);
  }
  assert.ok(validateDesign(null).length);
});

test('自由なカテゴリ・枚数・順序・ページ別文字サイズを保存でき、不正な定義を拒否する', async () => {
  const f = await temporaryStore();
  try {
    const design = copy('研修用の自由構成');
    design.settings.categories = { training: { ...Object.values(design.settings.categories)[0] } };
    design.categoryNames = { training: '接客研修' };
    design.deck = { targetSeconds: 300, takehomeCount: 3, slides: [{ layout: 'message', purpose: '問題提起から始める', headingSize: 100 }, { layout: 'flow', purpose: '対応手順', bodySize: 32 }, { layout: 'takehome', purpose: '3つの行動' }] };
    design.aiInstructions = 'この構成で説明しやすいデザインにする';
    assert.deepEqual(validateDesign(design), []);
    assert.equal(designCategoryKey(design, 'cat-a'), 'training');
    const entry = await f.store.change({ op: 'create', design });
    assert.deepEqual((await f.store.get(entry.id)).design, design);
    assert.equal(designDeck(design).slides.length, 3);
    for (const mutate of [d => { d.settings.categories = {}; }, d => { d.categoryNames.training = 5; }, d => { d.categoryNames.training = ''; }, d => { d.deck.slides = []; }, d => { d.deck.slides[0].headingSize = 200; }, d => { d.deck.takehomeCount = 7; }, d => { d.deck.slides[0].layout = 'unknown'; }, d => { d.aiInstructions = 'a'.repeat(6001); }]) {
      const bad = structuredClone(design); mutate(bad); assert.ok(validateDesign(bad).length);
    }
    const duplicate = structuredClone(design); duplicate.settings.categories.second = { ...duplicate.settings.categories.training }; duplicate.categoryNames.second = '接客研修';
    assert.ok(validateDesign(duplicate).some(item => item.includes('重複')));
  } finally { await f.close(); }
});

test('デザインを新規保存して別のストアから読み直せる・標準は不変・IDと名前の競合を拒否', async () => {
  const fixture = await temporaryStore(), { store, directory } = fixture;
  try {
    const before = await store.get(STANDARD_DESIGN_ID);
    const design = copy('自分のデザイン'); design.settings.colors.paper = '#ffffff'; Object.values(design.settings.categories)[0].primary = '#154e56';
    const created = await store.change({ op: 'create', design });
    assert.match(created.id, /^design-/); assert.equal(created.builtin, false);
    const reopened = await createDesignStore({ directory }).get(created.id);
    assert.deepEqual(reopened.design, design); assert.equal(reopened.revision, created.revision);
    assert.equal((await store.list()).designs.length, 2);
    assert.deepEqual(await store.get(STANDARD_DESIGN_ID), before);
    await assert.rejects(store.change({ op: 'create', design: copy(' 自分のデザイン ') }), { status: 409 });
    await assert.rejects(store.change({ op: 'update', id: STANDARD_DESIGN_ID, design }), { status: 403 });
    await assert.rejects(store.get('../../config/tts'), { status: 400 });
  } finally { await fixture.close(); }
});

test('編集は版を照合して保存前のバックアップを残す・同時編集は一方だけ保存', async () => {
  const fixture = await temporaryStore(), { store, directory } = fixture;
  try {
    const created = await store.change({ op: 'create', design: copy('編集するデザイン') });
    const oldRaw = await readFile(join(directory, `${created.id}.json`), 'utf8');
    const changed = structuredClone(created.design); changed.settings.typography.heading = 44;
    const result = await store.change({ op: 'update', id: created.id, revision: created.revision, design: changed });
    assert.notEqual(result.revision, created.revision);
    assert.equal((await store.get(created.id)).design.settings.typography.heading, 44);
    const backups = await readdir(join(directory, 'backups')); assert.equal(backups.length, 1);
    assert.equal(await readFile(join(directory, 'backups', backups[0]), 'utf8'), oldRaw);
    await assert.rejects(store.change({ op: 'update', id: created.id, revision: created.revision, design: changed }), { status: 409 });
    const changes = await Promise.allSettled([46, 48].map(heading => store.change({ op: 'update', id: created.id, revision: result.revision, design: { ...changed, settings: { ...changed.settings, typography: { ...changed.settings.typography, heading } } } })));
    assert.equal(changes.filter(item => item.status === 'fulfilled').length, 1);
    assert.equal(changes.find(item => item.status === 'rejected').reason.status, 409);
  } finally { await fixture.close(); }
});

test('デザインAPIは画面からの保存だけを許可し、保存・一覧・再取得と入力エラーを扱う', async () => {
  const fixture = await temporaryStore();
  const server = await createStudioServer({ port: 0, designStore: fixture.store });
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'Content-Type': 'application/json', 'X-Studio-Editor': '1', Origin: base };
  const post = (body, values = headers) => fetch(base + '/api/designs', { method: 'POST', headers: values, body: JSON.stringify(body) });
  try {
    const body = { op: 'create', design: copy('APIから保存') };
    assert.equal((await post(body, { 'Content-Type': 'application/json' })).status, 403);
    assert.equal((await post(body, { ...headers, Origin: 'https://example.com' })).status, 403);
    const response = await post(body); assert.equal(response.status, 201); const created = await response.json();
    const loaded = await (await fetch(base + '/api/designs?id=' + created.id)).json();
    assert.deepEqual(loaded.design, body.design);
    assert.equal((await (await fetch(base + '/api/designs')).json()).designs.length, 2);
    assert.equal((await post(body)).status, 409);
    assert.equal((await post({ ...body, design: { ...body.design, settings: {} } })).status, 422);
    assert.equal((await fetch(base + '/api/designs?id=..%2Fconfig%2Ftts')).status, 400);
    assert.equal((await fetch(base + '/designs/' + created.id + '.json')).status, 404);
    assert.equal((await post({ op: 'move', id: created.id, revision: created.revision, folder: 'unused' }, { 'Content-Type': 'application/json' })).status, 403);
    const movedResponse = await post({ op: 'move', id: created.id, revision: created.revision, folder: 'unused' });
    assert.equal(movedResponse.status, 200); const moved = await movedResponse.json();
    const deletedResponse = await post({ op: 'trash', id: moved.id, revision: moved.revision });
    assert.equal(deletedResponse.status, 200); const deleted = await deletedResponse.json();
    assert.equal((await (await fetch(base + '/api/designs')).json()).designs.length, 1);
    assert.equal((await (await fetch(base + '/api/designs?includeTrash=1')).json()).designs.length, 2);
    assert.equal((await fetch(base + '/api/designs?id=' + created.id)).status, 404);
    assert.equal((await post({ op: 'restore', id: deleted.id, revision: deleted.revision })).status, 200);
  } finally { await new Promise(done => server.close(done)); await fixture.close(); }
});
