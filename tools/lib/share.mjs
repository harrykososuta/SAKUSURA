// 講義・デザインテンプレートを、ほかの人の SAKUSURA へファイル（ZIP）で受け渡す。ネットワークは使わない。
// 書き出し：exportLecture / exportDesign → exports/share/<題名>_v<版>.zip
// 取り込み：inspectPackage（中身の確認・衝突の判定だけ）→ importPackage（展開）
// 仕様の説明は docs/SHARE.md。
import { readdir, readFile, writeFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { ROOT } from './project.mjs';
import { writeZip } from './write-zip.mjs';
import { readZip } from './zip.mjs';
import { validateLecture } from '../../src/core.js';
import { validateDesign } from '../../src/design-theme.js';
import { readHtmlDeck } from './html-decks.mjs';
import { createDesignStore } from './design-store.mjs';

export const SHARE_FORMAT = 'sakusura-share';
const FORMAT_VERSION = 1;
const LIMITS = { zip: 1024 ** 3, entries: 5000, entry: 300 * 1024 ** 2, total: 2 * 1024 ** 3 };
const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const DESIGN_ID = /^design-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const SHARE_ID = /^SKS-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;
const fail = (status, message, extra = {}) => { throw Object.assign(new Error(message), { status, ...extra }); };
const sha256 = data => createHash('sha256').update(data).digest('hex');
const readJsonFile = async path => JSON.parse((await readFile(path, 'utf8')).replace(/^﻿/, ''));
const exists = async path => { try { await stat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };

// 講義フォルダーのうち、共有する（＝取り込みで受け付ける）ファイル。作者用の作業ファイル（backups/・組み立てスクリプト・画像の依頼書・Orcaの状態）は入れない。
// 画像は配信できる png/jpg/webp だけ（SVGは配信もしないので受け付けない）。HTML単体の講義の slides.html は隔離CSPで表示される。
export function sharedLecturePath(path, type) {
  if (type === 'json' && ['lecture.json', 'theme.css', 'DESCRIPTION.md'].includes(path)) return true;
  if (type === 'html' && ['html-deck.json', 'slides.html', 'DESCRIPTION.md'].includes(path)) return true;
  if (type !== 'json') return false;
  if (/^images\/ORCA_TASK/i.test(path)) return false;
  if (/^images\/[a-zA-Z0-9][a-zA-Z0-9_.-]{0,120}\.(png|jpg|webp|json)$/.test(path)) return !/\.\./.test(path);
  return /^audio\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,120}\.(wav|json)$/.test(path);
}
const isAudio = path => path.startsWith('audio/');

// 共有ID（ナンバープレート）：SKS-XXXX-XXXX。読み違えやすい I L O U を除いた32文字。
export function newShareId(random = randomBytes) {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ', bytes = random(8);
  const chars = [...bytes].map(byte => alphabet[byte & 31]).join('');
  return `SKS-${chars.slice(0, 4)}-${chars.slice(4, 8)}`;
}

export function createShareStore({ root = ROOT, now = () => new Date(), createId = newShareId, designStore } = {}) {
  const lecturesDirectory = join(root, 'lectures'), designsDirectory = join(root, 'designs');
  const settingsPath = join(root, 'library', 'share-settings.json'), outputDirectory = join(root, 'exports', 'share');
  designStore ??= createDesignStore({ directory: designsDirectory, lecturesDirectory });
  let queue = Promise.resolve();
  const locked = action => { const job = queue.catch(() => {}).then(action); queue = job; return job; };

  async function appVersion() {
    try { return (await readJsonFile(join(root, 'package.json'))).version ?? null; } catch { return null; }
  }
  async function settings() {
    try { return await readJsonFile(settingsPath); } catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return {}; throw error; }
  }
  async function resolveAuthor(author) {
    const value = (author ?? (await settings()).author ?? '').trim().normalize('NFC');
    if (!value) fail(422, '送り主の名前が未登録です。初回は --author "名前" を付けてください（次回から省略できます）。');
    if (value.length > 60 || /[\u0000-\u001f\u007f]/.test(value)) fail(422, '送り主の名前は60文字以内で入力してください。');
    if (author) { await mkdir(dirname(settingsPath), { recursive: true }); await writeFile(settingsPath, `${JSON.stringify({ ...(await settings()), author: value }, null, 2)}\n`); }
    return value;
  }

  async function lectureType(slug) {
    if (!SLUG.test(slug ?? '')) fail(400, '講義名は半角小文字・数字・_・-、64文字以内で指定してください。');
    const directory = join(lecturesDirectory, slug);
    if (await exists(join(directory, 'lecture.json'))) return { directory, type: 'json' };
    if (await exists(join(directory, 'html-deck.json'))) return { directory, type: 'html' };
    fail(404, `lectures/${slug} に講義が見つかりません。`);
  }
  async function collect(directory, type, { audio = true } = {}) {
    const files = [];
    async function walk(relative) {
      for (const entry of await readdir(join(directory, relative), { withFileTypes: true })) {
        const path = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory()) { if (['images', 'audio'].includes(path)) await walk(path); continue; }
        if (!entry.isFile() || !sharedLecturePath(path, type) || (!audio && isAudio(path))) continue;
        files.push(path);
      }
    }
    await walk('');
    return files.sort();
  }
  // 講義の中身（音声以外）のハッシュ。取り込み後に手を加えたか・前回の書き出しから変わったかの判定に使う。
  async function contentHash(directory, type) {
    const parts = [];
    for (const path of await collect(directory, type, { audio: false })) parts.push(`${path}\n${sha256(await readFile(join(directory, path)))}`);
    return sha256(parts.join('\n'));
  }
  async function readLocalShare(directory) {
    try {
      const share = await readJsonFile(join(directory, 'share.json'));
      return share && SHARE_ID.test(share.id ?? '') && Number.isInteger(share.revision) && share.revision > 0 ? share : null;
    } catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return null; throw error; }
  }
  async function readLectureMeta(directory, type) {
    if (type === 'json') {
      const lecture = await readJsonFile(join(directory, 'lecture.json')), errors = validateLecture(lecture);
      if (errors.length) fail(422, `講義の形式に問題があります：${errors.slice(0, 3).join(' / ')}`);
      return { title: lecture.title, category: lecture.category ?? null, design: lecture.design ?? null };
    }
    const deck = await readJsonFile(join(directory, 'html-deck.json'));
    return { title: deck.title, category: deck.category ?? null, design: null };
  }
  // 講義が使っているデザインテンプレート。PDF原本・参考PDFつきのデザインは追加ファイルが要るため、この版では同梱しない（講義のCSSは lecture.json に入っているので見た目は再現される）。
  async function shareableDesign(id) {
    if (!DESIGN_ID.test(id ?? '')) return { record: null };
    try {
      const record = await readJsonFile(join(designsDirectory, `${id}.json`));
      if (record.id !== id || validateDesign(record.design).length) return { record: null, skipped: `${id}（形式を確認できません）` };
      if (record.design.pdfSource || record.referencePdfId) return { record: null, skipped: `${record.design.name}（PDFから作ったデザインは未対応）` };
      return { record: { id: record.id, design: record.design, createdAt: record.createdAt, updatedAt: record.updatedAt } };
    } catch (error) { if (error.code === 'ENOENT') return { record: null, skipped: `${id}（手元にありません）` }; throw error; }
  }
  // 題名を短縮してから番号を付ける。番号まで短縮すると長い題名で保存先が変わらなくなる。
  const fileName = (title, revision, copy = 1) => `${(title || 'share').normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 60) || 'share'}${copy > 1 ? `_${copy}` : ''}_v${revision}.zip`;
  async function writePackage(manifest, files) {
    const entries = [{ name: 'share.json', data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) }, ...files];
    const zip = writeZip(entries);
    await mkdir(outputDirectory, { recursive: true });
    let path;
    for (let n = 1; n <= 1000; n++) {
      const candidate = join(outputDirectory, fileName(manifest.title, manifest.revision, n));
      if (!await exists(candidate)) { path = candidate; break; }
    }
    if (!path) fail(409, '同じ名前の共有ファイルが多すぎます。exports/share のファイルを整理してから、もう一度書き出してください。');
    const temp = `${path}.${randomUUID()}.tmp`;
    await writeFile(temp, zip); await rename(temp, path);
    return { path, size: zip.length };
  }

  // 講義を共有用ZIPにする。共有IDは最初の書き出しで発行して lectures/<slug>/share.json に残し、以後は変えない。
  // 受け取った講義：手を加えずに書き出す＝同じID・同じ版のまま転送／手を加えた＝新しいIDを発行し originId に元のIDを残す。
  async function exportLecture(slug, { author, audio = true } = {}) {
    return locked(async () => {
      const { directory, type } = await lectureType(slug);
      const meta = await readLectureMeta(directory, type), name = await resolveAuthor(author);
      const local = await readLocalShare(directory), hash = await contentHash(directory, type);
      let share;
      if (!local) share = { version: 1, id: createId(), revision: 1, author: name };
      else if (local.importedAt) share = local.contentHash === hash ? { ...local } : { version: 1, id: createId(), revision: 1, author: name, originId: local.originId ?? local.id };
      else share = { ...local, revision: local.contentHash === hash ? local.revision : local.revision + 1, author: name };
      const forwarded = Boolean(local?.importedAt && local.contentHash === hash);
      const paths = await collect(directory, type, { audio });
      if (type === 'json' && !paths.includes('lecture.json')) fail(422, 'lecture.json を読めません。');
      const files = [], list = [];
      for (const path of paths) { const data = await readFile(join(directory, path)); files.push({ name: `lecture/${path}`, data }); list.push({ path: `lecture/${path}`, size: data.length, sha256: sha256(data) }); }
      const designs = [], skipped = [];
      const used = await shareableDesign(meta.design);
      if (used.record) { const data = Buffer.from(`${JSON.stringify(used.record, null, 2)}\n`); files.push({ name: `designs/${used.record.id}.json`, data }); list.push({ path: `designs/${used.record.id}.json`, size: data.length, sha256: sha256(data) }); designs.push(used.record.id); }
      if (used.skipped) skipped.push(used.skipped);
      const manifest = {
        format: SHARE_FORMAT, formatVersion: FORMAT_VERSION, kind: 'lecture',
        id: share.id, revision: share.revision, author: forwarded ? local.author : name, ...(share.originId ? { originId: share.originId } : {}),
        title: meta.title, exportedAt: now().toISOString(), sakusuraVersion: await appVersion(),
        lecture: { slug, type, category: meta.category, audio: paths.some(isAudio) }, designs, files: list,
      };
      const output = await writePackage(manifest, files);
      if (!forwarded) {
        const saved = { version: 1, id: share.id, revision: share.revision, author: name, ...(share.originId ? { originId: share.originId } : {}), contentHash: hash, exportedAt: manifest.exportedAt };
        await writeFile(join(directory, 'share.json'), `${JSON.stringify(saved, null, 2)}\n`);
      }
      return { ...output, manifest, forwarded, skipped };
    });
  }

  // デザインテンプレートだけを共有用ZIPにする。識別番号はデザインの design-<UUID> をそのまま使う。
  async function exportDesign(id, { author } = {}) {
    return locked(async () => {
      if (!DESIGN_ID.test(id ?? '')) fail(400, 'デザインのID（design-<UUID>）を指定してください。npm run designs で一覧を確認できます。');
      const name = await resolveAuthor(author), used = await shareableDesign(id);
      if (!used.record) fail(422, `このデザインは共有できません：${used.skipped ?? id}`);
      const data = Buffer.from(`${JSON.stringify(used.record, null, 2)}\n`);
      const manifest = {
        format: SHARE_FORMAT, formatVersion: FORMAT_VERSION, kind: 'design', id, revision: 1, author: name,
        title: used.record.design.name, exportedAt: now().toISOString(), sakusuraVersion: await appVersion(),
        designs: [id], files: [{ path: `designs/${id}.json`, size: data.length, sha256: sha256(data) }],
      };
      return { ...(await writePackage(manifest, [{ name: `designs/${id}.json`, data }])), manifest, skipped: [] };
    });
  }

  // ZIPを読み、形式・ハッシュ・パスをすべて確かめる。ここで弾いたものは1ファイルも書かない。
  function openPackage(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 22 || buffer.length > LIMITS.zip) fail(422, '共有ファイル（ZIP）として読めません。サイズを確認してください。');
    let zip;
    try { zip = readZip(buffer, '共有ファイル', { maxEntrySize: LIMITS.entry }); } catch (error) { fail(422, error.message); }
    if (zip.names.length > LIMITS.entries) fail(422, '共有ファイルのファイル数が多すぎます。');
    if (zip.names.reduce((sum, name) => sum + zip.size(name), 0) > LIMITS.total) fail(422, '共有ファイルの展開後のサイズが大きすぎます。');
    if (!zip.has('share.json')) fail(422, 'SAKUSURAの共有ファイルではありません（share.json がありません）。');
    let manifest;
    try { manifest = JSON.parse(zip.text('share.json').replace(/^﻿/, '')); } catch { fail(422, 'share.json を読めません。'); }
    if (manifest?.format !== SHARE_FORMAT) fail(422, 'SAKUSURAの共有ファイルではありません。');
    if (manifest.formatVersion !== FORMAT_VERSION) fail(422, `この共有ファイルは新しい形式（${manifest.formatVersion}）です。SAKUSURAを更新してから取り込んでください。`);
    if (!['lecture', 'design'].includes(manifest.kind) || typeof manifest.title !== 'string' || !manifest.title.trim() || manifest.title.length > 200 || typeof manifest.author !== 'string' || manifest.author.length > 60 || !Number.isInteger(manifest.revision) || manifest.revision < 1 || !Array.isArray(manifest.files) || !Array.isArray(manifest.designs) || manifest.designs.some(id => !DESIGN_ID.test(id))) fail(422, 'share.json の内容を確認してください。');
    if (manifest.kind === 'lecture' && (!SHARE_ID.test(manifest.id ?? '') || !SLUG.test(manifest.lecture?.slug ?? '') || !['json', 'html'].includes(manifest.lecture?.type) || (manifest.originId !== undefined && !SHARE_ID.test(manifest.originId)))) fail(422, 'share.json の講義情報を確認してください。');
    if (manifest.kind === 'design' && (!DESIGN_ID.test(manifest.id ?? '') || manifest.designs.length !== 1 || manifest.designs[0] !== manifest.id)) fail(422, 'share.json のデザイン情報を確認してください。');
    const listed = new Map();
    for (const file of manifest.files) {
      const path = file?.path;
      if (typeof path !== 'string' || listed.has(path) || !/^[0-9a-f]{64}$/.test(file.sha256 ?? '')) fail(422, 'share.json のファイル一覧を確認してください。');
      const lecturePath = path.startsWith('lecture/') ? path.slice(8) : null, design = path.match(/^designs\/(design-[0-9a-f-]{36})\.json$/);
      const allowed = manifest.kind === 'lecture' && lecturePath ? sharedLecturePath(lecturePath, manifest.lecture.type) : design && manifest.designs.includes(design[1]);
      if (!allowed) fail(422, `共有ファイルに受け付けないファイルがあります：${path}`);
      listed.set(path, file.sha256);
    }
    const extra = zip.names.filter(name => name !== 'share.json' && !name.endsWith('/') && !listed.has(name));
    if (extra.length) fail(422, `一覧にないファイルが入っています：${extra[0]}`);
    for (const id of manifest.designs) if (!listed.has(`designs/${id}.json`)) fail(422, `デザイン ${id} のファイルがありません。`);
    const files = new Map();
    for (const [path, hash] of listed) {
      if (!zip.has(path)) fail(422, `${path} がありません。`);
      let data;
      try { data = zip.read(path); } catch (error) { fail(422, error.message); }
      if (sha256(data) !== hash) fail(422, `${path} が壊れているか、書き換えられています。`);
      files.set(path, data);
    }
    if (manifest.kind === 'lecture') {
      const type = manifest.lecture.type;
      if (type === 'json') {
        if (!files.has('lecture/lecture.json')) fail(422, 'lecture.json がありません。');
        let lecture;
        try { lecture = JSON.parse(files.get('lecture/lecture.json').toString('utf8').replace(/^﻿/, '')); } catch { fail(422, 'lecture.json を読めません。'); }
        const errors = validateLecture(lecture);
        if (errors.length) fail(422, `講義の形式に問題があります（SAKUSURAの版が違う可能性があります）：${errors.slice(0, 3).join(' / ')}`);
      } else if (!files.has('lecture/html-deck.json') || !files.has('lecture/slides.html')) fail(422, 'HTMLスライドのファイルが足りません。');
    }
    const designs = [];
    for (const id of manifest.designs) {
      let record;
      try { record = JSON.parse(files.get(`designs/${id}.json`).toString('utf8')); } catch { fail(422, `デザイン ${id} を読めません。`); }
      if (record?.id !== id || validateDesign(record.design).length || record.design.pdfSource || record.referencePdfId) fail(422, `デザイン ${id} の形式を確認してください。`);
      designs.push(record);
    }
    return { manifest, files, designs };
  }

  async function lectureEntries() {
    const result = [];
    let entries = [];
    try { entries = await readdir(lecturesDirectory, { withFileTypes: true }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    for (const entry of entries) if (entry.isDirectory() && SLUG.test(entry.name)) result.push({ slug: entry.name, share: await readLocalShare(join(lecturesDirectory, entry.name)) });
    return result;
  }
  async function freeSlug(base) {
    for (let n = 1; n < 1000; n++) {
      const suffix = n === 1 ? '' : `-${n}`, slug = `${base.slice(0, 64 - suffix.length)}${suffix}`;
      if (!await exists(join(lecturesDirectory, slug))) return slug;
    }
    fail(409, '取り込み先の講義名を決められません。');
  }
  const compareVersion = (a, b) => {
    const pa = String(a ?? '').split('.').map(Number), pb = String(b ?? '').split('.').map(Number);
    for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return Math.sign(d); }
    return 0;
  };

  // 取り込む前の確認。何も書かずに、衝突（同じ共有IDの講義が手元にあるか）と注意点を返す。
  const inspect = buffer => summarize(openPackage(buffer));
  async function summarize({ manifest, designs }) {
    const warnings = [], local = await appVersion();
    if (manifest.sakusuraVersion && local && compareVersion(manifest.sakusuraVersion, local) > 0) warnings.push(`送り主のSAKUSURA（${manifest.sakusuraVersion}）の方が新しい版です。一部の表示が再現されない場合は、SAKUSURAを更新してください。`);
    const summary = { kind: manifest.kind, id: manifest.id, revision: manifest.revision, author: manifest.author, title: manifest.title, exportedAt: manifest.exportedAt, sakusuraVersion: manifest.sakusuraVersion ?? null, originId: manifest.originId ?? null, warnings, designs: [] };
    for (const record of designs) {
      let state = 'new';
      try { const current = await designStore.get(record.id, { includeTrash: true }); state = JSON.stringify(current.design) === JSON.stringify(record.design) ? 'same' : 'different'; }
      catch (error) { if (error.status !== 404) throw error; }
      summary.designs.push({ id: record.id, name: record.design.name, state });
    }
    if (manifest.kind === 'lecture') {
      const match = (await lectureEntries()).find(item => item.share?.id === manifest.id);
      summary.lecture = { slug: manifest.lecture.slug, type: manifest.lecture.type, category: manifest.lecture.category ?? null, audio: manifest.lecture.audio === true, files: manifest.files.length };
      summary.existing = match ? { slug: match.slug, revision: match.share.revision, imported: Boolean(match.share.importedAt) } : null;
      if (match && match.share.revision > manifest.revision) warnings.push(`手元の「${match.slug}」の方が新しい版（v${match.share.revision}）です。更新すると古い版（v${manifest.revision}）に戻ります。`);
      if (match && match.share.revision === manifest.revision) warnings.push(`同じ版（v${manifest.revision}）がすでに手元にあります（${match.slug}）。`);
    }
    return summary;
  }

  // 取り込み。mode：同じ共有IDの講義が手元にあるときに 'update'（置き換え。元の講義はバックアップ）か 'copy'（別の講義として追加）。
  // 同じ共有IDがなければ mode は不要。講義のカテゴリは送り主のものを変えずに残し、「共有で受け取った」タブ（share.json の inbox）に入れる。
  async function importPackage(buffer, { mode } = {}) {
    return locked(async () => {
      const parsed = openPackage(buffer), { manifest, files, designs } = parsed;
      const summary = await summarize(parsed);
      if (manifest.kind === 'design' && summary.designs[0].state === 'different' && !['update', 'copy'].includes(mode)) fail(409, `同じデザイン（${summary.designs[0].name}）が中身の違う状態ですでにあります。更新するか（--mode update）、別のデザインとして残すか（--mode copy）を選んでください。`, { summary });
      const result = { ...summary, designsImported: [], designsKept: [] };
      for (const record of designs) await importDesign(record, manifest.kind === 'design' ? mode : 'keep', result);
      if (manifest.kind === 'design') return result;
      if (summary.existing && !['update', 'copy'].includes(mode)) fail(409, `同じ講義（${summary.existing.slug}・v${summary.existing.revision}）がすでにあります。更新するか（--mode update）、別の講義として残すか（--mode copy）を選んでください。`, { summary });
      const update = summary.existing && mode === 'update';
      const slug = update ? summary.existing.slug : await freeSlug(manifest.lecture.slug);
      // 作業フォルダー（tmp/share-import/<uuid>/<slug>）で組み立てて検査してから、講義フォルダーへ移す。途中で失敗しても lectures/ には何も残らない。
      const target = join(lecturesDirectory, slug), workRoot = join(root, 'tmp', 'share-import', randomUUID()), temp = join(workRoot, slug);
      await mkdir(temp, { recursive: true });
      try {
        for (const [path, data] of files) {
          if (!path.startsWith('lecture/')) continue;
          const destination = join(temp, ...path.slice(8).split('/'));
          await mkdir(dirname(destination), { recursive: true });
          await writeFile(destination, data);
        }
        const type = manifest.lecture.type, importedAt = now().toISOString();
        if (type === 'html') { try { await readHtmlDeck(slug, { directory: workRoot }); } catch { fail(422, 'HTMLスライドの形式を確認してください。'); } }
        const hash = await contentHash(temp, type);
        const share = { version: 1, id: manifest.id, revision: manifest.revision, author: manifest.author, ...(manifest.originId ? { originId: manifest.originId } : {}), contentHash: hash, exportedAt: manifest.exportedAt, importedAt, inbox: true };
        await writeFile(join(temp, 'share.json'), `${JSON.stringify(share, null, 2)}\n`);
        await mkdir(lecturesDirectory, { recursive: true });
        if (update) {
          // 元の講義は消さずに library/backups/share/ へ移す（戻したいときはフォルダーを lectures/ に戻す）。
          const backup = join(root, 'library', 'backups', 'share', `${slug}-${importedAt.replace(/[:.]/g, '-')}`);
          await mkdir(dirname(backup), { recursive: true });
          await rename(target, backup);
          result.backup = backup;
          try { await rename(temp, target); } catch (error) { await rename(backup, target); throw error; }
        } else await rename(temp, target);
      } finally { await rm(workRoot, { recursive: true, force: true }); }
      return { ...result, slug, mode: update ? 'update' : summary.existing ? 'copy' : 'new' };
    });
  }
  // デザイン：同じIDで中身も同じ→何もしない。同じIDで中身が違う→講義と一緒の取り込みでは手元を残す（デザインだけの取り込みで mode=update なら更新、copy なら別IDで追加）。
  async function importDesign(record, mode, result) {
    let current = null;
    try { current = await designStore.get(record.id, { includeTrash: true }); } catch (error) { if (error.status !== 404) throw error; }
    if (current && JSON.stringify(current.design) === JSON.stringify(record.design)) { result.designsKept.push({ id: record.id, name: record.design.name, reason: 'same' }); return; }
    if (current && mode === 'update') {
      const saved = await designStore.change({ op: 'update', id: record.id, revision: current.revision, design: { ...record.design, name: current.design.name } });
      result.designsImported.push({ id: saved.id ?? record.id, name: current.design.name, mode: 'update' }); return;
    }
    if (current && mode !== 'copy') { result.designsKept.push({ id: record.id, name: current.design.name, reason: 'different' }); return; }
    const design = structuredClone(record.design);
    const names = new Set((await designStore.list({ includeTrash: true })).designs.map(item => item.design.name.trim().normalize('NFKC').toLocaleLowerCase('ja')));
    const base = design.name.trim();
    for (let n = 1; names.has(design.name.trim().normalize('NFKC').toLocaleLowerCase('ja')); n++) design.name = `${base}（受け取り${n === 1 ? '' : n}）`.slice(0, 80);
    const saved = await designStore.change({ op: 'create', design }, current ? {} : { createId: record.id });
    result.designsImported.push({ id: saved.id, name: design.name, mode: current ? 'copy' : 'new' });
  }

  // 「共有で受け取った」タブから外す（ライブラリの「整理」で自分のカテゴリ・フォルダーへ移したとき）。
  async function leaveInbox(slug) {
    if (!SLUG.test(slug ?? '')) return false;
    const path = join(lecturesDirectory, slug, 'share.json'), share = await readLocalShare(join(lecturesDirectory, slug));
    if (!share?.inbox) return false;
    await writeFile(path, `${JSON.stringify({ ...share, inbox: false }, null, 2)}\n`);
    return true;
  }
  async function inbox() {
    return (await lectureEntries()).filter(item => item.share?.importedAt && item.share.inbox).map(item => ({ slug: item.slug, id: item.share.id, revision: item.share.revision, author: item.share.author, importedAt: item.share.importedAt }));
  }

  const publicSettings = async () => ({ author: (await settings()).author ?? '' });
  return { exportLecture, exportDesign, inspect, importPackage, leaveInbox, inbox, settings: publicSettings, outputDirectory };
}
