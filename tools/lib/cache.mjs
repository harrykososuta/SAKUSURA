import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { lectureRoot, readJson, synthesisInput, inputHash, fileHash } from './project.mjs';
import { wavInfo } from './wav.mjs';

export async function inspectAudio(name, slide, config) {
  const input = synthesisInput(slide, config);
  const hash = inputHash(input);
  const root = lectureRoot(name);
  try {
    const metadata = await readJson(join(root, 'audio', `${slide.id}.json`));
    const wav = await readFile(join(root, 'audio', `${slide.id}.wav`));
    const info = wavInfo(wav);
    if (metadata.hash !== hash) return { ready: false, reason: '台本・声・話し方・モデルが変更されています' };
    if (metadata.fileHash !== fileHash(wav)) return { ready: false, reason: '音声ファイルの内容が変更されています' };
    if (info.speechStart === null) return { ready: false, reason: '発話を検出できません（無音の可能性）' };
    return { ready: true, ...info, hash, url: `/audio/${name}/${slide.id}.wav?v=${metadata.fileHash.slice(0, 16)}` };
  } catch (error) {
    return { ready: false, reason: error.code === 'ENOENT' ? '音声が未生成です' : '音声またはメタデータが不正です' };
  }
}

export async function audioManifest(name, lecture, config) {
  return Object.fromEntries(await Promise.all(lecture.slides.map(async slide => [slide.id, await inspectAudio(name, slide, config)])));
}
