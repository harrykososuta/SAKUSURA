import test from 'node:test';
import assert from 'node:assert/strict';
import { clock, cueSteps, nextView, pace, plannedStart, plannedTotal, presenterUrl, sameFrame, stepProgress, toFrame, toSlide, validCommand } from '../src/presenter-link.js';

const lecture = { slides: [
  { id: 's1', plannedSeconds: 10, gapAfter: 1, cues: [{ at: 0, target: 'b1' }] },
  { id: 's2', plannedSeconds: 20, gapAfter: 1, cues: [{ at: 0, target: 'b1' }, { at: 4, target: 'b2' }, { at: 4, target: 'b3' }, { at: 9, target: 'b4' }] },
  { id: 's3', plannedSeconds: 30, gapAfter: 0, cues: [] },
] };

test('要点の段階は cue の時刻の重複を除いて数え、時刻0の要点は最初から表示済み', () => {
  assert.deepEqual(cueSteps(lecture.slides[1]), [0, 4, 9]);
  assert.deepEqual(stepProgress(lecture.slides[1], 0), { shown: 1, total: 3 });
  assert.deepEqual(stepProgress(lecture.slides[1], 4), { shown: 2, total: 3 });
  assert.deepEqual(stepProgress(lecture.slides[2], 0), { shown: 0, total: 0 });
});

test('次に出るものは、同じスライドの次の要点・次のスライド・終わりの順に決まる', () => {
  assert.deepEqual(nextView(lecture, 1, 0), { kind: 'step', index: 1, time: 4 });
  assert.deepEqual(nextView(lecture, 1, 9), { kind: 'slide', index: 2, time: 0 });
  assert.deepEqual(nextView(lecture, 0, 0), { kind: 'slide', index: 1, time: 0 });
  assert.equal(nextView(lecture, 2, 0).kind, 'end');
});

test('予定の時刻は音声の長さを優先し、無音リハーサルでは予定尺を使う', () => {
  const audio = { s1: { duration: 12 } };
  assert.equal(plannedStart(lecture, audio, false, 2), 12 + 1 + 20 + 1);
  assert.equal(plannedStart(lecture, audio, true, 2), 10 + 1 + 20 + 1);
  assert.equal(plannedTotal(lecture, {}, true), 10 + 1 + 20 + 1 + 30);
});

test('予定との差は15秒未満なら予定どおり', () => {
  assert.deepEqual(pace(100, 90), { kind: 'on', seconds: 0 });
  assert.deepEqual(pace(130, 100), { kind: 'behind', seconds: 30 });
  assert.deepEqual(pace(60, 100), { kind: 'ahead', seconds: 40 });
});

test('タイマーは1時間を超えると時:分:秒になる', () => {
  assert.equal(clock(0), '00:00');
  assert.equal(clock(65.9), '01:05');
  assert.equal(clock(3723), '1:02:03');
});

test('発表者ビューから受け付ける操作は決めたものだけで、移動先は範囲内に限る', () => {
  assert.ok(validCommand({ type: 'command', name: 'next' }, 3));
  assert.ok(validCommand({ type: 'command', name: 'goto', index: 2 }, 3));
  assert.ok(!validCommand({ type: 'command', name: 'goto', index: 3 }, 3));
  assert.ok(!validCommand({ type: 'command', name: 'goto', index: '1' }, 3));
  assert.ok(!validCommand({ type: 'command', name: 'dispose' }, 3));
  assert.ok(!validCommand({ type: 'state' }, 3));
  assert.equal(presenterUrl('a b', 'x1'), '/presenter?lecture=a%20b&channel=x1');
});

test('レーザー・ペン・拡大の操作は、値の形と範囲を確かめてから受け付ける', () => {
  assert.ok(validCommand({ type: 'command', name: 'laser', u: .5, v: .2 }, 3));
  assert.ok(validCommand({ type: 'command', name: 'laser', u: null, v: null }, 3));
  assert.ok(!validCommand({ type: 'command', name: 'laser', u: 2, v: .2 }, 3));
  assert.ok(validCommand({ type: 'command', name: 'stroke-start', point: { x: 100, y: 200 }, color: 'red' }, 3));
  assert.ok(!validCommand({ type: 'command', name: 'stroke-start', point: { x: 'a', y: 200 }, color: 'red' }, 3));
  assert.ok(validCommand({ type: 'command', name: 'stroke-move', points: [{ x: 1, y: 2 }] }, 3));
  assert.ok(!validCommand({ type: 'command', name: 'stroke-move', points: Array(501).fill({ x: 1, y: 2 }) }, 3));
  assert.ok(validCommand({ type: 'command', name: 'view', z: 2, x: -.5, y: -.25 }, 3));
  assert.ok(!validCommand({ type: 'command', name: 'view', z: Infinity, x: 0, y: 0 }, 3));
});

test('拡大中の画面上の点とスライド上の点は、互いに戻せる', () => {
  const view = { z: 2, x: -.5, y: -.25 };
  const { u, v } = toSlide(view, .3, .6);
  const { a, b } = toFrame(view, u, v);
  assert.ok(Math.abs(a - .3) < 1e-9 && Math.abs(b - .6) < 1e-9);
  assert.deepEqual(toSlide({ z: 1, x: 0, y: 0 }, .4, .7), { u: .4, v: .7 });
});

test('スライド画面と発表者ビューの位置・大きさが同じなら、同じウィンドウ（タブ）とみなす', () => {
  const frame = { x: 0, y: 0, w: 1920, h: 1040 };
  assert.equal(sameFrame(frame, { x: 2, y: 0, w: 1920, h: 1042 }), true);
  assert.equal(sameFrame(frame, { x: 960, y: 0, w: 960, h: 1040 }), false);
  assert.equal(sameFrame(undefined, frame), false);
  assert.equal(sameFrame({ x: 0, y: 0, w: 1920 }, frame), false);
});
