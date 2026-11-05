// 講義のCSS（LLMにおまかせで作ったデザイン）を、デザインテンプレートとして「デザイン」画面に保存する。
// npm run design:save -- --lecture <slug> --name "テンプレート名" [--description "説明"]
// 保存したテンプレートは、次からの作成で npm run new -- ... --design <id> として選べる（CSSを新しい講義へ写す）。
import { createDesignStore } from './lib/design-store.mjs';
import { loadLecture, argumentValue } from './lib/project.mjs';
import { standardDesign } from '../src/design-theme.js';

try {
  const name = argumentValue(process.argv, '--lecture');
  const title = argumentValue(process.argv, '--name')?.trim();
  if (!name || !title) throw new Error('--lecture <講義名> と --name "テンプレート名" を指定してください。');
  const lecture = await loadLecture(name);
  if (!lecture.theme?.css) throw new Error(`lectures/${name} には講義のCSSがありません。theme.css を書いて npm run theme -- --lecture ${name} で取り込んでから保存してください。`);
  const description = argumentValue(process.argv, '--description') ?? `講義「${lecture.title}」で作ったデザイン（LLMにおまかせ）。`;
  const saved = await createDesignStore().change({ op: 'create', design: { ...standardDesign(), name: title, description, css: lecture.theme.css } });
  console.log(`テンプレートとして保存しました：${saved.design.name}（id: ${saved.id}）\n「デザイン」画面の一覧に表示されます。次からは npm run new -- ... --design ${saved.id} で使えます。`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
