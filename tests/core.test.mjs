import test from 'node:test';
import assert from 'node:assert/strict';
import { LecturePlayer, cueState, validateLecture } from '../src/core.js';
import { readJson, ROOT, inputHash, synthesisInput } from '../tools/lib/project.mjs';
import { join } from 'node:path';
import { pcmToWav, wavInfo } from '../tools/lib/wav.mjs';

const sample = await readJson(join(ROOT, 'lectures/demo/lecture.json'));
class FakeMedia extends EventTarget {
  currentTime = 0;
  paused = true;
  src = '';
  playResult = null;
  play() { this.paused = false; return this.playResult ?? Promise.resolve(); }
  pause() { this.paused = true; }
  load() { this.currentTime = 0; }
  removeAttribute() { this.src = ''; }
}
function setup({ preview = false, gapAfter = 0 } = {}) {
  const lecture = structuredClone(sample);
  lecture.slides.forEach(slide => { slide.plannedSeconds = 12; slide.gapAfter = gapAfter; });
  const media = new FakeMedia();
  const audio = Object.fromEntries(lecture.slides.map(slide => [slide.id, { ready: true, duration: 12, url: `/audio/${slide.id}.wav` }]));
  const errors = [];
  const player = new LecturePlayer({ lecture, media, audio, preview, onError: error => errors.push(error.message) });
  return { player, media, errors, audio };
}
test('講義スキーマは重複ID・存在しないcue・逆順cueを拒否する', () => {
  assert.deepEqual(validateLecture(sample), []);
  const broken = structuredClone(sample);
  broken.slides[1].id = '001';
  broken.slides[1].cues = [{ at: 5, target: 'unknown' }, { at: 2, target: 'audio' }];
  const result = validateLecture(broken).join('\n');
  assert.match(result, /id が重複/); assert.match(result, /cue.target/); assert.match(result, /昇順/);
});
test('cueは音声位置から復元でき、巻き戻すと要素が再び隠れる', () => {
  const cues = sample.slides[1].cues;
  assert.deepEqual([...cueState(cues, 8)], ['audio', 'cue']);
  assert.deepEqual([...cueState(cues, 2)], ['audio']);
});
test('通常再生は音声のcurrentTimeを基準にする', async () => {
  const { player, media } = setup(); await player.play();
  media.currentTime = 4.5; player.tick(1000); player.tick(8000);
  assert.equal(player.time, 4.5);
  player.pause(); media.currentTime = 7; player.tick(9000);
  assert.equal(player.time, 4.5); assert.equal(player.state, 'paused');
  player.seek(1); assert.equal(media.currentTime, 1);
  await player.play(); assert.equal(player.state, 'playing');
});
test('音声終了で自動送りし、最終枚で終了する', async () => {
  const { player, media } = setup(); await player.play();
  media.dispatchEvent(new Event('ended')); await Promise.resolve();
  assert.equal(player.index, 1);
  media.dispatchEvent(new Event('ended')); await Promise.resolve();
  assert.equal(player.index, 2);
  media.dispatchEvent(new Event('ended'));
  assert.equal(player.state, 'ended'); assert.equal(player.elapsed, player.total);
  await player.play(); assert.equal(player.index, 0); assert.equal(player.state, 'playing');
});
test('切り替えの間も一時停止・再開できる', async () => {
  const { player, media } = setup({ gapAfter: 1 }); await player.play();
  media.dispatchEvent(new Event('ended')); player.tick(0); player.tick(400);
  assert.equal(player.gapRemaining, .6);
  player.pause(); player.tick(5000); assert.equal(player.gapRemaining, .6);
  await player.play(); player.tick(5000); player.tick(5700); await Promise.resolve();
  assert.equal(player.index, 1); assert.equal(player.state, 'playing');
});
test('音声読み込み中の停止で、遅れて解決したplayが再開しない', async () => {
  const { player, media } = setup(); let release;
  media.playResult = new Promise(resolve => { release = resolve; });
  const playing = player.play(); assert.equal(player.state, 'loading');
  player.pause(); release(); await playing;
  assert.equal(player.state, 'paused'); assert.equal(media.paused, true);
});
test('音声がなければ通常再生を止め、無音リハーサルは動く', async () => {
  const { player, errors, audio } = setup(); audio['001'].ready = false;
  await player.play(); assert.equal(player.state, 'error'); assert.equal(errors.length, 1);
  const rehearsal = setup({ preview: true }); await rehearsal.player.play();
  rehearsal.player.tick(0); rehearsal.player.tick(6000); assert.equal(rehearsal.player.time, 6);
  rehearsal.player.tick(12000); await Promise.resolve(); assert.equal(rehearsal.player.index, 1);
});
test('再生拒否を表示し、再試行できる', async () => {
  const { player, media, errors } = setup(); media.playResult = Promise.reject(new Error('blocked'));
  await player.play(); assert.equal(player.state, 'error'); assert.equal(errors.length, 1);
  media.playResult = null; await player.play(); assert.equal(player.state, 'playing');
});
test('キャッシュキーは台本・モデル・声・話し方を含み、cue変更では変わらない', () => {
  const config = { model: 'model', voice: { id: 'voice_test' }, defaultStyle: 'calm' };
  const slide = structuredClone(sample.slides[0]);
  const original = inputHash(synthesisInput(slide, config));
  slide.cues[0].at = 1; assert.equal(inputHash(synthesisInput(slide, config)), original);
  for (const change of [ { ...config, model: 'other' }, { ...config, voice: { id: 'voice_other' } }, { ...config, defaultStyle: 'clear' } ]) assert.notEqual(inputHash(synthesisInput(slide, change)), original);
  slide.narration += '変更'; assert.notEqual(inputHash(synthesisInput(slide, config)), original);
});
test('WAVの長さ・無音・破損を検証する', () => {
  const pcm = Buffer.alloc(48000);
  const silent = pcmToWav(pcm); assert.equal(wavInfo(silent).duration, 1); assert.equal(wavInfo(silent).speechStart, null);
  for (let i = 2400; i < 12000; i++) pcm.writeInt16LE(Math.round(Math.sin(i / 10) * 10000), i * 2);
  const info = wavInfo(pcmToWav(pcm)); assert.equal(info.speechStart, .1); assert.equal(info.speechEnd, .5);
  assert.throws(() => wavInfo(Buffer.from('broken'))); assert.throws(() => wavInfo(silent.subarray(0, 100)));
});
test('発表の手動送り：押すたびに要点を1つ表示し、全部出たら次のスライド。戻ると1つ前の状態・前のスライドの全表示へ', () => {
  const { player, media } = setup();
  player.lecture.slides[0].cues = [{ at: 0, target: player.lecture.slides[0].cues[0].target }];
  player.lecture.slides[1].cues = [{ at: 0, target: 'audio' }, { at: 4, target: 'cue' }];
  player.load(0);
  const visible = () => [...cueState(player.slide.cues, player.time)].sort();
  player.step(1);
  assert.equal(player.index, 1); assert.deepEqual(visible(), ['audio']); assert.equal(player.state, 'paused'); assert.equal(media.paused, true);
  player.step(1);
  assert.equal(player.index, 1); assert.deepEqual(visible(), ['audio', 'cue']); assert.equal(media.currentTime, 4);
  player.step(-1);
  assert.equal(player.index, 1); assert.deepEqual(visible(), ['audio']);
  player.step(1); player.step(1);
  assert.equal(player.index, 2); assert.equal(player.time, 0);
  player.step(-1);
  assert.equal(player.index, 1); assert.deepEqual(visible(), ['audio', 'cue']);
  player.step(-1); player.step(-1);
  assert.equal(player.index, 0);
  player.step(-1);
  assert.equal(player.index, 0);
  // 最終スライドで要点が出尽くしたら、それ以上進まない。
  player.load(player.lecture.slides.length - 1);
  for (let i = 0; i < 10; i++) player.step(1);
  assert.equal(player.index, player.lecture.slides.length - 1); assert.notEqual(player.state, 'error');
});
test('ttsModel：そのスライドだけ別のTTSモデルで生成し、ほかのスライドの生成条件は変えない', async () => {
  const config = { model: 'gemini-3.8-flash-lite-tts', voice: { id: 'voice_x' }, defaultStyle: 's' };
  const slide = { narration: '本文' };
  const before = inputHash(synthesisInput(slide, config));
  assert.equal(synthesisInput({ ...slide, ttsModel: 'gemini-3.8-flash-tts' }, config).model, 'gemini-3.8-flash-tts');
  assert.equal(inputHash(synthesisInput(slide, config)), before);
  const lecture = structuredClone(sample);
  lecture.slides[0].ttsModel = 'flash';
  assert.match(validateLecture(lecture).join('\n'), /ttsModel/);
  lecture.slides[0].ttsModel = 'gemini-3.8-flash-tts';
  assert.deepEqual(validateLecture(lecture), []);
});
test('ttsVoice：そのスライドだけ別の声で生成し、ほかのスライドの生成条件は変えない', () => {
  const config = { model: 'gemini-3.8-flash-lite-tts', voice: { id: 'voice_x' }, defaultStyle: 's' };
  const slide = { narration: '本文' };
  const before = inputHash(synthesisInput(slide, config));
  assert.equal(synthesisInput({ ...slide, ttsVoice: 'voice_y' }, config).voice, 'voice_y');
  assert.equal(inputHash(synthesisInput(slide, config)), before);
  const lecture = structuredClone(sample);
  lecture.slides[0].ttsVoice = 'Jon';
  assert.match(validateLecture(lecture).join('\n'), /ttsVoice/);
  lecture.slides[0].ttsVoice = 'voice_y';
  assert.deepEqual(validateLecture(lecture), []);
});
