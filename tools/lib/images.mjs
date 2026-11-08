import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { lectureRoot } from './project.mjs';
import { imageFileOf, blockImagesOf } from '../../src/core.js';

export const labelsFileOf = file => file.replace(/\.(png|jpg|webp)$/, '.labels.json');

// ラベル位置ファイル（Codexが作成）：{ "labels": [{ "text": "上腕動脈", "x": 0.42, "y": 0.61, "side": "left" }] }
// x, y は画像の幅・高さに対する割合（0〜1）で、その構造の上の点。side はラベル文字を置く向き。
export function checkLabels(expected, data) {
  const problems = [];
  const items = Array.isArray(data?.labels) ? data.labels : [];
  const byText = new Map(items.map(item => [item?.text, item]));
  for (const text of expected) {
    const item = byText.get(text);
    if (!item) { problems.push(`「${text}」の位置がありません`); continue; }
    if (![item.x, item.y].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) problems.push(`「${text}」の x, y は0〜1の割合です`);
    if (!['left', 'right', 'top', 'bottom'].includes(item.side)) problems.push(`「${text}」の side は left / right / top / bottom です`);
  }
  for (const item of items) if (!expected.includes(item?.text)) problems.push(`lecture.json にないラベル「${item?.text}」があります`);
  return { labels: expected.map(text => byText.get(text)).filter(Boolean), problems };
}

// スライドの画像（Codexが生成）とラベル位置の有無。更新時刻をURLに付け、差し替え後の古い表示を防ぐ。
export async function imageManifest(name, lecture) {
  const result = {};
  for (const slide of lecture.slides) {
    const file = imageFileOf(slide);
    if (!file) continue;
    const directory = join(lectureRoot(name), 'images');
    const entry = { file, ready: false, labels: [], labelProblems: [], revision: Boolean(slide.image.revision) };
    try {
      const info = await stat(join(directory, file));
      Object.assign(entry, { ready: info.size > 0, url: `/images/${name}/${file}?v=${Math.floor(info.mtimeMs)}` });
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const expected = slide.image.labels ?? [];
    if (expected.length) {
      try {
        const data = slide.image.labelPositions ? { labels: slide.image.labelPositions } : JSON.parse((await readFile(join(directory, labelsFileOf(file)), 'utf8')).replace(/^﻿/, ''));
        const { labels, problems } = checkLabels(expected, data);
        Object.assign(entry, { labels, labelProblems: problems });
      } catch (error) { entry.labelProblems = [error.code === 'ENOENT' ? `ラベル位置ファイル ${labelsFileOf(file)} がありません` : `ラベル位置ファイル ${labelsFileOf(file)} を読めません`]; }
    }
    result[slide.id] = entry;
  }
  // フロー図の段階ごとの絵・人物紹介の似顔絵（ラベルなし）
  for (const slide of lecture.slides) for (const { key, file, kind } of blockImagesOf(slide)) {
    const entry = { file, kind, ready: false, labels: [], labelProblems: [] };
    try {
      const info = await stat(join(lectureRoot(name), 'images', file));
      Object.assign(entry, { ready: info.size > 0, url: `/images/${name}/${file}?v=${Math.floor(info.mtimeMs)}` });
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    result[key] = entry;
  }
  return result;
}
