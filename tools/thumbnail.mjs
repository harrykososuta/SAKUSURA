// 1枚目（サムネイル）を 1920×1080 のJPGで exports/ に保存する（撮影は tools/lib/thumbnail.mjs）。
// 使い方: npm run thumbnail -- --lecture <slug>  → exports/<slug>_thumbnail.jpg（上書き）
import { mkdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { ROOT, argumentValue } from './lib/project.mjs';
import { captureThumbnail, thumbnailFileOf } from './lib/thumbnail.mjs';

try {
  const name = argumentValue(process.argv, '--lecture', 'demo');
  const jpg = await captureThumbnail(name);
  await mkdir(join(ROOT, 'exports'), { recursive: true });
  const path = join(ROOT, 'exports', thumbnailFileOf(name));
  await writeFile(path, jpg);
  console.log(`サムネイル: ${relative(ROOT, path)}（1920×1080 JPG・${Math.ceil(jpg.length / 1024)}KB）`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
