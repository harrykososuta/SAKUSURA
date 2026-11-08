import { mkdir, writeFile, rename, open, unlink, copyFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { lectureRoot, loadTtsConfig, synthesisInput, inputHash, fileHash, writeJson } from './project.mjs';
import { readEditableLecture } from './editor-store.mjs';
import { inspectAudio } from './cache.mjs';
import { synthesize } from './gemini.mjs';
import { wavInfo } from './wav.mjs';

export async function planTts(name, { slideId } = {}) {
  const { lecture, revision } = await readEditableLecture(name);
  const config = await loadTtsConfig();
  const slides = lecture.slides.filter(slide => !slideId || slide.id === slideId);
  if (!slides.length) throw new Error('指定したスライドがありません');
  const pending = [], empty = [], entries = [];
  for (const slide of slides) {
    if (!synthesisInput(slide, config).text.trim()) { empty.push(slide.id); continue; }
    const audio = await inspectAudio(name, slide, config);
    entries.push({ id: slide.id, ...audio });
    if (!audio.ready) pending.push(slide);
  }
  return { name, lecture, revision, config, pending, empty, entries };
}

// CLIと編集画面で同じ差分生成・講義単位のロックを使用する。承認済みの原稿を固定して生成。
export async function generateTts(plan, { onProgress = () => {}, synthesizeAudio = synthesize } = {}) {
  const { name, config, pending, empty } = plan;
  if (empty.length) throw new Error('空欄の台本を記入してください（API呼び出しなし）');
  if (!pending.length) return;
  const directory = join(lectureRoot(name), 'audio');
  await mkdir(directory, { recursive: true });
  const lockPath = join(directory, '.tts.lock');
  let lock;
  try { lock = await open(lockPath, 'wx'); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('同じ講義のTTS生成が実行中です。異常終了時はプロセス停止を確認して audio/.tts.lock を削除してください。'); throw error; }
  try {
    for (const [index, slide] of pending.entries()) {
      if ((await inspectAudio(name, slide, config)).ready) { onProgress({ id: slide.id, completed: index + 1, cached: true }); continue; }
      onProgress({ id: slide.id, completed: index });
      const input = synthesisInput(slide, config);
      const buffer = await synthesizeAudio(input, { timeoutMs: config.timeoutMs });
      const info = wavInfo(buffer);
      if (info.speechStart === null) throw new Error(`${slide.id}: 無音の音声が返りました。保存しません。`);
      const wavPath = join(directory, `${slide.id}.wav`), temporary = `${wavPath}.${process.pid}.tmp`;
      const metadataPath = join(directory, `${slide.id}.json`);
      try {
        // 更新前の音声も残し、以前の原稿へ戻したい場合に再生成せず取り出せるようにする。
        const backupDirectory = join(directory, 'backups');
        const stamp = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
        for (const extension of ['wav', 'json']) {
          try { await mkdir(backupDirectory, { recursive: true }); await copyFile(join(directory, `${slide.id}.${extension}`), join(backupDirectory, `${slide.id}-${stamp}.${extension}`)); }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
        await writeFile(temporary, buffer); await rename(temporary, wavPath);
        const metadata = { hash: inputHash(input), fileHash: fileHash(buffer), ...input, voiceAlias: slide.ttsVoice ?? config.voice.alias, generatedAt: new Date().toISOString(), ...info };
        await writeJson(`${metadataPath}.tmp`, metadata); await rename(`${metadataPath}.tmp`, metadataPath);
      } finally { await Promise.all([unlink(temporary).catch(() => {}), unlink(`${metadataPath}.tmp`).catch(() => {})]); }
      onProgress({ id: slide.id, completed: index + 1, duration: info.duration, speechStart: info.speechStart, speechEnd: info.speechEnd, cueWarning: slide.cues.some(cue => cue.at >= info.duration) });
    }
  } finally { await lock.close(); await unlink(lockPath); }
}
