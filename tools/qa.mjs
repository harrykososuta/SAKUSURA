import { join } from 'node:path';
import { access } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { ROOT, ensureLectureReports, loadLecture, loadTtsConfig, argumentValue, writeJson } from './lib/project.mjs';
import { audioManifest } from './lib/cache.mjs';
import { imageManifest } from './lib/images.mjs';
import { validateDeckStructure, plainText, DIAGRAM_BLOCKS, isDense } from '../src/core.js';
import { shapeName } from '../src/shapes.js';
import { motionPlan } from '../src/motion.js';

// 読み比べ用：空白・句読点・かっこを除いて比べる。
const spoken = value => plainText(value).replace(/[\s、。，．,.・:：;；!！?？「」『』（）()［］\[\]【】…‥〜~ー―-]/g, '');
// 編集画面で足した図形・文字の確認（エラーにはせず、完成前に人へ確認する項目）。
// unread：足した文字がナレーションで読まれていない / untimed：表示タイミング（cue）が未設定で、最初から表示される。
export function shapeNotices(lecture) {
  const unread = [], untimed = [];
  for (const [index, slide] of lecture.slides.entries()) {
    const narration = spoken(slide.ttsText ?? slide.narration);
    const cued = new Set(slide.cues.map(cue => cue.target));
    for (const shape of slide.shapes ?? []) {
      const item = { page: index + 1, slide: slide.id, id: shape.id, name: shapeName(shape) };
      if (shape.kind === 'text' && !narration.includes(spoken(shape.text))) unread.push({ ...item, text: plainText(shape.text) });
      if (!cued.has(shape.id)) untimed.push(item);
    }
  }
  return { unread, untimed };
}

// silent：TTSを使わず無音で作る講義。音声の未生成はエラーにせず、表示時間（plannedSeconds）で総尺を測る。
export async function checkLecture(name = 'demo', { production = false, silent = false } = {}) {
  const lecture = await loadLecture(name);
  const errors = validateDeckStructure(lecture), warnings = [];
  const config = await loadTtsConfig();
  const audio = await audioManifest(name, lecture, config);
  let duration = 0;
  for (const [index, slide] of lecture.slides.entries()) {
    const item = audio[slide.id];
    if (!slide.narration.trim()) (production ? errors : warnings).push(`${slide.id}: 台本が空欄です`);
    if (!item.ready && !silent) (production ? errors : warnings).push(`${slide.id}: ${item.reason}`);
    const seconds = item.ready ? item.duration : slide.plannedSeconds;
    duration += seconds + (index < lecture.slides.length - 1 ? slide.gapAfter : 0);
    for (const cue of slide.cues) if (cue.at >= seconds) errors.push(`${slide.id}: cue ${cue.target} (${cue.at}秒) が終了 (${seconds}秒) 以降です`);
    if (motionPlan(lecture, slide, seconds).some(item => item.short)) warnings.push(`${slide.id}: アニメーションが音声の終わりまでに収まらず、途中を縮めています。最後の cue を早めてください`);
    // 要素数の目安。カテゴリD（isDense）は本文6つ・フロー図5つまで。図解は DIAGRAM_BLOCKS の上限。
    const most = { document: 200, agenda: 6, bars: 6, ...Object.fromEntries(Object.entries(DIAGRAM_BLOCKS).map(([key, range]) => [key, range[1]])) }[slide.layout] ?? (isDense(lecture) ? (slide.layout === 'flow' ? 5 : 6) : 4);
    if (slide.blocks.length > most) warnings.push(`${slide.id}: 要素が多いためレイアウトを確認してください`);
    if (item.ready && item.peak >= 0.999) warnings.push(`${slide.id}: 音声ピークが上限付近です。音割れを試聴で確認してください`);
  }
  const images = await imageManifest(name, lecture);
  for (const [id, item] of Object.entries(images)) if (item.ready) for (const problem of item.labelProblems) (production ? errors : warnings).push(`${id}: ${problem}（Codexに REQUEST.md のラベル位置の作成を依頼）`);
  const pendingImages = Object.entries(images).filter(([, item]) => !item.ready).map(([id]) => id);
  const revisions = Object.entries(images).filter(([, item]) => item.ready && item.revision).map(([id]) => id);
  if (revisions.length) (production ? errors : warnings).push(`画像の修正依頼が未完了です（${revisions.join(', ')}）。Codexの修正後に画像を確認し、image.revision を外してください`);
  if (pendingImages.length) (production ? errors : warnings).push(`画像が未生成です（${pendingImages.join(', ')}）。npm run images -- --lecture ${name} で依頼書を作り、Codexに生成を依頼してください`);
  if (lecture.source) { try { await access(join(ROOT, lecture.source)); } catch { warnings.push(`元資料 ${lecture.source} が見つかりません`); } }
  const shapes = shapeNotices(lecture);
  for (const item of shapes.unread) warnings.push(`${item.slide}: 追加した文字「${item.text}」はナレーションで読まれていません（読ませる場合は原稿に足し、このスライドの音声だけ作り直します）`);
  for (const item of shapes.untimed) warnings.push(`${item.slide}: 追加した${item.name}の表示タイミングが未設定です（スライドの最初から表示されます）`);
  const ready = Object.values(audio).filter(item => item.ready).length;
  const deviation = Math.abs(duration - lecture.targetSeconds) / lecture.targetSeconds;
  if (deviation > 0.15) (production ? errors : warnings).push(`総尺 ${duration.toFixed(2)}秒 / 目標 ${lecture.targetSeconds}秒（許容差15%を超過）`);
  if (ready !== lecture.slides.length) warnings.push('総尺には未生成スライドの予定秒数を含みます');
  return { name, title: lecture.title, mode: production ? 'production' : 'preview', silent, passed: !errors.length, generatedAt: new Date().toISOString(), slides: lecture.slides.length, audioReady: ready, duration: +duration.toFixed(3), targetSeconds: lecture.targetSeconds, errors, warnings, shapes, audio };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = await checkLecture(argumentValue(process.argv, '--lecture', 'demo'), { production: process.argv.includes('--production'), silent: process.argv.includes('--silent') });
    await writeJson(join(await ensureLectureReports(report.name), 'qa.json'), report);
    console.log(`${report.passed ? 'PASS' : 'FAIL'} (${report.mode}${report.silent ? "・無音" : ""}) ${report.title} / 音声 ${report.audioReady}/${report.slides} / ${report.duration}秒`);
    for (const message of report.errors) console.log(`ERROR: ${message}`);
    for (const message of report.warnings) console.log(`要確認: ${message}`);
    if (!report.passed) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
