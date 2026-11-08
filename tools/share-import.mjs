// 共有ファイル（ZIP）を取り込む。docs/SHARE.md
// npm run share:import -- <ZIPのパス> [--check] [--mode update|copy]
//   --check：中身と衝突を確認するだけ（何も書かない）
//   --mode ：同じ共有IDの講義（または中身の違う同じデザイン）が手元にあるとき、update＝置き換え（元はバックアップ）／copy＝別に残す
import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { argumentValue, ROOT } from './lib/project.mjs';
import { createShareStore } from './lib/share.mjs';

const args = process.argv.slice(2);
const file = args.find((arg, index) => !arg.startsWith('--') && args[index - 1] !== '--mode');
const STATE = { new: '新規', same: '手元と同じ', different: '手元と中身が違う' };
function printSummary(summary) {
  console.log(`  種類：${summary.kind === 'lecture' ? '講義' : 'デザインテンプレート'}　題名：${summary.title}`);
  console.log(`  共有ID：${summary.id}　版：v${summary.revision}　送り主：${summary.author}${summary.originId ? `　元ID：${summary.originId}` : ''}　作成：${summary.exportedAt ?? '不明'}`);
  if (summary.lecture) console.log(`  講義名：${summary.lecture.slug}（${summary.lecture.type === 'html' ? 'HTMLスライド' : '講義'}）　カテゴリ：${summary.lecture.category ?? '未設定'}　音声：${summary.lecture.audio ? 'あり' : 'なし'}`);
  for (const design of summary.designs) console.log(`  デザイン：${design.name}（${STATE[design.state]}）`);
  if (summary.existing) console.log(`  手元に同じ講義があります：${summary.existing.slug}（v${summary.existing.revision}）`);
  for (const warning of summary.warnings) console.log(`  ⚠ ${warning}`);
}
try {
  if (!file) throw new Error('取り込むZIPのパスを指定してください：npm run share:import -- <ZIPのパス>');
  const mode = argumentValue(args, '--mode');
  if (mode !== undefined && !['update', 'copy'].includes(mode)) throw new Error('--mode は update（置き換え）か copy（別に残す）です。');
  const buffer = await readFile(file), store = createShareStore();
  if (args.includes('--check')) { console.log('共有ファイルの中身（まだ取り込んでいません）：'); printSummary(await store.inspect(buffer)); }
  else {
    const result = await store.importPackage(buffer, { mode });
    console.log('取り込みました：'); printSummary(result);
    if (result.slug) console.log(`  → lectures/${result.slug}（${{ new: '新しい講義として追加', copy: '別の講義として追加', update: '手元の講義を更新' }[result.mode]}）。ライブラリの「共有で受け取った」に表示されます。`);
    if (result.backup) console.log(`  元の講義のバックアップ：${relative(ROOT, result.backup)}`);
    for (const item of result.designsImported) console.log(`  デザインを追加：${item.name}（${item.id}）`);
    for (const item of result.designsKept) console.log(`  デザインは手元のものを使います：${item.name}${item.reason === 'different' ? '（手元と中身が違うため上書きしていません）' : ''}`);
  }
} catch (error) {
  console.error(error.message);
  if (error.summary) printSummary(error.summary);
  process.exitCode = error.status === 409 ? 2 : 1;
}
