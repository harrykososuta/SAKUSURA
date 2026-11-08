// 共通の動き。1枚ごとの設定は音声がなくても手動送り・予定尺で利用できる。
export const MOTION = Object.freeze({ enter: .25, link: .25, verdict: .2, focus: .25, stagger: .09, grow: .35, distance: 20, scale: .96, dim: .35 });
export const ANIMATION_TYPES = { subtle: '軽快な出現', flow: '矢印 → 要素', preview: '全体を予告', focus: '説明中に注目', limit: '上限で停止', none: '動きなし' };
export const basicLayouts = new Set(['title', 'agenda', 'statement', 'figure', 'flow', 'steps', 'compare', 'table', 'bars', 'stack', 'takehome', 'message']);
// 動き多め（lecture.motion: "rich"）。挿入したスライドは挿入元の設定（appearance）に従う。
export const richMotion = (lecture, slide) => { const source = slide?.appearance ?? lecture; return source?.motion === 'rich' || source?.category === 'ai'; };
export const usesPresentationMotion = (lecture, slide) => slide.animation?.type !== 'none' && (['subtle', 'flow', 'preview', 'focus', 'limit'].includes(slide.animation?.type) || (richMotion(lecture, slide) && basicLayouts.has(slide.layout)));
export function supportsAnimation(layout, type) {
  if (type === 'none') return true;
  if (type === 'flow') return layout === 'flow';
  if (type === 'limit') return layout === 'bars';
  if (['focus', 'preview'].includes(type)) return basicLayouts.has(layout) && !['title', 'message'].includes(layout);
  return type === 'subtle' && basicLayouts.has(layout);
}
export function validateAnimation(slide) {
  const a = slide.animation;
  if (a === undefined) return [];
  const fail = ['animation は対応する type と、必要に応じて targets・stagger・verdicts・links・limit・blockedTargets を指定します'];
  if (!a || typeof a !== 'object' || Array.isArray(a) || !supportsAnimation(slide.layout, a.type) || Object.keys(a).some(key => !['type', 'targets', 'stagger', 'verdicts', 'links', 'limit', 'blockedTargets'].includes(key))) return fail;
  const blocks = Array.isArray(slide.blocks) ? slide.blocks : [];
  const ids = new Set(blocks.map(b => b?.id));
  const targets = value => Array.isArray(value) && new Set(value).size === value.length && value.every(id => typeof id === 'string' && ids.has(id));
  if (a.type === 'flow' && (!targets(a.targets) || a.targets.length < 2)) return fail;
  if (a.targets !== undefined && a.type !== 'flow') return fail;
  if (a.stagger !== undefined && typeof a.stagger !== 'boolean') return fail;
  if (a.limit !== undefined && a.type !== 'limit') return fail;
  if (a.type === 'limit' && (!Number.isFinite(a.limit) || a.limit <= 0 || a.limit > (slide.max ?? Math.max(...blocks.map(b => b?.value))))) return fail;
  if (a.blockedTargets !== undefined && (a.type !== 'limit' || !targets(a.blockedTargets))) return fail;
  if (a.verdicts !== undefined && (!Array.isArray(a.verdicts) || new Set(a.verdicts.map(v => v?.target)).size !== a.verdicts.length || !a.verdicts.every(v => v && ids.has(v.target) && ['pass', 'fail'].includes(v.result) && Object.keys(v).every(k => ['target', 'result'].includes(k))))) return fail;
  if (a.links !== undefined && (slide.layout !== 'flow' || !Array.isArray(a.links) || new Set(a.links.map(v => v?.target)).size !== a.links.length || !a.links.every(v => v && (a.targets ?? blocks.map(b => b?.id)).slice(1).includes(v.target) && ['solid', 'dashed'].includes(v.style) && (v.result === undefined || ['pass', 'fail'].includes(v.result)) && Object.keys(v).every(k => ['target', 'style', 'result'].includes(k))))) return fail;
  if (a.type === 'none' && Object.keys(a).length !== 1) return fail;
  return [];
}
// cubic-bezier(0.22, 1, 0.36, 1)。時刻から逆算し、CSSの実時間時計を使わない。
export function motionEase(p) {
  p = Math.max(0, Math.min(1, p));
  if (p === 0 || p === 1) return p;
  const x = t => 3 * (1 - t) ** 2 * t * .22 + 3 * (1 - t) * t * t * .36 + t ** 3;
  let low = 0, high = 1;
  for (let i = 0; i < 18; i++) { const mid = (low + high) / 2; if (x(mid) < p) low = mid; else high = mid; }
  return 1 - (1 - (low + high) / 2) ** 3;
}
