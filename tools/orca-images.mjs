import { argumentValue, slugOf } from './lib/project.mjs';
import { createOrcaClient, imageTaskPlan, startImageTask, waitImageTask, inspectImageTask, recordImageTask } from './lib/orca-images.mjs';

try {
  if (process.argv.includes('--help')) {
    console.log('使い方: npm run images:task -- --lecture <slug> [--check | --wait | --status | --record | --retry-refused]\n通常起動: 依頼書作成とOrca画像Taskの起動。--wait: 最大55秒の通知待機。--record: 通知処理・担当の後処理後の確定。\n詳しい手順: docs/ORCA_IMAGES.md');
    process.exit(0);
  }
  if (['--check', '--wait', '--status', '--record', '--retry-refused'].filter(flag => process.argv.includes(flag)).length > 1) throw new Error('操作オプションは1つだけ指定してください。--help で使い方を確認できます。');
  const name = slugOf(argumentValue(process.argv, '--lecture'));
  const call = createOrcaClient();
  let result;
  if (process.argv.includes('--check')) result = await imageTaskPlan(name);
  else if (process.argv.includes('--wait')) result = await waitImageTask(name, { call });
  else if (process.argv.includes('--status')) result = await inspectImageTask(name, { call });
  else if (process.argv.includes('--record')) result = await recordImageTask(name, { call });
  else result = await startImageTask(name, { call, retryRefused: process.argv.includes('--retry-refused') });
  console.log(JSON.stringify(result, null, 2));
  if (result.codexExited) console.log(`\nCodexが起動に失敗し、端末がシェルに戻っています（${result.codexExited.exited}）。Enterは送っていません。docs/ORCA_IMAGES.md の「Codexが起動に失敗したとき」の手順で、同じ端末でCodexを起動し直して依頼文を送ってください。`);
  if (['running', 'launch-unknown'].includes(result.phase) || result.reused) console.log(`\nClaudeは npm run images:task -- --lecture ${name} --wait で完了・質問を待ってください。待機のタイムアウトは失敗ではありません。`);
} catch (error) {
  console.error(error.message);
  if (error.receipt) console.error(JSON.stringify(error.receipt, null, 2));
  process.exitCode = 1;
}
