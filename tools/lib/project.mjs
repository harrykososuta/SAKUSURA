import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { validateLecture } from '../../src/core.js';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const slugOf = value => {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value ?? '')) throw new Error('講義名は半角小文字・数字・_・-、64文字以内で指定してください');
  return value;
};
export const lectureRoot = name => join(ROOT, 'lectures', slugOf(name));
export const readJson = async path => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
export const writeJson = async (path, data) => writeFile(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
export const loadLecture = async name => {
  const lecture = await readJson(join(lectureRoot(name), 'lecture.json'));
  const errors = validateLecture(lecture);
  if (errors.length) throw new Error(errors.join('\n'));
  return lecture;
};
export function loadEnv() {
  try { process.loadEnvFile(resolve(ROOT, '.env')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
export async function loadTtsConfig({ env = true } = {}) {
  if (env) loadEnv();
  const config = await readJson(join(ROOT, 'config', 'tts.json'));
  if (env && process.env.GEMINI_VOICE_ID) config.voice.id = process.env.GEMINI_VOICE_ID;
  if (!/^voice_[a-zA-Z0-9_-]+$/.test(config.voice?.id ?? '')) throw new Error('永続カスタムボイスID（voice_...）が必要です');
  return config;
}
export const spokenText = slide => slide.ttsText ?? slide.narration;
export const synthesisInput = (slide, config) => ({
  // ttsModel・ttsVoice：そのスライドだけ別のTTSモデル・声で生成する（1日の上限・紹介動画など）。未指定のスライドの生成条件は変わらない。
  text: spokenText(slide), model: slide.ttsModel ?? config.model, voice: slide.ttsVoice ?? config.voice.id,
  style: slide.style || config.defaultStyle, format: 'audio/wav',
});
export const inputHash = input => createHash('sha256').update(JSON.stringify(input)).digest('hex');
export const fileHash = buffer => createHash('sha256').update(buffer).digest('hex');
// プレイヤー・サーバーのプログラムの版。ファイルの最終更新時刻の最大値で表し、
// 起動済みのサーバーが古いプログラムのまま動いていないかを確かめるのに使う。
export async function codeVersion() {
  const { readdir, stat } = await import('node:fs/promises');
  let latest = 0;
  async function walk(directory) {
    for (const entry of await readdir(join(ROOT, directory), { withFileTypes: true })) {
      const name = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await walk(name);
      else if (/\.(mjs|js|css|html)$/.test(entry.name)) latest = Math.max(latest, (await stat(join(ROOT, name))).mtimeMs);
    }
  }
  for (const directory of ['src', 'tools', 'public']) await walk(directory);
  return Math.floor(latest);
}
export async function ensureReports() { await mkdir(join(ROOT, 'reports'), { recursive: true }); }
// 検証結果は講義ごとに reports/<slug>/ へ保存し、別の講義の画面PNGと混ざらないようにする。
export const reportRoot = name => join(ROOT, 'reports', slugOf(name));
export async function ensureLectureReports(name) { const directory = reportRoot(name); await mkdir(directory, { recursive: true }); return directory; }
export const argumentValue = (args, flag, fallback) => { const index = args.indexOf(flag); return index < 0 ? fallback : args[index + 1]; };
