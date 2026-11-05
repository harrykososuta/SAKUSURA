import { MOTION, motionEase } from './animation.js';
import { compositionEdges, drawCompositionLinks } from './design-compositions.js';

const clamp = value => Math.max(0, Math.min(1, value));
export const itemProgress = (item, time) => !item || time < item.start ? 0 : item.end <= item.start ? 1 : clamp((time - item.start) / (item.end - item.start));
const pathOf = slide => (slide.animation?.targets ?? slide.blocks.map(b => b.id)).map(id => slide.blocks.find(b => b.id === id)).filter(Boolean);
export function presentationPlan(lecture, slide, duration) {
  const a = slide.animation ?? {}, items = [], at = new Map(slide.cues.map(c => [c.target, c.at]));
  const add = (kind, target, cue, start, length) => { const item = { kind, target, cue, start, end: start + length }; items.push(item); return item; };
  const groups = new Map(), entries = new Map();
  const ordered = slide.layout === 'flow' ? [...pathOf(slide), ...slide.blocks.filter(b => !pathOf(slide).includes(b))] : slide.blocks;
  const path = slide.layout === 'flow' && !slide.composition ? pathOf(slide) : [];
  for (const block of ordered) {
    const cue = at.get(block.id); if (cue === undefined) continue;
    const count = groups.get(cue) ?? 0; groups.set(cue, count + 1);
    let start = cue + (a.stagger === false ? 0 : count * MOTION.stagger);
    if (compositionEdges(slide).some(([,target]) => slide.blocks[target]?.id === block.id)) start = add('link', block.id, cue, start, MOTION.link).end;
    const step = path.findIndex(b => b.id === block.id);
    if (step > 0) {
      start = Math.max(start, entries.get(path[step - 1].id)?.end ?? 0);
      start = add('link', block.id, cue, start, MOTION.link).end;
    }
    const enter = add('enter', block.id, cue, start, MOTION.enter); entries.set(block.id, enter);
    if (step >= 0) add('arrive', block.id, cue, enter.end, .2);
    if (slide.layout === 'bars' && a.type !== 'focus') {
      const grow = add('grow', block.id, cue, start, MOTION.grow);
      if (a.type === 'limit' && block.value > a.limit) add('hit', block.id, cue, grow.end, MOTION.verdict);
    }
    const verdict = a.verdicts?.find(v => v.target === block.id);
    if (verdict) add('verdict', block.id, cue, enter.end + .08, MOTION.verdict);
    if (step > 0 && a.links?.some(link => link.target === block.id && link.result)) add('linkVerdict', block.id, cue, enter.end + .08, MOTION.verdict);
  }
  for (const cue of slide.cues.filter(c => !entries.has(c.target))) add('enter', cue.target, cue.at, cue.at, MOTION.enter);
  if (['title', 'message'].includes(slide.layout)) add('intro', 'slide', 0, 0, .35);
  if (a.type === 'focus') for (const cue of new Set(slide.cues.filter(c => entries.has(c.target)).map(c => c.at))) add('focus', 'slide', cue, cue, MOTION.focus);
  if (path.length > 1) {
    const arrivals = items.filter(i => i.kind === 'arrive');
    const start = Math.max(0, ...arrivals.map(i => i.end)) + .15;
    if (arrivals.length && start + path.length * .35 <= duration - .2) add('sweep', 'flow', Math.max(...arrivals.map(i => i.cue)), start, path.length * .35);
  }
  const limit = Math.max(0, duration - .2);
  for (const item of items) {
    // 終端の余白より発話のcueを優先する。遅いcueは瞬時表示に縮め、言及前に出さない。
    const cap = Math.max(item.cue, limit);
    item.short = item.end > cap; item.start = Math.max(item.cue, Math.min(item.start, cap)); item.end = Math.max(item.start, Math.min(item.end, cap));
  }
  return items;
}

const ns = 'http://www.w3.org/2000/svg';
function svg(tag, attributes = {}) { const node = document.createElementNS(ns, tag); for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value); return node; }
function verdictIcon(result) {
  const node = svg('svg', { viewBox: '0 0 32 32', 'aria-hidden': 'true' });
  node.append(svg('path', { d: result === 'pass' ? 'M6 16 13 23 26 9' : 'M8 8 24 24 M24 8 8 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })); return node;
}
// 静止プレビューとサムネイルでは完成状態を表示する。動きはapplyで同じDOMに設定する。
export function decoratePresentation(content, slide) {
  const a = slide.animation ?? {};
  for (const block of slide.blocks) {
    const el = [...content.querySelectorAll('[data-block]')].find(e => e.dataset.block === block.id), body = el?.querySelector(':scope > .block-body');
    if (!el || !body) continue;
    if (a.type === 'preview') { const ghost = document.createElement('div'); ghost.className = 'motion-placeholder'; ghost.setAttribute('aria-hidden', 'true'); el.append(ghost); }
    const verdict = a.verdicts?.find(v => v.target === block.id);
    if (verdict) { const badge = document.createElement('span'); badge.className = 'motion-verdict'; badge.setAttribute('aria-label', verdict.result === 'pass' ? '成立' : '不成立'); badge.append(verdictIcon(verdict.result)); body.append(badge); }
    if (a.type === 'limit' && Number.isFinite(a.limit) && a.limit > 0) {
      const track = el.querySelector('.bar-track'), max = slide.max ?? Math.max(...slide.blocks.map(b => b.value));
      if (!track) continue;
      const line = document.createElement('span'); line.className = 'bar-limit'; line.style.left = `${a.limit / max * 100}%`; line.setAttribute('aria-label', `上限 ${a.limit}`); track.append(line);
      line.dataset.label = `上限 ${a.limit}`;
      if (block.value > a.limit) {
        const badge = document.createElement('span'); badge.className = 'motion-limit-hit'; badge.style.left = `${a.limit / max * 100}%`; badge.append(verdictIcon('fail')); track.append(badge);
        const requested = document.createElement('span'); requested.className = 'bar-requested'; requested.textContent = `要求 ${block.value.toLocaleString('ja-JP')}${block.unit ?? ''}`; el.querySelector('.bar-value').append(requested);
        el.querySelector('.bar-fill').style.setProperty('--ratio', String(a.limit / max));
        el.querySelector('.bar-number').textContent = a.limit.toLocaleString('ja-JP');
      }
    }
  }
}

export function applyPresentation(stage, lecture, slide, time, duration) {
  const content = stage.querySelector('#slide-content'); if (!content) return;
  const a = slide.animation ?? {}, plan = presentationPlan(lecture, slide, duration);
  const find = (kind, target) => plan.find(i => i.kind === kind && i.target === target);
  const at = new Map(slide.cues.map(c => [c.target, c.at]));
  const blockIds = new Set(slide.blocks.map(b => b.id));
  const cues = [...new Set(slide.cues.filter(c => blockIds.has(c.target)).map(c => c.at))].sort((x, y) => x - y);
  const latest = cues.findLast(c => c <= time), prior = cues.filter(c => c < latest).at(-1);
  const focus = latest === undefined ? 0 : motionEase(clamp((time - latest) / MOTION.focus));
  const hit = plan.filter(i => i.kind === 'hit' && time >= i.start).sort((x, y) => x.start - y.start)[0];
  for (const el of stage.querySelectorAll('[data-block]')) {
    const id = el.dataset.block, enter = find('enter', id), p = motionEase(itemProgress(enter, time));
    const isBlock = blockIds.has(id), preview = a.type === 'preview' && isBlock, spotlight = a.type === 'focus' && isBlock;
    let opacity = p;
    if (spotlight) opacity = at.get(id) === latest ? MOTION.dim + (1 - MOTION.dim) * focus : at.get(id) === prior ? 1 - (1 - MOTION.dim) * focus : MOTION.dim;
    if (hit && a.blockedTargets?.includes(id)) opacity *= 1 - (1 - MOTION.dim) * motionEase(itemProgress(hit, time));
    const separate = preview || (slide.layout === 'flow' && isBlock);
    if (preview) { el.style.borderColor = p < 1 ? 'transparent' : ''; el.style.setProperty('--decoration', String(p)); }
    el.style.transition = 'none'; el.style.opacity = String(separate ? (spotlight ? opacity : 1) : opacity);
    el.style.transform = separate || spotlight ? 'none' : `translateY(${(MOTION.distance * (1 - p)).toFixed(3)}px) scale(${(MOTION.scale + (1 - MOTION.scale) * p).toFixed(4)})`;
    if (separate) for (const child of el.children) {
      if (child.classList.contains('motion-placeholder')) { child.style.opacity = String(1 - p); continue; }
      child.style.opacity = String(spotlight ? 1 : p); child.style.transform = spotlight ? 'none' : `translateY(${(MOTION.distance * (1 - p)).toFixed(3)}px) scale(${(MOTION.scale + (1 - MOTION.scale) * p).toFixed(4)})`;
    }
    if (spotlight) el.style.scale = (1 + .02 * (at.get(id) === latest ? focus : at.get(id) === prior ? 1 - focus : 0)).toFixed(4);
    const badge = el.querySelector('.motion-verdict');
    if (badge) { const q = itemProgress(find('verdict', id), time); badge.style.opacity = q > 0 ? '1' : '0'; badge.style.scale = String(q < .65 ? 1.15 * motionEase(q / .65) : 1.15 - .15 * motionEase((q - .65) / .35)); }
    if (slide.layout === 'bars' && isBlock) {
      const block = slide.blocks.find(b => b.id === id), grow = a.type === 'focus' ? 1 : motionEase(itemProgress(find('grow', id), time));
      el.style.setProperty('--grow', String(grow));
      const number = el.querySelector('.bar-number'), value = a.type === 'limit' && Number.isFinite(a.limit) && a.limit > 0 ? Math.min(block.value, a.limit) : block.value;
      const digits = (String(value).split('.')[1] ?? '').length;
      if (number) number.textContent = (value * grow).toLocaleString('ja-JP', { minimumFractionDigits: digits, maximumFractionDigits: digits });
      const badge = el.querySelector('.motion-limit-hit');
      if (badge) { const q = itemProgress(find('hit', id), time); badge.style.opacity = String(q > 0 ? 1 : 0); badge.style.scale = String(motionEase(q)); }
    }
  }
  const intro = find('intro', 'slide');
  if (intro) { const p = motionEase(itemProgress(intro, time)); content.style.setProperty('--intro', String(p)); content.style.setProperty('--mark', String(p)); }
  if (slide.composition) drawCompositionLinks(content, slide, time, find);
  else if (slide.layout === 'flow') drawFlow(content, slide, time, find);
}

function drawFlow(content, slide, time, find) {
  const blocks = content.querySelector('.blocks'), path = pathOf(slide);
  const elements = path.map(b => [...blocks.querySelectorAll('[data-block]')].find(e => e.dataset.block === b.id));
  const bodies = elements.map(e => e?.querySelector(':scope > .block-body'));
  if (bodies.some(b => !b)) return;
  // SVGはsubgridの外に置く。格子の子にするとブラウザが各箱のスクロール範囲まで広げてしまう。
  let layer = content.querySelector(':scope > .flow-connectors');
  if (!layer) { layer = svg('svg', { class: 'flow-connectors', 'aria-hidden': 'true' }); content.append(layer); content.classList.add('motion-connectors'); }
  Object.assign(layer.style, { left: `${blocks.offsetLeft}px`, top: `${blocks.offsetTop}px`, width: `${blocks.clientWidth}px`, height: `${blocks.clientHeight}px`, right: 'auto', bottom: 'auto' });
  layer.setAttribute('viewBox', `0 0 ${blocks.clientWidth} ${blocks.clientHeight}`); layer.replaceChildren();
  const centers = bodies.map((body, i) => ({ x: elements[i].offsetLeft + body.offsetLeft + body.offsetWidth / 2, y: elements[i].offsetTop + body.offsetTop + body.offsetHeight / 2, half: body.offsetWidth / 2 }));
  path.forEach((block, i) => {
    if (!i) return;
    const from = centers[i - 1], to = centers[i], start = from.x + from.half + 8, end = to.x - to.half - 8;
    const p = motionEase(itemProgress(find('link', block.id), time)), x = start + (end - start) * p;
    const length = Math.max(0, end - start), line = svg('path', { d: `M${start} ${from.y} H${end}`, 'stroke-dasharray': length, 'stroke-dashoffset': length * (1 - p), class: 'flow-link-line' });
    const tip = svg('path', { d: `M${x - 9} ${from.y - 7} L${x} ${from.y} L${x - 9} ${from.y + 7}`, opacity: p > 0 ? 1 : 0, class: 'flow-link-tip' });
    const settings = slide.animation?.links?.find(link => link.target === block.id);
    if (settings?.style === 'dashed') {
      const clipId = `flow-clip-${slide.id}-${i}`, defs = svg('defs'), clip = svg('clipPath', { id: clipId, clipPathUnits: 'userSpaceOnUse' });
      clip.append(svg('rect', { x: start, y: 0, width: length * p, height: blocks.clientHeight })); defs.append(clip); layer.append(defs);
      line.setAttribute('stroke-dasharray', '7 7'); line.setAttribute('stroke-dashoffset', '0'); line.setAttribute('clip-path', `url(#${clipId})`);
    }
    layer.append(line, tip);
    if (settings?.result) {
      const q = itemProgress(find('linkVerdict', block.id), time), s = q < .65 ? 1.15 * motionEase(q / .65) : 1.15 - .15 * motionEase((q - .65) / .35);
      const badge = svg('g', { transform: `translate(${(start + end) / 2} ${from.y}) scale(${s})`, opacity: q > 0 ? 1 : 0, class: 'flow-link-verdict' });
      badge.append(svg('circle', { r: 19, fill: 'var(--paper)', stroke: 'var(--accent)', 'stroke-width': 2 }));
      const icon = verdictIcon(settings.result); icon.setAttribute('x', '-14'); icon.setAttribute('y', '-14'); icon.setAttribute('width', '28'); icon.setAttribute('height', '28'); badge.append(icon); layer.append(badge);
    }
  });
  const sweep = find('sweep', 'flow'), p = itemProgress(sweep, time);
  if (sweep && p > 0 && p < 1) {
    const f = p * (centers.length - 1), i = Math.min(centers.length - 2, Math.floor(f)), local = f - i;
    const x = centers[i].x + (centers[i + 1].x - centers[i].x) * local, y = centers[i].y + (centers[i + 1].y - centers[i].y) * local;
    layer.append(svg('circle', { cx: x, cy: y, r: 6, class: 'flow-light' }));
  }
}
