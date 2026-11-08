import { readdir, readFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { lectureRoot } from './project.mjs';
import { validateLecture } from '../../src/core.js';

const BACKUP = /^lecture-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)-[a-f0-9]{8}\.json$/;
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
// 一覧は名前と日時だけ。選んだ版だけを読み込み、大きな講義でも一覧を軽く保つ。
export async function listLectureHistory(name) {
  const directory = join(lectureRoot(name), 'backups');
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return { versions: [], total: 0 }; throw error; }
  const files = entries.filter(entry => entry.isFile() && BACKUP.test(entry.name)).map(entry => entry.name).sort().reverse();
  return { total: files.length, versions: files.slice(0, 200).map(file => {
    const stamp = BACKUP.exec(file)[1];
    return { file, at: stamp.replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, 'T$1:$2:$3.$4Z') };
  }) };
}
export async function readLectureHistory(name, file) {
  if (typeof file !== 'string' || !BACKUP.test(file)) fail(400, '履歴を選び直してください。');
  const path = join(lectureRoot(name), 'backups', file);
  let data;
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.size > 2 * 1024 * 1024) fail(422, 'この履歴は読み込めません。');
    data = JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
  } catch (error) {
    if (error.status) throw error;
    fail(error.code === 'ENOENT' ? 404 : 422, '履歴が見つからないか、読み込めない形式です。');
  }
  try { if (validateLecture(data).length) fail(422, 'この履歴は現在の編集画面で開けない形式です。'); }
  catch { fail(422, 'この履歴は現在の編集画面で開けない形式です。'); }
  return data;
}
