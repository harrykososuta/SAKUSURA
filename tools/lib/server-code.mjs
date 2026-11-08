// 起動中のスタジオのサーバーが、自分のプログラムより新しいファイルがあるか（再起動が必要か）を調べる。
// 対象は tools/server.mjs から import でたどれるファイルだけ。講義の作成用スクリプトや画面だけの部品（src/ の画面用ファイル）は、
// サーバーを再起動しなくても反映されるので含めない。
import { readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { ROOT } from './project.mjs';

const IMPORT = /(?:\bimport\s*(?:[^'"()]*?\bfrom\s*)?|\bimport\s*\(\s*|\bexport\s*[^'"()]*?\bfrom\s*)['"](\.{1,2}\/[^'"]+)['"]/g;

// tools/server.mjs から相対パスの import をたどったファイルの一覧（絶対パス）。
export async function serverModuleFiles(entry = join(ROOT, 'tools/server.mjs')) {
  const seen = new Set(), queue = [resolve(entry)];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    let text;
    try { text = await readFile(file, 'utf8'); } catch { continue; }
    seen.add(file);
    for (const [, specifier] of text.matchAll(IMPORT)) if (/\.(?:mjs|js|json)$/.test(specifier)) queue.push(resolve(dirname(file), specifier));
  }
  return [...seen].sort();
}

// ファイルの一覧と更新時刻をまとめた目印。import の追加・削除やファイルの更新で変わる。
export async function serverCodeStamp(entry) {
  const files = await serverModuleFiles(entry);
  const times = await Promise.all(files.map(file => stat(file).then(info => Math.floor(info.mtimeMs), () => 0)));
  return `${files.length}:${Math.max(0, ...times)}`;
}

// launch.mjs から起動したサーバーがこの終了コードで終わると、launch.mjs が同じウィンドウで起動し直す。
export const RESTART_EXIT_CODE = 75;
