import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { imageTaskSpec, startImageTask, readImageTask, waitImageTask, recordImageTask, verifyImageTask, orcaExecutable, unsentDispatchInput, SPEC_MARKER } from '../tools/lib/orca-images.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'orca-images-test-'));
  t.after(async () => { assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep) && root.includes('orca-images-test-')); await rm(root, { recursive: true, force: true }); });
  const images = join(root, 'lectures/lesson/images'), reports = join(root, 'reports/lesson');
  await mkdir(images, { recursive: true }); await mkdir(reports, { recursive: true });
  await writeFile(join(root, 'lectures/lesson/lecture.json'), JSON.stringify({ slides: [{ id: '001', image: { labels: [] } }] }));
  const calls = [];
  const call = async args => {
    calls.push(args);
    if (args[1] === 'run-create') return { run: { id: 'run_test', coordinator_handle: 'term_claude' } };
    if (args[1] === 'worker-start') return { runId: 'run_test', taskId: 'task_test', dispatchId: 'dispatch_test', state: 'ready' };
    throw new Error(`Unexpected ${args[1]}`);
  };
  const plan = async () => ({ name: 'lesson', title: 'テスト', pending: 1, targets: [{ id: '001', file: '001.png', size: [1, 1] }] });
  const prepare = async () => writeFile(join(images, 'REQUEST.md'), 'request literal $() `quotes` "日本語"');
  return { root, images, reports, calls, call, plan, prepare };
}

test('same request starts one supervised Codex in the current folder and preserves literal prompt text', async t => {
  const f = await fixture(t);
  const first = await startImageTask('lesson', f);
  const second = await startImageTask('lesson', f);
  assert.equal(first.phase, 'running'); assert.equal(second.reused, true);
  assert.equal(f.calls.length, 2);
  const args = f.calls[1];
  assert.equal(args[1], 'worker-start');
  assert.equal(args[args.indexOf('--worktree') + 1], `path:${resolve(f.root)}`);
  assert.equal(args[args.indexOf('--agent') + 1], 'codex');
  assert.ok(args.includes('--spec'));
  assert.ok(!args.includes('dispatch') && !args.includes('terminal'));
  assert.equal((await readImageTask('lesson', f.root)).coordinatorHandle, 'term_claude');
});

test('unknown launch result is durable and never retried as a new worker', async t => {
  const f = await fixture(t);
  let starts = 0;
  const call = async args => { if (args[1] === 'worker-start') { starts++; const error = new Error('transport lost'); error.receipt = { residualResources: ['unknown'] }; throw error; } return f.call(args); };
  await assert.rejects(startImageTask('lesson', { ...f, call }), /transport lost/);
  const state = await readImageTask('lesson', f.root);
  assert.equal(state.phase, 'launch-unknown'); assert.deepEqual(state.errorReceipt.residualResources, ['unknown']);
  assert.equal((await startImageTask('lesson', { ...f, call })).reused, true);
  assert.equal(starts, 1);
});

test('complete assets do not create a Run, rewrite REQUEST, or launch an agent', async t => {
  const f = await fixture(t);
  const result = await startImageTask('lesson', { ...f, plan: async () => ({ pending: 0 }), prepare: async () => { throw new Error('must not write'); } });
  assert.equal(result.phase, 'no-work'); assert.equal(f.calls.length, 0);
});

test('unobserved turn retains the exact Dispatch for recovery without another launch', async t => {
  const f = await fixture(t); let starts = 0;
  const call = async args => {
    if (args[1] !== 'worker-start') return f.call(args);
    starts++;
    const error = new Error('turn start unobserved');
    error.receipt = { ok: true, result: { state: 'outcome_unknown', dispatchId: 'ctx_existing', taskId: 'task_existing', prompt: { stages: ['input_accepted'] } } };
    throw error;
  };
  const state = await startImageTask('lesson', { ...f, call });
  assert.equal(state.phase, 'launch-unknown'); assert.equal(state.startReceipt.dispatchId, 'ctx_existing');
  assert.equal((await startImageTask('lesson', { ...f, call })).reused, true);
  assert.equal(starts, 1);
});

test('refused preflight can only be retried with explicit no-effects proof and an empty native Run', async t => {
  const f = await fixture(t);
  const refused = async args => {
    if (args[1] !== 'worker-start') return f.call(args);
    const error = new Error('nested worker depth');
    error.receipt = { error: { code: 'nested_worker_depth_exceeded', data: { effectsApplied: false } } }; throw error;
  };
  await assert.rejects(startImageTask('lesson', { ...f, call: refused }), /nested worker depth/);
  assert.equal((await readImageTask('lesson', f.root)).phase, 'refused');
  await assert.rejects(startImageTask('lesson', { ...f, retryRefused: true, call: async args => args[1] === 'task-list' ? { tasks: [{}] } : { workers: [] } }), /残っています/);
  const call = async args => args[1] === 'task-list' ? { tasks: [] } : args[1] === 'worker-list' ? { workers: [] } : f.call(args);
  assert.equal((await startImageTask('lesson', { ...f, call, retryRefused: true })).phase, 'running');
  await assert.rejects(startImageTask('lesson', { ...f, call, retryRefused: true }), /未起動/);
});

test('wait preserves the entire FIFO batch and never acknowledges questions or completions', async t => {
  const f = await fixture(t); await startImageTask('lesson', f);
  const batch = { messages: [{ type: 'question', id: 'q1' }, { type: 'worker_done', id: 'd1' }], delivery: { id: 'delivery_test' } };
  const calls = [];
  const result = await waitImageTask('lesson', { root: f.root, timeout: 900000, call: async args => { calls.push(args); return batch; } });
  assert.deepEqual(result.delivery, batch);
  assert.equal(calls.length, 1); assert.ok(!calls[0].includes('--ack'));
  assert.equal(calls[0][calls[0].indexOf('--timeout-ms') + 1], '55000');
  assert.equal((await readImageTask('lesson', f.root)).phase, 'running');
});

test('unsent dispatch input is detected only when the composer still holds the request', () => {
  const footer = '  GPT-6.1-Sol high · ~\\SAKUSURA';
  assert.equal(unsentDispatchInput({ tail: ['  役へ送る。', `  進行役のClaudeが完了通知を待っており、そこで${SPEC_MARKER}`, footer] }), 'composer');
  assert.equal(unsentDispatchInput({ tail: ['  >_ OpenAI Codex', '›', footer], draft: 'You are working inside Orca…' }), 'draft');
  assert.equal(unsentDispatchInput({ tail: [`  ${SPEC_MARKER}`, '› Ask Codex to do anything', footer] }), null);
  assert.equal(unsentDispatchInput({ tail: [`  ${SPEC_MARKER}`, '• Working (19s • esc to interrupt)', footer] }), null);
  assert.equal(unsentDispatchInput({ tail: ['Allow command? [y/n]', footer], draft: 'x' }), null);
});

test('wait sends Enter once to a worker whose request was never submitted', async t => {
  const f = await fixture(t); await startImageTask('lesson', f);
  const sent = [];
  const call = async args => {
    if (args[1] === 'worker-show') return { worker: { stage: 'turn_start_unobserved', agentTerminalHandle: 'term_codex' } };
    if (args[0] === 'terminal' && args[1] === 'read') return { terminal: { tail: [`  ${SPEC_MARKER}`, '  GPT high'] } };
    if (args[0] === 'terminal' && args[1] === 'send') { sent.push(args); return {}; }
    return { messages: [] };
  };
  const later = Date.now() + 120000;
  const first = await waitImageTask('lesson', { root: f.root, call, now: later });
  assert.equal(first.nudged.reason, 'composer');
  assert.deepEqual(sent[0], ['terminal', 'send', '--terminal', 'term_codex', '--enter']);
  await waitImageTask('lesson', { root: f.root, call, now: later + 60000 });
  assert.equal(sent.length, 1);
  assert.equal((await readImageTask('lesson', f.root)).nudge.terminal, 'term_codex');
});

test('wait never sends Enter when Codex exited back to the shell', async t => {
  const f = await fixture(t); await startImageTask('lesson', f);
  const sent = [];
  const call = async args => {
    if (args[1] === 'worker-show') return { worker: { stage: 'turn_start_unobserved', agentTerminalHandle: 'term_codex' } };
    if (args[0] === 'terminal' && args[1] === 'read') return { terminal: { tail: ['Error: account/read failed during TUI bootstrap: workspace routing discovery timed out', 'PS C:\\work> Orcaの生きたDispatch前文…', `>> ${SPEC_MARKER}`] } };
    if (args[0] === 'terminal' && args[1] === 'send') { sent.push(args); return {}; }
    return { messages: [] };
  };
  const result = await waitImageTask('lesson', { root: f.root, call, now: Date.now() + 120000 });
  assert.match(result.codexExited.exited, /TUI bootstrap/);
  assert.equal(result.nudged, undefined);
  assert.equal(sent.length, 0);
});

test('wait leaves a started worker alone', async t => {
  const f = await fixture(t); await startImageTask('lesson', f);
  const calls = [];
  const call = async args => { calls.push(args); return args[1] === 'worker-show' ? { worker: { stage: 'running', agentTerminalHandle: 'term_codex' } } : { messages: [] }; };
  await waitImageTask('lesson', { root: f.root, call, now: Date.now() + 120000 });
  assert.ok(!calls.some(args => args[0] === 'terminal'));
});

test('running native task cannot be recorded as complete', async t => {
  const f = await fixture(t); await startImageTask('lesson', f);
  await assert.rejects(recordImageTask('lesson', { root: f.root, call: async args => args[1] === 'task-list' ? { tasks: [{ status: 'in_progress' }] } : { workers: [{}] } }), /まだ完了/);
});

test('native completion still requires worker cleanup and processed mail', async t => {
  const f = await fixture(t); await startImageTask('lesson', f);
  const native = async args => args[1] === 'task-list' ? { tasks: [{ id: 'task_test', status: 'completed' }] } : args[1] === 'check' ? { messages: [{ type: 'question' }] } : { workers: args.includes('--terminal-state') ? [] : [{ dispatchId: 'dispatch_test' }] };
  await assert.rejects(recordImageTask('lesson', { root: f.root, call: native }), /未処理/);
  await assert.rejects(recordImageTask('lesson', { root: f.root, call: async args => args[1] === 'task-list' ? { tasks: [{ id: 'task_test', status: 'completed' }] } : { workers: [{ dispatchId: 'dispatch_test' }] } }), /後処理/);
  await assert.rejects(recordImageTask('lesson', { root: f.root, call: async args => args[1] === 'task-list' ? { tasks: [{ id: 'task_other', status: 'completed' }] } : { workers: [{ dispatchId: 'dispatch_other' }] } }), /一致しません/);
});

test('verification rejects stale QA, wrong dimensions, and changes to the lecture', async t => {
  const f = await fixture(t); const state = await startImageTask('lesson', f);
  await writeFile(state.reportPath, JSON.stringify({ requestHash: state.requestHash, outcome: 'succeeded', files: ['lectures/lesson/images/001.png'], visualChecked: true, notes: ['確認済み'] }));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
  await writeFile(join(f.images, '001.png'), png);
  for (const file of ['qa.json', 'browser-qa.json']) await writeFile(join(f.reports, file), JSON.stringify({ name: 'lesson', passed: true, generatedAt: '2000-01-01T00:00:00Z' }));
  await assert.rejects(verifyImageTask(state, f.root), /今回の依頼後/);
  for (const file of ['qa.json', 'browser-qa.json']) await writeFile(join(f.reports, file), JSON.stringify({ name: 'lesson', passed: true, generatedAt: new Date(Date.now() + 1000).toISOString() }));
  assert.equal((await verifyImageTask(state, f.root)).visualChecked, true);
  await assert.rejects(verifyImageTask({ ...state, targets: [{ ...state.targets[0], size: [1800, 1200] }] }, f.root), /指定寸法/);
  await writeFile(join(f.root, 'lectures/lesson/lecture.json'), '{}');
  await assert.rejects(verifyImageTask(state, f.root), /lecture.jsonが変更/);
});

test('worker contract prohibits source edits, paid API fallback and lifecycle improvisation', () => {
  const spec = imageTaskSpec({ name: 'lesson', title: '日本語', targets: [{ id: '001', file: '001.png' }], requestPath: 'C:\\path with spaces\\REQUEST.md', reportPath: 'result.json', requestHash: hash('request') });
  assert.match(spec, /lecture.json、REQUEST.md、ORCA_TASK.json、CSS/);
  assert.match(spec, /APIキーを使う別経路へ自動で切り替えない/);
  assert.match(spec, /worker_done/); assert.match(spec, /目視確認/);
  assert.ok(spec.endsWith(SPEC_MARKER)); // 未送信の検出に使う最後の一文
  assert.equal(orcaExecutable({ ORCA_CLI_COMMAND: 'specific-orca' }, 'win32'), 'specific-orca');
});
