import { spawn } from 'node:child_process';
import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT, ensureLectureReports, argumentValue, writeJson } from './lib/project.mjs';
import { checkLecture } from './qa.mjs';

async function run(args) {
  return new Promise(resolve => {
    const process = spawn(globalThis.process.execPath, args, { cwd: ROOT, stdio: 'inherit', windowsHide: true });
    process.on('error', () => resolve(false)); process.on('exit', code => resolve(code === 0));
  });
}
async function sources(directory) {
  const result = [];
  for (const entry of await readdir(join(ROOT, directory), { withFileTypes: true })) {
    const name = `${directory}/${entry.name}`;
    if (entry.isDirectory()) result.push(...await sources(name));
    else if (/\.(mjs|js)$/.test(entry.name)) result.push(name);
  }
  return result;
}
try {
  const name = argumentValue(process.argv, '--lecture', 'demo');
  const production = process.argv.includes('--production');
  const silent = process.argv.includes('--silent'); // TTSなし（無音）で作る講義
  const steps = [];
  let syntax = true;
  for (const file of [...await sources('src'), ...await sources('tools'), ...await sources('tests')]) if (!await run(['--check', file])) syntax = false;
  steps.push({ name: 'JavaScript構文', passed: syntax });
  const testFiles = (await sources('tests')).filter(file => file.endsWith('.test.mjs'));
  steps.push({ name: '回帰テスト', passed: await run(['--test', ...testFiles]) });
  const qa = await checkLecture(name, { production, silent });
  steps.push({ name: '講義・音声・cue・総尺', passed: qa.passed });
  if (process.argv.includes('--browser')) steps.push({ name: 'ブラウザ操作・表示', passed: await run(['tools/browser-qa.mjs', '--lecture', name]) });
  // 足した図形・文字は人が判断する項目として、独立した節で知らせる（Claudeが完了報告で確認を取る）。
  const shapeReview = [...qa.shapes.unread.map(item => `${item.page}枚目「${item.text}」：ナレーションで読まれていません。読ませますか？`), ...qa.shapes.untimed.map(item => `${item.page}枚目 ${item.name}：表示タイミングが未設定です（最初から表示）`)];
  const report = { generatedAt: new Date().toISOString(), passed: steps.every(step => step.passed), mode: production ? 'production' : 'preview', silent, steps, qa, shapeReview, manualReview: ['ナレーションの誤読・声・音質を試聴', '図解と発話の意味が合うか確認', 'OBSのテスト録画で映像・音声・解像度を確認'] };
  const reportDir = await ensureLectureReports(name); await writeJson(join(reportDir, 'harness.json'), report);
  await writeJson(join(reportDir, 'qa.json'), qa);
  await writeFile(join(reportDir, 'harness.md'), `# Harness ${report.passed ? 'PASS' : 'FAIL'} (${report.mode}${report.silent ? "・無音" : ""})\n\n講義: ${qa.title}\n\n${steps.map(step => `- ${step.passed ? 'PASS' : 'FAIL'}: ${step.name}`).join('\n')}\n\n音声 ${qa.audioReady}/${qa.slides}枚 / 総尺 ${qa.duration}秒 / 目標 ${qa.targetSeconds}秒\n\n${[...qa.errors.map(message => `- ERROR: ${message}`), ...qa.warnings.map(message => `- 要確認: ${message}`)].join('\n')}\n\n${shapeReview.length ? `## 追加した図形・文字の確認\n\n${shapeReview.map(message => `- ${message}`).join('\n')}\n\n` : ''}## 人が確認する項目\n\n${report.manualReview.map(message => `- ${message}`).join('\n')}\n`, 'utf8');
  console.log(`\nHarness ${report.passed ? 'PASS' : 'FAIL'} (${report.mode}${report.silent ? "・無音" : ""}) / reports/${name}/harness.md`);
  for (const message of qa.errors) console.log(`ERROR: ${message}`);
  for (const message of qa.warnings) console.log(`要確認: ${message}`);
  if (shapeReview.length) console.log(`\n追加した図形・文字の確認（${shapeReview.length}件）:\n${shapeReview.map(message => `- ${message}`).join('\n')}`);
  if (!report.passed) process.exitCode = 1;
} catch (error) { console.error(error.message); process.exitCode = 1; }
