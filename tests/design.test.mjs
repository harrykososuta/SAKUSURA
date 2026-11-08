import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { emphasisParts, plainText, validateDeckStructure, validateLecture } from '../src/core.js';
import { readJson, ROOT } from '../tools/lib/project.mjs';

const sample = await readJson(join(ROOT, 'lectures/business-design/lecture.json'));

test('見本デッキはSAKUSURA標準構成を満たす', () => {
  assert.deepEqual(validateLecture(sample), []);
  assert.deepEqual(validateDeckStructure(sample), []);
});
test('構成ルール：12枚・一文スライド2枚・サムネイル・アジェンダ・Take Home Message 4つ・演題番号', () => {
  const broken = structuredClone(sample);
  delete broken.number;
  broken.slides[1].layout = 'statement';
  broken.slides.at(-1).blocks.pop();
  broken.slides[3].layout = 'agenda';
  const result = validateDeckStructure(broken).join('\n');
  assert.match(result, /number/); assert.match(result, /2枚目/); assert.match(result, /4つです/); assert.match(result, /4枚目に agenda/);
  assert.match(validateDeckStructure({ ...sample, slides: sample.slides.slice(0, 3) }).join(), /合計12枚/);
  const short = structuredClone(sample); short.slides.splice(3, 1);
  assert.match(validateDeckStructure(short).join(), /現在 11枚/);
  const messages = structuredClone(sample);
  const index = messages.slides.findIndex(slide => slide.layout === 'message');
  messages.slides[index].blocks = [{ id: 'x', text: '本文' }];
  messages.slides[index + 1].layout = 'message';
  const result2 = validateDeckStructure(messages).join('\n');
  assert.match(result2, /2枚です（現在 3枚）/); assert.match(result2, /blocks は空/); assert.match(result2, /連続/);
  assert.deepEqual(validateDeckStructure({ ...broken, demo: true }), []);
});
test('カテゴリ：IDの形式を検査する。組み込みのカテゴリがある版では必須で、配色はカテゴリごとに異なる。画像の依頼書もその配色になる', async () => {
  const { CATEGORIES } = await import('../src/core.js');
  const { category, ...missing } = sample;
  assert.match(validateLecture({ ...sample, category: 'Heart!' }).join(), /category は/);
  assert.deepEqual(validateLecture({ ...sample, category: 'custom-1a2b3c4d' }), [], '利用者が追加したカテゴリ');
  assert.match(validateLecture({ ...sample, motion: 'fast' }).join(), /motion は/);
  const { styleFor } = await import('../tools/image-requests.mjs');
  assert.match(styleFor({ name: '営業', colors: { primary: '#4a1d2c', accent: '#d6455d' }, fill: '#ECB8C1' }).join(), /#4A1D2C/);
  // 配布版は組み込みのカテゴリを持たず、カテゴリなしの講義も作れる。
  if (!Object.keys(CATEGORIES).length) { assert.ok(!validateDeckStructure(missing).some(error => /category/.test(error))); return; }
  assert.deepEqual(Object.values(CATEGORIES).map(item => item.name), ['カテゴリC', 'カテゴリB', 'カテゴリA', 'カテゴリD']);
  assert.equal(new Set(Object.values(CATEGORIES).map(item => item.colors.primary)).size, 4);
  assert.match(validateDeckStructure(missing).join(), /category/);
  assert.deepEqual(validateLecture({ ...sample, category: 'cat-c' }), []);
  assert.match(styleFor(CATEGORIES.ecg).join(), /#4A1D2C/);
});
test('強調記法は ** の対応を検査し、HTMLを解釈しない', () => {
  assert.deepEqual(emphasisParts('本文**重要語**本文'), [{ text: '本文', strong: false }, { text: '重要語', strong: true }, { text: '本文', strong: false }]);
  assert.deepEqual(emphasisParts('<b>x</b>'), [{ text: '<b>x</b>', strong: false }]);
  const broken = structuredClone(sample); broken.slides[3].blocks[0].text = '閉じない**強調';
  assert.match(validateDeckStructure(broken).join(), /強調記法/);
});
test('左下の表題：日本語の改行は詰め、英数字の間は空白にする', () => {
  assert.equal(plainText('伝わる資料は\n**設計**で決まる'), '伝わる資料は設計で決まる');
  assert.equal(plainText('Business\nDesign'), 'Business Design');
});
test('新規作成のひな形は標準構成を満たす', async () => {
  const name = `zz-design-test-${process.pid}`;
  // カテゴリは designs/category-presets.json の一覧（配布版は空で、--category なしで作る）。
  const { createCategoryDesignStore } = await import('../tools/lib/category-design-store.mjs');
  const first = (await createCategoryDesignStore().get()).categories[0];
  const category = first ? ['--category', first.id] : [];
  try {
    const missing = spawnSync(process.execPath, ['tools/new-lecture.mjs', '--name', name, '--title', 'テスト', '--number', '7'], { cwd: ROOT, encoding: 'utf8' });
    if (first) { assert.notEqual(missing.status, 0); assert.match(missing.stderr, /--category/); }
    // デザインはユーザーに確認して --design で指定する。未指定・存在しないIDは作らない。
    const noDesign = spawnSync(process.execPath, ['tools/new-lecture.mjs', '--name', name, '--title', 'テスト', '--number', '7', ...category], { cwd: ROOT, encoding: 'utf8' });
    assert.notEqual(noDesign.status, 0); assert.match(noDesign.stderr, /--design/); assert.match(noDesign.stderr, /sakusura-standard/);
    const unknown = spawnSync(process.execPath, ['tools/new-lecture.mjs', '--name', name, '--title', 'テスト', '--number', '7', ...category, '--design', 'design-00000000-0000-0000-0000-000000000000', '--rules', 'sakusura'], { cwd: ROOT, encoding: 'utf8' });
    assert.notEqual(unknown.status, 0); assert.match(unknown.stderr, /ありません/);
    const noRules = spawnSync(process.execPath, ['tools/new-lecture.mjs', '--name', name, '--title', 'テスト', '--number', '7', ...category, '--design', 'sakusura-standard'], { cwd: ROOT, encoding: 'utf8' });
    assert.notEqual(noRules.status, 0); assert.match(noRules.stderr, /--rules/);
    const result = spawnSync(process.execPath, ['tools/new-lecture.mjs', '--name', name, '--title', 'テスト', '--number', '7', ...category, '--design', 'sakusura-standard', '--rules', 'sakusura'], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const lecture = await readJson(join(ROOT, 'lectures', name, 'lecture.json'));
    assert.equal(lecture.category, first?.id); assert.equal(lecture.design, 'sakusura-standard'); assert.equal(lecture.rules, 'sakusura'); assert.equal(lecture.theme, undefined);
    assert.deepEqual(validateLecture(lecture), []);
    assert.deepEqual(validateDeckStructure(lecture), []);
    assert.deepEqual(lecture.slides.map(slide => slide.layout), ['title', 'agenda', 'statement', 'statement', 'message', 'flow', 'statement', 'statement', 'message', 'statement', 'statement', 'takehome']);
  } finally { await rm(join(ROOT, 'lectures', name), { recursive: true, force: true }); }
});
test('図解はフロー図を1枚以上。画像は alt と prompt が必要で、置けるレイアウトは限定', () => {
  const noFlow = structuredClone(sample);
  for (const slide of noFlow.slides) if (slide.layout === 'flow') slide.layout = 'steps';
  assert.match(validateDeckStructure(noFlow).join(), /フロー図/);
  const image = structuredClone(sample);
  image.slides[0].image = { alt: '説明' };
  image.slides[2].image = { alt: '説明', prompt: '指示' };
  image.slides[3].image = { alt: '説明', prompt: '指示', file: '../x.png' };
  const result = validateLecture(image).join('\n');
  assert.match(result, /slide 1: image は alt/); assert.match(result, /slide 3: image を置けるのは/); assert.match(result, /slide 4: image.file/);
  assert.match(validateLecture({ ...sample, source: '../secret.pdf' }).join(), /source/);
  assert.deepEqual(validateLecture({ ...sample, source: 'input/資料.pdf' }), []);
  assert.deepEqual(validateLecture({ ...sample, source: 'input/資料.docx' }), []);
  const transition = structuredClone(sample); transition.slides[2].transition = true;
  assert.match(validateLecture(transition).join(), /transition は compare/);
});
test('画像の依頼書：未生成の画像だけを保存先・サイズ・生成指示つきで書き出す', async () => {
  const { writeImageRequests } = await import('../tools/image-requests.mjs');
  const result = await writeImageRequests('business-design');
  const text = await readFile(result.path, 'utf8');
  assert.equal(result.pending, sample.slides.filter(slide => slide.image).length);
  assert.match(text, /lectures\/business-design\/images\/001\.png/); assert.match(text, /文字・数字・ロゴ/);
});
test('画像の修正依頼：revision は文字列で、生成済みでも依頼書に「修正依頼」として変更点つきで出る', async () => {
  const lecture = structuredClone(sample);
  const slide = lecture.slides.find(item => item.image);
  slide.image.revision = '';
  assert.match(validateLecture(lecture).join(), /image.revision は修正内容の文字列/);
  slide.image.revision = '人物を少し小さくする';
  assert.deepEqual(validateLecture(lecture), []);
  const { imageManifest } = await import('../tools/lib/images.mjs');
  const images = await imageManifest('business-design', lecture);
  assert.equal(images[slide.id].revision, true);
});
test('解剖図のラベル：lecture.json の名称と、Codexが返す座標（0〜1）・向きを照合する', async () => {
  const { checkLabels } = await import('../tools/lib/images.mjs');
  const ok = checkLabels(['上腕動脈', '橈骨動脈'], { labels: [{ text: '上腕動脈', x: 0.4, y: 0.6, side: 'left' }, { text: '橈骨動脈', x: 0.7, y: 0.3, side: 'top' }] });
  assert.deepEqual(ok.problems, []); assert.equal(ok.labels.length, 2);
  const ng = checkLabels(['上腕動脈', '橈骨動脈'], { labels: [{ text: '上腕動脈', x: 1.4, y: 0.6, side: 'up' }, { text: '尺骨動脈', x: 0.1, y: 0.1, side: 'left' }] });
  const result = ng.problems.join('\n');
  assert.match(result, /x, y は0〜1/); assert.match(result, /side は/); assert.match(result, /「橈骨動脈」の位置がありません/); assert.match(result, /ないラベル「尺骨動脈」/);
  const broken = structuredClone(sample);
  broken.slides.find(slide => slide.layout === 'statement').image = { alt: '説明', prompt: '指示', labels: ['同じ', '同じ'] };
  assert.match(validateLecture(broken).join(), /image.labels は重複のない/);
  const figure = structuredClone(sample); figure.slides[3].layout = 'figure'; delete figure.slides[3].image;
  assert.match(validateLecture(figure).join(), /figure には image/);
});
test('段階・列の絵：対応レイアウトで使え、alt と prompt が必要。依頼書に共通の構図と各段階が出る', async () => {
  const lecture = structuredClone(sample);
  const flow = lecture.slides.find(slide => slide.layout === 'flow');
  flow.blocks[0].image = { alt: '説明', prompt: '指示' };
  const compare = lecture.slides.find(slide => slide.layout === 'compare');
  if (compare) compare.blocks[0].image = { alt: '説明', prompt: '指示' };
  assert.deepEqual(validateLecture(lecture), []);
  lecture.slides[3].blocks[0].image = { alt: '説明' };
  const result = validateLecture(lecture).join('\n');
  assert.match(result, /block.image はフロー図・比較・表・自由レイアウト/); assert.match(result, /alt と prompt/);
  const { blockImagesOf } = await import('../src/core.js');
  assert.equal(blockImagesOf(flow)[0].file, `${flow.id}-${flow.blocks[0].id}.png`);
});
test('表：columns は2〜4列、各行は label・text・cells で列数がそろう。行は5つまで', () => {
  const lecture = structuredClone(sample);
  const slide = lecture.slides[3];
  Object.assign(slide, { layout: 'table', columns: ['種類', '部位', '症状'] });
  slide.blocks = slide.blocks.slice(0, 2).map((block, index) => ({ ...block, label: `行${index + 1}`, cells: ['症状'] }));
  slide.cues = slide.blocks.map((block, index) => ({ at: index, target: block.id }));
  assert.deepEqual(validateLecture(lecture), []);
  slide.blocks[0].cells = [];
  assert.match(validateLecture(lecture).join(), /cells に残り1列/);
  slide.blocks[0].cells = ['症状']; slide.columns = ['1列'];
  assert.match(validateLecture(lecture).join(), /2〜4列/);
  const other = structuredClone(sample); other.slides[3].columns = ['a', 'b'];
  assert.match(validateLecture(other).join(), /表（table）だけ/);
});
test('まとめの一文：改行のない一文で、置けるレイアウトは本編だけ。cue の target は note', () => {
  const lecture = structuredClone(sample);
  const slide = lecture.slides.find(item => item.layout === 'statement');
  slide.note = '局所で**食い止める**';
  assert.match(validateLecture(lecture).join(), /note のcueがありません/);
  slide.cues.push({ at: slide.cues.at(-1).at + 1, target: 'note' });
  assert.deepEqual(validateLecture(lecture), []);
  slide.note = '一行目\n二行目';
  assert.match(validateLecture(lecture).join(), /改行のない一文/);
  const message = lecture.slides.find(item => item.layout === 'message');
  message.note = '一文';
  assert.match(validateLecture(lecture).join(), /note を置けるのは/);
});
test('人物紹介：一文スライドだけで使え、cueは不要。似顔絵は person として依頼される', async () => {
  const lecture = structuredClone(sample);
  const message = lecture.slides.find(slide => slide.layout === 'message');
  message.people = [{ id: 'p1', name: '名前', text: '紹介', image: { alt: '説明', prompt: '指示' } }];
  assert.deepEqual(validateLecture(lecture), []);
  assert.deepEqual(validateDeckStructure(lecture), []);
  const { blockImagesOf } = await import('../src/core.js');
  assert.deepEqual(blockImagesOf(message).map(item => [item.kind, item.file]), [['person', `${message.id}-p1.png`]]);
  message.people.push({ id: 'p1', name: '名前' });
  lecture.slides[3].people = [{ id: 'x', name: '名前', text: '紹介' }];
  const result = validateLecture(lecture).join('\n');
  assert.match(result, /message）だけ/); assert.match(result, /name と text/);
});
test('動画の書き出し：時間割は音声の長さ＋間で、要点が変わる時刻だけ画面を分け、通しのフレームでずれない', async () => {
  const { renderPlan } = await import('../tools/render.mjs');
  const lecture = { slides: [
    { id: '001', gapAfter: 0.6, cues: [] },
    { id: '002', gapAfter: 0.6, cues: [{ at: 0, target: 'a' }, { at: 2.01, target: 'b' }, { at: 2.01, target: 'c' }, { at: 9, target: 'd' }] },
  ] };
  const audio = { '001': { duration: 3.33 }, '002': { duration: 5 } };
  const plan = renderPlan(lecture, audio, { tail: 2 });
  assert.deepEqual(plan[1].states.map(state => state.visible), [['a'], ['a', 'b', 'c']]);
  assert.equal(plan[1].start, 3.93);
  assert.equal(plan.reduce((sum, item) => sum + item.frames, 0), Math.round((3.93 + 7) * 30));
  assert.equal(plan[1].states[1].frame, Math.round((3.93 + 2.01) * 30) - Math.round(3.93 * 30));
});
test('動画の書き出し：上書きせず <講義名>_001.mp4 から番号を増やして残す', async () => {
  const { mkdtemp, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { nextExportPath } = await import('../tools/render.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'render-'));
  try {
    assert.match(await nextExportPath('va-01', directory), /va-01_001\.mp4$/);
    for (const file of ['va-01_001.mp4', 'va-01_009.mp4', 'va-01-b_020.mp4', 'va-01.part.mp4']) await writeFile(join(directory, file), '');
    assert.match(await nextExportPath('va-01', directory), /va-01_010\.mp4$/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
