import { readdir, readFile, writeFile, mkdir, rename, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ROOT, slugOf, readJson } from './project.mjs';
import { revisionOf } from './editor-store.mjs';
import { CATEGORIES, DEFAULT_CATEGORY, validCategoryId, validateLecture } from '../../src/core.js';
import { createCategoryDesignStore } from './category-design-store.mjs';
import { readHtmlDeck } from './html-decks.mjs';

// 共有で受け取った講義（lectures/<slug>/share.json。tools/lib/share.mjs が書く）。一覧の「共有で受け取った」タブと送り主の表示に使う。
const LECTURES = join(ROOT, 'lectures');
async function shareInfo(name, directory = LECTURES) {
  try {
    const share = JSON.parse((await readFile(join(directory, slugOf(name), 'share.json'), 'utf8')).replace(/^\uFEFF/, ''));
    if (typeof share?.id !== 'string' || !share.importedAt) return null;
    return { id: share.id, revision: share.revision, author: String(share.author ?? ''), importedAt: share.importedAt, inbox: share.inbox === true };
  } catch { return null; }
}
// 「整理」で自分のカテゴリ・フォルダーへ移した講義は、受け取り箱（inbox）から外す。
export async function leaveShareInbox(name, directory = LECTURES) {
  const path = join(directory, slugOf(name), 'share.json');
  let share;
  try { share = JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, '')); } catch { return; }
  if (share?.inbox !== true) return;
  await writeFile(path, `${JSON.stringify({ ...share, inbox: false }, null, 2)}\n`);
}

const error = (status, message) => { throw Object.assign(new Error(message), { status }); };
// カテゴリの一覧は designs/category-presets.json（デザイン画面で追加・削除できる）。一覧にないカテゴリの講義は「カテゴリ未設定」に入れる。
const OTHER = { id: 'other', name: 'カテゴリ未設定', color: '#738097' };
export async function libraryCategories() {
  const { categories } = await createCategoryDesignStore().get();
  return [...categories.map(({ id, name }) => ({ id, name, color: (Object.hasOwn(CATEGORIES, id) ? CATEGORIES[id] : DEFAULT_CATEGORY).colors.primary })), OTHER];
}
// フォルダーのカテゴリは形式だけ確かめる（カテゴリを削除しても分類データは読める）。
const folderCategory = id => id === OTHER.id || validCategoryId(id);
const normalizedName = value => {
  if (typeof value !== 'string') error(422, 'フォルダー名を入力してください。');
  const name = value.trim().normalize('NFC');
  if (!name || name.length > 60 || /[\\/:*?"<>|\u0000-\u001f\u007f]/.test(name) || /^\.{1,2}$/.test(name)) error(422, 'フォルダー名は60文字以内で入力してください。パスの区切りや記号 \\ / : * ? " < > | は使えません。');
  return name;
};
const sameName = (a, b) => a.normalize('NFKC').toLocaleLowerCase('ja') === b.normalize('NFKC').toLocaleLowerCase('ja');
const hiddenNames = data => new Set((data.trash ?? []).flatMap(batch => batch.lectures.map(item => item.name)));
function belongsTo(data, id, ancestor) {
  let folder = data.folders.find(item => item.id === id);
  while (folder) { if (folder.id === ancestor) return true; folder = data.folders.find(item => item.id === folder.parentId); }
  return false;
}
function selection(body, data, lectures) {
  const names = body.lectures ?? [], ids = body.folders ?? [];
  if (!Array.isArray(names) || !Array.isArray(ids) || names.length + ids.length === 0 || names.length + ids.length > 500 || !names.every(name => typeof name === 'string') || !ids.every(id => typeof id === 'string')) error(422, '操作する講義・フォルダーを選択してください（500件まで）。');
  if (names.some(name => !lectures.some(item => item.name === name)) || ids.some(id => !data.folders.some(item => item.id === id))) error(404, '選択した項目が見つかりません。一覧を更新してください。');
  return { names: [...new Set(names)], ids: [...new Set(ids)] };
}

// directory：講義フォルダーの親（通常は lectures/。検査では一時フォルダー）。
export async function listLectures({ directory = LECTURES } = {}) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(entry.name)) continue;
    try {
      const path = join(directory, entry.name, 'lecture.json'), lecture = await readJson(path);
      if (validateLecture(lecture).length) throw new Error('INVALID_LECTURE');
      const info = await stat(path);
      result.push({ name: entry.name, title: lecture.title, description: lecture.description ?? '', number: lecture.number ?? '', category: validCategoryId(lecture.category) ? lecture.category : OTHER.id, demo: lecture.demo === true, slides: lecture.slides.length, updatedAt: Math.floor(info.mtimeMs), share: await shareInfo(entry.name, directory) });
    } catch {
      try { result.push({ ...(await readHtmlDeck(entry.name, { directory })).item, share: await shareInfo(entry.name, directory) }); }
      catch { /* 不正な講義・制作途中のフォルダーは一覧へ出さない。 */ }
    }
  }
  return result.sort((a, b) => a.demo - b.demo || b.updatedAt - a.updatedAt);
}

function checkIndex(data) {
  if (data?.version !== 1 || !Array.isArray(data.folders) || data.folders.length > 1000 || !data.assignments || typeof data.assignments !== 'object' || Array.isArray(data.assignments)) throw new Error('INVALID_INDEX');
  const ids = new Set();
  for (const folder of data.folders) {
    if (!folder || !/^[0-9a-f-]{36}$/.test(folder.id ?? '') || ids.has(folder.id) || !folderCategory(folder.category) || normalizedName(folder.name) !== folder.name || folder.parentId !== null && typeof folder.parentId !== 'string') throw new Error('INVALID_FOLDER');
    ids.add(folder.id);
  }
  for (const folder of data.folders) {
    let current = folder, seen = new Set();
    while (current) {
      if (seen.has(current.id) || seen.size >= 8) throw new Error('INVALID_TREE');
      seen.add(current.id);
      if (current.parentId === null) break;
      current = data.folders.find(item => item.id === current.parentId && item.category === folder.category);
      if (!current) throw new Error('INVALID_PARENT');
    }
    if (data.folders.some(other => other.id !== folder.id && other.parentId === folder.parentId && other.category === folder.category && sameName(other.name, folder.name))) throw new Error('DUPLICATE_NAME');
  }
  for (const [name, folder] of Object.entries(data.assignments)) if (!slugOf(name) || !ids.has(folder)) throw new Error('INVALID_ASSIGNMENT');
  if (data.trash !== undefined) {
    if (!Array.isArray(data.trash)) throw new Error('INVALID_TRASH');
    const batches = new Set(), deletedNames = new Set(), deletedFolders = new Set();
    for (const batch of data.trash) {
      if (!/^[0-9a-f-]{36}$/.test(batch?.id ?? '') || batches.has(batch.id) || !Number.isFinite(Date.parse(batch.deletedAt)) || !Array.isArray(batch.lectures) || !Array.isArray(batch.folders) || !batch.assignments || typeof batch.assignments !== 'object' || Array.isArray(batch.assignments)) throw new Error('INVALID_TRASH');
      batches.add(batch.id);
      for (const lecture of batch.lectures) { if (!slugOf(lecture?.name) || typeof lecture.title !== 'string' || deletedNames.has(lecture.name) || !folderCategory(lecture.category)) throw new Error('INVALID_TRASH_LECTURE'); deletedNames.add(lecture.name); }
      for (const folder of batch.folders) {
        if (!/^[0-9a-f-]{36}$/.test(folder?.id ?? '') || ids.has(folder.id) || deletedFolders.has(folder.id) || normalizedName(folder.name) !== folder.name || !folderCategory(folder.category) || folder.parentId !== null && typeof folder.parentId !== 'string') throw new Error('INVALID_TRASH_FOLDER');
        deletedFolders.add(folder.id);
      }
      for (const [name, id] of Object.entries(batch.assignments)) if (!slugOf(name) || !batch.lectures.some(item=>item.name===name) || typeof id !== 'string') throw new Error('INVALID_TRASH_ASSIGNMENT');
    }
  }
}
function folderPath(data, folderId) {
  const names = []; let current = data.folders.find(item => item.id === folderId);
  while (current) { names.unshift(current.name); current = data.folders.find(item => item.id === current.parentId); }
  return names.join(' / ');
}

export function createLibraryStore({ directory = join(ROOT, 'library'), getLectures: loadLectures = listLectures, getCategories = libraryCategories, leaveInbox = leaveShareInbox } = {}) {
  // 一覧にないカテゴリの講義は「カテゴリ未設定」として扱う。
  async function getLectures() {
    const ids = new Set((await getCategories()).map(item => item.id));
    return (await loadLectures()).map(item => ids.has(item.category) ? item : { ...item, category: OTHER.id });
  }
  const path = join(directory, 'index.json');
  let queue = Promise.resolve();
  async function read() {
    let raw;
    try { raw = await readFile(path); }
    catch (err) { if (err.code !== 'ENOENT') throw err; return { data: { version: 1, folders: [], assignments: {} }, revision: revisionOf(''), raw: null }; }
    let data;
    try { data = JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, '')); checkIndex(data); }
    catch { error(503, '講義ライブラリの分類データを読み込めません。library/index.json とバックアップを確認してください。'); }
    return { data, revision: revisionOf(raw), raw };
  }
  async function snapshot() {
    const { data, revision } = await read(), deleted = hiddenNames(data), lectures = (await getLectures()).filter(item => !deleted.has(item.name));
    return { version: 1, revision, categories: await getCategories(), folders: data.folders.map(folder => ({ ...folder, path: folderPath(data, folder.id) })), trash: (data.trash ?? []).map(batch => ({ id: batch.id, deletedAt: batch.deletedAt, lectures: batch.lectures.map(item => ({ name:item.name, title:item.title, category:item.category })), folders: batch.folders.map(item => ({ id:item.id, name:item.name, category:item.category })), lectureCount:batch.lectures.length, folderCount:batch.folders.length })), lectures: lectures.map(lecture => {
      const folder = data.folders.find(item => item.id === data.assignments[lecture.name] && item.category === lecture.category);
      return { ...lecture, folderId: folder?.id ?? null, folderPath: folder ? folderPath(data, folder.id) : '' };
    }) };
  }
  function change(body) {
    const run = queue.catch(() => {}).then(async () => {
      const current = await read();
      if (!body || body.revision !== current.revision) error(409, '別の画面で分類が変更されています。一覧を更新してから、もう一度操作してください。');
      const data = structuredClone(current.data); let createdId = null, moved = [];
      const activeLectures = async () => { const deleted=hiddenNames(data);return (await getLectures()).filter(item=>!deleted.has(item.name)); };
      if (body.op === 'create' || body.op === 'rename') {
        const name = normalizedName(body.name);
        let folder;
        if (body.op === 'create') {
          if (data.folders.length >= 1000 || !(await getCategories()).some(item => item.id === body.category)) error(422, 'カテゴリを選択してください。フォルダーは1000個まで作成できます。');
          const parentId = body.parentId ?? null;
          if (parentId !== null && !data.folders.some(item => item.id === parentId && item.category === body.category)) error(422, '作成先のフォルダーが見つかりません。');
          folder = { id: randomUUID(), name, category: body.category, parentId }; createdId = folder.id;
          data.folders.push(folder);
        } else {
          folder = data.folders.find(item => item.id === body.id);
          if (!folder) error(404, 'フォルダーが見つかりません。');
          folder.name = name;
        }
        if (data.folders.some(other => other.id !== folder.id && other.category === folder.category && other.parentId === folder.parentId && sameName(other.name, name))) error(422, '同じ場所に同名のフォルダーがあります。別の名前を入力してください。');
      } else if (body.op === 'move') {
        const lectures=await activeLectures(), chosen=selection(body,data,lectures);
        const target=body.folderId===null?null:data.folders.find(item=>item.id===body.folderId);
        const targetCategory=target?.category??body.category;
        if (body.folderId!==null&&!target || !(await getCategories()).some(item=>item.id===targetCategory)) error(422,'移動先のフォルダー・カテゴリを選択してください。');
        const roots=chosen.ids.filter(id=>!chosen.ids.some(other=>other!==id&&belongsTo(data,id,other)));
        for(const id of roots){
          const folder=data.folders.find(item=>item.id===id);
          if(folder.category!==targetCategory) error(422,'同じカテゴリ内で移動してください。');
          if(target&&belongsTo(data,target.id,id)) error(422,'フォルダーを自分自身や内側のフォルダーには移動できません。');
          if(data.folders.some(item=>item.id!==id&&item.category===targetCategory&&item.parentId===(target?.id??null)&&sameName(item.name,folder.name))) error(422,'移動先に同名のフォルダーがあります。');
        }
        for(const name of chosen.names){if(lectures.find(item=>item.name===name).category!==targetCategory)error(422,'同じカテゴリ内で移動してください。');}
        for(const id of roots)data.folders.find(item=>item.id===id).parentId=target?.id??null;
        for(const name of chosen.names){if(target)data.assignments[name]=target.id;else delete data.assignments[name];}
        moved = chosen.names;
      } else if (body.op === 'trash') {
        const lectures=await activeLectures(), chosen=selection(body,data,lectures);
        const folderIds=new Set(data.folders.filter(item=>chosen.ids.some(id=>belongsTo(data,item.id,id))).map(item=>item.id));
        const names=new Set(chosen.names);
        for(const lecture of lectures){const folder=data.folders.find(item=>item.id===data.assignments[lecture.name]&&item.category===lecture.category);if(folder&&folderIds.has(folder.id))names.add(lecture.name);}
        const assignments=Object.fromEntries(Object.entries(data.assignments).filter(([name])=>names.has(name)));
        const batch={id:randomUUID(),deletedAt:new Date().toISOString(),lectures:lectures.filter(item=>names.has(item.name)),folders:data.folders.filter(item=>folderIds.has(item.id)),assignments};
        data.trash??=[];data.trash.push(batch);
        data.folders=data.folders.filter(item=>!folderIds.has(item.id));
        for(const [name,id] of Object.entries(data.assignments))if(names.has(name)||folderIds.has(id))delete data.assignments[name];
      } else if (body.op === 'restore') {
        if(!Array.isArray(body.ids)||!body.ids.length||body.ids.length>500||!body.ids.every(id=>typeof id==='string'))error(422,'復元する項目を選択してください（500件まで）。');
        const batches=[...new Set(body.ids)].map(id=>(data.trash??[]).find(item=>item.id===id));
        if(batches.some(item=>!item))error(404,'ごみ箱の項目が見つかりません。');
        const allLectures=await getLectures();
        if(batches.some(batch=>batch.lectures.some(item=>!allLectures.some(lecture=>lecture.name===item.name))))error(422,'元の講義ファイルが見つかりません。保存先を確認してください。');
        const restoring=batches.flatMap(batch=>batch.folders).map(item=>({...item}));
        if(restoring.some(folder=>data.folders.some(item=>item.id===folder.id)))error(409,'復元するフォルダーのIDがすでに使われています。');
        for(const folder of restoring)if(folder.parentId!==null&&![...data.folders,...restoring].some(item=>item.id===folder.parentId&&item.category===folder.category))folder.parentId=null;
        const combined=[...data.folders,...restoring];
        for(const folder of restoring)if(combined.some(item=>item.id!==folder.id&&item.category===folder.category&&item.parentId===folder.parentId&&sameName(item.name,folder.name)))error(409,'復元先に同名のフォルダーがあります。先に既存のフォルダー名を変更してください。');
        data.folders=combined;
        for(const batch of batches)for(const [name,id] of Object.entries(batch.assignments))if(data.folders.some(item=>item.id===id))data.assignments[name]=id;
        data.trash=data.trash.filter(batch=>!body.ids.includes(batch.id));
      } else if (body.op === 'delete') {
        const folder = data.folders.find(item => item.id === body.id);
        if (!folder) error(404, 'フォルダーが見つかりません。');
        const lectures = await activeLectures();
        if (data.folders.some(item => item.parentId === folder.id) || lectures.some(item => item.category === folder.category && data.assignments[item.name] === folder.id)) error(422, '空のフォルダーだけ削除できます。中の講義を移動し、空の子フォルダーを削除してください。');
        data.folders = data.folders.filter(item => item.id !== folder.id);
        for (const [name, id] of Object.entries(data.assignments)) if (id === folder.id) delete data.assignments[name];
      } else if (body.op === 'assign') {
        if (!Array.isArray(body.lectures) || !body.lectures.length || body.lectures.length > 500 || !body.lectures.every(name => typeof name === 'string')) error(422, '移動する講義を選択してください（500件まで）。');
        const lectures = await activeLectures();
        const target = body.folderId === null ? null : data.folders.find(item => item.id === body.folderId);
        if (body.folderId !== null && !target) error(404, '移動先のフォルダーが見つかりません。');
        for (const name of body.lectures) {
          const lecture = lectures.find(item => item.name === name);
          if (!lecture) error(404, '移動する講義が見つかりません。一覧を更新してください。');
          if (target && target.category !== lecture.category) error(422, '講義と同じカテゴリのフォルダーを選んでください。カテゴリの変更は編集画面から行えます。');
          if (target) data.assignments[name] = target.id; else delete data.assignments[name];
        }
        moved = body.lectures;
      } else error(400, '操作内容を確認してください。');
      try { checkIndex(data); } catch (err) { if (err.status) throw err; error(422, 'フォルダーは8階層まで作成できます。作成先を確認してください。'); }
      const serialized = JSON.stringify(data, null, 2) + '\n';
      for (const name of moved) await leaveInbox(name);
      if (current.raw?.toString('utf8') === serialized) return { ...await snapshot(), createdId };
      await mkdir(directory, { recursive: true });
      if (current.raw) {
        await mkdir(join(directory, 'backups'), { recursive: true });
        await writeFile(join(directory, 'backups', `index-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.json`), current.raw, { flag: 'wx' });
      }
      const temporary = join(directory, `.index-${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, serialized, { flag: 'wx' });
        if ((await read()).revision !== current.revision) error(409, '保存中に別の変更が見つかりました。一覧を更新してください。');
        await rename(temporary, path);
      } finally { await unlink(temporary).catch(err => { if (err.code !== 'ENOENT') throw err; }); }
      return { ...await snapshot(), createdId };
    });
    queue = run; return run;
  }
  return { snapshot, change, async isTrashed(name) { slugOf(name);return hiddenNames((await read()).data).has(name); } };
}
