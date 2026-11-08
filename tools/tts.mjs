import { argumentValue, synthesisInput } from './lib/project.mjs';
import { planTts, generateTts } from './lib/tts.mjs';

const args = process.argv.slice(2);
const name = argumentValue(args, '--lecture', 'demo');
const checkOnly = args.includes('--check');
try {
  const plan = await planTts(name, { slideId: argumentValue(args, '--slide', null) });
  for (const id of plan.empty) console.log(`${id}: 台本が空欄です`);
  for (const item of plan.entries) console.log(`${item.id}: ${item.ready ? `キャッシュ使用 (${item.duration.toFixed(2)}秒)` : item.reason}`);
  const models = [...new Set(plan.pending.map(slide => synthesisInput(slide, plan.config).model))];
  const voices = [...new Set(plan.pending.map(slide => slide.ttsVoice ?? plan.config.voice.alias))];
  console.log(`対象 ${plan.pending.length}枚 / 約${plan.pending.reduce((sum, slide) => sum + synthesisInput(slide, plan.config).text.length, 0)}文字 / ${(models.length ? models : [plan.config.model]).join('・')} / ${(voices.length ? voices : [plan.config.voice.alias]).join('・')}`);
  if (plan.empty.length) throw new Error('空欄の台本を記入してください（API呼び出しなし）');
  if (!checkOnly) await generateTts(plan, { onProgress: item => {
    if (item.duration !== undefined) console.log(`${item.id}: 保存 ${item.duration.toFixed(2)}秒 / 発話 ${item.speechStart}〜${item.speechEnd}秒`);
    if (item.cueWarning) console.log('  要調整: 音声終了以降にcueがあります');
  } });
  if (checkOnly) console.log('確認のみ。音声生成APIは呼び出していません。');
  else console.log('完了。npm run check -- --lecture ' + name + ' で検証してください。');
} catch (error) { console.error(error.message); process.exitCode = 1; }
