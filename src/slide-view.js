import { emphasisParts, plainText, categoryOf, COLOR_KEYS, applyThemeCss, appearanceOf, isDense } from './core.js';
import { applyPlacement, fitImage } from './placement.js';
import { SHAPE_KINDS } from './shapes.js';
import { hasMotion, CYCLE } from './motion.js';
import { iconElement, ICON_LAYOUTS } from './icons.js';
import { fullCrop, croppedPoint } from './image-data.js';
import { usesPresentationMotion } from './animation.js';
import { decoratePresentation } from './presentation-motion.js';
import { decorateComposition } from './design-compositions.js';
import { decorateAnatomy } from './extension-stubs.js';
import { decorateConduction } from './extension-stubs.js';
import { decorateWpwMotion } from './extension-stubs.js';
import { decorateWpwTypes } from './extension-stubs.js';
import { decorateWpwOrigin } from './extension-stubs.js';
import { decorateLgl } from './extension-stubs.js';
import { decorateAvDelay } from './extension-stubs.js';
import { decorateHdCircuit } from './hd-circuit-motion.js';
import { decorateEcgVector } from './extension-stubs.js';
import { decorateEcgLeads } from './extension-stubs.js';
import { decorateEcgMeasure } from './extension-stubs.js';
import { decorateEcgAxis } from './extension-stubs.js';
import { decorateEcgTransition } from './extension-stubs.js';
import { decorateBundleBlock, decorateBundlePathway } from './extension-stubs.js';
import { decorateFascicular, decorateFascicularHeart } from './extension-stubs.js';
import { decorateVentricularHypertrophy } from './extension-stubs.js';
import { decorateLvhDetail } from './extension-stubs.js';
import { decorateLvhCriteria } from './extension-stubs.js';
import { decorateHcm } from './extension-stubs.js';
import { decorateTrifascicular } from './extension-stubs.js';
import { decorateRvh } from './extension-stubs.js';
import { decorateBvh } from './extension-stubs.js';
import { decorateAcs } from './extension-stubs.js';
import { decorateSqlite } from './extension-stubs.js';
import { renderDocument } from './document-layout.js';
import { decorateHemodialysis } from './extension-stubs.js';

// textContentだけで組み立てる。** で囲んだ語は濃いグレーの太字。
function rich(tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  for (const part of emphasisParts(value)) {
    if (part.strong) { const strong = document.createElement('strong'); strong.textContent = part.text; element.append(strong); }
    else element.append(part.text);
  }
  return element;
}
// チャットの吹き出し：1文字ずつ表示できるよう、文字を1つずつ span（.ch）に分ける。改行・太字はそのまま残る。
function splitChars(element) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) node.replaceWith(...[...node.textContent].map(char => { const span = document.createElement('span'); span.className = 'ch'; span.textContent = char; return span; }));
  return element;
}
// アジェンダとTake Home Messageは 01, 02 … を自動で振る。
const NUMBERED = new Set(['agenda', 'takehome']);
const SECTIONED = new Set(['statement', 'flow', 'figure', 'steps', 'compare', 'table', 'chat', 'bars', 'code', 'timeline', 'cycle', 'stack']);
const div = className => { const element = document.createElement('div'); element.className = className; return element; };
// 1文字ずつ span（.ch）にした行。コードの打ち込み表示に使う。
const charLine = (className, value) => { const line = div(className); line.append(...[...value].map(char => { const span = document.createElement('span'); span.className = 'ch'; span.textContent = char; return span; })); return line; };

export function renderSlide(stage, lecture, index, images = {}, categoryOverride = null) {
  const $ = id => stage.querySelector(`#${id}`);
  const p = { lecture, index };
  const slide = lecture.slides[index];
  stage.style.setProperty('--deck-progress', `${100*(index+1)/lecture.slides.length}%`);
  // 講義ごとのCSS（LLMにおまかせのデザイン・CSSのデザインテンプレート）。なければ外す。
  const appearance = appearanceOf(lecture, slide);
  const visualLecture = { ...lecture, category: appearance.category };
  applyThemeCss(stage, appearance.css);
  const content = $('slide-content');
  content.replaceChildren();
  delete content.dataset.hemodialysis;
  delete content.dataset.wpwMotion;
  if(slide.wpwMotion)content.dataset.wpwMotion=slide.wpwMotion.kind;
  delete content.dataset.avDelay;
  if(slide.avDelay)content.dataset.avDelay=slide.avDelay.kind;
  delete content.dataset.lglMotion;
  if(slide.lglMotion)content.dataset.lglMotion=slide.lglMotion.kind;
  delete content.dataset.wpwOrigin;
  if(slide.wpwOrigin)content.dataset.wpwOrigin=slide.wpwOrigin.kind;
  delete content.dataset.wpwTypes;
  if(slide.wpwTypes)content.dataset.wpwTypes=slide.wpwTypes.kind;
  content.style.removeProperty('--intro'); content.style.removeProperty('--mark');
  content.className = `layout-${slide.layout}`;
  content.classList.toggle('is-transition', slide.transition === true);
  // 動き多め（AI Topic など）のフロー図は、矢印が伸びて箱が光る動きをつける（src/motion.js）。
  content.classList.toggle('motion-flow', slide.layout === 'flow' && hasMotion(lecture, slide));
  // 動き多めは全スライドに登場の動き（線が引かれる・横から入る）をつけ、1枚の情報量を増やせる（行が多いときは詰める）。
  const presentationMotion = usesPresentationMotion(lecture, slide);
  content.classList.toggle('motion-ai', isDense(lecture, slide) && !presentationMotion && slide.animation?.type !== 'none');
  content.classList.toggle('motion-presentation', presentationMotion);
  content.classList.toggle('motion-none', slide.animation?.type === 'none');
  content.classList.remove('motion-connectors');
  content.classList.toggle('is-dense', isDense(lecture, slide) && slide.blocks.length > 4);
  // カテゴリの配色：線と図形の色だけを差し替える（未指定のデモはCSSの既定色）。
  const category = categoryOverride ?? categoryOf(visualLecture);
  for (const key of COLOR_KEYS) {
    if (category) stage.style.setProperty(`--${key}`, category.colors[key]);
    else stage.style.removeProperty(`--${key}`);
  }
  // サムネイルにはカテゴリ名を出し、一覧でシリーズが見分けられるようにする。
  if (slide.layout === 'document') {
    renderDocument(content, slide, images, rich);
    $('eyebrow').textContent = slide.eyebrow || '';
    $('slide-number').textContent = String(index + 1).padStart(2, '0');
    $('lecture-title').textContent = plainText(lecture.slides[0].title);
    $('brand').textContent = lecture.brand || 'SAKUSURA';
    applyPlacement(stage, slide);renderShapes(stage, slide);return;
  }
  if (slide.layout === 'title' && category) {
    const tag = document.createElement('div'); tag.className = 'category-tag'; tag.textContent = category.name;
    content.append(tag);
  }
  if (slide.layout === 'title' && p.lecture.number !== undefined) {
    const number = document.createElement('div'); number.className = 'deck-number'; number.textContent = `#${String(p.lecture.number).padStart(2, '0')}`;
    content.append(number);
  }
  const heading = document.createElement('h1'); heading.dataset.element = 'title';
  // 本編（statement / flow / steps / compare）は見出し帯の左に通し番号 01, 02 … を付ける。
  if (SECTIONED.has(slide.layout)) {
    const order = p.lecture.slides.slice(0, p.index + 1).filter(item => SECTIONED.has(item.layout)).length;
    const number = document.createElement('span'); number.className = 'section-number'; number.textContent = String(order).padStart(2, '0');
    heading.append(number);
  }
  heading.append(rich('span', 'heading-text', slide.title));
  content.append(heading);
  const blocks = document.createElement('div'); blocks.className = 'blocks';
  // 表：見出し行は最初から表示し、各行（ブロック）を cue で順に出す。列数は CSS 変数で渡す。
  if (slide.layout === 'table') {
    // 行に絵がある表は、絵と見出しが1列目に並ぶため1列目を広げる。
    const first = slide.blocks.some(item => item.image) ? 'minmax(460px, 1.3fr)' : 'minmax(220px, .8fr)';
    blocks.style.setProperty('--table-grid', `${first} repeat(${slide.columns.length - 1}, 1fr)`);
    const head = document.createElement('div'); head.className = 'table-head';
    for (const column of slide.columns) head.append(rich('div', 'table-column', column));
    blocks.append(head);
  }
  for (const [index, item] of slide.blocks.entries()) {
    const block = document.createElement('div'); block.className = 'reveal'; block.dataset.block = item.id; block.dataset.element = `block:${item.id}`;
    if (NUMBERED.has(slide.layout)) { const order = document.createElement('div'); order.className = 'block-index'; order.textContent = String(index + 1).padStart(2, '0'); block.append(order); }
    const body = document.createElement('div'); body.className = 'block-body';
    // フロー図の段階・比較の列の絵（Codexが生成）。未生成なら小さな点線枠。
    if (item.image) {
      const picture = document.createElement('div'); picture.className = 'flow-image';
      const entry = images[`${slide.id}:${item.id}`];
      if (entry?.ready) { const img = document.createElement('img'); img.src = entry.url; img.alt = item.image.alt; picture.append(img); }
      else { const pending = document.createElement('div'); pending.className = 'image-pending'; pending.textContent = '画像生成待ち'; picture.append(pending); }
      body.append(picture);
    }
    if (slide.layout === 'chat') {
      // チャット：左にAI・右に質問者のアイコン（図形だけ）、吹き出しの中に文字。
      block.classList.add(`role-${item.role}`);
      const avatar = document.createElement('div'); avatar.className = 'chat-avatar'; block.append(avatar);
      if (item.label) body.append(rich('div', 'block-label', item.label));
      body.append(splitChars(rich('div', 'block-text', item.text)));
      if (item.role === 'ai') { const dots = document.createElement('div'); dots.className = 'chat-thinking'; dots.hidden = true; dots.append(...[0, 1, 2].map(() => document.createElement('span'))); body.append(dots); }
    } else if (slide.layout === 'bars') {
      // 棒グラフ：項目名・棒・数値。棒の長さは max（なければ最大値）に対する割合。
      const max = slide.max ?? Math.max(...slide.blocks.map(row => row.value));
      block.classList.toggle('is-highlight', item.highlight === true);
      const name = document.createElement('div'); name.className = 'bar-name'; name.append(rich('div', 'block-label', item.label));
      if (item.text) name.append(rich('div', 'block-detail', item.text));
      const track = document.createElement('div'); track.className = 'bar-track';
      const fill = document.createElement('div'); fill.className = 'bar-fill'; fill.style.setProperty('--ratio', String(max ? item.value / max : 0)); track.append(fill);
      const value = document.createElement('div'); value.className = 'bar-value';
      const number = document.createElement('span'); number.className = 'bar-number'; number.textContent = item.value.toLocaleString('ja-JP', { maximumFractionDigits: 6 }); value.append(number);
      if (item.unit) { const unit = document.createElement('span'); unit.className = 'bar-unit'; unit.textContent = item.unit; value.append(unit); }
      body.append(name, track, value);
    } else if (slide.layout === 'code') {
      // コード：ファイル名の見出し・行番号つきのコード・ターミナル（$ コマンド → 結果）・下に説明。
      const panel = div('code-panel'), head = div('code-head');
      head.append(div('code-dots'), rich('div', 'block-label', item.label));
      const source = div('code-body');
      for (const [number, line] of item.code.split('\n').entries()) {
        const row = div(`code-line${/^\s*(\/\/|--)/.test(line) ? ' is-comment' : ''}`);
        const count = div('code-num'); count.textContent = String(number + 1);
        row.append(count, charLine('code-src', line));
        source.append(row);
      }
      panel.append(head, source);
      if (item.command || item.output) {
        const terminal = div('code-term');
        if (item.command) { const command = charLine('term-command', item.command); const prompt = document.createElement('span'); prompt.className = 'term-prompt'; prompt.textContent = '$ '; command.prepend(prompt); terminal.append(command); }
        if (item.output) { const output = div('term-output'); output.textContent = item.output; terminal.append(output); }
        panel.append(terminal);
      }
      body.append(panel, rich('div', 'block-text', item.text));
    } else {
      // 年表：点（軸の上）と、上下交互に置く年・出来事。
      if (slide.layout === 'timeline') { block.classList.add(index % 2 ? 'is-below' : 'is-above'); block.append(div('tl-dot')); }
      for (const [key, className] of [['label', 'block-label'], ['text', 'block-text']]) if (item[key]) body.append(rich('div', className, item[key]));
    }
    // 線画アイコン（blocks[].icon、src/icons.js）。絵（block.image）がある段階は絵を優先する。
    // フロー図・年表・層の図は本文の先頭、輪の図は箱の左端に重ね、それ以外は見出し（label）の左に並べる。
    if (item.icon && !item.image && ICON_LAYOUTS.includes(slide.layout)) {
      const icon = iconElement(item.icon), label = body.querySelector('.block-label');
      if (slide.layout === 'cycle') block.append(icon);
      else if (['flow', 'timeline', 'stack'].includes(slide.layout) || !label) body.prepend(icon);
      else { const key = div('icon-key'); label.replaceWith(key); key.append(icon, label); }
      block.classList.add('has-icon');
    }
    if (slide.layout === 'table') {
      // 表の行の絵は1列目（行の見出し）の左に小さく並べ、絵と見出しで1つのセルにする。
      const picture = body.querySelector(':scope > .flow-image');
      if (picture) { const key = document.createElement('div'); key.className = 'table-key'; key.append(picture, body.querySelector(':scope > .block-label')); body.prepend(key); }
      for (const cell of item.cells ?? []) body.append(rich('div', 'block-text', cell));
    }
    block.classList.toggle('has-label', !!item.label);
    block.append(body);
    // フロー図では補足を箱の外（下）に置く。それ以外は本文の下。
    if (item.detail && slide.layout !== 'bars') (slide.layout === 'flow' ? block : body).append(rich('div', 'block-detail', item.detail));
    blocks.append(block);
  }
  blocks.classList.add(`count-${slide.blocks.length}`);
  if (slide.layout === 'timeline') blocks.prepend(div('tl-axis'));
  if (slide.layout === 'cycle') {
    // 輪の図：楕円の上にノードを時計回り（上から）に置き、中央に言葉。輪の線と光の点は src/motion.js が時刻から描く。
    const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'cycle-ring'); svg.setAttribute('viewBox', `${-CYCLE.rx - 20} ${-CYCLE.ry - 20} ${CYCLE.rx * 2 + 40} ${CYCLE.ry * 2 + 40}`);
    const base = document.createElementNS(ns, 'ellipse'); base.setAttribute('class', 'ring-base');
    for (const [key, value] of Object.entries({ cx: 0, cy: 0, rx: CYCLE.rx, ry: CYCLE.ry })) base.setAttribute(key, value);
    const arc = document.createElementNS(ns, 'path'); arc.setAttribute('class', 'ring-arc');
    svg.append(base, arc);
    [...blocks.children].forEach((element, index) => {
      const angle = (-90 + 360 * index / slide.blocks.length) * Math.PI / 180;
      element.style.left = `calc(50% + ${(CYCLE.rx * Math.cos(angle)).toFixed(1)}px)`;
      element.style.top = `calc(50% + ${(CYCLE.ry * Math.sin(angle)).toFixed(1)}px)`;
    });
    blocks.prepend(svg, div('cycle-packet'));
    if (slide.center) blocks.append(rich('div', 'cycle-center', slide.center));
  }
  if (slide.layout === 'stack') {
    // 層の図：row の大きい順（上の層から）に横一列へまとめる。
    const rows = new Map();
    [...blocks.children].forEach((element, index) => { const row = slide.blocks[index].row; if (!rows.has(row)) rows.set(row, div('stack-row')); rows.get(row).append(element); });
    blocks.replaceChildren(...[...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, row]) => row));
  }
  content.append(blocks);
  // 本文の下のまとめの一文（任意）。cue の target "note" で表示する。
  content.classList.toggle('has-note', !!slide.note);
  if (slide.note) {
    const note = rich('div', 'slide-note reveal', slide.note); note.dataset.block = 'note'; note.dataset.element = 'note';
    content.append(note);
  }
  // 一文スライドの右側の人物紹介：似顔絵（Codexが生成）＋名前＋紹介。最初から表示する。
  content.classList.toggle('has-people', !!slide.people?.length);
  if (slide.people?.length) {
    const people = document.createElement('div'); people.className = 'people';
    for (const person of slide.people) {
      const row = document.createElement('div'); row.className = 'person';
      const picture = document.createElement('div'); picture.className = 'person-image';
      const entry = images[`${slide.id}:${person.id}`];
      if (entry?.ready) { const img = document.createElement('img'); img.src = entry.url; img.alt = person.image.alt; picture.append(img); }
      else if (person.image) { const pending = document.createElement('div'); pending.className = 'image-pending'; pending.textContent = '生成待ち'; picture.append(pending); }
      const body = document.createElement('div'); body.className = 'person-body';
      body.append(rich('div', 'person-name', person.name), rich('div', 'block-text', person.text));
      row.append(picture, body);
      people.append(row);
    }
    content.append(people);
  }
  // 画像はCodexが生成。未生成の間は生成待ちの枠を表示する（REQUEST.md で依頼）。
  content.classList.toggle('has-image', !!slide.image);
  if (slide.image) {
    const figure = document.createElement('figure'); figure.className = 'slide-image'; figure.dataset.element = 'image';
    figure._crop = slide.image.crop ?? fullCrop();
    const image = images[slide.id];
    if (image?.ready) {
      // 画像の実寸比に合わせた枠を作り、ラベル（Codexが返した座標）を同じ枠の上に重ねる。
      const frame = document.createElement('div'); frame.className = 'image-frame';
      const img = document.createElement('img'); img.alt = slide.image.alt;
      img.addEventListener('load', () => fitImage(figure));
      img.src = image.url;
      const viewport = document.createElement('div'); viewport.className = 'image-viewport';
      const crop = figure._crop;
      Object.assign(img.style, { position: 'absolute', maxWidth: 'none', width: `${100 / crop.width}%`, height: `${100 / crop.height}%`, left: `${-100 * crop.x / crop.width}%`, top: `${-100 * crop.y / crop.height}%` });
      viewport.append(img); frame.append(viewport);
      for (const item of slide.image.labelPositions ?? image.labels ?? []) {
        const point = croppedPoint(item, crop);
        if (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) continue;
        const tag = document.createElement('div'); tag.className = `image-label side-${item.side}`;
        tag.style.left = `${point.x * 100}%`; tag.style.top = `${point.y * 100}%`;
        const text = document.createElement('span'); text.textContent = item.text; tag.append(text);
        frame.append(tag);
      }
      decorateAnatomy(frame,figure,slide);
      decorateConduction(frame,figure,slide);
      decorateWpwMotion(frame,figure,slide);
      decorateWpwTypes(frame,figure,slide);
      decorateLgl(frame,figure,slide);
      decorateAvDelay(frame,figure,slide);
      decorateBundlePathway(frame,figure,slide);
      decorateFascicularHeart(frame,figure,slide);
      if(slide.wpwOrigin?.kind==='regions')decorateWpwOrigin(content,frame,figure,slide);
      figure.append(frame);
    } else { const pending = document.createElement('div'); pending.className = 'image-pending'; pending.textContent = `画像生成待ち（Codex）\n${slide.image.alt}`; figure.append(pending); }
    content.append(figure);
  }
  $('eyebrow').textContent = slide.eyebrow || '';
  $('slide-number').textContent = String(p.index + 1).padStart(2, '0');
  // 左下は1枚目（サムネイル）の表題。
  $('lecture-title').textContent = plainText(p.lecture.slides[0].title);
  $('brand').textContent = p.lecture.brand || 'SAKUSURA';
  applyPlacement(stage, slide);
  decorateComposition(content, slide);
  decorateEcgVector(content, slide);
  decorateEcgMeasure(content, slide);
  decorateEcgAxis(content, slide);
  decorateEcgTransition(content, slide);
  decorateBundleBlock(content, slide);
  decorateFascicular(content, slide);
  decorateVentricularHypertrophy(content, slide);
  decorateLvhDetail(content, slide);
  decorateLvhCriteria(content, slide);
  decorateHcm(content, slide);
  decorateTrifascicular(content, slide);
  decorateRvh(content, slide);
  decorateBvh(content, slide);
  decorateAcs(content, slide);
  decorateSqlite(content, slide);
  decorateHdCircuit(content, slide);
  decorateHemodialysis(content, slide);
  decorateEcgLeads(content, slide);
  if(slide.wpwOrigin?.kind==='overview')decorateWpwOrigin(content,null,null,slide);
  if (presentationMotion) decoratePresentation(content, slide);
  renderShapes(stage, slide);
}

// 編集画面で足した図形・文字。スライド全体（1920×1080）に重ねた層に、絶対座標で置く。
// cue のある図形だけ段階表示（data-block）にし、cue のない図形は最初から表示する。
export function renderShapes(stage, slide) {
  let layer = stage.querySelector(':scope > .shape-layer');
  if (!layer) { layer = document.createElement('div'); layer.className = 'shape-layer'; stage.append(layer); }
  layer.replaceChildren();
  const cued = new Set((slide.cues ?? []).map(cue => cue.target));
  for (const shape of slide.shapes ?? []) {
    if (!SHAPE_KINDS[shape.kind]) continue;
    const element = shape.kind === 'text' ? rich('div', `shape-text size-${shape.size ?? 28}`, shape.text) : document.createElement('div');
    element.classList.add('shape', `shape-${shape.kind}`, `shape-color-${shape.color}`);
    element.dataset.element = `shape:${shape.id}`;
    if (cued.has(shape.id)) { element.classList.add('reveal'); element.dataset.block = shape.id; }
    Object.assign(element.style, { left: `${shape.x}px`, top: `${shape.y}px`, width: `${shape.width}px` });
    if (shape.height !== undefined) element.style.height = `${shape.height}px`;
    if (shape.angle) element.style.rotate = `${shape.angle}deg`;
    layer.append(element);
  }
}

