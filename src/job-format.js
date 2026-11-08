// 作業状況の通知欄（src/job-center.js）に出す1行の文。
export function jobLine(job, now = Date.now()) {
  const percent = job.count ? Math.floor(job.completed / job.count * 100) : 0;
  if (job.state === 'running') return job.kind === 'render' ? `書き出し中 ${percent}%${job.step ? `（${job.step}）` : ''}` : `生成中 ${job.completed} / ${job.count}枚`;
  const ago = job.finishedAt ? relative(now - job.finishedAt) : '';
  if (job.state === 'completed') return job.kind === 'render' ? `完了${ago ? `・${ago}` : ''}${job.output ? `：${job.output}` : ''}` : `完了${ago ? `・${ago}` : ''}（${job.count}枚）`;
  return `失敗${ago ? `・${ago}` : ''}${job.error ? `：${job.error}` : ''}`;
}
export function relative(ms) {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'たった今';
  if (minutes < 60) return `${minutes}分前`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}時間前` : `${Math.floor(hours / 24)}日前`;
}

