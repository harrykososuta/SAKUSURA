import { readFile, writeFile, mkdir, rename, unlink, copyFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { lectureRoot } from './project.mjs';
import { validateLecture, validateDeckStructure, slideFilePairs } from '../../src/core.js';

export const revisionOf = data => createHash('sha256').update(data).digest('hex');
const queues = new Map();
export async function readEditableLecture(name) {
  const raw = await readFile(join(lectureRoot(name), 'lecture.json'));
  const lecture = JSON.parse(raw.toString('utf8').replace(/^﻿/, ''));
  if (validateLecture(lecture).length) throw new Error('INVALID_LECTURE');
  return { lecture, revision: revisionOf(raw) };
}

// 編集画面で挿入したスライド（imports）：[{ id: 挿入先のスライドID, from: { lecture: 元の講義, slide: 元のスライド } }]。
// 保存の直前に、元の画像・ラベル位置・音声を新しいIDのファイル名で写す。音声は原稿・声・話し方が同じならそのまま使える。
const ASSET = /^(images|audio)\/[a-zA-Z0-9][a-zA-Z0-9_-]*(\.labels)?\.(png|jpg|webp|json|wav)$/;
export function importCopies(name, lecture, saved, imports) {
  if (imports === undefined) return [];
  if (!Array.isArray(imports) || imports.length > 200) throw new Error('INVALID_IMPORTS');
  const savedIds = new Set(saved.slides.map(slide => slide.id));
  const copies = [];
  for (const item of imports) {
    const target = lecture.slides.find(slide => slide.id === item?.id);
    if (!target) continue; // 挿入した後に削除したスライドは写さない。
    // 保存済みのスライドのファイルは上書きしない。
    const from = item.from?.slide;
    if (savedIds.has(target.id) || !from || typeof from !== 'object' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(from.id ?? '')) throw new Error('INVALID_IMPORTS');
    const source = lectureRoot(item.from.lecture);
    for (const [a, b] of slideFilePairs(from, target)) {
      if (!ASSET.test(a) || !ASSET.test(b)) throw new Error('INVALID_IMPORTS');
      if (source !== lectureRoot(name) || a !== b) copies.push([join(source, a), join(lectureRoot(name), b)]);
    }
  }
  return copies;
}
async function copyAssets(copies) {
  let copied = 0;
  for (const [from, to] of copies) {
    try { await mkdir(dirname(to), { recursive: true }); await copyFile(from, to); copied++; }
    catch (error) { if (error.code !== 'ENOENT') throw error; } // 未生成の画像・音声は写さない。
  }
  return copied;
}

export function saveEditableLecture(name, lecture, revision, imports) {
  // 同時に到着した保存も直列化し、古い版で上書きしない。
  const job = (queues.get(name) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const root = lectureRoot(name);
    const path = join(root, 'lecture.json');
    const original = await readFile(path);
    if (revisionOf(original) !== revision) return { status: 409, error: '別の画面またはファイルで変更されています。編集内容をJSONで控え、再読み込みしてください。' };
    let errors;
    try { errors = [...validateLecture(lecture), ...validateDeckStructure(lecture)]; }
    catch { return { status: 422, error: '講義データの形式を確認してください。' }; }
    if (errors.length) return { status: 422, error: errors.join('\n') };
    let copies;
    try { copies = importCopies(name, lecture, JSON.parse(original.toString('utf8').replace(/^﻿/, '')), imports); }
    catch { return { status: 422, error: '挿入したスライドの情報を確認できません。再読み込みしてから挿入し直してください。' }; }
    const data = `${JSON.stringify(lecture, null, 2)}\n`;
    if (data === original.toString('utf8')) return { status: 200, revision, backup: null, copied: 0 };
    const stamp = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
    await mkdir(join(root, 'backups'), { recursive: true });
    const backup = `backups/lecture-${stamp}.json`;
    await writeFile(join(root, backup), original, { flag: 'wx' });
    const temporary = join(root, `.lecture-${randomUUID()}.tmp`);
    let copied = 0;
    try {
      await writeFile(temporary, data, { flag: 'wx' });
      // バックアップ作成中に外部で書き換わった場合も保存を止める。
      if (revisionOf(await readFile(path)) !== revision) return { status: 409, error: '保存中に別の変更が見つかりました。再読み込みしてください。' };
      // 画像・音声を先に写す。講義の保存に失敗しても、新しいIDのファイルが残るだけで既存のスライドは変わらない。
      copied = await copyAssets(copies);
      await rename(temporary, path);
    } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    return { status: 200, revision: revisionOf(data), backup, copied };
  });
  queues.set(name, job);
  job.finally(() => { if (queues.get(name) === job) queues.delete(name); }).catch(() => {});
  return job;
}

export async function readEditorBody(request) {
  let length = 0;
  const chunks = [];
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 2 * 1024 * 1024) throw new Error('BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
