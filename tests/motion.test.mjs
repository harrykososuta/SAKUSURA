import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { LecturePlayer, validateLecture } from '../src/core.js';
import { hasMotion, motionPlan, motionSpans, settleTime } from '../src/motion.js';
import { readJson, ROOT } from '../tools/lib/project.mjs';

const demo = await readJson(join(ROOT, 'lectures/ai-motion-demo/lecture.json'));
const slideOf = layout => demo.slides.find(slide => slide.layout === layout);

test('アニメーション見本の講義はスキーマに合う', () => assert.deepEqual(validateLecture(demo), []));

test('動きはカテゴリDのフロー図・チャット・棒グラフだけ。ほかの講義のフロー図は今までどおり静か', () => {
  const flow = slideOf('flow');
  assert.equal(hasMotion(demo, flow), true);
  assert.equal(hasMotion({ ...demo, category: 'cat-a' }, flow), false);
  assert.equal(hasMotion({ category: 'cat-a' }, slideOf('chat')), true);
  assert.equal(hasMotion({ category: 'cat-a' }, slideOf('message')), false);
  assert.equal(hasMotion(demo, slideOf('message')), true); // カテゴリD は一文スライドも動く
  assert.deepEqual(motionPlan({ category: 'cat-a' }, flow, 16), []);
});

test('フロー図：2つ目以降の箱は矢印が伸び、全部出たあと光の点が1回流れる', () => {
  const plan = motionPlan(demo, slideOf('flow'), 16);
  assert.deepEqual(plan.filter(item => item.kind === 'link').map(item => item.start), [3, 5.5, 8.5]);
  assert.equal(plan.filter(item => item.kind === 'arrive').length, 4);
  const sweep = plan.find(item => item.kind === 'sweep');
  assert.ok(sweep && sweep.end <= 16 - 0.2);
  // 音声が短く収まらないときは光の点を省く
  assert.equal(motionPlan(demo, slideOf('flow'), 10.5).some(item => item.kind === 'sweep'), false);
});

test('ほかの講義フローの明示指定：補足説明を経路から外し、描画とMP4が同じ時間割を使う', async () => {
  const slide = structuredClone(slideOf('flow'));
  const ids = slide.blocks.map(block => block.id);
  slide.animation = { type: 'flow', targets: ids.slice(0, 3) };
  slide.cues = ids.map((target, index) => ({ target, at: index * 3 }));
  const lecture = { ...demo, category: 'cat-a', slides: [slide], rules: 'free' };
  assert.deepEqual(validateLecture(lecture), []);
  assert.equal(hasMotion(lecture, slide), true);
  const plan = motionPlan(lecture, slide, 20);
  assert.deepEqual(plan.filter(item => item.kind === 'arrive').map(item => item.target), ids.slice(0, 3));
  assert.deepEqual(plan.filter(item => item.kind === 'link').map(item => item.target), ids.slice(1, 3));
  assert.ok(plan.find(item => item.kind === 'sweep').start < 9);
  assert.ok(plan.some(item => item.kind === 'enter' && item.target === ids[3]));
  const { renderPlan } = await import('../tools/render.mjs');
  const [output] = renderPlan(lecture, { [slide.id]: { duration: 20 } });
  assert.ok(output.shots?.length);
  const sweep = plan.find(item => item.kind === 'sweep');
  for (let frame = Math.ceil(sweep.start * 30); frame <= Math.floor(sweep.end * 30); frame++) {
    assert.ok(output.shots.some(shot => shot.frame === frame));
  }
  slide.animation.targets.push(ids[0]);
  assert.match(validateLecture(lecture).join('\n'), /animation/);
  slide.animation.targets = [ids[0], 'missing'];
  assert.match(validateLecture(lecture).join('\n'), /animation/);
});

test('チャット：AIは考え中のあとに文字を出し、音声の終わりまでに必ず書き終える', () => {
  const chat = slideOf('chat');
  const plan = motionPlan(demo, chat, 14);
  const think = plan.find(item => item.kind === 'think'), type = plan.find(item => item.kind === 'type' && item.target === 'a');
  assert.equal(think.start, 3); assert.equal(type.start, think.end);
  assert.ok(plan.every(item => !item.short));
  const short = motionPlan(demo, chat, 5);
  assert.ok(short.every(item => item.end <= 5 - 0.2 + 1e-9));
  assert.ok(short.some(item => item.short));
});

test('動いている時間帯は重なりをまとめ、手動送りは cue から動きの終わりまで進める', () => {
  const bars = slideOf('bars');
  assert.deepEqual(motionSpans(demo, bars, 13), [[0.5, 0.85], [4, 4.35], [8, 8.25]]); // 8秒：まとめの一文の登場
  assert.equal(settleTime(demo, bars, 4, 13), 4.35);
  assert.equal(settleTime(demo, bars, 8, 13), 8.25);
  assert.equal(settleTime({ ...demo, category: 'cat-a' }, bars, 8, 13), 8); // カテゴリD 以外のまとめの一文は動きなし
});

test('チャット・棒グラフの検査：role・value が必要で、ほかのレイアウトには使えない', () => {
  const lecture = structuredClone(demo);
  const chat = lecture.slides.find(slide => slide.layout === 'chat');
  const bars = lecture.slides.find(slide => slide.layout === 'bars');
  delete chat.blocks[0].role;
  bars.blocks[0].value = -1;
  bars.max = 10;
  lecture.slides.find(slide => slide.layout === 'flow').blocks[0].value = 3;
  const result = validateLecture(lecture).join('\n');
  assert.match(result, /role（user＝質問/); assert.match(result, /value（0以上の数値）/);
  assert.match(result, /max は棒グラフ/); assert.match(result, /value は棒グラフ（bars）だけ/);
});

test('発表用の手動送り：押すと cue の時刻から動きの終わりまで音声なしで進み、そこで止まる', () => {
  const media = new (class extends EventTarget { currentTime = 0; play() { return Promise.resolve(); } pause() {} load() {} removeAttribute() {} })();
  const audio = Object.fromEntries(demo.slides.map(slide => [slide.id, { ready: true, duration: slide.plannedSeconds, url: '' }]));
  const player = new LecturePlayer({ lecture: demo, audio, media, settle: (slide, at, duration) => settleTime(demo, slide, at, duration) });
  player.load(demo.slides.indexOf(slideOf('bars')));
  player.step(1);
  assert.equal(player.time, 0.5); assert.equal(player.state, 'paused');
  player.tick(1000); player.tick(1600); player.tick(3000);
  assert.equal(player.time, 0.85);
  player.tick(5000);
  assert.equal(player.time, 0.85);
});

test('動画の書き出し：動きのあるスライドはフェードと動きの間を毎コマ撮り、それ以外は表示が変わるときだけ', async () => {
  const { renderPlan } = await import('../tools/render.mjs');
  const bars = slideOf('bars');
  const lecture = { ...demo, category: 'cat-a', slides: [demo.slides[0], bars] }; // 表紙が動かないシリーズで比べる
  const plan = renderPlan(lecture, { [demo.slides[0].id]: { duration: 8 }, [bars.id]: { duration: 13 } });
  assert.equal(plan[0].shots, undefined);
  const shots = plan[1].shots;
  const frames = shots.map(shot => shot.frame);
  assert.equal(frames[0], 0);
  assert.ok(frames.every((frame, index) => !index || frame > frames[index - 1]));
  // 0.5〜0.85秒（棒が伸びる間）は毎コマ
  const from = Math.round((8.5 + 0.5) * 30) - Math.round(8.5 * 30), to = Math.round((8.5 + 0.85) * 30) - Math.round(8.5 * 30);
  for (let frame = from; frame <= to; frame++) assert.ok(frames.includes(frame));
  // 動きのない間（2〜3.9秒）は撮らない
  assert.ok(!frames.some(frame => frame > to + 1 && frame < Math.round((8.5 + 4) * 30) - Math.round(8.5 * 30)));
  assert.ok(shots.every(shot => shot.time <= 13));
});

test('コード・年表・輪の図・層の図：必要な項目を検査し、動きは cue から順に進む', () => {
  const lecture = structuredClone(demo);
  const code = lecture.slides.find(slide => slide.layout === 'code');
  const plan = motionPlan(lecture, code, 14);
  const [type, cmd, out] = ['type', 'cmd', 'out'].map(kind => plan.find(item => item.kind === kind));
  assert.ok(type.start === 0.5 && cmd.start > type.end && out.start > cmd.end && out.end <= 14 - 0.2);
  const timeline = lecture.slides.find(slide => slide.layout === 'timeline');
  assert.ok(motionPlan(lecture, timeline, 16).some(item => item.kind === 'tail'));
  const cycle = lecture.slides.find(slide => slide.layout === 'cycle');
  const ring = motionPlan(lecture, cycle, 18);
  assert.equal(ring.filter(item => item.kind === 'orbit').length, 3);
  assert.ok(ring.find(item => item.kind === 'laps')?.laps >= 1);
  assert.equal(motionPlan(lecture, cycle, 9).some(item => item.kind === 'laps'), false); // 収まらなければ周回しない
  delete code.blocks[0].code;
  timeline.blocks[0].label = '';
  cycle.center = 'x'.repeat(20);
  lecture.slides.find(slide => slide.layout === 'stack').blocks[0].row = 9;
  lecture.slides.find(slide => slide.layout === 'statement').blocks[0].row = 1;
  const result = validateLecture(lecture).join('\n');
  assert.match(result, /label（ファイル名など）と code/); assert.match(result, /label（年・日付）/);
  assert.match(result, /center は輪の図/); assert.match(result, /row（1〜5/); assert.match(result, /row は層の図/);
});

test('カテゴリD は本文6つ・表6行まで。ほかのシリーズは表5行まで', () => {
  const lecture = structuredClone(demo);
  const table = { id: 't', layout: 'table', title: '表', narration: '', plannedSeconds: 5, gapAfter: 0, columns: ['a', 'b'], blocks: [1, 2, 3, 4, 5, 6].map(i => ({ id: `r${i}`, label: `行${i}`, text: '内容' })), cues: [1, 2, 3, 4, 5, 6].map(i => ({ at: i, target: `r${i}` })) };
  lecture.slides.push(table);
  assert.deepEqual(validateLecture(lecture), []);
  assert.match(validateLecture({ ...lecture, category: 'cat-a' }).join('\n'), /table の行は5つまで/);
});
