// 全画面プレゼン中のスケッチ（P）と拡大（Z・ホイール）。
// 線は 1920×1080 のステージ座標で持つので、画面サイズや拡大率が変わっても図とずれない。
// どちらも発表中だけの一時的なもので、lecture.json や動画の書き出しには影響しない。全画面を抜けると消える。
const STAGE_WIDTH = 1920, STAGE_HEIGHT = 1080;
const ZOOM_MAX = 4, ZOOM_TOGGLE = 2, DRAG_THRESHOLD_PX = 5;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// view の x, y はスライド左上のずれ（スライドの幅・高さを1とした割合）。スライドの外が見えないように制限する。
export const DEFAULT_VIEW = Object.freeze({ z: 1, x: 0, y: 0 });
// ペンの色。順番が数字キー（1〜5）に対応する。白は暗い背景のスライド用。
export const PEN_COLORS = Object.freeze([
  { id: 'red', label: '赤', value: '#e5252a' },
  { id: 'blue', label: '青', value: '#1f6fe5' },
  { id: 'green', label: '緑', value: '#12a150' },
  { id: 'black', label: '黒', value: '#222222' },
  { id: 'white', label: '白', value: '#ffffff' },
]);
export const clampView = ({ z, x, y }) => {
  const zoom = clamp(z, 1, ZOOM_MAX);
  return { z: zoom, x: clamp(x, 1 - zoom, 0), y: clamp(y, 1 - zoom, 0) };
};
// u, v（スライド上の割合）の点を動かさずに拡大率を変える。
export const zoomAt = (view, u, v, z) => {
  const next = clamp(z, 1, ZOOM_MAX), ratio = next / view.z;
  return clampView({ z: next, x: u - (u - view.x) * ratio, y: v - (v - view.y) * ratio });
};
export const stageTransform = (view, base, width, height) => view.z === 1 ? `scale(${base})` : `translate(${view.x * width}px, ${view.y * height}px) scale(${base * view.z})`;
export const strokePath = points => points.length ? `M${points[0].x} ${points[0].y}${(points.length > 1 ? points.slice(1) : points).map(p => `L${p.x} ${p.y}`).join('')}` : '';

export function initPresentationTools({ shell, stage, layer, presenting, autoplaying, onViewChange, onStrokesChange = () => {} }) {
  const strokes = new Map();
  let view = DEFAULT_VIEW, pen = false, color = PEN_COLORS[0], slideId = null, drawing = null, remote = null, panning = null, panned = false, mouse = null, animationTimer = 0;

  const slideStrokes = () => { if (!strokes.has(slideId)) strokes.set(slideId, []); return strokes.get(slideId); };
  const pathOf = stroke => {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', strokePath(stroke.points));
    path.setAttribute('stroke', stroke.value);
    return path;
  };
  const redraw = () => { layer.replaceChildren(...slideStrokes().map(pathOf)); onStrokesChange(); };
  const setView = next => { view = next; onViewChange(); };
  const stopAnimation = () => { clearTimeout(animationTimer); stage.classList.remove('zoom-animating'); };
  const resetZoom = () => { stopAnimation(); if (view.z > 1) setView(DEFAULT_VIEW); };
  const setPen = value => { pen = value; drawing = null; document.body.classList.toggle('pointer-pen', pen); };
  const shellPoint = event => {
    const rect = shell.getBoundingClientRect();
    return { u: clamp((event.clientX - rect.left) / rect.width, 0, 1), v: clamp((event.clientY - rect.top) / rect.height, 0, 1) };
  };
  const stagePoint = event => {
    const rect = stage.getBoundingClientRect();
    return { x: +((event.clientX - rect.left) / rect.width * STAGE_WIDTH).toFixed(1), y: +((event.clientY - rect.top) / rect.height * STAGE_HEIGHT).toFixed(1) };
  };

  document.addEventListener('pointermove', event => { mouse = event; });
  shell.addEventListener('pointerdown', event => {
    panned = false;
    if (!presenting() || event.button !== 0) return;
    if (pen) {
      const stroke = { value: color.value, points: [stagePoint(event)] };
      slideStrokes().push(stroke);
      drawing = { points: stroke.points, path: pathOf(stroke) };
      layer.append(drawing.path);
      shell.setPointerCapture(event.pointerId);
    } else if (view.z > 1) {
      const rect = shell.getBoundingClientRect();
      panning = { startX: event.clientX, startY: event.clientY, view, width: rect.width, height: rect.height };
      shell.setPointerCapture(event.pointerId);
    }
  });
  shell.addEventListener('pointermove', event => {
    if (drawing) {
      for (const item of event.getCoalescedEvents?.() ?? [event]) drawing.points.push(stagePoint(item));
      drawing.path.setAttribute('d', strokePath(drawing.points));
    } else if (panning) {
      const dx = event.clientX - panning.startX, dy = event.clientY - panning.startY;
      if (!panned && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD_PX) return;
      panned = true;
      setView(clampView({ ...panning.view, x: panning.view.x + dx / panning.width, y: panning.view.y + dy / panning.height }));
    }
  });
  const endDrag = () => { const drew = !!drawing; drawing = null; panning = null; if (drew) onStrokesChange(); };
  shell.addEventListener('pointerup', endDrag);
  shell.addEventListener('pointercancel', endDrag);
  // 画像をつかむブラウザ標準のドラッグが始まると、線や移動が途中で切れる。
  shell.addEventListener('dragstart', event => { if (presenting()) event.preventDefault(); });
  // 音声付き再生中はホイールに反応しない（収録中に手が当たっても拡大しない）。Z は明示の操作なので使える。
  document.addEventListener('wheel', event => {
    if (!presenting() || event.ctrlKey || autoplaying()) return;
    stopAnimation();
    const { u, v } = shellPoint(event), delta = event.deltaY * (event.deltaMode ? 16 : 1), zoom = view.z * Math.exp(-delta * .0015);
    setView(zoomAt(view, u, v, zoom < 1.02 ? 1 : zoom));
  }, { passive: true });

  return {
    get view() { return view; },
    transform: (base, width, height) => stageTransform(view, base, width, height),
    // ペン中のクリックや、拡大中のドラッグ移動の直後のクリックではスライドを送らない。
    takeClick() { const consumed = pen || panned; panned = false; return consumed; },
    get pen() { return pen; },
    setPen,
    togglePen() { setPen(!pen); },
    get color() { return color.id; },
    setColor(id) { color = PEN_COLORS.find(item => item.id === id) ?? color; },
    undo() { slideStrokes().pop(); drawing = null; remote = null; redraw(); },
    // 発表者ビュー（別ウィンドウ）から送られた線・拡大。座標はステージ座標（1920×1080）。
    beginStroke(point, colorId) {
      const stroke = { value: (PEN_COLORS.find(item => item.id === colorId) ?? color).value, points: [point] };
      slideStrokes().push(stroke);
      remote = { points: stroke.points, path: pathOf(stroke) };
      layer.append(remote.path);
    },
    extendStroke(points) { if (!remote) return; remote.points.push(...points); remote.path.setAttribute('d', strokePath(remote.points)); },
    endStroke() { if (!remote) return; remote = null; onStrokesChange(); },
    get strokes() { return slideStrokes().map(stroke => ({ value: stroke.value, d: strokePath(stroke.points) })); },
    applyView(next) { stopAnimation(); setView(clampView(next)); },
    clear() { strokes.set(slideId, []); drawing = null; remote = null; redraw(); },
    // 操作バーのボタンから呼ぶときは、マウスがバーの上にあるので画面の中央を拡大する。
    toggleZoom({ center = false } = {}) {
      stage.classList.add('zoom-animating');
      clearTimeout(animationTimer);
      animationTimer = setTimeout(stopAnimation, 220);
      const { u, v } = mouse && !center ? shellPoint(mouse) : { u: .5, v: .5 };
      setView(view.z > 1 ? DEFAULT_VIEW : zoomAt(view, u, v, ZOOM_TOGGLE));
    },
    resetZoom,
    slideChanged(id) {
      slideId = id; drawing = null; remote = null; panning = null;
      resetZoom();
      redraw();
    },
    reset() {
      strokes.clear(); setPen(false); remote = null; panning = null; panned = false;
      resetZoom();
      redraw();
    },
  };
}
