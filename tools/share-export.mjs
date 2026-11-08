// 講義・デザインテンプレートを、ほかの人の SAKUSURA で取り込める共有ファイル（ZIP）にする。docs/SHARE.md
// npm run share:export -- --lecture <講義名> [--author "送り主名"] [--no-audio]
// npm run share:export -- --design <design-ID> [--author "送り主名"]
import { relative } from 'node:path';
import { argumentValue, ROOT } from './lib/project.mjs';
import { createShareStore } from './lib/share.mjs';

const args = process.argv.slice(2);
const mb = bytes => `${(bytes / 1024 / 1024).toFixed(1)}MB`;
try {
  const lecture = argumentValue(args, '--lecture'), design = argumentValue(args, '--design'), author = argumentValue(args, '--author');
  if (!lecture === !design) throw new Error('--lecture <講義名> か --design <design-ID> のどちらか1つを指定してください。');
  const store = createShareStore();
  const result = lecture ? await store.exportLecture(lecture, { author, audio: !args.includes('--no-audio') }) : await store.exportDesign(design, { author });
  const { manifest } = result;
  console.log(`共有ファイルを作りました：${relative(ROOT, result.path)}（${mb(result.size)}）`);
  console.log(`  題名：${manifest.title}`);
  console.log(`  共有ID：${manifest.id}　版：v${manifest.revision}　送り主：${manifest.author}${manifest.originId ? `　元ID：${manifest.originId}` : ''}`);
  if (manifest.kind === 'lecture') console.log(`  音声：${manifest.lecture.audio ? 'あり' : 'なし'}　デザイン同梱：${manifest.designs.length ? manifest.designs.join(', ') : 'なし'}`);
  if (result.forwarded) console.log('  受け取った講義に手を加えていないので、同じ共有ID・同じ版のまま書き出しました（転送）。');
  for (const item of result.skipped) console.log(`  ※ 同梱しなかったデザイン：${item}。講義の見た目（CSS）は講義の中に入っているので再現されます。`);
  console.log('このZIPを相手に渡し、相手のSAKUSURAで npm run share:import -- <ZIPのパス>（またはライブラリの「取り込む」）で取り込みます。');
} catch (error) { console.error(error.message); process.exitCode = 1; }
