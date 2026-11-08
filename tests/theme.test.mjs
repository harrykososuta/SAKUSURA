// LLMにおまかせのデザイン：講義ごとのCSS（theme.css）の検査・取り込み、構成ルールの選択、デザインテンプレートとしての保存。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, readJson } from '../tools/lib/project.mjs';
import { validateThemeCss, validateLecture, validateDeckStructure, appearanceOf, withInsertedAppearance, withSlideId } from '../src/core.js';
import { hasMotion } from '../src/motion.js';
import { standardDesign, validateDesign } from '../src/design-theme.js';
import { createDesignStore } from '../tools/lib/design-store.mjs';

test('講義のCSS：#stage から始まる規則・@media・@keyframes・data: の url は使え、スライドの外・外部読み込み・スクリプトは使えない', () => {
  assert.deepEqual(validateThemeCss('/* メモ */ #stage { --paper: #fff } #stage .heading-text, #stage h1 strong { color: #123 } @media (min-width: 1px) { #stage p { margin: 0 } } @keyframes rise { from { opacity: 0 } to { opacity: 1 } } #stage { background: url(data:image/png;base64,AA==) }'), []);
  for (const [css, pattern] of [['body { color: red }', /#stage から/], ['#stage-shell { display: none }', /#stage から/], [':root { --x: 1 }', /#stage から/], ['@import "x.css";', /@import/], ['#stage { background: url(https://example.com/a.png) }', /data:/], ['#stage { a: b', /対応/], ['@page { margin: 0 }', /@page/], ['#stage { content: "</style><script>" }', /スクリプト/]]) assert.match(validateThemeCss(css).join(), pattern, css);
  assert.match(validateThemeCss('#stage{}'.padEnd(60001, ' ')).join(), /60000/);
});
test('講義データ：design は llm も選べ、rules と theme を検査する。rules: free は構成の規格を外す', async () => {
  const lecture = await readJson(join(ROOT, 'lectures/business-design/lecture.json'));
  assert.deepEqual(validateLecture({ ...lecture, design: 'llm', rules: 'sakusura', theme: { css: '#stage { --paper: #fff }' } }), []);
  assert.match(validateLecture({ ...lecture, rules: 'other' }).join(), /rules/);
  assert.match(validateLecture({ ...lecture, theme: { css: 'body{}' } }).join(), /#stage/);
  assert.match(validateLecture({ ...lecture, theme: { css: '#stage{}', extra: 1 } }).join(), /theme/);
  const short = { ...lecture, slides: lecture.slides.slice(0, 5) };
  assert.ok(validateDeckStructure(short).length > 0);
  assert.deepEqual(validateDeckStructure({ ...short, rules: 'free' }), []);
});

test('挿入のデザイン：元のCSSとカテゴリを固定し、再挿入・複製でも保持する。挿入先に合わせるときだけ外す', async () => {
  const source = await readJson(join(ROOT, 'lectures/demo/lecture.json'));
  source.category = 'ai'; source.theme = { css: '#stage { --paper: #fff6e8 }' };
  const before = structuredClone(source), slide = source.slides[1];
  const kept = withInsertedAppearance(slide, source, true);
  assert.deepEqual(kept.appearance, { css: source.theme.css, category: 'ai' });
  const target = { ...source, category: 'cat-b', theme: { css: '#stage { --paper: #fff }' }, slides: [kept] };
  assert.deepEqual(validateLecture(target), []);
  assert.deepEqual(withSlideId(kept, 'copy').appearance, kept.appearance);
  assert.deepEqual(withInsertedAppearance(kept, target, true).appearance, kept.appearance);
  assert.equal(hasMotion(target, kept), true);
  const matched = withInsertedAppearance(kept, target, false);
  assert.equal(matched.appearance, undefined);
  assert.deepEqual(appearanceOf(target, matched), { css: target.theme.css, category: 'cat-b' });
  assert.equal(hasMotion(target, matched), false);
  const standard = withInsertedAppearance(slide, { category: 'cat-a' }, true);
  assert.deepEqual(appearanceOf(target, standard), { css: '', category: 'cat-a' });
  assert.deepEqual(source, before, '挿入元は変更しない');
  for (const appearance of [null, [], { css: 'body{}', category: 'cat-a' }, { css: '#stage{}', category: 'Unknown!' }, { css: '#stage{}', category: 'cat-a', motion: 'fast' }, { css: '#stage{}', category: 'cat-a', extra: 1 }]) {
    assert.ok(validateLecture({ ...target, slides: [{ ...kept, appearance }] }).length > 0);
  }
});
test('LLMにおまかせで作成：theme.css の書き始めを置き、npm run theme で検査して取り込む', async () => {
  const name = `zz-theme-test-${process.pid}`, dir = join(ROOT, 'lectures', name);
  const run = args => spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' });
  // カテゴリは designs/category-presets.json の一覧（配布版は空で、--category なしで作る）。
  const { createCategoryDesignStore } = await import('../tools/lib/category-design-store.mjs');
  const first = (await createCategoryDesignStore().get()).categories[0];
  try {
    const created = run(['tools/new-lecture.mjs', '--name', name, '--title', 'テスト', '--number', '7', ...(first ? ['--category', first.id] : []), '--motion', 'rich', '--design', 'llm', '--rules', 'free']);
    assert.equal(created.status, 0, created.stderr);
    let lecture = await readJson(join(dir, 'lecture.json'));
    assert.equal(lecture.motion, 'rich'); assert.equal(lecture.design, 'llm'); assert.equal(lecture.rules, 'free'); assert.equal(lecture.theme, undefined);
    assert.deepEqual(validateThemeCss(await readFile(join(dir, 'theme.css'), 'utf8')), []);
    await writeFile(join(dir, 'theme.css'), 'body { color: red }');
    const rejected = run(['tools/theme.mjs', '--lecture', name]);
    assert.notEqual(rejected.status, 0); assert.match(rejected.stderr, /#stage/);
    await writeFile(join(dir, 'theme.css'), '#stage { --paper: #101820 } #stage .heading-text { color: #f2aa4c }');
    assert.equal(run(['tools/theme.mjs', '--lecture', name]).status, 0);
    lecture = await readJson(join(dir, 'lecture.json'));
    assert.equal(lecture.theme.css, '#stage { --paper: #101820 } #stage .heading-text { color: #f2aa4c }');
    assert.deepEqual(validateLecture(lecture), []);
    assert.equal(run(['tools/theme.mjs', '--lecture', name, '--clear']).status, 0);
    assert.equal((await readJson(join(dir, 'lecture.json'))).theme, undefined);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('デザインテンプレート：講義のCSSを css としてプリセットに保存でき、不正なCSSは保存しない', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'design-css-'));
  try {
    const store = createDesignStore({ directory });
    const design = { ...standardDesign(), name: 'ダーク＆オレンジ', description: 'テスト', css: '#stage { --paper: #101820 }' };
    assert.deepEqual(validateDesign(design), []);
    const saved = await store.change({ op: 'create', design });
    assert.equal((await store.get(saved.id)).design.css, '#stage { --paper: #101820 }');
    await assert.rejects(store.change({ op: 'create', design: { ...design, name: '別名', css: 'body {}' } }), /#stage/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
