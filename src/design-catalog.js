import { CATEGORIES, DEFAULT_CATEGORY, validCategoryId, CHAT_BLOCKS, BAR_BLOCKS, TABLE_COLUMNS, TABLE_ROWS, DIAGRAM_BLOCKS, CODE_LINES, isDense } from './core.js';

// 閲覧用の見本と説明。実講義やTTS原稿としては保存しない。
const blocks = rows => rows.map(([label, text], i) => ({ id: `b${i + 1}`, label, text }));
export const DESIGN_GROUPS = [
  { id: 'basic', name: '基本のスライド', description: 'はじめに、本文、結論。講義の骨格をつくるレイアウト。' },
  { id: 'diagram', name: '図解と比較', description: '手順、構造、違い。情報に合った見せ方を選びます。' },
  { id: 'motion', name: '動きで伝える', description: '対話、数値、コード。時間に合わせて内容を見せるレイアウト。' },
];

export const DESIGN_SAMPLES = [
  { layout: 'title', group: 'basic', name: '表紙', description: '大きな題名と演題番号で、講義の入口をつくる。', title: '伝わるスライドは、\nデザインから。', blocks: blocks([['SAKUSURA Standard', '色・文字・余白を揃えて、**伝えたいこと**をまっすぐ届ける。']]), rules: [['役割', '1枚目のサムネイル。題名・演題番号・カテゴリを表示します。'], ['配置', '左に題名と番号、右に円の装飾または挿絵を配置します。'], ['文字', '題名と演題番号は、本文スライドより大きく表示します。']] },
  { layout: 'agenda', group: 'basic', name: 'アジェンダ', description: '番号・項目名・説明を揃えて、全体像を見せる。', title: '今日お伝えする、4つのこと', blocks: blocks([['配色', '線と図形にカテゴリの色を使う'], ['文字', 'グレーの強弱で読みやすくする'], ['レイアウト', '罫線と余白で情報を整理する'], ['まとめ', '持ち帰ってほしいことを4つに絞る']]), rules: [['役割', '2枚目に講義の流れを提示します。'], ['項目', '最大6項目。01、02…の番号を自動で付けます。'], ['整列', '項目名と説明を横に並べ、番号の下に短い差し色の線を置きます。']] },
  { layout: 'statement', group: 'basic', name: '本文', description: '項目と説明を、罫線と余白で読みやすく整理する。', title: '罫線と余白で、要点が伝わる', blocks: blocks([['見出し', '**結論の一文**を、最初に置く。'], ['本文', '説明は短く。重要な語は**濃いグレーの太字**に。'], ['余白', '情報を詰め込まず、**読みやすい間隔**を保つ。']]), note: '1枚に伝えることは、1つ。', rules: [['役割', '見出しで結論を伝え、要点の行で説明を添えます。'], ['配置', '左に項目名、右に説明。行の区切りは細い罫線にします。'], ['まとめ', '必要なときだけ、本文の下に結論の一文を置きます。']] },
  { layout: 'message', group: 'basic', name: '一文', description: '一文と下線マーカーで、大事な言葉を際立たせる。', title: '伝えたいことは、\n**ひとつ**でいい。', blocks: [], rules: [['役割', '講義の要所に2枚。連続して配置しません。'], ['内容', '見出しの一文だけを表示し、本文の行は置きません。'], ['強調', '重要な語に淡いカテゴリ色の下線マーカーを引きます。'], ['別の配置', '右に人物紹介がある場合は一文を68pxにし、左半分に収めます。']] },
  { layout: 'takehome', group: 'basic', name: 'まとめ', description: '持ち帰ってほしい4つの要点を、2×2で配置する。', title: 'Take Home Message', blocks: blocks([['1枚、1メッセージ', '見出しは**結論の一文**にする。'], ['文字に強弱をつける', '本文と**重要な語**を、グレーで分ける。'], ['余白で読みやすくする', '情報は**罫線と間隔**で整理する。'], ['図でつながりを見せる', '手順や因果は**フロー図**で伝える。']]), rules: [['役割', '12枚目のTake Home Message。項目は必ず4つです。'], ['配置', '2列×2段に、番号・短い見出し・説明を揃えます。'], ['装飾', '各項目の上に主色の罫線と、差し色の短い印を置きます。']] },
  { layout: 'flow', group: 'diagram', name: 'フロー図', description: '箱と矢印をつなぎ、手順や因果を一方向に見せる。', title: '手順は、つながりで見せる', blocks: blocks([['整理する', '伝えたいことを\n1つに絞る'], ['組み立てる', '要点の順序を\n決める'], ['届ける', '図と短い言葉で\nわかりやすく']]), rules: [['役割', '手順や因果関係を示す図解の標準です。本編に1枚以上使います。'], ['配置', '箱を横に並べ、差し色の矢印で中央同士をつなぎます。補足は箱の下へ。'], ['動き', 'AI Topicでは矢印が伸び、光の点が順に流れます。']] },
  { layout: 'figure', group: 'diagram', name: '図と要点', description: '左に大きな図、右に短い要点を並べて説明する。', title: '大きな図と、短い要点で伝える', image: { alt: '大きな図と右側の要点の配置を示す図版見本' }, blocks: blocks([['全体を見る', '左側を大きな図に使い、**全体像**を見せる。'], ['要点を絞る', '右側に短い言葉で、**見るポイント**を添える。'], ['位置を示す', '必要な構造名は、図に**HTMLのラベル**を重ねる。']]), rules: [['役割', '解剖・構造など、大きな図が説明の中心になる場面に使います。'], ['配置', '左に図、右に要点。見本の図は配置確認用の図形です。'], ['ラベル', '構造名は画像内に描かず、位置情報を使ってHTMLの文字を重ねます。']] },
  { layout: 'steps', group: 'diagram', name: '段階', description: '太線と短い言葉で、各段階の要点を横に並べる。', title: '段階ごとに、見るポイントを揃える', blocks: blocks([['01 整理', '伝える内容を\n絞り込む'], ['02 設計', '順序と見せ方を\n決める'], ['03 確認', '読みやすさを\n見直す']]), rules: [['役割', '3〜4段階の要点を並べて説明します。'], ['配置', '段階ごとに太い上罫線と見出しを揃えます。'], ['使い分け', 'つながりや因果を中心に伝える場合はフロー図を使います。']] },
  { layout: 'compare', group: 'diagram', name: '比較', description: '2つの内容を左右に並べ、違いを見せる。', title: '情報の強弱で、読み方が変わる', blocks: blocks([['見出し・重要な語', '**濃いグレーと太字**で、\n最初に目に入るポイントをつくる。'], ['本文・補足', '薄いグレーを基調に、\n要点を支える説明を添える。']]), rules: [['役割', '2つの選択肢や状態の違いを並べて説明します。'], ['配置', '中央の細い縦線で分け、左右の見出しと下線を揃えます。'], ['変化の表示', 'Before→Afterのような変化があるときだけ、丸い矢印を使えます。']] },
  { layout: 'table', group: 'diagram', name: '表', description: '列と行を揃えて、複数の観点を比較する。', title: '比較する観点を、同じ列に揃える', columns: ['項目', '使いどころ', '見せ方'], blocks: [['配色', 'シリーズを見分ける', '線と図形の色'], ['文字', '内容に強弱をつける', 'グレーと太字'], ['余白', '情報を整理する', '罫線と間隔']].map(([label, text, cell], i) => ({ id: `b${i + 1}`, label, text, cells: [cell] })), rules: [['役割', '項目ごとに、同じ観点の情報を比べます。'], ['整列', '列見出しと各行の開始位置を揃え、行間を細い罫線で区切ります。']] },
  { layout: 'timeline', group: 'diagram', name: '年表', description: '軸に沿って、出来事の順序や変化を見せる。', title: '順序を軸に沿って見せる', blocks: blocks([['はじめに', '内容を整理する'], ['つぎに', '見せ方を決める'], ['最後に', '仕上がりを確認する']]), rules: [['役割', '出来事を時間順に説明します。'], ['配置', '一本の軸に点を置き、見出しと説明を上下交互に並べます。'], ['動き', 'cueごとに軸が伸び、次の点が現れます。']] },
  { layout: 'cycle', group: 'diagram', name: '輪の図', description: '繰り返す流れを、閉じた輪に沿って見せる。', title: '繰り返す流れは、輪で見せる', center: '改善の流れ', blocks: blocks([['つくる', '形にする'], ['確かめる', '見直す'], ['整える', '改善する']]), rules: [['役割', '一方向で終わらず、繰り返す流れを説明します。'], ['配置', '楕円の上に箱を置き、中央に流れの名前を表示します。'], ['動き', '輪の線がつながり、光の点が箱を順に通ります。']] },
  { layout: 'stack', group: 'diagram', name: '層の図', description: '積み重なりで、役割や構造の関係を見せる。', title: '役割の重なりを、層で見せる', blocks: [['伝えたいこと', '伝える内容', 3], ['見せ方', '構成とレイアウト', 2], ['共通のルール', '色・文字・余白', 1]].map(([label, text, row], i) => ({ id: `b${i + 1}`, label, text, row })), rules: [['役割', '仕組みの層や、各部分の役割を説明します。'], ['配置', 'row=1を一番下にし、同じ層は横に並べます。'], ['動き', '層が上から現れ、重なりが順に見えるようにします。']] },
  { layout: 'chat', group: 'motion', name: 'チャット', description: '質問と回答を、左右の吹き出しで表す。', title: '対話で、考え方を見せる', blocks: [{ id: 'b1', role: 'user', label: '質問', text: 'スライドを読みやすくするには？' }, { id: 'b2', role: 'ai', label: '回答', text: 'まずは**1枚1メッセージ**に。色・文字・余白を揃えてみましょう。' }], rules: [['配置', '右に質問、左に回答。アイコンと吹き出しを組み合わせます。'], ['動き', '質問は入力するように表示し、AIの回答は考え中の点に続いて1文字ずつ現れます。']] },
  { layout: 'bars', group: 'motion', name: '棒グラフ', description: '棒の長さと数字で、量の違いを比べる。', title: '長さと数字で、違いが見える', max: 100, blocks: [{ id: 'b1', label: '表示サンプル A', value: 40, text: 'レイアウト確認用の仮の値' }, { id: 'b2', label: '表示サンプル B', value: 70, highlight: true }, { id: 'b3', label: '表示サンプル C', value: 100 }], rules: [['配置', '左に項目名、中央に棒、右に数値を揃えます。'], ['強調', '通常の棒は主色、注目させたい行だけ差し色にします。'], ['動き', '棒が伸び、数字が0から数え上がります。見本の数値は表示確認用です。']] },
  { layout: 'code', group: 'motion', name: 'コード', description: 'コード・実行・結果を、ひとまとまりで見せる。', title: 'コードと結果を、順に見せる', blocks: [{ id: 'b1', label: 'hello.js', code: '// 短いコードの見本\nconst message = "Hello, slides!";\nconsole.log(message);', command: 'node hello.js', output: 'Hello, slides!', text: 'コードと実行結果を、**同じパネル**で説明する。' }], rules: [['配置', 'ファイル名・行番号付きコード・実行コマンド・結果をまとめます。'], ['文字', 'コードは等幅書体を使い、パネル数に応じて文字サイズを調整します。'], ['動き', 'コードが打ち込まれ、続いてコマンドと結果が表示されます。']] },
].map(slide => ({ ...slide, id: `design-${slide.layout}`, eyebrow: 'Design Preview', cues: [...slide.blocks.map((b, i) => ({ at: i * 2, target: b.id })), ...(slide.note ? [{ at: slide.blocks.length * 2, target:'note' }] : [])] }));

// 実際に使うカテゴリは designCategoryKey でデザインの配色に合わせる。
export const validDesignCategory = value => validCategoryId(value) ? value : 'va';
export const validDesignLayout = value => DESIGN_SAMPLES.some(s => s.layout === value) ? value : 'title';

export function layoutRules(sample, category) {
  const rows = [...sample.rules];
  const range = values => `${values[0]}〜${values[1]}`;
  const dense = isDense({ category });
  if (sample.layout === 'statement') rows.push(['項目数', `${dense ? 6 : 4}項目まで。多い場合はスライドを分けます。`]);
  if (sample.layout === 'flow') rows.push(['箱の数', '3〜5個。各箱の高さを揃えます。']);
  if (sample.layout === 'figure') rows.push(['要点数', '3〜4項目を目安に、図を見るための言葉に絞ります。']);
  if (sample.layout === 'table') rows.push(['列と行', `${range(TABLE_COLUMNS)}列、${dense ? 6 : TABLE_ROWS}行まで。`]);
  if (sample.layout === 'chat') rows.push(['吹き出し数', `${range(CHAT_BLOCKS)}つ。`]);
  if (sample.layout === 'bars') rows.push(['項目数', `${range(BAR_BLOCKS)}行。実講義の数値は元資料に基づきます。`]);
  if (DIAGRAM_BLOCKS[sample.layout]) rows.push(['要素数', `${range(DIAGRAM_BLOCKS[sample.layout])}${sample.layout === 'code' ? `パネル。コードは${CODE_LINES}行まで。` : '個。'}`]);
  return rows;
}

// 数値は指定した要素の実際の計算値を読む。本文がない一文スライドに本文サイズは表示しない。
export const LAYOUT_METRICS = {
  title: [['演題番号', '.deck-number', 'fontSize'], ['題名の最大幅', 'h1', 'maxWidth'], ['カテゴリ名', '.category-tag', 'fontSize']],
  agenda: [['項目名', '.block-label', 'fontSize'], ['項目と説明の間隔', '.block-body', 'columnGap']],
  statement: [['行の上下余白', '.reveal', 'paddingTop'], ['項目と説明の間隔', '.block-body', 'columnGap']],
  message: [['行の高さ', 'h1', 'lineHeight'], ['文字の太さ', 'h1', 'fontWeight'], ['上の印の幅', 'h1', 'width', '::before']],
  takehome: [['列の間隔', '.blocks', 'columnGap'], ['段の間隔', '.blocks', 'rowGap']],
  flow: [['箱の最小高さ', '.block-body', 'minHeight'], ['箱の間隔', '.blocks', 'columnGap'], ['箱の線幅', '.block-body', 'borderTopWidth']],
  figure: [['図の幅', '.slide-image', 'width'], ['図の高さ', '.slide-image', 'height']],
  steps: [['段階の間隔', '.blocks', 'columnGap'], ['上の線幅', '.reveal', 'borderTopWidth']],
  compare: [['左右の間隔', '.blocks', 'columnGap'], ['見出し下の余白', '.block-label', 'paddingBottom']],
  table: [['列見出し', '.table-column', 'fontSize'], ['行の上下余白', '.reveal', 'paddingTop'], ['列の間隔', '.block-body', 'columnGap']],
  timeline: [['軸の領域の高さ', '.blocks', 'height'], ['点の大きさ', '.tl-dot', 'width']],
  cycle: [['輪の領域の高さ', '.blocks', 'height'], ['箱の幅', '.reveal', 'width']],
  stack: [['層の間隔', '.blocks', 'rowGap'], ['層の上下余白', '.block-body', 'paddingTop']],
  chat: [['アイコンの大きさ', '.chat-avatar', 'width'], ['吹き出しの上下余白', '.block-body', 'paddingTop']],
  bars: [['棒の高さ', '.bar-track', 'height'], ['数値', '.bar-value', 'fontSize']],
  code: [['コード本文', '.code-body', 'fontSize'], ['コマンド・結果', '.code-term', 'fontSize']],
};

export function designImages(category, colors = (CATEGORIES[category] ?? DEFAULT_CATEGORY).colors) {
  const { primary, accent, soft } = colors;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 600"><rect x="100" y="60" width="700" height="480" rx="32" fill="${soft}" opacity=".38"/><circle cx="425" cy="300" r="172" fill="${soft}"/><circle cx="425" cy="300" r="112" fill="none" stroke="${primary}" stroke-width="12"/><circle cx="425" cy="300" r="44" fill="${accent}"/><path d="M538 185 660 120M538 415 660 480" stroke="${primary}" stroke-width="6"/><circle cx="680" cy="110" r="32" fill="${accent}"/><circle cx="680" cy="490" r="32" fill="${primary}"/></svg>`;
  const portrait = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 660 620"><path d="M64 620c0-126 79-179 190-193h152c112 14 190 67 190 193" fill="#464543"/><path d="M260 371h140v96c-35 40-105 40-140 0" fill="#b8b5b0"/><ellipse cx="330" cy="251" rx="124" ry="161" fill="#d0cdc7"/><path d="M205 243c-18-149 40-185 122-185 99 0 151 70 128 189-16-32-30-68-40-99-71 47-131 48-194 46z" fill="#55534f"/><path d="M214 496 272 442 330 479 388 442 448 496 416 620H243" fill="#efede8"/><path d="M272 442 330 479 299 519 244 466M388 442 330 479 361 519 416 466" fill="#fffdfa"/><path d="M272 255h28M363 255h28M307 336c15 8 31 8 46 0" fill="none" stroke="#79756f" stroke-width="6" stroke-linecap="round"/><path d="M326 273 317 307h19" fill="none" stroke="#aaa59d" stroke-width="5" stroke-linecap="round"/></svg>';
  return {
    'design-figure': { ready: true, url: `data:image/svg+xml;base64,${btoa(svg)}` },
    'design-profile': {ready:true,url:`data:image/svg+xml;base64,${btoa(portrait)}`},
  };
}
