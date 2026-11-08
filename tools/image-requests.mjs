// 画像が必要なスライドについて、Codex向けの生成依頼書 lectures/<slug>/images/REQUEST.md を書き出す。
// 生成はCodexが行う（このツールは画像生成APIを呼ばない）。
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { lectureRoot, loadLecture, argumentValue } from './lib/project.mjs';
import { imageManifest, labelsFileOf } from './lib/images.mjs';
import { plainText, blockImagesOf, categoryOf, CATEGORIES, DEFAULT_CATEGORY } from '../src/core.js';

// 表示枠（CSSの .slide-image）の2倍の解像度で依頼する。縦横比は枠と同じにする（ラベル位置がずれないように）。
const SIZE = { title: '1440×1060 px（横長 約4:3）', statement: '1240×920 px（横長 約4:3）', figure: '1800×1200 px（横長 3:2）', step: '780×540 px（横長 約13:9）', person: '600×600 px（正方形）' };
// 画風の色はカテゴリの配色（スライドの線・図形と同じ）に合わせる。
export const styleFor = (category = CATEGORIES.va ?? { ...DEFAULT_CATEGORY, name: '標準' }) => [
  '用途：16:9 のHTMLビジネススライド（1920×1080）に置く挿絵・模式図。',
  `画風：フラットな線画。輪郭線は ${category.colors.primary.toUpperCase()}、塗りは ${category.colors.accent.toUpperCase()}・淡い色 ${category.fill}・白を基本にする（「${category.name}」シリーズの配色）。グラデーションと写真風の質感は使わない。`,
  '背景：透過PNG（不可なら生成り #F6F3EE の単色）。枠線・影・装飾的な背景は入れない。',
  '画像内に文字・数字・ロゴ・記号・矢印を入れない（名称はスライド側でHTMLの文字として重ねる）。',
  '実在の人物・企業・ブランドを描かない。人物はビジネスカジュアルで、穏やかな表情。',
  '主題は画面中央に大きく、周囲に少し余白を残す。指定サイズ（縦横比）を必ず守る。',
];
export const ANATOMY = [
  '医学教育用の**模式図**。写実的な解剖画・血液・切開・内臓のリアルな質感は描かない。線は太めで、要素の数を絞る。',
  '色の意味を全画像で統一する：**動脈＝オレンジ #D27D2D**（太い実線）、**静脈＝青 #6F8FD6**（実線。深部を走る区間・筋膜の下に潜る区間は破線）、**神経＝紺 #1E2A47 の細い破線**、**骨＝ごく淡い灰青 #DCE2EE の塗り（輪郭なし）**、**皮膚の輪郭＝紺の細線＋白の塗り**。',
  '向きと左右を取り違えない。各画像の「向き」の指定に従い、親指側・小指側、患者の右・左が画像のどちら側かを守る。',
  '走行の分岐・合流の位置関係は「確認項目」をすべて満たすこと。満たせない場合は描き直す。',
  'ラベルの文字は描かない。代わりに、各ラベルが指す構造の上の1点の位置を、下の形式のJSONファイルで保存する。',
];

const labelGuide = (name, slide, file) => [
  `- ラベル位置ファイル：\`lectures/${name}/images/${labelsFileOf(file)}\`（下の形式。text はこの表記のまま）`,
  '',
  '```json',
  '{', '  "labels": [',
  ...slide.image.labels.map((text, index, all) => `    { "text": ${JSON.stringify(text)}, "x": 0.00, "y": 0.00, "side": "right" }${index < all.length - 1 ? ',' : ''}`),
  '  ]', '}',
  '```',
  '',
  '  - 上は書式の見本。`x`, `y`, `side` を実際の値に置き換える。',
  '  - `x`, `y`：画像の幅・高さに対する割合（左上が 0, 0、右下が 1, 1）。その構造の**線の上**の点にする（周りの空白ではなく）。',
  '  - `side`：ラベル文字を点のどちら側に置くか（`left` / `right` / `top` / `bottom`）。文字（24px・最大7文字程度）が画像の外にはみ出さず、ほかのラベル・重要な線と重ならない向きを選ぶ。',
  '  - ラベル同士の点は、画像上で幅・高さの5%以上離す。',
];

export async function writeImageRequests(name, { all = false } = {}) {
  const lecture = await loadLecture(name);
  const images = await imageManifest(name, lecture);
  const needsWork = slide => all || !images[slide.id].ready || images[slide.id].revision || images[slide.id].labelProblems.length > 0;
  const targets = lecture.slides.filter(slide => slide.image && needsWork(slide));
  const directory = join(lectureRoot(name), 'images');
  await mkdir(directory, { recursive: true });
  const path = join(directory, 'REQUEST.md');
  const status = item => !item.ready ? '**未生成**' : item.revision ? '**修正依頼**' : item.labelProblems.length ? '**ラベル位置が未作成**' : '生成済み';
  const rows = lecture.slides.filter(slide => slide.image).map(slide => `| ${slide.id} | ${plainText(slide.title)} | \`${images[slide.id].file}\` | ${SIZE[slide.layout]} | ${slide.image.labels?.length ? `${slide.image.labels.length}個` : '—'} | ${status(images[slide.id])} |`);
  const sections = targets.map(slide => {
    const { file } = images[slide.id];
    const lines = [
      `## ${slide.id}：${plainText(slide.title)}`, '',
      `- 保存先：\`lectures/${name}/images/${file}\``,
      `- サイズ：${SIZE[slide.layout]}`,
      `- 何を表す画像か：${slide.image.alt}`,
      `- スライドの文脈：${plainText(slide.narration).slice(0, 200) || '（台本未記入）'}`, '',
    ];
    // 修正依頼：今の画像を見本に、指摘の点だけを直す（描き直しで別の絵にならないように）。
    if (images[slide.id].ready && images[slide.id].revision) lines.push(
      '### 修正依頼（今回の変更点）', '', ...slide.image.revision.split('\n').map(line => `> ${line}`), '',
      `今の \`${file}\` を見本にし、上の点だけを直して同じファイル名で上書きする。構図・色・ほかの部分は変えない。下の生成指示と確認項目は、修正後の画像も満たすこと。`,
      ...(slide.image.labels?.length ? [`形が変わった構造のラベル位置は、ラベル位置ファイル \`${labelsFileOf(file)}\` も直した画像に合わせて更新する。`] : []), '',
    );
    lines.push(
      '### 生成指示', '', ...slide.image.prompt.split('\n').map(line => `> ${line}`), '',
    );
    if (slide.image.checklist?.length) lines.push('### 確認項目（生成後に画像を見て、すべて満たすか確かめる）', '', ...slide.image.checklist.map(item => `- [ ] ${item}`), '');
    if (slide.image.labels?.length) lines.push('### ラベル（画像には描かない。位置だけJSONで返す）', '', `指す構造：${slide.image.labels.map(text => `「${text}」`).join('・')}`, '', ...labelGuide(name, slide, file), '');
    return lines.join('\n');
  });
  // フロー図の段階ごとの絵・人物紹介の似顔絵：スライド単位で「共通の構図」と各枚の指示をまとめる。
  for (const slide of lecture.slides) for (const kind of ['step', 'person']) {
    const steps = blockImagesOf(slide).filter(step => step.kind === kind);
    if (!steps.length) continue;
    for (const step of steps) rows.push(`| ${step.key} | ${plainText(slide.title)}（${plainText(step.block.label ?? step.block.name ?? step.block.id)}） | \`${step.file}\` | ${SIZE[kind]} | — | ${status(images[step.key])} |`);
    const pending = steps.filter(step => all || !images[step.key].ready);
    if (!pending.length) continue;
    const lines = [
      ...(kind === 'person' ? [
        `## ${slide.id}：${plainText(slide.title)}（人物紹介の似顔絵 ${steps.length}枚）`, '',
        `一文スライドの右側に、${steps.length}人の似顔絵を上から順に**直径120pxの円形に切り抜いて**並べ、横に名前と紹介をHTMLの文字で添える。**${steps.length}枚は同じ画風・同じ構図（胸から上・顔が画像の中央・同じ縮尺）**で描く。円形に切り抜いても頭と肩が収まるよう、上下左右に余白を残す。`, '',
      ] : slide.layout === 'table' ? [
        `## ${slide.id}：${plainText(slide.title)}（表の行の絵 ${steps.length}枚）`, '',
        `表の各行の1列目（行の見出し）の左に、${steps.length}枚を上から順に**幅180px程度の小さなアイコン**として表示する。**${steps.length}枚は同じ画風・同じ向き・同じ縮尺**で描き、小さくても何の絵か分かるよう、対象を画像の中央に大きく1つだけ描く。`, '',
      ] : slide.layout === 'compare' ? [
        `## ${slide.id}：${plainText(slide.title)}（比較の列の絵 ${steps.length}枚）`, '',
        `比較の左右の列の見出しの上に、${steps.length}枚を左から順に並べて表示する。**${steps.length}枚は同じ画風・同じ向き・同じ縮尺**で描き、違いが一目で比べられるようにする。`, '',
      ] : [
        `## ${slide.id}：${plainText(slide.title)}（フロー図の段階の絵 ${steps.length}枚）`, '',
        `フロー図の各段階の箱の上部に、${steps.length}枚を左から順に並べて表示する。**${steps.length}枚は同じ人物・同じ手・同じ向き・同じ縮尺**で描き、連続した手順に見えるようにする。`, '',
      ]),
      `- サイズ：各 ${SIZE[kind]}`,
      `- スライドの文脈：${plainText(slide.narration).slice(0, 200)}`, '',
    ];
    if (slide.imageSeries) lines.push('### 共通の構図', '', ...slide.imageSeries.split('\n').map(line => `> ${line}`), '');
    for (const step of pending) {
      lines.push(`### ${step.key.split(':')[1]}：${plainText(step.block.label ?? step.block.name ?? '')}`, '', `- 保存先：\`lectures/${name}/images/${step.file}\``, `- 何を表す絵か：${step.image.alt}`, '', ...step.image.prompt.split('\n').map(line => `> ${line}`), '');
      if (step.image.checklist?.length) lines.push(...step.image.checklist.map(item => `- [ ] ${item}`), '');
    }
    sections.push(lines.join('\n'));
  }
  const anatomy = lecture.slides.some(slide => slide.image?.labels?.length || slide.image?.checklist?.length || blockImagesOf(slide).some(step => step.kind === 'step'));
  // 人物紹介の似顔絵は、共通スタイルの「実在の人物を描かない」の例外（講義ごとにユーザーが了承したもの）。
  const portraits = lecture.slides.some(slide => blockImagesOf(slide).some(step => step.kind === 'person'));
  const body = [
    `# 画像生成依頼：${plainText(lecture.title)}（lectures/${name}）`, '',
    'Codexへの依頼書です。下の各画像を生成し、指定の保存先に**指定のファイル名で**保存してください。ラベルがある画像は、ラベル位置ファイル（JSON）も保存してください。lecture.json・CSS・ほかのファイルは変更しないでください。', '',
    '## 共通スタイル（全画像）', '', ...styleFor(categoryOf(lecture) ?? undefined).map(line => `- ${line}`),
    ...(portraits ? ['- **例外**：「人物紹介の似顔絵」だけは、講義で紹介する歴史上の医師・研究者を描く（ユーザー了承済み）。写真風にせず、上の画風（フラットな線画・配色）の似顔絵風イラストにする。人物は白衣でよい。'] : []), '',
    ...(anatomy ? ['## 解剖の模式図のルール', '', ...ANATOMY.map(line => `- ${line}`), ''] : []),
    '## 一覧', '', '| スライド | 見出し | ファイル | サイズ | ラベル | 状態 |', '|---|---|---|---|---|---|', ...rows, '',
    ...(sections.length ? sections : ['作業が必要な画像はありません。', '']),
    '## 保存後の確認', '',
    `1. \`npm run check -- --lecture ${name}\` で、画像とラベル位置ファイルの不足・形式の誤りがないことを確認する。`,
    `2. \`npm run qa:browser -- --lecture ${name}\` を実行し、\`reports/${name}/slide-*.png\` で、ラベルの点が正しい構造の上にあり、文字が重なっていないことを目で確認する。ずれていれば JSON の x, y, side を直す。`,
    '3. 確認項目を満たせなかった点があれば、作業報告に書く。', '',
  ].join('\n');
  await writeFile(path, body, 'utf8');
  return { path, total: rows.length, pending: Object.values(images).filter(item => !item.ready || item.revision || item.labelProblems.length).length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const name = argumentValue(process.argv, '--lecture', 'demo');
    const result = await writeImageRequests(name, { all: process.argv.includes('--all') });
    console.log(`画像 ${result.total}枚（依頼 ${result.pending}枚）/ lectures/${name}/images/REQUEST.md`);
    if (result.pending) console.log(`Orca内で依頼: npm run images:task -- --lecture ${name}（完了待ちは同コマンドに --wait）`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
