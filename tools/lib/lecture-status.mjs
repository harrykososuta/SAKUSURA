import { readFile, stat, readdir, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve, sep } from 'node:path';
import { ROOT, slugOf, synthesisInput, inputHash } from './project.mjs';
import { inspectAudio } from './cache.mjs';
import { readHomeMarks, lectureMarkValid, jobMarkValid } from './home-marks.mjs';
import { imageFileOf, blockImagesOf } from '../../src/core.js';

const json = async file => JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
const optionalJson = async file => { try { return await json(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
const exists = async file => { try { const info = await stat(file); return info.isFile() && info.size > 0; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
export const STATUS_LABELS = { images: '画像待ち', audio: '音声待ち', validation: '検証待ち', ready: '完成', exported: '書き出し済み' };

// 検証そのものはinspectAudioと共通。入力条件とWAV/メタデータのサイズ・更新時刻が
// 変わらない結果だけを再利用し、HOMEの更新ごとの大量のWAV読み込みを防ぐ。
const audioCacheFile = join(ROOT, 'reports', 'home', 'audio-cache.json');
let audioCachePromise, cacheDirty = false;
const audioCache = () => audioCachePromise ??= optionalJson(audioCacheFile).then(data => data?.version === 1 && data.entries && typeof data.entries === 'object' ? data.entries : {}, () => ({}));
async function inspectHomeAudio(name, slide, config) {
  const directory = join(ROOT, 'lectures', slugOf(name), 'audio');
  try {
    const wavPath = join(directory, `${slide.id}.wav`), metaPath = join(directory, `${slide.id}.json`);
    const [wav, meta] = await Promise.all([stat(wavPath, { bigint: true }), stat(metaPath, { bigint: true })]);
    const hash = inputHash(synthesisInput(slide, config));
    const key = `${hash}:${wav.size}:${wav.mtimeNs}:${meta.size}:${meta.mtimeNs}`;
    const cache = await audioCache(), id = `${name}/${slide.id}`;
    if (cache[id]?.key === key && typeof cache[id].ready === 'boolean') return { ready: cache[id].ready };
    const metadata = await json(metaPath);
    const result = metadata.hash === hash ? await inspectAudio(name, slide, config) : { ready: false };
    cache[id] = { key, ready: result.ready }; cacheDirty = true;
    return result;
  } catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return { ready: false }; throw error; }
}
async function saveAudioCache() {
  if (!cacheDirty) return;
  const temporary = `${audioCacheFile}.${randomUUID()}.tmp`;
  try {
    const entries = await audioCache(); await mkdir(join(ROOT, 'reports', 'home'), { recursive: true });
    await writeFile(temporary, JSON.stringify({ version: 1, entries })); await rename(temporary, audioCacheFile); cacheDirty = false;
  } catch { /* キャッシュを書けなくても検証結果は返す。 */ }
  finally { await unlink(temporary).catch(() => {}); }
}
async function importedShare(directory) {
  const share = await optionalJson(join(directory, 'share.json'));
  if (share?.version !== 1 || typeof share.importedAt !== 'string' || !Number.isFinite(Date.parse(share.importedAt))) return null;
  return { id: String(share.id ?? ''), revision: share.revision, author: String(share.author ?? ''), importedAt: share.importedAt, inbox: share.inbox === true };
}

// 講義の元ファイルの最終更新時刻（HOMEの「完了にする」が、その後の編集で外れたかを判定する）。
export async function lectureSourceTime(name, format, root = ROOT) {
  const directory = join(root, 'lectures', slugOf(name));
  if (!format) format = await stat(join(directory, 'lecture.json')).then(() => 'slides', () => 'html');
  if (format === 'html') return Math.max((await stat(join(directory, 'html-deck.json'))).mtimeMs, (await stat(join(directory, 'slides.html'))).mtimeMs);
  return (await stat(join(directory, 'lecture.json'))).mtimeMs;
}

export async function inspectLectureStatus(item, { root = ROOT, config, inspect = inspectAudio, exportFiles = [], marks = null } = {}) {
  const name = slugOf(item.name), directory = join(root, 'lectures', name);
  const result = { ...item, statuses: [], missingImages: 0, pendingAudio: 0, share: null };
  try {
    result.share = await importedShare(directory);
  } catch { result.shareWarning = true; }
  try {
    const html = item.format === 'html';
    const sourceFile = join(directory, html ? 'html-deck.json' : 'lecture.json');
    let sourceTime = (await stat(sourceFile)).mtimeMs;
    if (html) {
      sourceTime = Math.max(sourceTime, (await stat(join(directory, 'slides.html'))).mtimeMs);
    } else {
      const lecture = await json(sourceFile);
      let nextSlide = 0;
      await Promise.all(Array.from({ length: Math.min(4, lecture.slides.length) }, async () => { while (nextSlide < lecture.slides.length) {
        const slide = lecture.slides[nextSlide++];
        const files = [imageFileOf(slide), ...blockImagesOf(slide).map(image => image.file)].filter(Boolean);
        for (const file of files) {
          const imageRoot = resolve(directory, 'images'), path = resolve(imageRoot, file);
          if (!path.startsWith(imageRoot + sep) || !await exists(path)) result.missingImages++;
        }
        // planTtsと同じ空原稿・キャッシュ差分の判定。設定や秘密値をレスポンスに含めない。
        if (!synthesisInput(slide, config).text?.trim() || !(await inspect(name, slide, config)).ready) result.pendingAudio++;
      } }));
    }
    if (result.missingImages) result.statuses.push('images');
    if (result.pendingAudio) result.statuses.push('audio');
    const reportPath = join(root, 'reports', name, 'harness.json');
    const report = await optionalJson(reportPath);
    if (!report?.passed || (await stat(reportPath)).mtimeMs < sourceTime) result.statuses.push('validation');
    result.sourceTime = sourceTime;
    // 手動で「完了」にした講義は、その後に編集していなければ完成として数える（自動判定の待ち状態は manualDone に残す）。
    const mark = marks?.lectures?.[name];
    if (result.statuses.length && lectureMarkValid(mark, sourceTime)) { result.manualDone = { doneAt: mark.doneAt, statuses: result.statuses }; result.statuses = []; }
    if (!result.statuses.length) result.statuses.push('ready');
  } catch { result.statuses = [...new Set([...result.statuses, 'validation'])]; result.inspectionWarning = true; }
  if (exportFiles.some(file => file.startsWith(`${name}_`) && /^\d{3,}\.mp4$/.test(file.slice(name.length + 1)))) result.statuses.push('exported');
  result.primaryStatus = result.statuses.find(status => status !== 'exported') ?? 'validation';
  return result;
}

export async function homeSnapshot({ libraryStore, config, root = ROOT, inspect = inspectHomeAudio, overview = false, readMarks = readHomeMarks }) {
  const library = await libraryStore.snapshot();
  let exportFiles = [];
  try { exportFiles = (await readdir(join(root, 'exports'), { withFileTypes: true })).filter(file => file.isFile()).map(file => file.name); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const items = library.lectures.filter(item => !item.demo), lectures = [], imageJobs = [];
  // 手動の印が読めなくても、自動判定だけで表示を続ける。
  const marks = await readMarks().catch(() => null);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      if (overview) {
        let share = null; try { share = await importedShare(join(root, 'lectures', slugOf(item.name))); } catch { /* 一覧の残りは表示する。 */ }
        lectures.push({ ...item, share, statuses: [] });
      } else lectures.push(await inspectLectureStatus(item, { root, config, inspect, exportFiles, marks }));
      try {
        const task = await optionalJson(join(root, 'lectures', slugOf(item.name), 'images', 'ORCA_TASK.json'));
        if (task && ['creating-run', 'starting-worker', 'running', 'launch-unknown', 'refused', 'failed'].includes(task.phase) && !jobMarkValid(marks?.jobs?.[item.name], task)) {
          imageJobs.push({ id: `image-${item.name}`, kind: 'images', name: item.name, phase: task.phase, state: ['refused', 'failed'].includes(task.phase) ? 'failed' : task.phase === 'launch-unknown' ? 'unknown' : 'running', startedAt: Date.parse(task.createdAt) || 0 });
        }
      } catch { /* 外部タスクの内部記録やエラー本文は公開しない。 */ }
    }
  }));
  if (!overview && inspect === inspectHomeAudio) await saveAudioCache();
  lectures.sort((a, b) => b.updatedAt - a.updatedAt);
  return { generatedAt: new Date().toISOString(), lectures, counts: overview ? null : Object.fromEntries(Object.keys(STATUS_LABELS).map(status => [status, lectures.filter(item => item.statuses.includes(status)).length])), recent: lectures.slice(0, 6), imported: lectures.filter(item => item.share).sort((a, b) => Date.parse(b.share.importedAt) - Date.parse(a.share.importedAt)).slice(0, 6), imageJobs, excludedDemos: library.lectures.length - items.length };
}
