import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm, readdir } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { createDesignImportStore } from '../tools/lib/design-import-store.mjs';
import { createDesignStore } from '../tools/lib/design-store.mjs';
import { createDesignPdfStore } from '../tools/lib/design-pdf-store.mjs';
import { createStudioServer } from '../tools/server.mjs';
import { standardDesign } from '../src/design-theme.js';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'sakusura-design-import-test-'));
  const pdfStore = createDesignPdfStore({ directory: join(directory, 'references') });
  const designStore = createDesignStore({ directory, pdfStore });
  const options = { directory: join(directory, 'imports'), pdfStore, designStore };
  const store = createDesignImportStore(options);
  const pdf = await pdfStore.add(await readFile(new URL('./fixtures/design-reference.pdf', import.meta.url)), '参考.pdf');
  return { directory, store, pdf, options, designStore, pdfStore, async close() {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep)); await rm(directory, { recursive: true, force: true });
  } };
}
test('PDF・依頼書・編集用JSONを保存し、CLI完了で1回だけデザイン登録・再開できる', async () => {
  const f = await fixture();
  try {
    const task = await f.store.create({ referencePdfId: f.pdf.id, design: { ...standardDesign(), name: '参考プリセット' } });
    assert.equal(task.status, 'waiting');
    for (const file of ['REQUEST.md', 'preset.json', 'reference.pdf', 'schema-reference.js', 'task.json']) assert.ok((await readFile(join(task.folder, file))).length);
    assert.match(await readFile(task.requestPath, 'utf8'), /npm run design:import/);
    assert.equal((await f.designStore.list()).designs.length, 1);
    const design = JSON.parse(await readFile(join(task.folder, 'preset.json'), 'utf8'));
    design.settings.colors.paper = '#ffffff';
    await writeFile(join(task.folder, 'preset.json'), JSON.stringify(design));
    const [a, b] = await Promise.all([f.store.complete(task.id), f.store.complete(task.id)]);
    assert.equal(a.entry.id, b.entry.id);
    assert.equal((await f.store.complete(task.id)).entry.id, a.entry.id);
    assert.equal((await f.designStore.list()).designs.length, 2);
    assert.equal(a.entry.design.settings.colors.paper, '#ffffff');
    assert.equal(a.entry.referencePdfId, f.pdf.id);
    assert.equal((await createDesignImportStore(f.options).get(task.id)).status, 'complete');
    await assert.rejects(f.store.get('../outside'), { status: 400 });
  } finally { await f.close(); }
});
test('壊れた結果・範囲外・同名は登録せず、修正して再実行できる', async () => {
  const f = await fixture();
  try {
    const task = await f.store.create({ referencePdfId: f.pdf.id, design: standardDesign() });
    const path = join(task.folder, 'preset.json');
    await writeFile(path, '{'); await assert.rejects(f.store.complete(task.id), { status: 422 });
    const design = structuredClone(task.snapshot); design.name = 'SAKUSURA Standard'; design.settings.typography.body = 2;
    await writeFile(path, JSON.stringify(design)); await assert.rejects(f.store.complete(task.id), { status: 422 });
    design.settings.typography.body = 28;
    await writeFile(path, JSON.stringify(design)); await assert.rejects(f.store.complete(task.id), { status: 409 });
    assert.equal((await f.store.get(task.id)).status, 'waiting');
    assert.equal((await f.designStore.list()).designs.length, 1);
    const withoutSource = structuredClone(design); delete withoutSource.pdfSource;
    await writeFile(path, JSON.stringify(withoutSource)); await assert.rejects(f.store.complete(task.id), { status: 422 });
    design.name = '修正済み'; await writeFile(path, '\uFEFF' + JSON.stringify(design));
    assert.equal((await f.store.complete(task.id)).status, 'complete');
    assert.equal((await readdir(f.directory)).filter(name => /^design-.*json$/.test(name)).length, 1);
  } finally { await f.close(); }
});
test('作業APIはローカル画面で作成し、完了状態を取得できる', async () => {
  const f = await fixture();
  const server = await createStudioServer({ port: 0, designStore: f.designStore, pdfStore: f.pdfStore, designImportStore: f.store });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const body = JSON.stringify({ referencePdfId: f.pdf.id, design: { ...standardDesign(), name: 'APIから作成' } });
    assert.equal((await fetch(base + '/api/design-imports', { method: 'POST', body })).status, 403);
    const response = await fetch(base + '/api/design-imports', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', 'X-Studio-Editor': '1' }, body });
    assert.equal(response.status, 201); const task = await response.json();
    assert.equal((await (await fetch(base + '/api/design-imports?id=' + task.id)).json()).status, 'waiting');
    await f.store.complete(task.id);
    assert.equal((await (await fetch(base + '/api/design-imports?id=' + task.id)).json()).status, 'complete');
    assert.equal((await fetch(base + '/api/design-imports?id=../../config')).status, 400);
  } finally { await new Promise(done => server.close(done)); await f.close(); }
});

test('PDFなしの調整依頼は画面設定と希望を固定し、元を変えずに別のプリセットを作る', async () => {
  const f = await fixture();
  try {
    const original = await f.designStore.change({ op: 'create', design: { ...standardDesign(), name: '元のデザイン' } });
    const draft = structuredClone(original.design); draft.deck = { targetSeconds: 120, takehomeCount: 2, slides: [{ layout: 'title', purpose: '導入', headingSize: 110 }, { layout: 'takehome', purpose: '結論' }] };
    const task = await f.store.create({ kind: 'customize', design: draft, instructions: '本文を34pxにし、構成を維持してください。' });
    assert.equal(task.kind, 'customize'); assert.equal(task.referencePdfId, undefined);
    assert.match(task.snapshot.name, /調整案/);
    assert.deepEqual(task.snapshot.deck, draft.deck);
    assert.match(await readFile(task.requestPath, 'utf8'), /本文を34px/);
    const result = structuredClone(task.snapshot); result.settings.typography.body = 34;
    await writeFile(join(task.folder, 'preset.json'), JSON.stringify(result));
    assert.deepEqual((await f.store.get(task.id)).snapshot, task.snapshot);
    const completed = await f.store.complete(task.id);
    assert.equal(completed.entry.design.settings.typography.body, 34);
    assert.deepEqual(await f.designStore.get(original.id), original);
    assert.equal((await f.designStore.list()).designs.length, 3);
    await assert.rejects(f.store.create({ kind: 'customize', design: draft, instructions: ' ' }), { status: 422 });
  } finally { await f.close(); }
});
