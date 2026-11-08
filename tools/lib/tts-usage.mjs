import { mkdir, open, readFile, writeFile, rename, unlink, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ROOT } from './project.mjs';

export const USAGE_FILE = join(ROOT, 'reports', 'tts-usage.json');
export const pacificDay = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
export function nextPacificReset(now = new Date()) {
  const day = pacificDay(now);
  // 日付の境界を探索するので夏時間の23時間/25時間の日にも対応する。
  let low = now.getTime(), high = low + 27 * 3600000;
  while (high - low > 1) { const mid = Math.floor((low + high) / 2); if (pacificDay(new Date(mid)) === day) low = mid; else high = mid; }
  return new Date(high).toISOString();
}
async function readUsage(file) {
  try {
    const data = JSON.parse(await readFile(file, 'utf8'));
    if (data.version !== 1 || !data.days || typeof data.days !== 'object' || Array.isArray(data.days)) throw new Error('INVALID_USAGE');
    for (const models of Object.values(data.days)) {
      if (!models || typeof models !== 'object' || Array.isArray(models)) throw new Error('INVALID_MODELS');
      for (const item of Object.values(models)) if (!Number.isSafeInteger(item?.count) || item.count < 0 || typeof item.exhausted !== 'boolean') throw new Error('INVALID_COUNT');
    }
    return data;
  } catch (error) { if (error.code === 'ENOENT') return { version: 1, days: {} }; throw new Error('音声利用回数の記録を読み込めません。reports/tts-usage.json を確認してください。'); }
}
// Windowsでは、HOME（/api/home）などが記録を読んでいる瞬間に置き換えると EPERM / EACCES / EBUSY で断られる。
// 読み取りは数ミリ秒で終わるので、少し待って置き換え直す（記録の失敗で音声生成を止めないため）。
async function replace(temporary, file) {
  for (let attempt = 0; ; attempt++) {
    try { await rename(temporary, file); return; }
    catch (error) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 40) throw error;
      await new Promise(resolve => setTimeout(resolve, Math.min(10 + attempt * 10, 100)));
    }
  }
}
// CLIとサーバーの並行生成でも失わないよう、プロセス間ロックと原子的置換を使う。
async function update(file, mutate) {
  await mkdir(dirname(file), { recursive: true });
  const lockFile = `${file}.lock`, started = Date.now();
  let lock;
  while (!lock) {
    try { lock = await open(lockFile, 'wx'); }
    catch (error) {
      // Windowsでは、別の書き込みが消している途中のロックを作ろうとすると EEXIST ではなく EPERM / EACCES / EBUSY になる。待ってやり直す。
      if (!['EEXIST', 'EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error;
      // 書き込みは短い同期的な処理。異常終了で残ったロックは1分で期限切れ。
      try { if (Date.now() - (await stat(lockFile)).mtimeMs > 60000) { await unlink(lockFile); continue; } } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (Date.now() - started > 10000) throw new Error('音声利用回数の記録が使用中です。少し待ってから操作してください。');
      await new Promise(resolve => setTimeout(resolve, 30));
    }
  }
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const data = await readUsage(file); mutate(data);
    await writeFile(temporary, JSON.stringify(data, null, 2) + '\n');
    await replace(temporary, file);
  } finally { await unlink(temporary).catch(() => {}); await lock.close(); await unlink(lockFile); }
}
export async function recordTtsAttempt(model, { file = USAGE_FILE, now = new Date() } = {}) {
  const day = pacificDay(now);
  await update(file, data => { const models = data.days[day] ??= {}; const item = models[model] ??= { count: 0, exhausted: false }; item.count++; item.updatedAt = now.toISOString(); });
  return day;
}
export async function recordTtsExhausted(model, { file = USAGE_FILE, day = pacificDay() } = {}) {
  await update(file, data => { const models = data.days[day] ??= {}; const item = models[model] ??= { count: 0 }; item.exhausted = true; });
}
export async function ttsUsage({ file = USAGE_FILE, model = 'gemini-3.8-flash-lite-tts', now = new Date() } = {}) {
  const data = await readUsage(file), day = pacificDay(now), models = data.days[day] ?? {};
  const names = [...new Set([model, ...Object.keys(models)])];
  const entries = names.map(name => { const item = models[name] ?? { count: 0, exhausted: false }; const limit = /flash-lite.*tts|tts.*flash-lite/i.test(name) ? 100 : null; return { model: name, count: item.count, limit, exhausted: Boolean(item.exhausted), remaining: item.exhausted ? 0 : limit === null ? null : Math.max(0, limit - item.count) }; });
  return { day, timeZone: 'America/Los_Angeles', resetAt: nextPacificReset(now), models: entries, current: entries.find(item => item.model === model) };
}
