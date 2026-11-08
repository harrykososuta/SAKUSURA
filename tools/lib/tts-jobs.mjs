import { randomUUID } from 'node:crypto';
import { planTts, generateTts } from './tts.mjs';
import { readEditableLecture } from './editor-store.mjs';
import { loadTtsConfig, synthesisInput, inputHash } from './project.mjs';

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const signature = (slides, config) => slides.map(slide => inputHash(synthesisInput(slide, config))).join(':');
const publicJob = job => ({ id: job.id, name: job.name, state: job.state, count: job.count, completed: job.completed, slideId: job.slideId, error: job.error, warnings: job.warnings, startedAt: job.startedAt, finishedAt: job.finishedAt });

export function createTtsJobs({ makePlan = planTts, generate = generateTts, keyAvailable = () => !!process.env.GEMINI_API_KEY } = {}) {
  const plans = new Map(), jobs = new Map();
  const latest = name => [...jobs.values()].reverse().find(job => job.name === name);
  return {
    // 音声を生成中の講義（サーバーの再起動を断るため）。
    // 作業状況の通知欄（/api/jobs）に出す、最近の音声生成。
    list(limit = 10) { return [...jobs.values()].reverse().slice(0, limit).map(job => ({ kind: 'tts', ...publicJob(job) })); },
    runningJob() { const job = [...jobs.values()].find(item => item.state === 'running'); return job ? { kind: 'tts', name: job.name } : null; },
    async plan(name, { revision, scope, slideId } = {}) {
      if (!['slide', 'changed'].includes(scope) || scope === 'slide' && (typeof slideId !== 'string' || !slideId)) fail(400, '音声を生成する範囲を選んでください。');
      if (latest(name)?.state === 'running') fail(409, 'この講義の音声を生成中です。完了までお待ちください。');
      const plan = await makePlan(name, { slideId: scope === 'slide' ? slideId : undefined });
      if (plan.revision !== revision) fail(409, '保存後に講義が変更されています。再読み込みしてください。');
      for (const [token, entry] of plans) if (entry.expires < Date.now()) plans.delete(token);
      if (plans.size >= 100) plans.delete(plans.keys().next().value);
      const token = randomUUID(); plans.set(token, { ...plan, expires: Date.now() + 600000 });
      const slides = plan.pending.map(slide => ({ id: slide.id, page: plan.lecture.slides.findIndex(s => s.id === slide.id) + 1, characters: synthesisInput(slide, plan.config).text.length }));
      return { token, revision: plan.revision, count: slides.length, characters: slides.reduce((sum, slide) => sum + slide.characters, 0), slides, empty: plan.empty, voice: plan.config.voice.alias, model: plan.config.model };
    },
    async start(name, { token, revision } = {}) {
      const plan = plans.get(token);
      if (!plan || plan.name !== name || plan.expires < Date.now()) fail(409, '生成内容の確認期限が切れました。もう一度、対象を確認してください。');
      if (latest(name)?.state === 'running') fail(409, 'この講義の音声を生成中です。');
      const current = await readEditableLecture(name), config = await loadTtsConfig();
      if (revision !== plan.revision || current.revision !== plan.revision || signature(plan.pending, config) !== signature(plan.pending, plan.config)) fail(409, '原稿または音声設定が変更されました。もう一度、対象を確認してください。');
      if (plan.empty.length) fail(422, '空欄の原稿があります。原稿を入力してから生成してください。');
      if (!plan.pending.length) fail(422, '音声は最新です。生成するスライドはありません。');
      if (!keyAvailable()) fail(422, '音声生成のAPIキーが未設定です。起動側の環境変数または .env を設定してください。');
      // await中に別の開始要求が先行した場合も二重生成しない。
      if (latest(name)?.state === 'running' || !plans.has(token)) fail(409, 'この生成はすでに開始されています。');
      plans.delete(token);
      const job = { id: randomUUID(), name, state: 'running', count: plan.pending.length, completed: 0, slideId: null, error: null, warnings: [], startedAt: Date.now(), finishedAt: null };
      jobs.set(job.id, job);
      for (const [id, item] of jobs) if (jobs.size > 100 && item.state !== 'running') jobs.delete(id);
      Promise.resolve().then(async () => {
        try {
          await generate(plan, { onProgress: progress => {
            job.slideId = progress.id; job.completed = progress.completed;
            if (progress.cueWarning) job.warnings.push(`${progress.id}: 音声の終了より後に表示タイミングがあります。調整してください。`);
          } });
          job.state = 'completed'; job.finishedAt = Date.now();
        } catch (error) {
          job.state = 'failed'; job.finishedAt = Date.now();
          const http = /^Gemini API: HTTP (\d{3})/.exec(error.message ?? '');
          job.error = error.message?.includes('同じ講義のTTS生成が実行中') ? '同じ講義の音声生成が別の処理で実行中です。完了後に対象を確認してください。' : `音声を生成できませんでした。${http ? `API応答: HTTP ${http[1]}。` : ''}APIキー・通信・利用枠を確認してください。自動再試行はしていません。`;
        }
      });
      return publicJob(job);
    },
    get(name, id) {
      const job = id ? jobs.get(id) : latest(name);
      if (!job || job.name !== name) return null;
      return publicJob(job);
    },
  };
}
