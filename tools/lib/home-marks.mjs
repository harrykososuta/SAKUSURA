// HOMEの手動の印（docs/HOME.md「手動で完了・確認済み」）。library/home-marks.json に保存する。
// lecture.json は変えない（変えると検証・画像依頼の照合が崩れるため）。
//   lectures[name] = { doneAt, sourceTime }  … 「完了にする」。sourceTime より後に講義を編集したら自動判定に戻す。
//   jobs[name]     = { jobId, phase, at }     … 要確認の画像作業を「確認済み」にする。同じ依頼・同じ状態のときだけ隠す。
import { readFile, writeFile, rename, unlink, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, dirname } from 'node:path';
import { ROOT } from './project.mjs';

export const HOME_MARKS_FILE = join(ROOT, 'library', 'home-marks.json');
const blank = () => ({ version: 1, lectures: {}, jobs: {} });

export async function readHomeMarks(file = HOME_MARKS_FILE) {
  let text;
  try { text = await readFile(file, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return blank(); throw error; }
  const data = JSON.parse(text.replace(/^﻿/, ''));
  if (data?.version !== 1) return blank();
  return { version: 1, lectures: data.lectures && typeof data.lectures === 'object' ? data.lectures : {}, jobs: data.jobs && typeof data.jobs === 'object' ? data.jobs : {} };
}

// 同時に押されても記録を失わないよう、読み→変更→原子的置換を1本ずつ直列に行う。
let queue = Promise.resolve();
export function updateHomeMarks(change, file = HOME_MARKS_FILE) {
  const run = queue.then(async () => {
    const marks = await readHomeMarks(file).catch(() => blank());
    change(marks);
    await mkdir(dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, `${JSON.stringify(marks, null, 2)}\n`, 'utf8'); await rename(temporary, file); }
    finally { await unlink(temporary).catch(() => {}); }
    return marks;
  });
  queue = run.catch(() => {});
  return run;
}

// 印が今も有効か：完了にした時点より後に講義（lecture.json / html-deck.json・slides.html）を編集していないこと。
export const lectureMarkValid = (mark, sourceTime) => Boolean(mark && Number.isFinite(mark.sourceTime) && sourceTime <= mark.sourceTime + 1);
export const jobMarkValid = (mark, task) => Boolean(mark && task && mark.jobId === task.jobId && mark.phase === task.phase);
