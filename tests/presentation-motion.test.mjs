import test from 'node:test';
import assert from 'node:assert/strict';
import { MOTION, motionEase, validateAnimation } from '../src/animation.js';
import { presentationPlan } from '../src/presentation-motion.js';
import { hasMotion, motionPlan, settleTime } from '../src/motion.js';
import { renderPlan } from '../tools/render.mjs';

const makeSlide = (type = 'subtle', layout = 'statement') => ({ id: 'test', layout, title: '確認', narration: '', plannedSeconds: 6, gapAfter: 0, animation: { type }, blocks: [{ id: 'a', label: 'A', text: '項目A' }, { id: 'b', label: 'B', text: '項目B' }, { id: 'c', label: 'C', text: '項目C' }], cues: [{ target: 'a', at: .5 }, { target: 'b', at: .5 }, { target: 'c', at: 3 }] });

test('出現は0.25秒・同時cueだけ0.09秒ずらし、原稿とcueは変更しない', () => {
  const slide = makeSlide(), original = structuredClone(slide), plan = motionPlan({ category: 'cat-a' }, slide, 6);
  assert.equal(hasMotion({ category: 'cat-a' }, slide), true);
  assert.deepEqual(plan.filter(i => i.kind === 'enter').map(i => [i.start, i.end]), [[.5, .75], [.59, .84], [3, 3.25]]);
  assert.deepEqual(slide, original);
  slide.animation.stagger = false;
  assert.deepEqual(motionPlan({}, slide, 6).filter(i => i.kind === 'enter').map(i => i.start), [.5, .5, 3]);
  assert.equal(MOTION.distance, 20); assert.equal(MOTION.dim, .35);
  assert.equal(motionEase(0), 0); assert.equal(motionEase(1), 1);
  let previous = 0; for (let i = 1; i <= 100; i++) { const p = motionEase(i / 100); assert.ok(p >= previous && p <= 1); previous = p; }
  assert.ok(motionEase(.25) > .6);
});

test('フローは矢印の描画完了→カード出現完了→判定。cueが同時でも前後を逆転しない', () => {
  const slide = makeSlide('flow', 'flow'); slide.animation.targets = ['a', 'b', 'c']; slide.animation.verdicts = [{ target: 'b', result: 'pass' }]; slide.animation.links = [{ target: 'b', style: 'dashed', result: 'fail' }];
  const plan = presentationPlan({}, slide, 6), first = plan.find(i => i.kind === 'enter' && i.target === 'a'), link = plan.find(i => i.kind === 'link' && i.target === 'b'), enter = plan.find(i => i.kind === 'enter' && i.target === 'b'), verdict = plan.find(i => i.kind === 'verdict'), linkVerdict = plan.find(i => i.kind === 'linkVerdict');
  assert.ok(link.start >= first.end); assert.equal(enter.start, link.end); assert.ok(verdict.start > enter.end); assert.equal(verdict.start, linkVerdict.start);
  assert.deepEqual(validateAnimation(slide), []);
  assert.ok(settleTime({}, slide, .5, 6) >= verdict.end);
  slide.animation.links[0].target = 'a'; assert.ok(validateAnimation(slide).length);
});

test('フォーカスの切替・上限到達と判定も書き出しの全フレームに含める', () => {
  const focus = makeSlide('focus');
  assert.deepEqual(motionPlan({}, focus, 6).filter(i => i.kind === 'focus').map(i => [i.start, i.end]), [[.5, .75], [3, 3.25]]);
  const focusBars = makeSlide('focus', 'bars'); focusBars.blocks.forEach(b => { b.value = 50; });
  assert.equal(motionPlan({}, focusBars, 6).some(i => i.kind === 'grow'), false); // 一覧の未来の値を0と誤読させない。
  const bars = makeSlide('limit', 'bars'); bars.max = 150; bars.animation.limit = 100; bars.animation.blockedTargets = ['c']; bars.blocks.forEach((b, i) => { b.value = [60, 120, 30][i]; });
  assert.deepEqual(validateAnimation(bars), []);
  const hits = motionPlan({}, bars, 6).filter(i => i.kind === 'hit'); assert.deepEqual(hits.map(i => i.target), ['b']);
  const output = renderPlan({ slides: [bars] }, { test: { duration: 6 } })[0];
  for (let frame = Math.ceil(hits[0].start * 30); frame <= Math.floor(hits[0].end * 30); frame++) assert.ok(output.shots.some(shot => shot.frame === frame));
  bars.animation.limit = 200; assert.ok(validateAnimation(bars).length);
  bars.animation.limit = 100; bars.animation.blockedTargets = ['unknown']; assert.ok(validateAnimation(bars).length);
});

test('動きなしは静止画の切替として書き出し、短い尺にも範囲外の動きを作らない', () => {
  const slide = makeSlide('none');
  assert.deepEqual(validateAnimation(slide), []); assert.equal(hasMotion({}, slide), false); assert.deepEqual(motionPlan({}, slide, 6), []);
  const output = renderPlan({ slides: [slide] }, { test: { duration: 6 } })[0];
  assert.deepEqual(output.shots.map(shot => shot.frame), [0, 15, 90]);
  const short = makeSlide('flow', 'flow'); short.animation.targets = ['a', 'b', 'c'];
  short.cues.forEach((cue, i) => { cue.at = [.1, .2, .5][i]; });
  const plan = motionPlan({}, short, .6);
  assert.ok(plan.every(i => i.start >= i.cue && i.end >= i.start && i.end <= .6)); assert.ok(plan.some(i => i.short));
  assert.ok(validateAnimation({ ...slide, animation: { type: 'none', stagger: false } }).length);
  assert.ok(validateAnimation({ ...slide, animation: { type: 'limit', limit: 5 } }).length);
});
