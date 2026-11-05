// 無音で作る講義（TTSのAPIキーを登録しない場合）：ナレーションの文字数から各スライドの表示時間（plannedSeconds）を決め、
// 要点の表示タイミング（cues）を同じ比率で伸び縮みさせる。音声が生成済みのスライドは変えない。
// npm run timing -- --lecture <slug>（--check で書き込まずに確認）
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { lectureRoot, loadLecture, loadTtsConfig, argumentValue, writeJson } from './lib/project.mjs';
import { audioManifest } from './lib/cache.mjs';

// 既存講義300枚の実測：前後の間を含めて1秒あたり約5.1文字（空白を除く）。
export const SPEECH_RATE = 5.1;
const MIN_SECONDS = 4;
const round = value => Math.round(value * 10) / 10;
export const silentSeconds = slide => Math.max(MIN_SECONDS, round((slide.ttsText ?? slide.narration).replace(/\s/g, '').length / SPEECH_RATE));

// 表示時間を変えたスライドの cue を同じ比率で動かし、終了の0.5秒前までに収める。
export function retime(slide, seconds) {
  const ratio = seconds / slide.plannedSeconds;
  for (const cue of slide.cues) cue.at = Math.min(round(cue.at * ratio), Math.max(0, round(seconds - 0.5)));
  slide.plannedSeconds = seconds;
  return slide;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const name = argumentValue(process.argv, '--lecture', 'demo'), check = process.argv.includes('--check');
    const lecture = await loadLecture(name);
    const audio = await audioManifest(name, lecture, await loadTtsConfig());
    const empty = lecture.slides.filter(slide => !slide.narration.trim()).map(slide => slide.id);
    if (empty.length) throw new Error(`ナレーションが空欄のスライドがあります（${empty.join(', ')}）。無音で作る場合も原稿は書いてください`);
    let changed = 0, total = 0;
    for (const [index, slide] of lecture.slides.entries()) {
      const seconds = audio[slide.id].ready ? audio[slide.id].duration : silentSeconds(slide);
      if (!audio[slide.id].ready && seconds !== slide.plannedSeconds) { console.log(`${slide.id}: ${slide.plannedSeconds}秒 → ${seconds}秒`); retime(slide, seconds); changed++; }
      total += seconds + (index < lecture.slides.length - 1 ? slide.gapAfter : 0);
    }
    if (!check && changed) await writeJson(join(lectureRoot(name), 'lecture.json'), lecture);
    console.log(`${check ? '確認のみ：' : ''}${changed}枚の表示時間を${check ? '変更できます' : '変更しました'} / 総尺 ${Math.round(total)}秒（目標 ${lecture.targetSeconds}秒）`);
    if (Math.abs(total - lecture.targetSeconds) / lecture.targetSeconds > 0.15) console.log('要確認：総尺が目標から15%以上ずれています。原稿の分量を調整してください');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
