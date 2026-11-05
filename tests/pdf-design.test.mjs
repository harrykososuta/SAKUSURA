import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createDesignPdfStore } from '../tools/lib/design-pdf-store.mjs';
import { createPdfDesignStore, pdfSourceFor } from '../tools/lib/pdf-design-store.mjs';
import { createDesignStore } from '../tools/lib/design-store.mjs';
import { createCategoryDesignStore } from '../tools/lib/category-design-store.mjs';
import { standardDesign, validateDesign } from '../src/design-theme.js';
import { createStudioServer } from '../tools/server.mjs';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'sakusura-pdf-design-'));
  const pdfStore = createDesignPdfStore({ directory: join(directory, 'references') });
  const pdfDesignStore = createPdfDesignStore({ directory: join(directory, 'pdf-pages'), pdfStore });
  const designStore = createDesignStore({ directory, pdfStore, pdfDesignStore });
  const categoryDesignStore = createCategoryDesignStore({ directory, designStore });
  return { directory, pdfStore, pdfDesignStore, designStore, categoryDesignStore, async close() { assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep)); await rm(directory, { recursive: true, force: true }); } };
}
test('元PDFの全ページと文字の編集点を取り込み、キャッシュと参照先を照合する', async () => {
  const f = await fixture();
  try {
    const pdf = await f.pdfStore.add(await readFile(new URL('./fixtures/design-reference.pdf', import.meta.url)), 'reference.pdf');
    const [manifest, concurrent] = await Promise.all([f.pdfDesignStore.prepare(pdf.id), f.pdfDesignStore.prepare(pdf.id)]);
    assert.equal(manifest.pages.length, 2); assert.deepEqual(concurrent, manifest);
    assert.ok(manifest.pages[0].texts.some(text => text.editable));
    const original = await f.pdfDesignStore.asset(pdf.id, manifest.pages[0].file); assert.match(original.buffer.toString(), /data-text-id=/);
    await assert.rejects(f.pdfDesignStore.asset(pdf.id, '../../config/tts.json'), { status: 404 });
    const design = { ...standardDesign(), name: 'PDF原本', pdfSource: pdfSourceFor(pdf.id, manifest) };
    assert.deepEqual(validateDesign(design), []);
    const entry = await f.designStore.change({ op: 'create', design });
    assert.equal(entry.referencePdfId, pdf.id);
    const bad = structuredClone(design); bad.name = '存在しない文字'; bad.pdfSource.pages[0].edits.push({ id: 'text-9999', text: 'bad' });
    await assert.rejects(f.designStore.change({ op: 'create', design: bad }), { status: 422 });
    const unsafe = structuredClone(design); unsafe.pdfSource.pages[0].edits.push({ id: 'text-0001', color: 'url(https://example.com)', x: Infinity }); assert.ok(validateDesign(unsafe).length);
    assert.deepEqual(await f.pdfDesignStore.get(pdf.id), manifest);
  } finally { await f.close(); }
});
test('カテゴリの使用プリセットを保存し、古い版・重複名・不存在を拒否する', async () => {
  const f = await fixture();
  try {
    const entry = await f.designStore.change({ op: 'create', design: { ...standardDesign(), name: 'カテゴリ用' } });
    const initial = await f.categoryDesignStore.get();
    const categories = [{ id: 'respiratory', name: 'カテゴリC', designId: null }, { id: 'va', name: 'カテゴリA', designId: null }]; categories.find(item => item.id === 'respiratory').designId = entry.id;
    const saved = await f.categoryDesignStore.save({ revision: initial.revision, categories });
    assert.equal(saved.categories.find(item => item.id === 'respiratory').designId, entry.id);
    assert.deepEqual(await createCategoryDesignStore({ directory: f.directory, designStore: f.designStore }).get(), saved);
    await assert.rejects(f.categoryDesignStore.save({ revision: null, categories }), { status: 409 });
    const duplicate = structuredClone(categories); duplicate[1].name = duplicate[0].name;
    await assert.rejects(f.categoryDesignStore.save({ revision: saved.revision, categories: duplicate }), { status: 422 });
    const invalid = structuredClone(categories); invalid[0].designId = 'design-00000000-0000-0000-0000-000000000000';
    await assert.rejects(f.categoryDesignStore.save({ revision: saved.revision, categories: invalid }), { status: 404 });
  } finally { await f.close(); }
});
test('PDF素材APIは原本の素材だけを配信し、カテゴリ設定の書込みは画面からに制限する', async () => {
  const f = await fixture(); const server = await createStudioServer({ port: 0, ...f }); const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base + '/api/category-designs', { method: 'POST', body: '{}' })).status, 403);
    const current = await (await fetch(base + '/api/category-designs')).json();
    assert.equal((await fetch(base + '/api/category-designs', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', 'X-Studio-Editor': '1' }, body: JSON.stringify(current) })).status, 200);
    assert.equal((await fetch(base + '/api/pdf-designs?id=../../config')).status, 400);
  } finally { await new Promise(done => server.close(done)); await f.close(); }
});
