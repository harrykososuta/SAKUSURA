import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, stat } from 'node:fs/promises';
import { join, resolve, sep, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { ROOT } from '../tools/lib/project.mjs';
import { createShareStore, newShareId, sharedLecturePath } from '../tools/lib/share.mjs';
import { createDesignStore } from '../tools/lib/design-store.mjs';
import { readZip } from '../tools/lib/zip.mjs';
import { writeZip } from '../tools/lib/write-zip.mjs';
import { standardDesign } from '../src/design-theme.js';

const demo = JSON.parse(await readFile(join(ROOT, 'lectures', 'demo', 'lecture.json'), 'utf8'));
const exists = async path => { try { await stat(path); return true; } catch { return false; } };

// 送り主・受け取り側の SAKUSURA を一時フォルダーに作る。
async function workspace(label, ids = ['SKS-AAAA-0001', 'SKS-BBBB-0002', 'SKS-CCCC-0003', 'SKS-DDDD-0004']) {
  const root = await mkdtemp(join(tmpdir(), `sakusura-share-${label}-`));
  await writeFile(join(root, 'package.json'), JSON.stringify({ version: '1.1.0' }));
  await mkdir(join(root, 'lectures'), { recursive: true });
  let n = 0;
  const store = createShareStore({ root, createId: () => ids[n++] ?? newShareId() });
  return { root, store, designs: createDesignStore({ directory: join(root, 'designs'), lecturesDirectory: join(root, 'lectures') }),
    async close() { assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep)); await rm(root, { recursive: true, force: true }); } };
}
async function addLecture(root, slug, lecture = demo) {
  const directory = join(root, 'lectures', slug);
  await mkdir(join(directory, 'images'), { recursive: true }); await mkdir(join(directory, 'audio', 'backups'), { recursive: true }); await mkdir(join(directory, 'backups'), { recursive: true });
  await writeFile(join(directory, 'lecture.json'), JSON.stringify(lecture, null, 2));
  await writeFile(join(directory, 'theme.css'), '/* theme */');
  await writeFile(join(directory, 'images', 'figure.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
  await writeFile(join(directory, 'images', 'figure.labels.json'), '{}');
  await writeFile(join(directory, 'audio', '001.wav'), Buffer.alloc(64, 7));
  await writeFile(join(directory, 'audio', '001.json'), '{}');
  // 共有に入れない作業ファイル
  await writeFile(join(directory, 'images', 'REQUEST.md'), '# 依頼書');
  await writeFile(join(directory, 'images', 'ORCA_TASK.json'), '{}');
  await writeFile(join(directory, 'images', 'source.svg'), '<svg onload="alert(1)"/>');
  await writeFile(join(directory, 'audio', 'backups', '001.wav'), Buffer.alloc(8));
  await writeFile(join(directory, 'backups', 'old.json'), '{}');
  await writeFile(join(directory, 'build.mjs'), 'process.exit()');
  return directory;
}
const names = zipPath => readFile(zipPath).then(buffer => readZip(buffer).names.sort());

test('共有するファイルの許可一覧：再生に必要なものだけ、作業ファイル・SVG・スクリプトは入れない', () => {
  for (const path of ['lecture.json', 'theme.css', 'DESCRIPTION.md', 'images/a.png', 'images/a.labels.json', 'audio/001.wav', 'audio/001.json']) assert.equal(sharedLecturePath(path, 'json'), true, path);
  for (const path of ['images/a.svg', 'images/REQUEST.md', 'images/ORCA_TASK.json', 'audio/backups/001.wav', 'backups/a.json', 'build.mjs', 'slides.html', 'share.json', '../x.png', 'images/../../x.png']) assert.equal(sharedLecturePath(path, 'json'), false, path);
  assert.equal(sharedLecturePath('slides.html', 'html'), true);
  assert.equal(sharedLecturePath('images/a.png', 'html'), false);
  assert.match(newShareId(), /^SKS-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
});

test('書き出し：共有IDを1回だけ発行し、変更がなければ同じ版・変更すれば版を上げる', async () => {
  const a = await workspace('export');
  try {
    const directory = await addLecture(a.root, 'sample');
    await assert.rejects(a.store.exportLecture('sample'), /送り主の名前/);
    const first = await a.store.exportLecture('sample', { author: '送り主A' });
    assert.equal(first.manifest.id, 'SKS-AAAA-0001'); assert.equal(first.manifest.revision, 1); assert.equal(first.manifest.author, '送り主A');
    assert.deepEqual(await names(first.path), ['lecture/audio/001.json', 'lecture/audio/001.wav', 'lecture/images/figure.labels.json', 'lecture/images/figure.png', 'lecture/lecture.json', 'lecture/theme.css', 'share.json']);
    const saved = JSON.parse(await readFile(join(directory, 'share.json'), 'utf8'));
    assert.equal(saved.id, 'SKS-AAAA-0001'); assert.equal(saved.importedAt, undefined);
    const again = await a.store.exportLecture('sample'); // 名前は前回の登録を使う
    assert.equal(again.manifest.id, 'SKS-AAAA-0001'); assert.equal(again.manifest.revision, 1); assert.notEqual(again.path, first.path);
    await writeFile(join(directory, 'lecture.json'), JSON.stringify({ ...demo, title: '改訂した講義' }));
    const changed = await a.store.exportLecture('sample', { audio: false });
    assert.equal(changed.manifest.id, 'SKS-AAAA-0001'); assert.equal(changed.manifest.revision, 2); assert.equal(changed.manifest.lecture.audio, false);
    assert.ok((await names(changed.path)).every(name => !name.startsWith('lecture/audio/')));
    assert.match(changed.path, /改訂した講義_v2\.zip$/);
  } finally { await a.close(); }
});

test('共有ZIP：59・60・61文字の題名を繰り返し書き出しても、番号を残し元のファイルを上書きしない', { timeout: 10000 }, async () => {
  const a = await workspace('long-title');
  try {
    for (const length of [59, 60, 61]) {
      const title = String(length) + 'A'.repeat(length - 2), slug = `sample-${length}`;
      await addLecture(a.root, slug, { ...demo, title });
      const outputs = [];
      for (let copy = 1; copy <= 3; copy++) {
        const result = await a.store.exportLecture(slug, { author: 'test' });
        const suffix = copy > 1 ? `_${copy}` : '';
        assert.equal(basename(result.path), `${title.slice(0, 60)}${suffix}_v1.zip`);
        outputs.push({ path: result.path, data: await readFile(result.path) });
      }
      assert.equal(new Set(outputs.map(item => item.path)).size, 3);
      for (const item of outputs) assert.deepEqual(await readFile(item.path), item.data);
    }
  } finally { await a.close(); }
});

test('共有ZIP：保存名の候補を使い切ったらエラーを返し、次の共有操作を実行できる', { timeout: 10000 }, async () => {
  const a = await workspace('name-limit');
  try {
    const title = 'A'.repeat(60);
    await addLecture(a.root, 'sample', { ...demo, title });
    await mkdir(a.store.outputDirectory, { recursive: true });
    const data = Buffer.from('existing');
    for (let copy = 1; copy <= 1000; copy++) {
      const suffix = copy > 1 ? `_${copy}` : '';
      await writeFile(join(a.store.outputDirectory, `${title}${suffix}_v1.zip`), data);
    }
    await assert.rejects(a.store.exportLecture('sample', { author: 'test' }), error => error.status === 409);
    await addLecture(a.root, 'next', { ...demo, title: 'next export' });
    const next = await a.store.exportLecture('next', { author: 'test' });
    assert.equal(basename(next.path), 'next export_v1.zip');
    assert.deepEqual(await readFile(join(a.store.outputDirectory, `${title}_v1.zip`)), data);
  } finally { await a.close(); }
});

test('取り込み：受け取り箱に入り、同じ共有IDは更新か別に残すかを選ばせ、更新では元をバックアップする', async () => {
  const a = await workspace('sender'), b = await workspace('receiver');
  try {
    const source = await addLecture(a.root, 'sample');
    const v1 = await readFile((await a.store.exportLecture('sample', { author: '送り主A' })).path);
    await addLecture(b.root, 'sample'); // 受け取り側に同名の別講義がある
    const checked = await b.store.inspect(v1);
    assert.equal(checked.existing, null); assert.equal(checked.lecture.slug, 'sample');
    assert.deepEqual(await readdir(join(b.root, 'lectures')), ['sample']); // 確認だけでは何も書かない
    const imported = await b.store.importPackage(v1);
    assert.equal(imported.slug, 'sample-2'); assert.equal(imported.mode, 'new');
    const share = JSON.parse(await readFile(join(b.root, 'lectures', 'sample-2', 'share.json'), 'utf8'));
    assert.equal(share.id, 'SKS-AAAA-0001'); assert.equal(share.author, '送り主A'); assert.equal(share.inbox, true); assert.ok(share.importedAt);
    assert.deepEqual((await b.store.inbox()).map(item => item.slug), ['sample-2']);
    assert.equal(JSON.parse(await readFile(join(b.root, 'lectures', 'sample-2', 'lecture.json'), 'utf8')).category, demo.category);
    // 同じ共有IDの新しい版
    await writeFile(join(source, 'lecture.json'), JSON.stringify({ ...demo, title: '第2版' }));
    const v2 = await readFile((await a.store.exportLecture('sample')).path);
    await assert.rejects(b.store.importPackage(v2), error => error.status === 409 && error.summary.existing.slug === 'sample-2');
    const copied = await b.store.importPackage(v2, { mode: 'copy' });
    assert.equal(copied.slug, 'sample-3'); assert.equal(copied.mode, 'copy');
    const updated = await b.store.importPackage(v2, { mode: 'update' });
    assert.ok(['sample-2', 'sample-3'].includes(updated.slug)); assert.equal(updated.mode, 'update');
    assert.ok(await exists(join(updated.backup, 'lecture.json')));
    assert.equal(JSON.parse(await readFile(join(b.root, 'lectures', updated.slug, 'lecture.json'), 'utf8')).title, '第2版');
    // 古い版を入れようとすると警告
    const old = await b.store.inspect(v1);
    assert.ok(old.warnings.some(text => /新しい版/.test(text)));
    assert.equal(await b.store.leaveInbox('sample-2'), true);
    assert.ok(!(await b.store.inbox()).some(item => item.slug === 'sample-2'));
    assert.ok(!(await readdir(join(b.root, 'lectures'))).some(name => name.startsWith('.')));
  } finally { await a.close(); await b.close(); }
});

test('受け取った講義の再配布：手を加えなければ同じID・同じ版で転送、手を加えれば新しいIDと元ID', async () => {
  const a = await workspace('origin'), b = await workspace('relay', ['SKS-RRRR-0001']);
  try {
    await addLecture(a.root, 'sample');
    const imported = await b.store.importPackage(await readFile((await a.store.exportLecture('sample', { author: '送り主A' })).path));
    const forwarded = await b.store.exportLecture(imported.slug, { author: '受け取りB' });
    assert.equal(forwarded.forwarded, true); assert.equal(forwarded.manifest.id, 'SKS-AAAA-0001'); assert.equal(forwarded.manifest.revision, 1); assert.equal(forwarded.manifest.author, '送り主A');
    await writeFile(join(b.root, 'lectures', imported.slug, 'lecture.json'), JSON.stringify({ ...demo, title: 'Bが改変' }));
    const remix = await b.store.exportLecture(imported.slug);
    assert.equal(remix.forwarded, false); assert.notEqual(remix.manifest.id, 'SKS-AAAA-0001'); assert.equal(remix.manifest.originId, 'SKS-AAAA-0001'); assert.equal(remix.manifest.author, '受け取りB');
    const saved = JSON.parse(await readFile(join(b.root, 'lectures', imported.slug, 'share.json'), 'utf8'));
    assert.equal(saved.importedAt, undefined); assert.equal(saved.originId, 'SKS-AAAA-0001');
  } finally { await a.close(); await b.close(); }
});

test('壊れた・書き換えられた・余計なファイルを含む共有ファイルは1ファイルも書かずに断る', async () => {
  const a = await workspace('tamper-a'), b = await workspace('tamper-b');
  try {
    await addLecture(a.root, 'sample');
    const zip = readZip(await readFile((await a.store.exportLecture('sample', { author: 'A' })).path));
    const entries = zip.names.map(name => ({ name, data: zip.read(name) }));
    const rebuild = change => writeZip(change(entries.map(entry => ({ ...entry }))));
    const cases = {
      tampered: rebuild(list => list.map(entry => entry.name === 'lecture/theme.css' ? { ...entry, data: Buffer.from('body{}') } : entry)),
      extra: rebuild(list => [...list, { name: 'lecture/images/evil.png', data: Buffer.from('x') }]),
      script: (() => { const manifest = JSON.parse(zip.text('share.json')); manifest.files.push({ path: 'lecture/run.mjs', size: 1, sha256: '0'.repeat(64) }); return rebuild(list => [...list.filter(entry => entry.name !== 'share.json'), { name: 'share.json', data: Buffer.from(JSON.stringify(manifest)) }, { name: 'lecture/run.mjs', data: Buffer.from('x') }]); })(),
      traversal: (() => { const manifest = JSON.parse(zip.text('share.json')); manifest.files.push({ path: 'lecture/images/../../../x.png', size: 1, sha256: '0'.repeat(64) }); return rebuild(list => [...list.filter(entry => entry.name !== 'share.json'), { name: 'share.json', data: Buffer.from(JSON.stringify(manifest)) }]); })(),
      notShare: writeZip([{ name: 'a.txt', data: Buffer.from('a') }]),
      notZip: Buffer.from('not a zip file at all, definitely not'),
    };
    for (const [label, buffer] of Object.entries(cases)) await assert.rejects(b.store.importPackage(buffer), error => error.status === 422, label);
    assert.deepEqual(await readdir(join(b.root, 'lectures')), []);
  } finally { await a.close(); await b.close(); }
});

test('デザイン：講義と一緒に同梱、デザインだけの共有も可、中身が違う同じIDは上書きしない', async () => {
  const a = await workspace('design-a'), b = await workspace('design-b');
  try {
    const created = await a.designs.change({ op: 'create', design: { ...standardDesign(), name: '共有するテンプレート' } });
    await addLecture(a.root, 'with-design', { ...demo, design: created.id });
    const lecturePackage = await a.store.exportLecture('with-design', { author: 'A' });
    assert.deepEqual(lecturePackage.manifest.designs, [created.id]);
    const imported = await b.store.importPackage(await readFile(lecturePackage.path));
    assert.deepEqual(imported.designsImported.map(item => [item.id, item.mode]), [[created.id, 'new']]);
    assert.equal((await b.designs.get(created.id)).design.name, '共有するテンプレート');
    // デザインだけ（中身を変えた版）
    const current = await a.designs.get(created.id);
    await a.designs.change({ op: 'update', id: created.id, revision: current.revision, design: { ...current.design, description: '改訂版' } });
    const designOnly = await readFile((await a.store.exportDesign(created.id)).path);
    assert.equal((await b.store.inspect(designOnly)).designs[0].state, 'different');
    await assert.rejects(b.store.importPackage(designOnly), error => error.status === 409);
    const copy = await b.store.importPackage(designOnly, { mode: 'copy' });
    assert.notEqual(copy.designsImported[0].id, created.id); assert.equal(copy.designsImported[0].name, '共有するテンプレート（受け取り）');
    const updated = await b.store.importPackage(designOnly, { mode: 'update' });
    assert.equal(updated.designsImported[0].mode, 'update');
    assert.equal((await b.designs.get(created.id)).design.description, '改訂版');
    const same = await b.store.importPackage(designOnly);
    assert.equal(same.designsKept[0].reason, 'same');
  } finally { await a.close(); await b.close(); }
});

test('HTML単体の講義も共有できる', async () => {
  const a = await workspace('html-a'), b = await workspace('html-b');
  try {
    const directory = join(a.root, 'lectures', 'deck');
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'html-deck.json'), JSON.stringify({ version: 1, format: 'html', title: 'HTMLの講義', category: 'ai', slides: 2 }));
    await writeFile(join(directory, 'slides.html'), '<!doctype html><p>deck</p>');
    await writeFile(join(directory, 'notes.txt'), 'private');
    const exported = await a.store.exportLecture('deck', { author: 'A' });
    assert.deepEqual(await names(exported.path), ['lecture/html-deck.json', 'lecture/slides.html', 'share.json']);
    const imported = await b.store.importPackage(await readFile(exported.path));
    assert.equal(imported.slug, 'deck');
    assert.ok(await exists(join(b.root, 'lectures', 'deck', 'slides.html')));
  } finally { await a.close(); await b.close(); }
});

test('共有API：スタジオの画面からの要求だけ受け付け、書き出し・確認・取り込み・衝突の確認を返す', async () => {
  const { createServer } = await import('node:http');
  const { createShareApi } = await import('../tools/lib/share-api.mjs');
  const a = await workspace('api-a'), b = await workspace('api-b', ['SKS-ZZZZ-0001']);
  const fromStudio = (request, type = 'application/json') => request.headers.origin === `http://${request.headers.host}` && request.headers['x-studio-editor'] === '1' && (request.headers['content-type'] ?? '').split(';')[0] === type;
  const serve = store => new Promise(done => { const api = createShareApi({ store, fromStudio, localRequest: () => true }); const server = createServer(async (request, response) => { if (!await api.handle(request, response, new URL(request.url, 'http://127.0.0.1'))) { response.writeHead(404); response.end(); } }); server.listen(0, '127.0.0.1', () => done(server)); });
  const sa = await serve(a.store), sb = await serve(b.store);
  const base = server => `http://127.0.0.1:${server.address().port}`;
  const studio = (server, type) => ({ Origin: base(server), 'X-Studio-Editor': '1', 'Content-Type': type });
  try {
    await addLecture(a.root, 'sample');
    assert.equal((await fetch(`${base(sa)}/api/share/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lecture: 'sample' }) })).status, 403);
    const noName = await fetch(`${base(sa)}/api/share/export`, { method: 'POST', headers: studio(sa, 'application/json'), body: JSON.stringify({ lecture: 'sample' }) });
    assert.equal(noName.status, 422); assert.equal((await noName.json()).needAuthor, true);
    const exported = await fetch(`${base(sa)}/api/share/export`, { method: 'POST', headers: studio(sa, 'application/json'), body: JSON.stringify({ lecture: 'sample', author: '送り主A', audio: false }) });
    assert.equal(exported.status, 200); assert.equal(exported.headers.get('X-Share-Id'), 'SKS-AAAA-0001');
    assert.match(decodeURIComponent(exported.headers.get('Content-Disposition')), /_v1\.zip$/);
    const zip = Buffer.from(await exported.arrayBuffer());
    assert.equal((await (await fetch(`${base(sa)}/api/share/settings`)).json()).author, '送り主A');
    assert.equal((await fetch(`${base(sb)}/api/share/import`, { method: 'POST', headers: { ...studio(sb, 'application/zip'), Origin: 'http://evil.example' }, body: zip })).status, 403);
    const inspected = await (await fetch(`${base(sb)}/api/share/inspect`, { method: 'POST', headers: studio(sb, 'application/zip'), body: zip })).json();
    assert.equal(inspected.title, demo.title); assert.equal(inspected.lecture.audio, false); assert.equal(inspected.existing, null);
    const first = await fetch(`${base(sb)}/api/share/import`, { method: 'POST', headers: studio(sb, 'application/zip'), body: zip });
    assert.equal(first.status, 201); const created = await first.json(); assert.equal(created.slug, 'sample'); assert.equal(created.backup, undefined);
    const conflict = await fetch(`${base(sb)}/api/share/import`, { method: 'POST', headers: studio(sb, 'application/zip'), body: zip });
    assert.equal(conflict.status, 409); assert.equal((await conflict.json()).summary.existing.slug, 'sample');
    const updated = await (await fetch(`${base(sb)}/api/share/import?mode=update`, { method: 'POST', headers: studio(sb, 'application/zip'), body: zip })).json();
    assert.equal(updated.mode, 'update'); assert.equal(updated.backedUp, true); assert.equal(JSON.stringify(updated).includes(JSON.stringify(b.root).slice(1, -1)), false);
  } finally { sa.close(); sb.close(); await a.close(); await b.close(); }
});
