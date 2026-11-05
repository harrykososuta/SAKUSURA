import { motionEase } from './animation.js';
import { decorateEcg } from './extension-stubs.js';
// 共通のブロック・cueを使う図解の配置。文字は通常の編集機能で差し替えられる。
export const COMPOSITIONS = {
  profile: { name: '人物紹介', layout: 'figure' },
  system: { name: '全体構成', layout: 'flow' },
  lanes: { name: '役割別レーン', layout: 'flow' },
  journey: { name: '時間軸', layout: 'timeline' },
  recovery: { name: '停止と再開の比較', layout: 'flow' },
  'anatomy-focus': { name: '解剖図・部位を順に強調', layout: 'figure', count: 3, anatomy: true },
  'image-notes-2': { name: '画像＋要点2つ', layout: 'statement', count: 2, illustration: true },
  'image-notes-3': { name: '画像＋要点3つ', layout: 'statement', count: 3, illustration: true },
};
const b = (id, label, text = '', detail = '') => ({ id, label, text, detail });
export const COMPOSITION_SAMPLES = {
  'image-notes-2': {title:'大きな画像と、二つの視点で伝える',blocks:[{...b('b1','最初の視点','まずは、**全体**を捉える。'),icon:'book'},{...b('b2','見方を変える','次に、**要点**に目を向ける。'),icon:'idea'}]},
  'image-notes-3': {title:'画像を添えて、伝える要点を整理する',blocks:[b('b1','背景と経験','伝えたいことの**背景**を紹介する。'),b('b2','押さえるポイント','説明は短く、**要点**を示す。'),b('b3','次の学びへ','要点から、**理解**を深めていく。')]},
  'anatomy-focus': {title:'全体像を保ちながら、部位に注目する',blocks:[b('b1','全体と位置','図の中で、**位置**を確かめる。'),b('b2','指示線と名称','説明する部位の**名称**を添える。'),b('b3','関係を捉える','最後に、**部位の関係**を見渡す。')]},
  profile: { title: '伝える人の、背景が見える。', blocks: [b('b1', '講師プロフィール', '名前・肩書き', 'Name / Profile'), b('b2', '専門と活動', '伝えたいテーマを、ひと言で。'), b('b3', 'これまでの経験', '代表的な実績を、短く紹介する。'), b('b4', '大切にしていること', 'この講義で届けたい視点を添える。')] },
  system: { title: '入口・処理・実行を分けると、全体が見える', blocks: [b('b1', 'アプリ・Web', '入力を受け取る', '入口'), b('b2', 'メッセージ', '依頼を送る'), b('b3', '受付・キュー', '内容を確かめて振り分ける', '処理'), b('b4', 'エージェント', '判断 → ツールを選ぶ'), b('b5', '保存した状態', '会話・記憶・進行状況'), b('b6', 'ツールの実行', 'ファイル・コマンド', '実行'), b('b7', '結果を返す', '必要な情報を届ける')] },
  lanes: { title: '処理と保存の役割を、レーンで見分ける', blocks: [b('b1', 'あなたのメッセージ', 'ここから処理が始まる', 'きっかけ'), b('b2', '読み込む → 作業する → 保存する', 'ひと区切りごとに状態を残す', '処理'), b('b3', '必要なときだけ復元する', 'ツールを使う間だけ起動する', '実行環境'), b('b4', '会話・記憶・進行状況を保持する', '処理が止まっても状態は残る', '保存した状態')] },
  journey: { title: '時間の流れに沿って、変化を追いかける', blocks: [b('b1', '01 / きっかけ', '依頼を受け取る', '必要な情報を集める'), b('b2', '02 / 作業', '小さく進める', '区切りごとに記録する'), b('b3', '03 / 整理', '要点をまとめる', '次に必要な情報を残す'), b('b4', '04 / 再開', '続きから始める', '前の状態を引き継ぐ')] },
  recovery: { title: '記録があれば、止まったところから再開できる', blocks: [b('b1', 'STEP 01', '入力'), b('b2', 'STEP 02', '作業'), b('b3', 'STEP 03', '停止'), b('b4', '最初からやり直す', '完了した仕事も繰り返す'), b('b5', 'STEP 01', '入力・記録済み'), b('b6', 'STEP 02', '作業・記録済み'), b('b7', 'STEP 03', '停止'), b('b8', '続きから再開する', '終わった仕事は繰り返さない')] },
};
export const compositionEdges = slide => ({ system: [[0,2],[1,2],[2,3],[3,4,'dashed'],[3,5],[5,6]], lanes: [[0,1],[1,2,'dashed'],[2,3]], recovery: [[0,1],[1,2],[2,3,'dashed'],[4,5],[5,6],[6,7]] }[slide.composition] ?? []);

export function decorateComposition(content, slide) {
  content.dataset.composition = slide.composition ?? '';
  content.querySelector('.composition-regions')?.remove();
  if (!slide.composition) return;
  decorateEcg(content, slide);
  if (slide.composition === 'system') {
    const regions = document.createElement('div'); regions.className = 'composition-regions'; regions.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 3; i++) regions.append(document.createElement('span'));
    content.append(regions);
  }
}

// SVGの長さも音声時刻から復元する。独立した時計やタイマーは使わない。
export function drawCompositionLinks(content, slide, time, find) {
  const edges = compositionEdges(slide); if (!edges.length) return;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = (tag, attrs) => { const el = document.createElementNS(ns, tag); for (const [k,v] of Object.entries(attrs)) el.setAttribute(k,v); return el; };
  let layer = content.querySelector('.composition-links');
  if (!layer) { layer = svg('svg', { class: 'composition-links', 'aria-hidden': 'true' }); content.append(layer); }
  layer.setAttribute('viewBox', `0 0 ${content.clientWidth} ${content.clientHeight}`); layer.replaceChildren();
  const contentRect = content.getBoundingClientRect(), scale = contentRect.width / content.clientWidth;
  const rect = index => {
    const el = [...content.querySelectorAll('[data-block]')].find(el => el.dataset.block === slide.blocks[index]?.id);
    const body = el?.querySelector('.block-body'); if (!body) return null;
    const r = body.getBoundingClientRect(); return { x:(r.left-contentRect.left)/scale, y:(r.top-contentRect.top)/scale, w:r.width/scale, h:r.height/scale };
  };
  edges.forEach(([a,b,style],index) => {
    const from=rect(a),to=rect(b); if (!from || !to) return;
    const vertical = Math.abs(from.x + from.w/2 - to.x - to.w/2) < 160;
    const sx=vertical?from.x+from.w/2:from.x+from.w+9, sy=vertical?from.y+from.h+7:from.y+from.h/2;
    const tx=vertical?to.x+to.w/2:to.x-10, ty=vertical?to.y-8:to.y+to.h/2;
    const d=vertical?`M${sx} ${sy} V${ty}`:`M${sx} ${sy} H${(sx+tx)/2} V${ty} H${tx}`;
    const item=find('link',slide.blocks[b].id), p=!item?1:motionEase((time-item.start)/Math.max(.001,item.end-item.start));
    const group=svg('g',{}), path=svg('path',{d,fill:'none',stroke:'var(--primary)','stroke-width':2.5});
    group.append(path); layer.append(group);
    const length=path.getTotalLength(),clipId=`composition-${slide.id}-${index}`;
    if(style==='dashed') {
      const defs=svg('defs',{}),mask=svg('mask',{id:clipId,maskUnits:'userSpaceOnUse',x:0,y:0,width:content.clientWidth,height:content.clientHeight});
      mask.append(svg('path',{d,fill:'none',stroke:'white','stroke-width':8,'stroke-dasharray':length,'stroke-dashoffset':length*(1-p)}));defs.append(mask);group.prepend(defs);path.setAttribute('mask',`url(#${clipId})`);path.setAttribute('stroke-dasharray','8 7');
    } else {path.setAttribute('stroke-dasharray',length);path.setAttribute('stroke-dashoffset',length*(1-p));}
    if(p>=.98) group.append(svg('path',{d:vertical?`M${tx-6} ${ty-9} L${tx} ${ty} L${tx+6} ${ty-9}`:`M${tx-9} ${ty-6} L${tx} ${ty} L${tx-9} ${ty+6}`,fill:'none',stroke:'var(--primary)','stroke-width':2.5}));
  });
}
