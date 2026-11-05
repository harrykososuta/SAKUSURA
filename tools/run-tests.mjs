// テストの実行。配布版は見本講義を tests/fixtures/lectures に置くため、テスト中だけ lectures/ へ写し、終わったら片付ける。
import { cp, readdir, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './lib/project.mjs';

const fixtures = join(ROOT, 'tests', 'fixtures', 'lectures'), placed = [];
let names = [];
try { names = (await readdir(fixtures, { withFileTypes: true })).filter(item => item.isDirectory()).map(item => item.name); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
let status = 1;
try {
  for (const name of names) {
    const target = join(ROOT, 'lectures', name);
    // 同名の講義が利用者にあれば上書きしない。
    if (await access(target).then(() => true, () => false)) { console.warn(`lectures/${name} が既にあるため、見本講義を置かずにテストします。`); continue; }
    await cp(join(fixtures, name), target, { recursive: true, errorOnExist: true, force: false });
    placed.push(target);
  }
  const files = (await readdir(join(ROOT, 'tests'))).filter(file => file.endsWith('.test.mjs')).sort().map(file => join('tests', file));
  status = spawnSync(process.execPath, ['--test', ...files], { cwd: ROOT, stdio: 'inherit' }).status ?? 1;
} finally {
  for (const target of placed) await rm(target, { recursive: true, force: true });
}
process.exitCode = status;
