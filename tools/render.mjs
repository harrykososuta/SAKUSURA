// 講義をMP4に書き出す（OBSで録画する代わり）。npm run render -- --lecture <slug>
// 1. ヘッドレスのブラウザで録画モードの画面（1920×1080）を、要点が現れる段階ごとに撮影する。
// 2. 撮影画像を音声と同じ時間割（スライドの音声の長さ＋間、cueの時刻）で並べ、ffmpegでMP4にする。
// 要点が現れるところは短いフェード、スライドの切り替えはカット。音声は生成済みWAVをそのまま使う。
// --silent（TTSのAPIキーを登録しない場合）は音声を使わず、各スライドの表示時間（plannedSeconds）で無音の動画にする。
// アニメーションのあるスライド（src/motion.js）は、要点のフェードと動いている間を1コマずつ撮ってつなぐ。
import { spawn } from 'node:child_process';
import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createStudioServer } from './server.mjs';
import { ROOT, lectureRoot, loadLecture, loadTtsConfig, reportRoot, argumentValue } from './lib/project.mjs';
import { audioManifest } from './lib/cache.mjs';
import { imageManifest } from './lib/images.mjs';
import { launchBrowser, until, sleep } from './lib/browser.mjs';
import { ffmpegExecutable } from './lib/ffmpeg.mjs';
export { ffmpegExecutable };
import { cueState } from '../src/core.js';
import { hasMotion, motionSpans } from '../src/motion.js';

const FPS = 30;
const FADE = 0.25; // CSSの .reveal のフェードと同じ長さ
export const EXPORT_DIR = join(ROOT, 'exports');

function run(command, args, { quiet = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let stderr = '';
    child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-3000); });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(quiet ? `exit ${code}` : `ffmpeg が失敗しました（exit ${code}）\n${stderr.trim()}`)));
  });
}

// 時間割：各スライドは「音声の長さ＋間（最終枚は余韻）」。その中を、表示中の要点が変わる時刻で区切る。
// 時刻は講義全体の通し時間でフレームに丸め、スライドをつないでも音声とずれないようにする。
export function renderPlan(lecture, audio, { tail = 2 } = {}) {
  const frame = seconds => Math.round(seconds * FPS);
  let start = 0;
  return lecture.slides.map((slide, index) => {
    const duration = audio[slide.id].duration;
    const span = duration + (index < lecture.slides.length - 1 ? slide.gapAfter : tail);
    const times = [...new Set([0, ...slide.cues.map(cue => cue.at).filter(at => at > 0 && at < duration)])].sort((a, b) => a - b);
    const states = [];
    for (const time of times) {
      const visible = [...cueState(slide.cues, time)].sort();
      if (states.length && states.at(-1).visible.join() === visible.join()) continue;
      states.push({ time, visible });
    }
    const first = frame(start);
    const frames = frame(start + span) - first;
    for (const state of states) state.frame = frame(start + state.time) - first;
    const entry = { id: slide.id, index, start, span, audioSeconds: frames / FPS, frames, states };
    // 動きのあるスライド：撮影するコマ（スライド内の番号と時刻）。フェードと動きの間は毎コマ、それ以外は表示が変わるときだけ。
    if (hasMotion(lecture, slide) || slide.animation?.type === 'none') {
      const local = new Set(states.map(state => state.frame));
      const windows = slide.animation?.type === 'none' ? [] : [...slide.cues.filter(cue => cue.at < duration).map(cue => [cue.at, cue.at + FADE]), ...motionSpans(lecture, slide, duration)];
      for (const [from, to] of windows) for (let f = frame(start + from) - first; f <= frame(start + to) - first; f++) local.add(f);
      entry.shots = [...local].filter(f => f >= 0 && f < frames).sort((a, b) => a - b).map(f => ({ frame: f, time: Math.max(0, Math.min(duration, (first + f) / FPS - start)) }));
    }
    start += span;
    return entry;
  });
}

// 書き出しは上書きせず、<講義名>_001.mp4, _002.mp4 … と番号を増やして残す。
export async function nextExportPath(name, directory = EXPORT_DIR) {
  const pattern = new RegExp(`^${name}_(\\d{3,})\\.mp4$`); // 講義名は英小文字・数字・_・- だけ
  let files = [];
  try { files = await readdir(directory); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const last = Math.max(0, ...files.map(file => Number(file.match(pattern)?.[1] ?? 0)));
  return join(directory, `${name}_${String(last + 1).padStart(3, '0')}.mp4`);
}

// 1コマずつ撮ったスライド：各画像を次の画像までの長さで並べる（ffmpeg の concat 形式）。
async function renderMotionClip(ffmpeg, item, shotOf, output) {
  const list = `${output}.txt`;
  const file = k => `file '${shotOf(k).replaceAll('\\', '/')}'`;
  const lines = item.shots.flatMap((shot, k) => [file(k), `duration ${(((item.shots[k + 1]?.frame ?? item.frames) - shot.frame) / FPS).toFixed(6)}`]);
  await writeFile(list, [...lines, file(item.shots.length - 1)].join('\n') + '\n', 'utf8');
  await run(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-vf', `fps=${FPS},format=yuv420p`, '-frames:v', String(item.frames), '-r', String(FPS), '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-tune', 'stillimage', '-pix_fmt', 'yuv420p', output]);
}

async function renderSlideClip(ffmpeg, item, shotOf, output) {
  const inputs = [], filters = [];
  item.states.forEach((state, k) => {
    const next = item.states[k + 1];
    const fade = next ? Math.min(FADE, (next.frame - state.frame) / FPS / 2) : 0;
    const length = (next ? next.frame - state.frame : item.frames - state.frame) / FPS + fade;
    inputs.push('-loop', '1', '-framerate', String(FPS), '-t', length.toFixed(4), '-i', shotOf(k));
    if (next) filters.push(`[${k === 0 ? '0' : `x${k}`}][${k + 1}]xfade=transition=fade:duration=${fade.toFixed(4)}:offset=${(next.frame / FPS).toFixed(4)}[x${k + 1}]`);
  });
  const last = item.states.length > 1 ? `[x${item.states.length - 1}]` : '[0]';
  filters.push(`${last}format=yuv420p[v]`);
  await run(ffmpeg, ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', filters.join(';'), '-map', '[v]', '-frames:v', String(item.frames), '-r', String(FPS), '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-tune', 'stillimage', '-pix_fmt', 'yuv420p', output]);
}

export async function renderLecture(name, { tail = 2, keep = false, silent = false, log = console.log } = {}) {
  const lecture = await loadLecture(name);
  // 無音：音声の代わりに表示時間を時間割に使う（再生画面の無音リハーサルと同じ）。
  const audio = silent ? Object.fromEntries(lecture.slides.map(slide => [slide.id, { ready: true, duration: slide.plannedSeconds }])) : await audioManifest(name, lecture, await loadTtsConfig());
  const missing = lecture.slides.filter(slide => !audio[slide.id].ready).map(slide => slide.id);
  if (missing.length) throw new Error(`音声が未生成・変更済みのスライドがあります（${missing.join(', ')}）。先に npm run tts -- --lecture ${name} で生成してください。TTSを使わない場合は --silent で無音の動画を書き出せます`);
  if (silent) log('注意：無音で書き出します（ナレーション音声なし・各スライドの表示時間で進めます）');
  const images = await imageManifest(name, lecture);
  const pendingImages = Object.entries(images).filter(([, item]) => !item.ready).map(([id]) => id);
  if (pendingImages.length) log(`注意：画像が未生成です（${pendingImages.join(', ')}）。「画像生成待ち」の枠のまま書き出します`);
  const ffmpeg = await ffmpegExecutable();
  const plan = renderPlan(lecture, audio, { tail });
  const work = join(reportRoot(name), 'render');
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  const shotOf = (item, k) => join(work, `${item.id}-${String(k).padStart(4, '0')}.png`);

  let session, server;
  try {
    // 1. 撮影
    session = await launchBrowser();
    const { cdp, sessionId } = session;
    server = await createStudioServer({ port: 0 });
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/?lecture=${encodeURIComponent(name)}&record=1` }, sessionId);
    await until(() => cdp.evaluate('!!window.slideStudio?.player'), 'プレイヤーを読み込めません');
    await cdp.evaluate("document.fonts.ready.then(() => { const style = document.createElement('style'); style.textContent = '.reveal{transition:none!important}'; document.head.append(style); slideStudio.frames = true; return true; })");
    if (silent) await cdp.evaluate('slideStudio.player.preview = true');
    const stage = await cdp.evaluate('JSON.stringify(document.getElementById("stage").getBoundingClientRect())').then(JSON.parse);
    if (Math.abs(stage.width - 1920) > 1 || Math.abs(stage.height - 1080) > 1) throw new Error('録画モードの画面が1920×1080ではありません');
    for (const item of plan) {
      await cdp.evaluate(`slideStudio.player.load(${item.index})`);
      await until(() => cdp.evaluate("[...document.querySelectorAll('#slide-content img')].every(img => img.complete && img.naturalWidth > 0)"), `スライド${item.id}の画像を読み込めません`);
      if (item.shots) {
        const slide = lecture.slides[item.index];
        for (const [k, shot] of item.shots.entries()) {
          await cdp.evaluate(`slideStudio.player.seek(${shot.time})`);
          const expected = JSON.stringify(JSON.stringify([...cueState(slide.cues, shot.time)].sort()));
          await until(() => cdp.evaluate(`JSON.stringify([...document.querySelectorAll('[data-block].visible')].map(el => el.dataset.block).sort()) === ${expected}`), `スライド${item.id}の表示が時刻 ${shot.time} の状態になりません`);
          await cdp.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
          const image = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
          await writeFile(shotOf(item, k), Buffer.from(image.data, 'base64'));
        }
        log(`撮影 ${item.id}（動きあり・${item.shots.length}コマ）`);
        continue;
      }
      for (const [k, state] of item.states.entries()) {
        await cdp.evaluate(`slideStudio.player.seek(${state.time + 0.01})`);
        const expected = JSON.stringify(state.visible);
        await until(() => cdp.evaluate(`JSON.stringify([...document.querySelectorAll('[data-block].visible')].map(el => el.dataset.block).sort()) === ${JSON.stringify(expected)}`), `スライド${item.id}の表示が時刻 ${state.time} の状態になりません`);
        await cdp.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
        await sleep(60);
        const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
        await writeFile(shotOf(item, k), Buffer.from(shot.data, 'base64'));
      }
      log(`撮影 ${item.id}（${item.states.length}画面）`);
    }
  } finally {
    if (session) await session.close();
    if (server) await new Promise(resolve => server.close(resolve));
  }

  // 2. スライドごとの映像 → 連結 → 音声（WAV＋間の無音）と合わせてMP4
  const clips = [];
  for (const item of plan) {
    const clip = join(work, `clip-${item.id}.mp4`);
    await (item.shots ? renderMotionClip : renderSlideClip)(ffmpeg, item, k => shotOf(item, k), clip);
    clips.push(clip);
    log(`映像 ${item.id}（${item.span.toFixed(1)}秒）`);
  }
  const list = join(work, 'clips.txt');
  await writeFile(list, clips.map(clip => `file '${clip.replaceAll('\\', '/')}'`).join('\n') + '\n', 'utf8');
  const video = join(work, 'video.mp4');
  await run(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', video]);
  const seconds = plan.reduce((sum, item) => sum + item.frames, 0) / FPS;
  const wavs = plan.flatMap(item => ['-i', join(lectureRoot(name), 'audio', `${item.id}.wav`)]);
  const audioFilters = plan.map((item, i) => `[${i + 1}:a]aresample=48000,atrim=end=${item.audioSeconds.toFixed(4)},apad=whole_dur=${item.audioSeconds.toFixed(4)}[a${i}]`);
  audioFilters.push(`${plan.map((_, i) => `[a${i}]`).join('')}concat=n=${plan.length}:v=0:a=1[a]`);
  await mkdir(EXPORT_DIR, { recursive: true });
  const output = await nextExportPath(name);
  const partial = join(EXPORT_DIR, `${name}.part.mp4`);
  // 無音でも再生ソフトで扱いやすいよう、無音の音声トラックを入れる。
  if (silent) await run(ffmpeg, ['-y', '-loglevel', 'error', '-i', video, '-f', 'lavfi', '-t', seconds.toFixed(4), '-i', 'anullsrc=r=48000:cl=stereo', '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-shortest', '-movflags', '+faststart', partial]);
  else await run(ffmpeg, ['-y', '-loglevel', 'error', '-i', video, ...wavs, '-filter_complex', audioFilters.join(';'), '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-movflags', '+faststart', partial]);
  await rename(partial, output);
  if (!keep) await rm(work, { recursive: true, force: true });
  return { output, seconds, silent, slides: plan.length, screens: plan.reduce((sum, item) => sum + (item.shots ?? item.states).length, 0) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const name = argumentValue(process.argv, '--lecture', 'demo');
    const tail = Number(argumentValue(process.argv, '--tail', '2'));
    const started = Date.now();
    const result = await renderLecture(name, { tail, keep: process.argv.includes('--keep'), silent: process.argv.includes('--silent') });
    console.log(`\n書き出し完了${result.silent ? '（無音）' : ''}：${relative(ROOT, result.output)} / ${result.slides}枚・${result.screens}画面 / ${Math.floor(result.seconds / 60)}分${Math.round(result.seconds % 60)}秒（処理 ${Math.round((Date.now() - started) / 1000)}秒）`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
