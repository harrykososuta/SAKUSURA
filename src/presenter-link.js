// 発表者ビュー（/presenter）と再生画面（スライド画面）のあいだの約束ごと。
// 2つのウィンドウは BroadcastChannel で同じPC・同じブラウザの中だけでつながる（外部へは何も送らない）。
// スライド画面が状態の持ち主で、発表者ビューは表示と操作の要求だけを行う。

export const PRESENTER_WINDOW = 'sakusura-presenter';
export const channelName = id => `sakusura-presenter:${id}`;
export const presenterUrl = (lecture, id) => `/presenter?lecture=${encodeURIComponent(lecture)}&channel=${encodeURIComponent(id)}`;
// スライド画面からの最後の連絡がこれより古ければ、接続が切れたとみなす（スライド画面は1秒ごとに状態を送る）。
export const STALE_MS = 3500;

// 発表用の手動送りで止まる時刻（LecturePlayer.step と同じ並び）。
export const cueSteps = slide => [...new Set((slide?.cues ?? []).map(cue => cue.at))].sort((a, b) => a - b);

// このスライドで、いま表示している要点の段階と、全段階の数。時刻0の要点は最初から出ている。
export function stepProgress(slide, time) {
  const steps = cueSteps(slide);
  return { shown: steps.filter(at => at <= time + 1e-6).length, total: steps.length };
}

// 次へ送ったときに表示されるもの：同じスライドの次の要点か、次のスライドの最初の状態か、もうないか。
export function nextView(lecture, index, time) {
  const slides = lecture?.slides ?? [];
  const next = cueSteps(slides[index]).find(at => at > time + 1e-6);
  if (next !== undefined) return { kind: 'step', index, time: next };
  if (index < slides.length - 1) return { kind: 'slide', index: index + 1, time: 0 };
  return { kind: 'end', index, time };
}

// 各スライドの長さ（音声があれば音声、無音リハーサルなら予定尺）と、そのスライドが始まる予定の時刻。
export const slideLength = (slide, audio, preview) => preview ? slide.plannedSeconds : (audio?.[slide.id]?.duration ?? slide.plannedSeconds);
export function plannedStart(lecture, audio, preview, index) {
  return (lecture?.slides ?? []).slice(0, index).reduce((sum, slide) => sum + slideLength(slide, audio, preview) + (slide.gapAfter ?? 0), 0);
}
export function plannedTotal(lecture, audio, preview) {
  const slides = lecture?.slides ?? [];
  return slides.reduce((sum, slide, i) => sum + slideLength(slide, audio, preview) + (i < slides.length - 1 ? slide.gapAfter ?? 0 : 0), 0);
}

// 2つの画面が同じウィンドウ（同じウィンドウのタブ）か、同じ位置・大きさで重なったウィンドウかどうか。
// frame は { x: screenX, y: screenY, w: outerWidth, h: outerHeight }。数ピクセルの差は同じとみなす。
export function sameFrame(a, b) {
  const keys = ['x', 'y', 'w', 'h'];
  if (!a || !b || !keys.every(key => Number.isFinite(a[key]) && Number.isFinite(b[key]))) return false;
  return keys.every(key => Math.abs(a[key] - b[key]) <= 4);
}

// 経過時間と予定の差。±15秒は「予定どおり」とする。
export function pace(elapsed, planned) {
  const diff = elapsed - planned;
  if (Math.abs(diff) < 15) return { kind: 'on', seconds: 0 };
  return { kind: diff > 0 ? 'behind' : 'ahead', seconds: Math.abs(diff) };
}

// 1:05 や 1:02:03 の形。ストップウォッチの表示に使う。
export function clock(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600), m = Math.floor(total / 60) % 60, s = total % 60;
  const two = value => String(value).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
}

// 発表者ビューから送れる操作。これ以外の要求や、形の合わない値はスライド画面が無視する。
// laser・ペンの線（stroke-*）・view（拡大）は、発表者ビューのスライドの上でマウスを使ったときに送る。
export const PRESENTER_COMMANDS = ['prev', 'next', 'goto', 'play', 'blackout', 'whiteout', 'laser', 'stroke-start', 'stroke-move', 'stroke-end', 'undo', 'clear', 'view'];
const finite = value => typeof value === 'number' && Number.isFinite(value);
const unit = value => finite(value) && value >= 0 && value <= 1;
const stagePoint = point => !!point && finite(point.x) && finite(point.y) && point.x >= -100 && point.x <= 2020 && point.y >= -100 && point.y <= 1180;
export const validCommand = (message, count) => {
  if (!message || message.type !== 'command' || !PRESENTER_COMMANDS.includes(message.name)) return false;
  switch (message.name) {
    case 'goto': return Number.isInteger(message.index) && message.index >= 0 && message.index < count;
    case 'laser': return (message.u === null && message.v === null) || (unit(message.u) && unit(message.v));
    case 'stroke-start': return stagePoint(message.point) && typeof message.color === 'string' && message.color.length <= 16;
    case 'stroke-move': return Array.isArray(message.points) && message.points.length <= 500 && message.points.every(stagePoint);
    case 'view': return finite(message.z) && finite(message.x) && finite(message.y);
    default: return true;
  }
};

// 拡大中の画面上の点（枠の幅・高さを1とした割合 a, b）を、スライド上の割合 u, v に直す。逆も同じ式。
export const toSlide = (view, a, b) => ({ u: (a - view.x) / view.z, v: (b - view.y) / view.z });
export const toFrame = (view, u, v) => ({ a: view.x + u * view.z, b: view.y + v * view.z });
