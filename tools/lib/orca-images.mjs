import { spawn } from 'node:child_process';
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { ROOT, slugOf, loadLecture } from './project.mjs';
import { imageManifest } from './images.mjs';
import { writeImageRequests } from '../image-requests.mjs';

export const orcaExecutable = (env = process.env, platform = process.platform) => env.ORCA_CLI_COMMAND || (env.ORCA_DEV_REPO_ROOT ? 'orca-dev' : platform === 'linux' && !env.ORCA_TERMINAL_ID ? 'orca-ide' : 'orca');

// No shell: Japanese paths, prompts, quotes and $() remain literal arguments.
export function createOrcaClient(executable = orcaExecutable()) {
  return args => new Promise((accept, reject) => {
    // Orca 1.4.246以降の orchestration は既定で簡略表示になるため、coordinator_handle などを読める完全な記録を要求する。
    const child = spawn(executable, [...args, ...(args[0] === 'orchestration' ? ['--full'] : []), '--json'], { cwd: ROOT, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', () => {}); // Drain Orca keepalives; only its structured receipt is returned.
    child.once('error', reject);
    child.once('close', code => {
      let receipt;
      try { receipt = JSON.parse(stdout); } catch { reject(new Error(`Orcaの応答を読めません (${executable}, exit ${code})。再起動せず、Orcaの状態を確認してください。`)); return; }
      if (code !== 0 || receipt.ok === false) {
        const error = new Error(`Orca ${args.slice(0, 2).join(' ')} が失敗しました。自動再実行はしません。`);
        error.receipt = receipt; reject(error); return;
      }
      accept(receipt.result);
    });
  });
}

const hash = value => createHash('sha256').update(value).digest('hex');
async function optionalJson(path) { try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
async function save(path, value) { const temp = `${path}.${randomUUID()}.tmp`; await writeFile(temp, JSON.stringify(value, null, 2) + '\n'); await rename(temp, path); }
export const taskPaths = (name, root = ROOT) => {
  const directory = join(root, 'lectures', slugOf(name), 'images');
  return { directory, state: join(directory, 'ORCA_TASK.json'), lock: join(directory, '.orca-task.lock'), request: join(directory, 'REQUEST.md') };
};

export async function imageTaskPlan(name) {
  const lecture = await loadLecture(name), images = await imageManifest(name, lecture);
  const sizes = { title: [1440, 1060], statement: [1240, 920], figure: [1800, 1200] };
  const targets = Object.entries(images).filter(([, item]) => !item.ready || item.revision || item.labelProblems.length).map(([id, item]) => ({ id, file: item.file, revision: item.revision, labels: item.labels, ready: item.ready, size: item.kind === 'person' ? [600, 600] : id.includes(':') ? [780, 540] : sizes[lecture.slides.find(slide => slide.id === id)?.layout] }));
  return { name, title: lecture.title, pending: targets.length, targets };
}

export function imageTaskSpec({ name, title, targets, requestPath, reportPath, requestHash, root = ROOT }) {
  return [
    `Target: HTMLスライド「${title}」の画像生成。講義 ${name}。作業フォルダ ${root}。`,
    `正本の依頼書: ${requestPath}。まず全文を読む。今回の対象: ${targets.map(item => `${item.id}=${item.file}`).join(', ')}。`,
    'Change: 依頼書の対象画像だけを内蔵の画像生成ツールとimagegenスキルで生成し、指定の透過PNG・サイズ・ファイル名で保存する。画像生成ツールが利用できなければ failed を報告し、APIキーを使う別経路へ自動で切り替えない。',
    'Constraints: 依頼書のスタイル・向き・チェックリストを守る。画像内に文字・数字・矢印を描かない。ラベルは .labels.json に保存する。既存画像は明示的な修正依頼の対象だけ上書き可。ラベルだけ不足している画像は再生成せず座標を作る。',
    `Ownership: 書き込めるのは lectures/${name}/images/ 内の対象PNG・ラベルJSONと reports/${name}/ の検証結果だけ。lecture.json、REQUEST.md、ORCA_TASK.json、CSS、台本、音声、設定、他講義を変更しない。TTS・動画書き出しは実行しない。別エージェントや新しいTaskを起動しない。`,
    `Observable acceptance: npm run check -- --lecture ${name} と npm run qa:browser -- --lecture ${name} が成功。PNGの指定寸法・透過・ファイル名、ラベル点の位置、文字の重なり、全確認項目を実画像と reports/${name}/slide-*.png で目視確認する。previewの音声未生成警告は今回の画像Taskの失敗理由にはしない。`,
    `結果を ${reportPath} にJSONで保存する。形式: {"requestHash":"${requestHash}","outcome":"succeeded または failed","files":["実際に保存した相対パス"],"visualChecked":true,"notes":["目視確認した内容・未解決事項"]}。成功は全確認完了時だけ。`,
    'Orcaの生きたDispatch前文が指示する正確な送信元・Task ID・Dispatch ID・CLIを使う。質問は前文のaskで進行役へ送る。終了直前に前文のcheckで追記を読む。結果JSONを保存した後、前文のworker_doneを --outcome succeeded または failed と実在の --report-path を付けて一度だけ送る。worker_done後はターンを終了する。進行役のClaudeが完了通知を待っており、そこで制作を再開する。',
  ].join('\n\n');
}

export async function startImageTask(name, { call = createOrcaClient(), plan = imageTaskPlan, prepare = writeImageRequests, root = ROOT, retryRefused = false } = {}) {
  const paths = taskPaths(name, root);
  await mkdir(paths.directory, { recursive: true });
  let lock;
  try { lock = await open(paths.lock, 'wx'); } catch (error) { if (error.code === 'EEXIST') throw new Error('画像Taskの起動処理中です。同じ依頼を再起動せず、--status で確認してください。'); throw error; }
  try {
    let previous = await optionalJson(paths.state);
    if (previous && retryRefused) {
      if (previous.phase !== 'refused' || previous.errorReceipt?.error?.data?.effectsApplied !== false) throw new Error('確実に未起動と確認された事前拒否だけ再依頼できます。起動不明の場合は復旧手順を使ってください。');
      const tasks = await call(['orchestration', 'task-list', '--run', previous.runId]);
      const workers = await call(['orchestration', 'worker-list', '--run', previous.runId, '--include-remote']);
      if (tasks.tasks?.length !== 0 || workers.workers?.length !== 0 || workers.page?.hasMore) throw new Error('前のRunにTaskまたは担当が残っています。再依頼しません。');
      await save(join(paths.directory, `ORCA_TASK.${previous.jobId}.json`), previous);
      previous = null;
    }
    if (previous && !['completed', 'failed'].includes(previous.phase)) return { reused: true, ...previous };
    const planned = await plan(name);
    if (!planned.pending) return { phase: 'no-work', name, pending: 0 };
    await prepare(name);
    const request = await readFile(paths.request, 'utf8'), requestHash = hash(request);
    if (previous?.requestHash === requestHash) return { reused: true, ...previous };
    const jobId = randomUUID(), reportPath = join(root, 'reports', name, `orca-images-${jobId}.json`);
    const lectureHash = hash(await readFile(join(root, 'lectures', name, 'lecture.json')));
    const state = { version: 1, jobId, name, title: planned.title, targets: planned.targets, requestHash, lectureHash, reportPath, createdAt: new Date().toISOString(), phase: 'creating-run' };
    await save(paths.state, state); // Persist intent BEFORE a mutation; unknown results must never trigger duplicate starts.
    try {
      const { run } = await call(['orchestration', 'run-create', '--objective', `画像生成: ${name} / ${planned.title}`]);
      if (!run?.id || !run.coordinator_handle) throw new Error('OrcaのRun識別情報がありません。');
      Object.assign(state, { runId: run.id, coordinatorHandle: run.coordinator_handle, phase: 'starting-worker' });
      await save(paths.state, state);
      const spec = imageTaskSpec({ ...planned, requestPath: paths.request, reportPath, requestHash, root });
      const receipt = await call(['orchestration', 'worker-start', '--spec', spec, '--task-title', `画像生成 ${name} (${planned.pending}点)`, '--worktree', `path:${resolve(root)}`, '--agent', 'codex', '--run', run.id]);
      Object.assign(state, { phase: 'running', startReceipt: receipt });
      await save(paths.state, state);
      return state;
    } catch (error) {
      Object.assign(state, { phase: error.receipt?.error?.data?.effectsApplied === false ? 'refused' : 'launch-unknown', error: error.message, errorReceipt: error.receipt ?? null });
      if (error.receipt?.result?.state === 'outcome_unknown' && error.receipt.result.dispatchId) {
        state.startReceipt = error.receipt.result;
        await save(paths.state, state);
        return state; // Existing Dispatch may recover; keep its IDs and continue waiting, never start another.
      }
      await save(paths.state, state); throw error;
    }
  } finally { await lock.close(); await unlink(paths.lock); }
}

export async function readImageTask(name, root = ROOT) {
  const state = await optionalJson(taskPaths(name, root).state);
  if (!state) throw new Error('この講義のOrca画像Taskはありません。');
  return state;
}

// Windows版Codexでは、Orcaが貼り付けた依頼文が入力欄に残り、送信されないことがある（ターン開始が観測されない）。
// 画面に依頼文だけが未送信で残り、実行中・承認待ちでないと判断できる場合に限る。
export const SPEC_MARKER = '制作を再開する。';
export function unsentDispatchInput(terminal) {
  const text = (terminal?.tail ?? []).map(line => String(line).trim()).join('');
  if (/Working|esctointerrupt|allow|approve|y\/n|proceed\?|許可/i.test(text.replace(/\s+/g, ''))) return null;
  if (typeof terminal?.draft === 'string' && terminal.draft.trim()) return 'draft';
  const at = text.lastIndexOf(SPEC_MARKER);
  if (at >= 0 && !text.slice(at + SPEC_MARKER.length).includes('›')) return 'composer';
  return null;
}

// Codexが起動時のエラー（例：account/read failed during TUI bootstrap）で終了し、端末がPowerShellに戻っている。
// このとき依頼文はシェルの入力に流れ込んでいるので、Enterを送ってはいけない。最後の数行だけを見る。
export function exitedAgent(terminal) {
  const lines = (terminal?.tail ?? []).map(line => String(line).trim()).filter(Boolean).slice(-3);
  const error = (terminal?.tail ?? []).map(line => String(line).trim()).find(line => /TUI bootstrap|^Error: /.test(line));
  return lines.some(line => /^PS [A-Za-z]:\\.*>|^>>/.test(line)) ? (error ?? 'シェルのプロンプトに戻っています') : null;
}

// Enterを送るのは1つのDispatchにつき1回だけ。依頼文の再送や別担当の起動はしない（docs/ORCA_IMAGES.md）。
export async function nudgeUnsentWorker(state, { call, root = ROOT, now = Date.now(), after = 60000 } = {}) {
  const dispatchId = state.startReceipt?.dispatchId;
  if (!dispatchId || state.nudge || !['running', 'launch-unknown'].includes(state.phase) || now - Date.parse(state.createdAt) < after) return null;
  const { worker } = await call(['orchestration', 'worker-show', '--dispatch', dispatchId]);
  if (worker?.stage !== 'turn_start_unobserved' || !worker.agentTerminalHandle) return null;
  const { terminal } = await call(['terminal', 'read', '--terminal', worker.agentTerminalHandle, '--screen']);
  const exited = exitedAgent(terminal);
  if (exited) return { exited, terminal: worker.agentTerminalHandle };
  const reason = unsentDispatchInput(terminal);
  if (!reason) return null;
  await call(['terminal', 'send', '--terminal', worker.agentTerminalHandle, '--enter']);
  state.nudge = { at: new Date(now).toISOString(), terminal: worker.agentTerminalHandle, reason };
  await save(taskPaths(state.name, root).state, state);
  return state.nudge;
}

export async function waitImageTask(name, { call = createOrcaClient(), root = ROOT, timeout = 55000, now } = {}) {
  const state = await readImageTask(name, root);
  if (!state.runId || !state.coordinatorHandle) throw new Error('起動結果が未確定です。--status と保存済みの応答を確認してください。');
  const nudged = await nudgeUnsentWorker(state, { call, root, now });
  const delivery = await call(['orchestration', 'check', '--run', state.runId, '--terminal', state.coordinatorHandle, '--wait', '--types', 'worker_done,escalation,question', '--timeout-ms', String(Math.min(55000, Math.max(1000, timeout)))]);
  return { state, delivery, ...(nudged?.exited ? { codexExited: nudged } : nudged ? { nudged } : {}) }; // Never acknowledge: Claude must process EVERY message and review the actual images first.
}

export async function inspectImageTask(name, { call = createOrcaClient(), root = ROOT } = {}) {
  const state = await readImageTask(name, root);
  if (!state.runId) return { state };
  const tasks = await call(['orchestration', 'task-list', '--run', state.runId]);
  const workers = await call(['orchestration', 'worker-list', '--run', state.runId, '--include-remote']);
  return { state, tasks, workers };
}

export async function verifyImageTask(state, root = ROOT) {
  if (hash(await readFile(join(root, 'lectures', state.name, 'lecture.json'))) !== state.lectureHash) throw new Error('依頼後にlecture.jsonが変更されています。依頼との一致を確認してください。');
  if (hash(await readFile(taskPaths(state.name, root).request)) !== state.requestHash) throw new Error('依頼後にREQUEST.mdが変更されています。');
  const report = await optionalJson(state.reportPath);
  if (report?.requestHash !== state.requestHash || report?.outcome !== 'succeeded' || report?.visualChecked !== true || !Array.isArray(report.files) || !Array.isArray(report.notes)) throw new Error('対象の依頼に対応する、目視確認済みの画像結果JSONがありません。');
  for (const target of state.targets) {
    const png = await readFile(join(root, 'lectures', state.name, 'images', target.file));
    if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || png.length < 33) throw new Error(`${target.file}: PNGを読めません。`);
    if (target.size && (png.readUInt32BE(16) !== target.size[0] || png.readUInt32BE(20) !== target.size[1])) throw new Error(`${target.file}: 指定寸法と一致しません。`);
  }
  // Validate labels against the lecture, rather than trusting a worker's prose.
  const lecture = JSON.parse((await readFile(join(root, 'lectures', state.name, 'lecture.json'), 'utf8')).replace(/^\uFEFF/, ''));
  for (const target of state.targets) {
    const labels = lecture.slides.find(slide => slide.id === target.id)?.image?.labels ?? [];
    if (labels.length) {
      const { checkLabels, labelsFileOf } = await import('./images.mjs');
      const data = await optionalJson(join(root, 'lectures', state.name, 'images', labelsFileOf(target.file)));
      const result = checkLabels(labels, data);
      if (result.problems.length) throw new Error(result.problems.join('\n'));
    }
  }
  for (const file of ['qa.json', 'browser-qa.json']) {
    const qa = await optionalJson(join(root, 'reports', state.name, file));
    if (!qa?.passed || qa.name !== state.name || !(Date.parse(qa.generatedAt) >= Date.parse(state.createdAt))) throw new Error(`${file}: 今回の依頼後の検証が成功していません。`);
  }
  return report;
}

// Only after Claude processed the Delivery and native release/ack, record a settled result.
// Native Task/Dispatch state remains authoritative; this file only prevents accidental relaunches.
export async function recordImageTask(name, { call = createOrcaClient(), root = ROOT } = {}) {
  const info = await inspectImageTask(name, { call, root });
  const tasks = info.tasks?.tasks ?? [], workers = info.workers?.workers ?? [];
  if (tasks.length !== 1 || !['completed', 'failed'].includes(tasks[0].status)) throw new Error('Taskがまだ完了していません。タイムアウトや無応答を完了扱いにはしません。');
  const receipt = info.state.startReceipt ?? info.state.errorReceipt?.result;
  if (receipt?.taskId !== tasks[0].id || !receipt?.dispatchId || !workers.some(worker => worker.dispatchId === receipt.dispatchId)) throw new Error('完了したTask・Dispatchがこの依頼の起動記録と一致しません。');
  const reclaimable = await call(['orchestration', 'worker-list', '--run', info.state.runId, '--terminal-state', 'reclaimable']);
  if (reclaimable.workers?.length || reclaimable.page?.hasMore) throw new Error('worker-release など、完了した担当の後処理が残っています。');
  const mail = await call(['orchestration', 'check', '--run', info.state.runId, '--terminal', info.state.coordinatorHandle, '--peek']);
  if (mail.messages?.length) throw new Error('未処理の完了通知・質問があります。全件処理してからDeliveryをackしてください。');
  if (!workers.length) throw new Error('Dispatchの検証情報がありません。');
  const outcome = tasks[0].status === 'completed' ? 'succeeded' : 'failed';
  if (outcome === 'succeeded') await verifyImageTask(info.state, root);
  const state = { ...info.state, phase: outcome === 'succeeded' ? 'completed' : 'failed', outcome, completedAt: info.state.completedAt ?? new Date().toISOString(), launchWarning: info.state.error ?? info.state.launchWarning ?? null, error: null };
  await save(taskPaths(name, root).state, state);
  return state;
}
