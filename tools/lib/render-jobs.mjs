// 動画の書き出し（npm run render と同じ処理）を、スタジオの再生画面のボタンから実行するジョブ。
// 書き出しはブラウザとffmpegを使う重い処理なので、全講義で同時に1つだけ。進み具合は「撮影・映像」の済んだ数で返す。
import { randomUUID } from 'node:crypto';
import { relative } from 'node:path';
import { ROOT, loadLecture, loadTtsConfig } from './project.mjs';
import { audioManifest } from './cache.mjs';

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const publicJob = job => ({ id: job.id, name: job.name, silent: job.silent, state: job.state, count: job.count, completed: job.completed, step: job.step, warnings: job.warnings, error: job.error, output: job.output, seconds: job.seconds, startedAt: job.startedAt, finishedAt: job.finishedAt });

// 書き出せる状態か（音声がすべて最新・ffmpegがある）を開始前に確かめ、手順の数（スライドごとに撮影と映像の2つ）を返す。
// 無音（silent）は音声を使わないので、音声の確認を省く。
async function checkReady(name, { silent = false } = {}) {
  const lecture = await loadLecture(name);
  const audio = silent ? {} : await audioManifest(name, lecture, await loadTtsConfig());
  const missing = silent ? [] : lecture.slides.filter(slide => !audio[slide.id].ready).map(slide => slide.id);
  if (missing.length) fail(422, `音声が未生成・変更済みのスライドがあります（${missing.join(', ')}）。編集画面で音声を生成してから書き出してください。`);
  const { ffmpegExecutable } = await import('../render.mjs');
  try { await ffmpegExecutable(); } catch (error) { fail(422, error.message); }
  return { count: lecture.slides.length * 2 };
}
// render.mjs は server.mjs を読み込むため、循環しないよう実行時に読み込む。
const renderLecture = async (...args) => (await import('../render.mjs')).renderLecture(...args);

export function createRenderJobs({ precheck = checkReady, render = renderLecture } = {}) {
  const jobs = new Map();
  const running = () => [...jobs.values()].find(job => job.state === 'running');
  const busy = name => { const job = running(); if (job) fail(409, job.name === name ? 'この講義の動画を書き出し中です。完了までお待ちください。' : `別の講義（${job.name}）の動画を書き出し中です。完了までお待ちください。`); };
  return {
    // 書き出し中の講義（サーバーの再起動を断るため）。
    // 作業状況の通知欄（/api/jobs）に出す、最近の書き出し。
    list(limit = 10) { return [...jobs.values()].reverse().slice(0, limit).map(job => ({ kind: 'render', ...publicJob(job) })); },
    runningJob() { const job = running(); return job ? { kind: 'render', name: job.name } : null; },
    async start(name, { silent = false } = {}) {
      busy(name);
      const { count } = await precheck(name, { silent });
      busy(name); // 確認中に別の書き出しが始まった場合も二重に実行しない。
      const job = { id: randomUUID(), name, silent, state: 'running', count, completed: 0, step: '準備中', warnings: [], error: null, output: null, seconds: null, startedAt: Date.now(), finishedAt: null };
      jobs.set(job.id, job);
      for (const [id, item] of jobs) if (jobs.size > 50 && item.state !== 'running') jobs.delete(id);
      Promise.resolve().then(async () => {
        try {
          const result = await render(name, { silent, log: message => {
            if (message.startsWith('注意')) { job.warnings.push(message); return; }
            if (/^(撮影|映像) /.test(message)) job.completed = Math.min(job.count, job.completed + 1);
            job.step = message;
          } });
          Object.assign(job, { state: 'completed', finishedAt: Date.now(), step: '完了', completed: job.count, output: relative(ROOT, result.output).replaceAll('\\', '/'), seconds: result.seconds });
        } catch (error) { Object.assign(job, { state: 'failed', finishedAt: Date.now(), error: String(error.message ?? error).slice(0, 600) }); }
      });
      return publicJob(job);
    },
    get(name, id) {
      const job = id ? jobs.get(id) : [...jobs.values()].reverse().find(item => item.name === name);
      return job && job.name === name ? publicJob(job) : null;
    },
  };
}
