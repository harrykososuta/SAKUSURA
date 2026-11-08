import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve, sep, basename } from 'node:path';
import { ROOT } from '../tools/lib/project.mjs';
import { randomUUID } from 'node:crypto';
import { readHtmlDeck } from '../tools/lib/html-decks.mjs';
import { createLibraryStore, listLectures } from '../tools/lib/library-store.mjs';
import { createStudioServer } from '../tools/server.mjs';

test('単独HTMLを一覧から開き、実行を独立させ、ごみ箱に移した後は配信しない', async () => {
  const parent = resolve(ROOT, 'lectures');
  const root = join(parent, 'zz-html-deck-test-' + randomUUID());
  await mkdir(root);
  const name = basename(root);
  let server;
  try {
    const manifest = { version: 1, format: 'html', title: '比較 <script> & 講義', category: 'ai', slides: 2 };
    const document = '<!doctype html><html><body><h1>独立HTML</h1><script>window.ready=true;</script></body></html>';
    await writeFile(join(root, 'html-deck.json'), JSON.stringify(manifest));
    await writeFile(join(root, 'slides.html'), document);
    const deck = await readHtmlDeck(name);
    assert.equal(deck.item.slides, 2);
    assert.equal(deck.path, join(root, 'slides.html'));
    assert.equal((await listLectures()).find(item => item.name === name)?.format, 'html');
    await assert.rejects(readHtmlDeck('../config'));
    await writeFile(join(root, 'html-deck.json'), JSON.stringify({ ...manifest, slides: -1 }));
    await assert.rejects(readHtmlDeck(name), /INVALID_HTML_DECK/);
    await writeFile(join(root, 'html-deck.json'), JSON.stringify(manifest));

    const libraryStore = createLibraryStore({ directory: join(root, 'library') });
    server = await createStudioServer({ port: 0, libraryStore });
    const base = `http://127.0.0.1:${server.address().port}`;
    const wrapper = await fetch(`${base}/html-slides?name=${name}`);
    assert.equal(wrapper.status, 200);
    const page = await wrapper.text();
    assert.match(page, /sandbox="allow-scripts"/);
    assert.match(page, /比較 &lt;script&gt; &amp; 講義/);
    assert.match(page, /href="\/library\?category=ai"/);
    const source = await fetch(`${base}/html-slides/document?name=${name}`);
    assert.equal(await source.text(), document);
    assert.match(source.headers.get('content-security-policy'), /sandbox allow-scripts/);
    assert.doesNotMatch(source.headers.get('content-security-policy'), /allow-same-origin/);
    assert.match(source.headers.get('content-security-policy'), /default-src 'none'/);
    const head = await fetch(`${base}/html-slides/document?name=${name}`, { method: 'HEAD' });
    assert.equal(head.status, 200); assert.equal(await head.text(), '');
    assert.equal((await fetch(`${base}/html-slides?name=${name}`, { method: 'POST' })).status, 405);
    assert.ok((await fetch(`${base}/html-slides/document?name=..%2Fconfig`)).status >= 400);
    let view = await libraryStore.snapshot();
    view = await libraryStore.change({ revision: view.revision, op: 'trash', lectures: [name], folders: [] });
    assert.equal((await fetch(`${base}/html-slides?name=${name}`)).status, 410);
    assert.equal((await fetch(`${base}/html-slides/document?name=${name}`)).status, 410);
    await libraryStore.change({ revision: view.revision, op: 'restore', ids: [view.trash[0].id] });
    assert.equal((await fetch(`${base}/html-slides?name=${name}`)).status, 200);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    assert.ok(resolve(root).startsWith(parent + sep) && basename(root).startsWith('zz-html-deck-test-'));
    await rm(root, { recursive: true, force: true });
  }
});
