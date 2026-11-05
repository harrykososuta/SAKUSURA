// アニメーション（AI Topic 向け）。すべて「スライド内の音声の再生位置（秒）」から計算する。
// 独自の時計を持たないので、停止・再開・巻き戻し・動画の書き出し（1コマずつ撮影）で同じ絵になる。
//  - AI Topic の全スライド：要点が出るときに線が引かれ横から入る（enter）。一文スライド・表紙は線とマーカーが引かれる（intro）。
//  - フロー図（AI Topic のみ）：矢印が伸び、届いた箱が光る。最後に光の点が全体を流れる。
//  - チャット（chat）：質問を打ち込み、AIは「考え中」のあと1文字ずつ答える。
//  - 棒グラフ（bars）：棒が伸び、数字がカウントアップする。
//  - コード（code）：コードが打ち込まれ、コマンドを実行して結果が出る。
//  - 年表（timeline）：軸が次の出来事まで伸び、点が光って現れる。
//  - 輪の図（cycle）：輪の線が次のノードまで引かれ、光の点が回る。全部出たあと数周する。
import { plainText } from './core.js';
import { usesPresentationMotion, richMotion } from './animation.js';
import { presentationPlan, applyPresentation } from './presentation-motion.js';
import { hasEcgWaveform, ecgMotionPlan, applyEcgMotion } from './extension-stubs.js';
import { hasAnatomyFocus, anatomyMotionPlan, applyAnatomyMotion } from './extension-stubs.js';
import { hasConduction, conductionPlan, applyConduction } from './extension-stubs.js';
import { hasWpwMotion, wpwMotionPlan, applyWpwMotion } from './extension-stubs.js';
import { hasWpwTypes, wpwTypePlan, applyWpwTypes } from './extension-stubs.js';
import { hasWpwOrigin, wpwOriginPlan, applyWpwOrigin } from './extension-stubs.js';
import { hasLgl, lglPlan, applyLgl } from './extension-stubs.js';
import { hasAvDelay, avDelayPlan, applyAvDelay } from './extension-stubs.js';
import { hasHdCircuit, hdCircuitPlan, applyHdCircuit } from './hd-circuit-motion.js';
import { hasEcgVector, ecgVectorPlan, applyEcgVector } from './extension-stubs.js';
import { hasEcgLeads, ecgLeadPlan, applyEcgLeads } from './extension-stubs.js';
import { hasEcgMeasure, ecgMeasurePlan, applyEcgMeasure } from './extension-stubs.js';
import { sqlitePlan, applySqlite } from './extension-stubs.js';
import { hasEcgAxis, ecgAxisPlan, applyEcgAxis } from './extension-stubs.js';
import { hasEcgTransition, transitionPlan, applyEcgTransition } from './extension-stubs.js';
import { hasBundleBlock, bundleBlockPlan, applyBundleBlock } from './extension-stubs.js';
import { hasFascicular, fascicularPlan, applyFascicular } from './extension-stubs.js';
import { hasVentricularHypertrophy, ventricularHypertrophyPlan, applyVentricularHypertrophy } from './extension-stubs.js';
import { hasLvhDetail, lvhDetailPlan, applyLvhDetail } from './extension-stubs.js';
import { hasLvhCriteria, lvhCriteriaPlan, applyLvhCriteria } from './extension-stubs.js';
import { hasHcm, hcmPlan, applyHcm } from './extension-stubs.js';
import { hasTrifascicular, trifascicularPlan, applyTrifascicular } from './extension-stubs.js';
import { hasRvh, rvhPlan, applyRvh } from './extension-stubs.js';
import { hasBvh, bvhPlan, applyBvh } from './extension-stubs.js';
import { hasHemodialysis, hemodialysisPlan, applyHemodialysis } from './extension-stubs.js';
import {hasDocumentGroups,documentGroupPlan,applyDocumentGroups} from './document-layout.js';

const FADE = 0.25; // CSSの .reveal と同じ長さ
const LINK = 0.6; // 矢印が伸びる時間
const GLOW = 0.9; // 箱が光る時間
const THINK = 0.9; // AIの「考え中」
const GROW = 0.35; // 棒が伸びる時間
const ENTER = 0.9; // 要点の登場
const INTRO = 1.7; // 一文スライド・表紙の線とマーカー
const ORBIT = 0.9; // 輪の線が次のノードまで伸びる時間
const LAP = 2.4; // 光の点が輪を1周する時間
const MARGIN = 0.2; // 音声の終わりの手前で動きを終える
// 輪の図（cycle）の楕円。中心からの横・縦の半径（px）。slide-view.js がノードを同じ値で置く。
export const CYCLE = { rx: 440, ry: 220 };
// flow・timeline・cycle・bars の enter はアイコンがふくらんで現れる動きだけに使う（それぞれの図の動きは別にある）。
const ENTER_LAYOUTS = new Set(['agenda', 'statement', 'figure', 'steps', 'compare', 'table', 'stack', 'takehome', 'flow', 'timeline', 'cycle', 'bars']);
const typing = (length, speed, max) => Math.min(max, Math.max(0.6, length / speed));
const easeOut = p => 1 - (1 - p) ** 3;
const easeInOut = p => p < .5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;

// 医療系なども、指定したフローだけ明示的に動かせる。既存講義の既定表示は維持する。
const optedFlow = slide => slide.layout === 'flow' && slide.animation?.type === 'flow';
const flowBlocks = slide => slide.animation?.targets
  ? slide.animation.targets.map(id => slide.blocks.find(block => block.id === id)).filter(Boolean)
  : slide.blocks;
export const hasMotion = (lecture, slide) => slide.animation?.type !== 'none' && (hasDocumentGroups(slide) || hasHdCircuit(slide) || hasHemodialysis(slide) || hasEcgAxis(slide) || hasEcgTransition(slide) || hasBundleBlock(slide) || hasFascicular(slide) || hasVentricularHypertrophy(slide) || hasLvhDetail(slide) || hasLvhCriteria(slide) || hasHcm(slide) || hasTrifascicular(slide) || hasRvh(slide) || hasBvh(slide) || hasAvDelay(slide) || hasLgl(slide) || hasWpwOrigin(slide) || hasWpwTypes(slide) || hasWpwMotion(slide) || hasEcgMeasure(slide) || hasEcgLeads(slide) || hasEcgVector(slide) || hasConduction(slide) || hasAnatomyFocus(slide) || hasEcgWaveform(slide) || usesPresentationMotion(lecture, slide) || ['chat', 'bars', 'code', 'timeline', 'cycle'].includes(slide.layout) || richMotion(lecture, slide) || optedFlow(slide));

// 動きの一覧：{ kind, target, cue（きっかけのcue時刻）, start, end }。音声の終わりまでに収める。
export function motionPlan(lecture, slide, duration) {
  if(hasDocumentGroups(slide))return documentGroupPlan(slide,duration);
  if (hasHdCircuit(slide)) return hdCircuitPlan(slide, duration);
  if (hasHemodialysis(slide)) return hemodialysisPlan(slide, duration);
  if (!hasMotion(lecture, slide)) return [];
  if (usesPresentationMotion(lecture, slide)) return [...presentationPlan(lecture, slide, duration),...ecgMotionPlan(slide,duration),...anatomyMotionPlan(slide,duration),...conductionPlan(slide,duration),...wpwMotionPlan(slide,duration),...wpwTypePlan(slide,duration),...wpwOriginPlan(slide,duration),...lglPlan(slide,duration),...avDelayPlan(slide,duration),...ecgVectorPlan(slide,duration),...ecgLeadPlan(slide,duration),...ecgMeasurePlan(slide,duration),...sqlitePlan(slide,duration),...ecgAxisPlan(slide,duration),...transitionPlan(slide,duration),...bundleBlockPlan(slide,duration),...fascicularPlan(slide,duration),...ventricularHypertrophyPlan(slide,duration),...lvhDetailPlan(slide,duration),...lvhCriteriaPlan(slide,duration),...hcmPlan(slide,duration),...trifascicularPlan(slide,duration),...rvhPlan(slide,duration),...bvhPlan(slide,duration)];
  const ai = richMotion(lecture, slide);
  const flow = slide.layout === 'flow' && (ai || optedFlow(slide));
  const path = flow ? flowBlocks(slide) : [];
  const at = new Map(slide.cues.map(cue => [cue.target, cue.at]));
  const items = [];
  const add = (kind, target, cue, start, length) => { const item = { kind, target, cue, start, end: start + length }; items.push(item); return item; };
  const limit = Math.max(0, duration - MARGIN);
  if (ai && ['message', 'title'].includes(slide.layout)) add('intro', 'slide', 0, 0, INTRO);
  slide.blocks.forEach((block, index) => {
    const cue = at.get(block.id);
    if (cue === undefined) return;
    if ((ai || optedFlow(slide)) && ENTER_LAYOUTS.has(slide.layout)) add('enter', block.id, cue, cue, ENTER);
    if (flow && path.some(item => item.id === block.id)) {
      const pathIndex = path.findIndex(item => item.id === block.id);
      if (pathIndex) add('link', block.id, cue, cue, LINK);
      add('arrive', block.id, cue, cue + (pathIndex ? LINK * .75 : 0), GLOW);
    } else if (slide.layout === 'chat') {
      const length = [...plainText(block.text)].length;
      if (block.role === 'ai') { add('think', block.id, cue, cue, THINK); add('type', block.id, cue, cue + THINK, typing(length, 24, 3.5)); }
      else add('type', block.id, cue, cue, typing(length, 14, 3));
    } else if (slide.layout === 'bars') add('grow', block.id, cue, cue, GROW);
    else if (slide.layout === 'code') {
      let end = add('type', block.id, cue, cue, typing(block.code.length, 40, 4)).end;
      if (block.command) end = add('cmd', block.id, cue, end + .2, typing(block.command.length, 18, 1.5)).end;
      if (block.output) add('out', block.id, cue, end + .3, .5);
    } else if (slide.layout === 'timeline') {
      add('grow', block.id, cue, cue, LINK);
      add('arrive', block.id, cue, cue + LINK * .75, GLOW);
    } else if (slide.layout === 'cycle') {
      if (index) add('orbit', block.id, cue, cue, ORBIT);
      add('arrive', block.id, cue, cue + (index ? ORBIT * .8 : 0), GLOW);
    }
  });
  const lastEnd = () => Math.max(...items.map(item => item.end));
  const lastCue = () => Math.max(...items.map(item => item.cue));
  // フロー図の仕上げ：全部の箱が出たあと、光の点が最初の箱から最後の箱まで1回流れる。
  if (flow && path.length > 1 && items.length) {
    // 下の補足説明を血液の経路に含めず、経路だけの登場完了を待つ。
    const arrivals = items.filter(item => item.kind === 'arrive');
    const start = Math.max(...arrivals.map(item => item.end)) + .4;
    const cue = Math.max(...arrivals.map(item => item.cue));
    if (start + .7 * path.length <= limit) add('sweep', 'flow', cue, start, .7 * path.length);
  }
  // 年表の仕上げ：最後の点のあと、軸が右端まで伸びる。
  if (slide.layout === 'timeline' && items.length) add('tail', 'axis', lastCue(), lastEnd() - GLOW + .2, LINK);
  // 輪の図の仕上げ：最後のノードから最初のノードへ輪を閉じ、光の点が収まるだけ（最大2周）回る。
  if (slide.layout === 'cycle' && slide.blocks.length > 1 && items.length) {
    const cue = lastCue(), close = add('close', 'ring', cue, lastEnd() - GLOW + .2, ORBIT);
    const laps = Math.min(2, Math.floor((limit - close.end - .2) / LAP));
    if (laps > 0) add('laps', 'ring', cue, close.end + .2, LAP * laps).laps = laps;
  }
  if ((ai || optedFlow(slide)) && slide.note && at.has('note')) add('enter', 'note', at.get('note'), at.get('note'), ENTER);
  for (const item of items) { item.short = item.end > limit; item.end = Math.min(item.end, Math.max(item.start, limit)); }
  return [...items,...ecgMotionPlan(slide,duration),...anatomyMotionPlan(slide,duration),...conductionPlan(slide,duration),...wpwMotionPlan(slide,duration),...wpwTypePlan(slide,duration),...wpwOriginPlan(slide,duration),...lglPlan(slide,duration),...avDelayPlan(slide,duration),...ecgVectorPlan(slide,duration),...ecgLeadPlan(slide,duration),...ecgMeasurePlan(slide,duration),...ecgAxisPlan(slide,duration),...transitionPlan(slide,duration),...bundleBlockPlan(slide,duration),...fascicularPlan(slide,duration),...ventricularHypertrophyPlan(slide,duration),...lvhDetailPlan(slide,duration),...lvhCriteriaPlan(slide,duration),...hcmPlan(slide,duration),...trifascicularPlan(slide,duration),...rvhPlan(slide,duration),...bvhPlan(slide,duration)];
}

// 動いている時間帯（重なりはまとめる）。書き出しはこの間だけ1コマずつ撮る。
export function motionSpans(lecture, slide, duration) {
  const spans = [];
  for (const { start, end } of motionPlan(lecture, slide, duration).sort((a, b) => a.start - b.start)) {
    if (end <= start) continue;
    if (spans.length && start <= spans.at(-1)[1]) spans.at(-1)[1] = Math.max(spans.at(-1)[1], end);
    else spans.push([start, end]);
  }
  return spans;
}

// 発表用の手動送りで、時刻 at の cue から始まる動きが終わる時刻（動きがなければ at）。
export const settleTime = (lecture, slide, at, duration) => Math.max(at, ...motionPlan(lecture, slide, duration).filter(item => item.cue === at).map(item => item.end));

const progress = (item, time) => !item || time < item.start ? 0 : item.end <= item.start || time >= item.end ? 1 : (time - item.start) / (item.end - item.start);

// 表示を時刻 time の状態にする。frames（動画の書き出し）では、要点のフェードも時刻から描く。
export function applyMotion(stage, lecture, slide, time, duration, { frames = false } = {}) {
  if(hasDocumentGroups(slide)){applyDocumentGroups(stage.querySelector('#slide-content'),slide,time);return;}
  applyHdCircuit(stage.querySelector('#slide-content'),slide,time);
  applyHemodialysis(stage.querySelector('#slide-content'),slide,time);
  applySqlite(stage.querySelector('#slide-content'),slide,time,duration);
  applyEcgAxis(stage.querySelector('#slide-content'),slide,time,duration);
  applyEcgTransition(stage.querySelector('#slide-content'),slide,time,duration);
  applyBundleBlock(stage.querySelector('#slide-content'),slide,time,duration);
  applyFascicular(stage.querySelector('#slide-content'),slide,time,duration);
  applyVentricularHypertrophy(stage.querySelector('#slide-content'),slide,time,duration);
  applyLvhDetail(stage.querySelector('#slide-content'),slide,time,duration);
  applyLvhCriteria(stage.querySelector('#slide-content'),slide,time,duration);
  applyHcm(stage.querySelector('#slide-content'),slide,time,duration);
  applyTrifascicular(stage.querySelector('#slide-content'),slide,time,duration);
  applyRvh(stage.querySelector('#slide-content'),slide,time,duration);
  applyBvh(stage.querySelector('#slide-content'),slide,time,duration);
  applyEcgMotion(stage.querySelector('#slide-content'),slide,time,duration,slide.animation?.type==='none');
  applyAnatomyMotion(stage.querySelector('#slide-content'),slide,time,duration);
  applyConduction(stage.querySelector('#slide-content'),slide,time,duration);
  applyWpwMotion(stage.querySelector('#slide-content'),slide,time);
  applyWpwTypes(stage.querySelector('#slide-content'),slide,time);
  applyWpwOrigin(stage.querySelector('#slide-content'),slide,time);
  applyLgl(stage.querySelector('#slide-content'),slide,time);
  applyAvDelay(stage.querySelector('#slide-content'),slide,time);
  applyEcgVector(stage.querySelector('#slide-content'),slide,time,duration);
  applyEcgLeads(stage.querySelector('#slide-content'),slide,time,duration);
  applyEcgMeasure(stage.querySelector('#slide-content'),slide,time,duration);
  if (slide.animation?.type === 'none') { for (const el of stage.querySelectorAll('[data-block]')) { el.style.transition = 'none'; el.style.opacity = el.classList.contains('visible') ? '1' : '0'; el.style.transform = 'none'; } return; }
  if (!hasMotion(lecture, slide)) return;
  if (usesPresentationMotion(lecture, slide)) { applyPresentation(stage, lecture, slide, time, duration); return; }
  const plan = motionPlan(lecture, slide, duration);
  const find = (kind, target) => plan.find(item => item.kind === kind && item.target === target);
  const content = stage.querySelector('#slide-content');
  const blockOf = id => content.querySelector(`[data-block="${CSS.escape(id)}"]`);
  if (frames) {
    const at = new Map(slide.cues.map(cue => [cue.target, cue.at]));
    for (const element of stage.querySelectorAll('[data-block]')) {
      const p = Math.min(1, Math.max(0, (time - at.get(element.dataset.block)) / FADE));
      element.style.opacity = String(p);
      element.style.transform = `translateY(${(12 * (1 - easeOut(p))).toFixed(2)}px)`;
    }
  }
  for (const item of plan.filter(item => item.kind === 'enter')) blockOf(item.target)?.style.setProperty('--enter', easeOut(progress(item, time)).toFixed(3));
  const intro = find('intro', 'slide');
  if (intro) {
    content.style.setProperty('--intro', easeOut(Math.min(1, Math.max(0, time / (INTRO * .55)))).toFixed(3));
    content.style.setProperty('--mark', easeInOut(Math.min(1, Math.max(0, (time - INTRO * .3) / (INTRO * .7)))).toFixed(3));
  }
  if (slide.layout === 'flow' && find('arrive', flowBlocks(slide)[0]?.id)) flowMotion(content, slide, time, find);
  if (slide.layout === 'chat') for (const block of slide.blocks) chatMotion(blockOf(block.id), time, find('think', block.id), find('type', block.id));
  if (slide.layout === 'bars') for (const block of slide.blocks) barMotion(blockOf(block.id), block, progress(find('grow', block.id), time));
  if (slide.layout === 'code') for (const block of slide.blocks) codeMotion(blockOf(block.id), time, find('type', block.id), find('cmd', block.id), find('out', block.id));
  if (slide.layout === 'timeline') timelineMotion(content, slide, time, find);
  if (slide.layout === 'cycle') cycleMotion(content, slide, time, find);
}

// 箱の光の輪（広がりながら消える）。ring：0〜1 の進み、pass：光の点が通る強さ。
function glow(body, ring, pass = 0) {
  const r = ring > 0 && ring < 1 ? 1 - ring : 0, strength = Math.max(r, pass);
  body.style.boxShadow = strength ? `0 0 0 ${(4 + 18 * (r ? ring : .2)).toFixed(1)}px color-mix(in srgb, var(--accent) ${(strength * 45).toFixed(1)}%, transparent)` : '';
  body.style.borderColor = strength > .3 ? 'var(--accent)' : '';
}

function flowMotion(content, slide, time, find) {
  const path = flowBlocks(slide);
  const blocks = path.map(block => content.querySelector(`[data-block="${CSS.escape(block.id)}"]`));
  const bodies = blocks.map(element => element?.querySelector(':scope > .block-body'));
  // 光の点：箱の後ろを通り、矢印の上で見える。箱の中心を通るときは箱を光らせる。
  const sweep = find('sweep', 'flow');
  let packet = content.querySelector('.flow-packet');
  if (!packet) { packet = document.createElement('div'); packet.className = 'flow-packet'; content.querySelector('.blocks').append(packet); }
  const centers = bodies.map((body, index) => body ? { x: blocks[index].offsetLeft + body.offsetLeft + body.offsetWidth / 2, y: blocks[index].offsetTop + body.offsetTop + body.offsetHeight / 2, half: body.offsetWidth / 2 } : null);
  const s = progress(sweep, time);
  const moving = sweep && s > 0 && s < 1 && centers[0] && centers.at(-1);
  let x = 0;
  if (moving) {
    x = centers[0].x + (centers.at(-1).x - centers[0].x) * easeInOut(s);
    packet.style.transform = `translate(${x.toFixed(1)}px, ${centers[0].y.toFixed(1)}px)`;
  } else packet.style.transform = '';
  packet.style.opacity = moving ? String(Math.min(1, s * 8, (1 - s) * 8)) : '0';
  path.forEach((block, index) => {
    if (!blocks[index] || !bodies[index]) return;
    const draw = index ? easeOut(progress(find('link', block.id), time)) : 1;
    blocks[index].style.setProperty('--draw', draw.toFixed(3));
    blocks[index].style.setProperty('--spark', Math.sin(Math.PI * draw).toFixed(3));
    const pass = moving && centers[index] ? Math.max(0, 1 - Math.abs(x - centers[index].x) / centers[index].half) : 0;
    glow(bodies[index], progress(find('arrive', block.id), time), pass);
  });
}

function chatMotion(element, time, think, type) {
  if (!element) return;
  const chars = element.querySelectorAll('.ch');
  const p = progress(type, time);
  const shown = Math.floor(p * chars.length);
  chars.forEach((char, index) => {
    char.classList.toggle('is-hidden', index >= shown);
    char.classList.toggle('is-caret', p > 0 && p < 1 && index === shown - 1);
  });
  // 考え中の3つの点：時刻から上下させる（AIの吹き出しだけ）。
  const dots = element.querySelector('.chat-thinking');
  if (!dots) return;
  const thinking = think && time >= think.start && p === 0;
  dots.hidden = !thinking;
  if (thinking) [...dots.children].forEach((dot, index) => { dot.style.transform = `translateY(${(-8 * Math.max(0, Math.sin((time - think.start) * 9 - index * .9))).toFixed(1)}px)`; });
}

function barMotion(element, block, p) {
  if (!element) return;
  const eased = easeOut(p);
  element.style.setProperty('--grow', eased.toFixed(4));
  const value = element.querySelector('.bar-number');
  const decimals = (String(block.value).split('.')[1] ?? '').length;
  if (value) value.textContent = (block.value * eased).toLocaleString('ja-JP', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// 打ち込み：文字（.ch）を進みの割合だけ見せ、入力中は最後の文字に縦棒を付ける。
function typeChars(chars, p) {
  const shown = Math.floor(p * chars.length);
  chars.forEach((char, index) => {
    char.classList.toggle('is-hidden', index >= shown);
    char.classList.toggle('is-caret', p > 0 && p < 1 && index === shown - 1);
  });
}

function codeMotion(element, time, type, cmd, out) {
  if (!element) return;
  typeChars([...element.querySelectorAll('.code-src .ch')], progress(type, time));
  const command = element.querySelector('.term-command');
  if (command) {
    const p = progress(cmd, time);
    typeChars([...command.querySelectorAll('.ch')], p);
    command.style.opacity = time >= (cmd?.start ?? 0) ? '1' : '0';
  }
  const output = element.querySelector('.term-output');
  if (output) {
    const p = easeOut(progress(out, time));
    output.style.opacity = p.toFixed(3);
    output.style.translate = `0 ${(8 * (1 - p)).toFixed(1)}px`;
  }
  // まだ打ち始めていない行の行番号は薄くする（コードが上から書かれていく様子）
  const p = progress(type, time), typed = Math.floor(p * element.querySelectorAll('.code-src .ch').length);
  let start = 0;
  for (const line of element.querySelectorAll('.code-line')) { line.classList.toggle('is-waiting', p < 1 && start > typed); start += line.querySelectorAll('.ch').length; }
}

function timelineMotion(content, slide, time, find) {
  const axis = content.querySelector('.tl-axis');
  const blocks = slide.blocks.map(block => content.querySelector(`[data-block="${CSS.escape(block.id)}"]`));
  if (!axis || blocks.some(block => !block)) return;
  const width = axis.parentElement.offsetWidth;
  const xs = blocks.map(block => block.offsetLeft + block.offsetWidth / 2);
  // 軸の先端：最後に届いた点、または次の点へ伸びている途中。最後は右端まで。
  let reach = 0;
  slide.blocks.forEach((block, index) => {
    const p = easeOut(progress(find('grow', block.id), time));
    if (p > 0) reach = (index ? xs[index - 1] : 0) + (xs[index] - (index ? xs[index - 1] : 0)) * p;
    const dot = blocks[index].querySelector('.tl-dot');
    const arrive = progress(find('arrive', block.id), time);
    blocks[index].style.setProperty('--pop', easeOut(Math.min(1, p * 1.4)).toFixed(3));
    if (dot) dot.style.boxShadow = arrive > 0 && arrive < 1 ? `0 0 0 ${(4 + 20 * arrive).toFixed(1)}px color-mix(in srgb, var(--accent) ${((1 - arrive) * 50).toFixed(1)}%, transparent)` : '';
  });
  const tail = easeOut(progress(find('tail', 'axis'), time));
  if (tail > 0) reach = xs.at(-1) + (width - xs.at(-1)) * tail;
  axis.style.width = `${reach.toFixed(1)}px`;
}

function cycleMotion(content, slide, time, find) {
  const n = slide.blocks.length;
  const point = fraction => { const angle = (-90 + 360 * fraction) * Math.PI / 180; return [CYCLE.rx * Math.cos(angle), CYCLE.ry * Math.sin(angle)]; };
  // 輪の線：引き終わった位置（0〜1）。光の点：線の先端、または周回中の位置。
  let drawn = 0, packet = null;
  slide.blocks.forEach((block, index) => {
    if (!index) return;
    const p = easeInOut(progress(find('orbit', block.id), time));
    if (p > 0) drawn = (index - 1 + p) / n;
    if (p > 0 && p < 1) packet = drawn;
  });
  const close = easeInOut(progress(find('close', 'ring'), time));
  if (close > 0) drawn = (n - 1 + close) / n;
  if (close > 0 && close < 1) packet = drawn;
  const laps = find('laps', 'ring'), lp = progress(laps, time);
  if (laps && lp > 0 && lp < 1) packet = (easeInOut(lp) * laps.laps) % 1;
  const arc = content.querySelector('.ring-arc');
  if (arc) {
    const steps = Math.max(2, Math.ceil(drawn * 120));
    arc.setAttribute('d', drawn > 0 ? Array.from({ length: steps + 1 }, (_, i) => point(drawn * i / steps)).map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ') : '');
  }
  const dot = content.querySelector('.cycle-packet');
  if (dot) {
    if (packet !== null) { const [x, y] = point(packet); dot.style.translate = `${x.toFixed(1)}px ${y.toFixed(1)}px`; }
    dot.style.opacity = packet === null ? '0' : '1';
  }
  slide.blocks.forEach((block, index) => {
    const body = content.querySelector(`[data-block="${CSS.escape(block.id)}"] > .block-body`);
    if (!body) return;
    const gap = packet === null ? 1 : Math.min(Math.abs(packet - index / n), 1 - Math.abs(packet - index / n));
    glow(body, progress(find('arrive', block.id), time), Math.max(0, 1 - gap * n * 2.5));
  });
}
