import { readFile, readdir, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { ROOT } from './project.mjs';
import { standardDesign, validateDesign, STANDARD_DESIGN_ID } from '../../src/design-theme.js';
import { createDesignPdfStore, isDesignPdfId } from './design-pdf-store.mjs';
import { createPdfDesignStore } from './pdf-design-store.mjs';

const queues = new Map();
const hash = raw => createHash('sha256').update(raw).digest('hex');
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const customId = value => typeof value === 'string' && /^design-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
const sameName = (a, b) => a.trim().normalize('NFKC').toLocaleLowerCase('ja') === b.trim().normalize('NFKC').toLocaleLowerCase('ja');
// 分類・削除とカテゴリ割り当てを同じロックで保存し、使用中のデザインを削除しない。
export function withDesignLock(directory, action) {
  directory = resolve(directory);
  const job = (queues.get(directory) ?? Promise.resolve()).catch(() => {}).then(action);
  queues.set(directory, job);
  job.finally(() => { if (queues.get(directory) === job) queues.delete(directory); }).catch(() => {});
  return job;
}
export function createDesignStore({ directory = join(ROOT, 'designs'), lecturesDirectory = join(ROOT, 'lectures'), pdfStore = createDesignPdfStore({ directory: join(directory, 'references') }), pdfDesignStore = createPdfDesignStore({ directory: join(directory, 'pdf-pages'), pdfStore }) } = {}) {
  directory = resolve(directory);
  const organizationPath = join(directory, 'organization.json');
  async function organization() {
    try {
      const raw = await readFile(organizationPath), data = JSON.parse(raw);
      if (data.version !== 1 || !data.locations || typeof data.locations !== 'object' || Array.isArray(data.locations)
        || Object.entries(data.locations).some(([id, item]) => !(id === STANDARD_DESIGN_ID || customId(id)) || !item || !['active', 'unused', 'trash'].includes(item.folder) || (item.restoreFolder !== undefined && !['active', 'unused'].includes(item.restoreFolder)) || (id === STANDARD_DESIGN_ID && item.folder === 'trash'))) fail(422, 'デザインの整理情報を確認してください。');
      return { data, revision: hash(raw) };
    } catch (error) { if (error.code !== 'ENOENT') throw error; return { data: { version: 1, locations: {} }, revision: null }; }
  }
  async function get(id, { includeTrash = false, locations } = {}) {
    const state = (locations ?? (await organization()).data.locations)[id];
    if (state?.folder === 'trash' && !includeTrash) fail(404, 'このデザインはゴミ箱にあります。一覧のゴミ箱から復元できます。');
    const location = { folder: state?.folder ?? 'active', ...(state?.restoreFolder ? { restoreFolder: state.restoreFolder } : {}) };
    if (id === STANDARD_DESIGN_ID) return { id, design: standardDesign(), revision: state ? hash(JSON.stringify(state)) : null, builtin: true, ...location };
    if (!customId(id)) fail(400, 'デザインのIDを確認してください。');
    let raw;
    try { raw = await readFile(join(directory, `${id}.json`)); } catch (error) { if (error.code === 'ENOENT') fail(404, 'デザインが見つかりません。'); throw error; }
    let record;
    try { if (raw.length > 262144) throw new Error(); record = JSON.parse(raw.toString('utf8')); if (record.id !== id || validateDesign(record.design).length) throw new Error(); }
    catch { fail(422, '保存済みデザインの形式を確認してください。'); }
    if (record.referencePdfId !== undefined && !isDesignPdfId(record.referencePdfId)) fail(422, '参考PDFの保存情報を確認してください。');
    return { ...record, builtin: false, contentRevision: hash(raw), revision: state ? hash(hash(raw) + JSON.stringify(state)) : hash(raw), ...location };
  }
  async function list({ includeTrash = false } = {}) {
    const { locations } = (await organization()).data;
    let entries = [];
    try { entries = await readdir(directory, { withFileTypes: true }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const saved = await Promise.all(entries.filter(item => item.isFile() && item.name.endsWith('.json') && customId(item.name.slice(0, -5)) && (includeTrash || locations[item.name.slice(0, -5)]?.folder !== 'trash')).map(item => get(item.name.slice(0, -5), { includeTrash, locations })));
    saved.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { designs: [await get(STANDARD_DESIGN_ID, { locations }), ...saved] };
  }
  async function usage(id) {
    const result = { categories: [], lectures: [] };
    try { const config = JSON.parse(await readFile(join(directory, 'category-presets.json'), 'utf8')); result.categories = (config.categories ?? []).filter(item => item.designId === id).map(item => item.name); }
    catch (error) { if (error.code !== 'ENOENT') fail(422, 'カテゴリの使用状況を確認できません。'); }
    let entries = [];
    try { entries = await readdir(lecturesDirectory, { withFileTypes: true }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    for (const entry of entries.filter(item => item.isDirectory())) {
      try { const lecture = JSON.parse((await readFile(join(lecturesDirectory, entry.name, 'lecture.json'), 'utf8')).replace(/^\uFEFF/, '')); if (lecture.design === id) result.lectures.push(lecture.title || entry.name); }
      catch (error) { if (error.code !== 'ENOENT') fail(422, '講義での使用状況を確認できません。'); }
    }
    return result;
  }
  async function organize(body) {
    const previous = await get(body.id, { includeTrash: true });
    if (body.revision !== previous.revision) fail(409, '別の画面で更新されています。再読み込みしてから操作してください。');
    const current = await organization();
    let folder = body.folder;
    if (body.op === 'trash') {
      if (previous.builtin) fail(403, '標準デザインは削除できません。「使わない」に収納できます。');
      if (previous.folder === 'trash') fail(409, 'すでにゴミ箱にあります。');
      const used = await usage(body.id);
      if (used.categories.length || used.lectures.length) fail(409, `使用中のため削除できません。${used.categories.length ? ` カテゴリ：${used.categories.join('、')}。` : ''}${used.lectures.length ? ` 講義：${used.lectures.slice(0, 3).join('、')}${used.lectures.length > 3 ? ' ほか' : ''}。` : ''}「使わない」への移動はできます。`);
      folder = 'trash';
    } else if (body.op === 'restore') {
      if (previous.folder !== 'trash') fail(409, 'ゴミ箱のデザインを選んでください。');
      if (body.folder !== undefined && !['active', 'unused'].includes(body.folder)) fail(422, '復元先を確認してください。');
      folder = body.folder ?? previous.restoreFolder ?? 'active';
    } else if (!['active', 'unused'].includes(folder) || previous.folder === 'trash') fail(422, '移動先を確認してください。');
    current.data.locations[body.id] = { folder, version: randomUUID(), ...(folder === 'trash' ? { restoreFolder: previous.folder } : {}) };
    await mkdir(directory, { recursive: true });
    const temp = join(directory, `.organization-${randomUUID()}.tmp`);
    try {
      await writeFile(temp, JSON.stringify(current.data, null, 2) + '\n', { flag: 'wx' });
      if ((await organization()).revision !== current.revision) fail(409, '整理情報が変更されました。再読み込みしてください。');
      await rename(temp, organizationPath);
    } finally { await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    return get(body.id, { includeTrash: true });
  }
  function change(body, { createId } = {}) {
    return withDesignLock(directory, async () => {
      if (!body || !['create', 'update', 'move', 'trash', 'restore'].includes(body.op)) fail(400, '保存する操作を確認してください。');
      if (['move', 'trash', 'restore'].includes(body.op)) return organize(body);
      const errors = validateDesign(body.design);
      if (errors.length) fail(422, errors.join('\n'));
      if (body.op === 'update' && body.id === STANDARD_DESIGN_ID) fail(403, '標準デザインは変更できません。複製して保存してください。');
      const previous = body.op === 'update' ? await get(body.id) : null;
      if (previous && previous.revision !== body.revision) fail(409, '別の画面で更新されています。再読み込みしてから編集してください。');
      if (createId && (!customId(createId) || body.op !== 'create')) fail(400, 'デザインのIDを確認してください。');
      const id = previous?.id ?? createId ?? `design-${randomUUID()}`;
      if (createId) {
        try { await get(createId); fail(409, 'このプリセットはすでに保存されています。'); }
        catch (error) { if (error.status !== 404) throw error; }
      }
      const referencePdfId = body.design.pdfSource?.pdfId ?? (Object.hasOwn(body, 'referencePdfId') ? body.referencePdfId : previous?.referencePdfId);
      const reference = referencePdfId ? await pdfStore.get(referencePdfId) : null;
      if (body.design.pdfSource) {
        const manifest = await pdfDesignStore.get(body.design.pdfSource.pdfId);
        for (const page of body.design.pdfSource.pages) {
          const original = manifest.pages.find(item => item.page === page.page);
          if (!original || page.edits.some(edit => !original.texts.some(text => text.id === edit.id && text.editable))) fail(422, 'PDFに存在するページと編集可能な文字を指定してください。');
        }
      }
      if (referencePdfId !== undefined && referencePdfId !== null && !isDesignPdfId(referencePdfId)) fail(422, '参考PDFのIDを確認してください。');
      const design = structuredClone(body.design); design.name = design.name.trim(); design.brand = design.brand.trim(); design.description = design.description.trim();
      if ((await list({ includeTrash: true })).designs.some(item => item.id !== id && sameName(item.design.name, design.name))) fail(409, '同じ名前のデザインがあります（ゴミ箱も含む）。別の名前を入力してください。');
      const now = new Date().toISOString(), record = { id, design, createdAt: previous?.createdAt ?? now, updatedAt: now, ...(reference ? { referencePdfId: reference.id, referenceName: reference.name } : {}) };
      const raw = JSON.stringify(record, null, 2) + '\n', path = join(directory, `${id}.json`);
      if (Buffer.byteLength(raw) > 262144) fail(413, 'プリセットは256KB以内で保存してください。文字の変更やページ数を減らしてください。');
      await mkdir(directory, { recursive: true });
      const temp = join(directory, `.${id}-${randomUUID()}.tmp`);
      try {
        await writeFile(temp, raw, { flag: 'wx' });
        if (previous) {
          const original = await readFile(path);
          if (hash(original) !== previous.contentRevision) fail(409, '保存中にデザインが更新されました。再読み込みしてください。');
          const backups = join(directory, 'backups'); await mkdir(backups, { recursive: true });
          await writeFile(join(backups, `${id}-${randomUUID()}.json`), original, { flag: 'wx' });
          if (hash(await readFile(path)) !== previous.contentRevision) fail(409, '保存中にデザインが更新されました。再読み込みしてください。');
        }
        await rename(temp, path);
      } finally { await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
      return get(id);
    });
  }
  return { get, list, change, directory, pdfDesignStore };
}
