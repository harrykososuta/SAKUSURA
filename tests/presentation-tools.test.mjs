import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_VIEW, PEN_COLORS, clampView, stageTransform, strokePath, zoomAt } from '../src/presentation-tools.js';
import { overviewColumns, overviewTarget } from '../src/presentation-overview.js';

test('ペンの色は数字キー1〜5に対応する5色で、重複しない', () => {
  assert.equal(PEN_COLORS.length, 5);
  assert.equal(new Set(PEN_COLORS.map(color => color.id)).size, 5);
  assert.equal(new Set(PEN_COLORS.map(color => color.value)).size, 5);
  assert.equal(PEN_COLORS[0].id, 'red');
});

test('スライド一覧の列数は枚数に応じて増える', () => {
  assert.deepEqual([3, 9, 10, 16, 17, 30, 31].map(overviewColumns), [3, 3, 4, 4, 5, 5, 6]);
});

test('スライド一覧の矢印キーは端で止まり、最終行が短くても最後のスライドへ移れる', () => {
  assert.equal(overviewTarget(0, 'ArrowLeft', 4, 10), 0);
  assert.equal(overviewTarget(0, 'ArrowUp', 4, 10), 0);
  assert.equal(overviewTarget(0, 'ArrowRight', 4, 10), 1);
  assert.equal(overviewTarget(1, 'ArrowDown', 4, 10), 5);
  assert.equal(overviewTarget(5, 'ArrowUp', 4, 10), 1);
  assert.equal(overviewTarget(7, 'ArrowDown', 4, 10), 9);
  assert.equal(overviewTarget(9, 'ArrowDown', 4, 10), 9);
  assert.equal(overviewTarget(9, 'ArrowRight', 4, 10), 9);
  assert.equal(overviewTarget(2, 'KeyA', 4, 10), 2);
});

test('拡大しても指定した点は同じ位置に留まる', () => {
  const view = zoomAt(DEFAULT_VIEW, .25, .5, 2);
  assert.deepEqual(view, { z: 2, x: -.25, y: -.5 });
  const closer = zoomAt(view, .5, .5, 3);
  assert.equal(closer.z, 3);
  assert.ok(Math.abs((.5 - closer.x) / closer.z - (.5 - view.x) / view.z) < 1e-9);
});

test('拡大率は1〜4倍に収め、スライドの外は見せない', () => {
  assert.equal(zoomAt(DEFAULT_VIEW, .5, .5, 9).z, 4);
  assert.equal(zoomAt(DEFAULT_VIEW, .5, .5, .2).z, 1);
  assert.deepEqual(clampView({ z: 2, x: .4, y: -3 }), { z: 2, x: 0, y: -1 });
  assert.deepEqual(zoomAt({ z: 2, x: -1, y: -1 }, 1, 1, 1), { z: 1, x: 0, y: 0 });
});

test('等倍の表示は従来と同じ scale だけの指定にする', () => {
  assert.equal(stageTransform(DEFAULT_VIEW, .5, 960, 540), 'scale(0.5)');
  assert.equal(stageTransform({ z: 2, x: -.5, y: -.25 }, .5, 960, 540), 'translate(-480px, -135px) scale(1)');
});

test('線のパスは1点だけでも点として描ける', () => {
  assert.equal(strokePath([]), '');
  assert.equal(strokePath([{ x: 1, y: 2 }]), 'M1 2L1 2');
  assert.equal(strokePath([{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 6 }]), 'M1 2L3 4L5 6');
});
