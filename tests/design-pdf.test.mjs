import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { createDesignPdfStore, validatePdfBytes, MAX_DESIGN_PDF_BYTES } from '../tools/lib/design-pdf-store.mjs';
import { createDesignStore } from '../tools/lib/design-store.mjs';
import { createStudioServer } from '../tools/server.mjs';
import { standardDesign } from '../src/design-theme.js';

const pdf = await readFile(new URL('./fixtures/design-reference.pdf', import.meta.url));
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'sakusura-design-pdf-test-'));
  const pdfStore = createDesignPdfStore({ directory: join(directory, 'references') });
  return { directory, pdfStore, designStore: createDesignStore({ directory, pdfStore }), async close() { assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep)); await rm(directory, { recursive: true, force: true }); } };
}

test('PDFはサイズ・ヘッダー・終端・暗号化と名前を検査して保存する', async () => {
  validatePdfBytes(pdf);
  for (const buffer of [Buffer.from('not a PDF'), Buffer.from('%PDF-1.7 no end'), Buffer.alloc(MAX_DESIGN_PDF_BYTES + 1), Buffer.concat([pdf, Buffer.from('\n/Encrypt 2 0 R\n%%EOF')])]) assert.throws(() => validatePdfBytes(buffer));
  const f = await fixture();
  try {
    await assert.rejects(f.pdfStore.add(pdf, '../outside.pdf'), { status: 422 });
    const saved = await f.pdfStore.add(pdf, '参考デザイン.pdf');
    assert.equal(saved.name, '参考デザイン.pdf'); assert.equal(saved.size, pdf.length);
    assert.deepEqual((await f.pdfStore.read(saved.id)).buffer, pdf);
    assert.equal((await createDesignPdfStore({ directory: join(f.directory, 'references') }).get(saved.id)).sha256, saved.sha256);
    await assert.rejects(f.pdfStore.get('../../config/tts'), { status: 400 });
    await writeFile(join(f.directory, 'references', saved.id + '.pdf'), Buffer.concat([pdf, Buffer.from('\nchanged')]));
    await assert.rejects(f.pdfStore.read(saved.id), { status: 422 });
  } finally { await f.close(); }
});

test('PDFの参照は保存・再編集で残り、選択解除でも元PDFは保持する', async () => {
  const f = await fixture();
  try {
    const saved = await f.pdfStore.add(pdf, 'reference.pdf');
    const design = { ...standardDesign(), name: 'PDFを参考にしたデザイン' };
    const created = await f.designStore.change({ op: 'create', design, referencePdfId: saved.id });
    assert.equal(created.referencePdfId, saved.id);
    const updated = await f.designStore.change({ op: 'update', id: created.id, revision: created.revision, design: { ...design, name: 'PDFのデザインを編集' } });
    assert.equal(updated.referencePdfId, saved.id);
    const cleared = await f.designStore.change({ op: 'update', id: created.id, revision: updated.revision, design: updated.design, referencePdfId: null });
    assert.equal(cleared.referencePdfId, undefined); assert.equal((await f.pdfStore.get(saved.id)).name, 'reference.pdf');
  } finally { await f.close(); }
});

test('PDF APIは画面からのアップロードだけを許可し、PDF本体・Range・HEADを返す', async () => {
  const f = await fixture(), server = await createStudioServer({ port: 0, pdfStore: f.pdfStore, designStore: f.designStore });
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { Origin: base, 'X-Studio-Editor': '1', 'Content-Type': 'application/pdf', 'X-File-Name': encodeURIComponent('参考.pdf') };
  const post = values => fetch(base + '/api/design-pdfs', { method: 'POST', headers: values, body: pdf });
  try {
    assert.equal((await post({ 'Content-Type': 'application/pdf' })).status, 403);
    assert.equal((await post({ ...headers, Origin: 'https://example.com' })).status, 403);
    const response = await post(headers); assert.equal(response.status, 201); const saved = await response.json();
    assert.equal((await (await fetch(base + '/api/design-pdfs?id=' + saved.id)).json()).name, '参考.pdf');
    const url = base + '/api/design-pdfs/file?id=' + saved.id;
    const full = await fetch(url); assert.equal(full.headers.get('content-type'), 'application/pdf'); assert.deepEqual(Buffer.from(await full.arrayBuffer()), pdf);
    const range = await fetch(url, { headers: { Range: 'bytes=0-7' } }); assert.equal(range.status, 206); assert.deepEqual(Buffer.from(await range.arrayBuffer()), pdf.subarray(0, 8));
    const tail = await fetch(url, { headers: { Range: 'bytes=-12' } }); assert.equal(tail.status, 206); assert.deepEqual(Buffer.from(await tail.arrayBuffer()), pdf.subarray(-12));
    assert.equal((await fetch(url, { headers: { Range: `bytes=${pdf.length}-` } })).status, 416);
    assert.equal((await fetch(url, { method: 'HEAD' })).headers.get('content-length'), String(pdf.length));
    assert.equal((await fetch(base + '/designs/references/' + saved.id + '.pdf')).status, 404);
  } finally { await new Promise(done => server.close(done)); await f.close(); }
});
