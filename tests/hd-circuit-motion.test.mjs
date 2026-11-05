import assert from 'node:assert/strict';
import test from 'node:test';
import { HD_SECONDS, hdBloodClock, hdCircuitPlan, hdCircuitState, hdFlowOffset, validateHdCircuit } from '../src/hd-circuit-motion.js';

const ids = ['s1', 's2', 's3', 's4', 's5'];
const slide = (overrides = {}) => ({ id: '001', layout: 'statement', plannedSeconds: 100, blocks: ids.map(id => ({ id })), cues: ids.map((target, i) => ({ target, at: i * 20 })), hdCircuit: { model: 'hd-circuit-v1', targets: ids }, ...overrides });

test('hdCircuit は statement と説明順の本文5つだけを受け付ける', () => {
  assert.deepEqual(validateHdCircuit(slide()), []);
  assert.equal(validateHdCircuit(slide({ layout: 'figure' })).length, 1);
  assert.equal(validateHdCircuit(slide({ hdCircuit: { model: 'hd-circuit-v1', targets: ids.slice(0, 4) } })).length, 1);
  assert.equal(validateHdCircuit(slide({ cues: ids.map((target, i) => ({ target, at: (4 - i) * 20 })) })).length, 1);
  assert.equal(validateHdCircuit(slide({ plannedSeconds: 82 })).length, 1, '最後の段階が終わるまでの長さが必要');
});

test('血液の粒は脈打ちながら後戻りしない', () => {
  let previous = hdFlowOffset('blood', 0);
  for (let t = .02; t < 5; t += .02) { const next = hdFlowOffset('blood', t); assert.ok(next > previous); previous = next; }
});

test('段階の進み具合は時刻だけで決まり、動きの一覧は最後まで続く', () => {
  const s = slide();
  assert.deepEqual(hdCircuitState(s, 21).progress.map(p => +p.toFixed(3)), [1, +(1 / HD_SECONDS[1]).toFixed(3), 0, 0, 0]);
  assert.equal(hdCircuitState(s, 21).current, 1);
  assert.deepEqual(hdCircuitState(s, 21), hdCircuitState(s, 21));
  const plan = hdCircuitPlan(s, 100);
  assert.equal(plan[0].start, 0); assert.equal(plan[0].end, 99.8);
  assert.equal(plan.length, 6);
  assert.deepEqual(hdCircuitPlan(slide({ animation: { type: 'none' } }), 100), []);
});

test('気泡を検知している間は血液の時計だけが止まり、その後は続きから進む', () => {
  const s = slide();
  assert.equal(hdBloodClock(s, 87), 87);
  assert.equal(hdBloodClock(s, 90), hdBloodClock(s, 91));
  assert.ok(hdBloodClock(s, 95) > hdBloodClock(s, 91));
  assert.ok(Math.abs(hdBloodClock(s, 95) - (95 - 3.2)) < 1e-9);
});
