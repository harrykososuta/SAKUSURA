// 編集画面で足す図形・文字（slides[].shapes）。位置と大きさは1920×1080キャンバス上の絶対座標（px）。
// 色と文字サイズは共通デザインの中からだけ選ぶ：文字はグレー2階調・28px／40px、線と図形は紺（primary）とオレンジ（accent）。
// cue は任意。cue のない図形はスライドの最初から表示し、最終チェックで「表示タイミング未設定」として知らせる。
export const SHAPE_KINDS = {
  text: { name: '文字', colors: ['strong', 'text'], width: [64, 1920] },
  rect: { name: '四角', colors: ['primary', 'accent'], width: [32, 1920], height: [32, 1080] },
  circle: { name: '丸', colors: ['primary', 'accent'], width: [32, 1920], height: [32, 1080] },
  arrow: { name: '矢印', colors: ['accent', 'primary'], width: [48, 1920], angle: true },
  line: { name: '線', colors: ['primary', 'accent'], width: [48, 1920], angle: true },
};
export const SHAPE_COLORS = { strong: '濃いグレー', text: '薄いグレー', primary: '紺', accent: 'オレンジ' };
export const SHAPE_SIZES = [28, 40];
export const SHAPES_MAX = 12;
// 線と矢印は太さ4pxの線を、つかみやすい高さ32pxの枠の縦中央に描く。
export const LINE_BOX = 32;
// 新しく足すときの既定値（本文領域の中央付近）。
export function newShape(kind, id) {
  const base = { id, kind, color: SHAPE_KINDS[kind].colors[0] };
  if (kind === 'text') return { ...base, x: 760, y: 500, width: 400, size: 28, text: '文字を入力' };
  if (kind === 'arrow' || kind === 'line') return { ...base, x: 800, y: 524, width: 320, angle: 0 };
  return { ...base, x: 800, y: 420, width: 320, height: 240 };
}
export const shapeName = shape => `${SHAPE_KINDS[shape.kind]?.name ?? '図形'}${shape.kind === 'text' ? `「${String(shape.text ?? '').replaceAll('**', '').replace(/\s+/g, ' ').slice(0, 10)}」` : ''}`;

export function validateShapes(slide) {
  if (slide.shapes === undefined) return [];
  if (!Array.isArray(slide.shapes)) return ['shapes は図形・文字の配列です'];
  const errors = [];
  if (slide.shapes.length > SHAPES_MAX) errors.push(`shapes は${SHAPES_MAX}個まで`);
  const ids = new Set();
  for (const shape of slide.shapes) {
    if (!shape || typeof shape !== 'object' || Array.isArray(shape)) { errors.push('shapes の各要素はオブジェクトです'); continue; }
    const kind = SHAPE_KINDS[shape.kind];
    const label = `shapes ${shape.id ?? '?'}`;
    if (typeof shape.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(shape.id) || ids.has(shape.id)) errors.push(`${label}: id は英数字・_・-で、重複しないこと`);
    ids.add(shape.id);
    if (!kind) { errors.push(`${label}: kind は ${Object.keys(SHAPE_KINDS).join(' / ')}`); continue; }
    const allowed = new Set(['id', 'kind', 'x', 'y', 'width', 'color', ...(kind.height ? ['height'] : []), ...(kind.angle ? ['angle'] : []), ...(shape.kind === 'text' ? ['text', 'size'] : [])]);
    for (const key of Object.keys(shape)) if (!allowed.has(key)) errors.push(`${label}: ${shape.kind} に ${key} は使えません`);
    const number = (key, [min, max]) => { if (!Number.isFinite(shape[key]) || shape[key] < min || shape[key] > max) errors.push(`${label}: ${key} は${min}〜${max}の数値`); };
    number('x', [0, 1920]); number('y', [0, 1080]); number('width', kind.width);
    if (kind.height) number('height', kind.height);
    if (kind.angle && shape.angle !== undefined) number('angle', [-180, 180]);
    if (Number.isFinite(shape.x) && Number.isFinite(shape.width) && shape.x + shape.width > 1920) errors.push(`${label}: 右端がスライドの外に出ています`);
    if (kind.height && Number.isFinite(shape.y) && Number.isFinite(shape.height) && shape.y + shape.height > 1080) errors.push(`${label}: 下端がスライドの外に出ています`);
    if (!kind.colors.includes(shape.color)) errors.push(`${label}: color は ${kind.colors.join(' / ')}（${kind.colors.map(c => SHAPE_COLORS[c]).join('・')}）`);
    if (shape.kind === 'text') {
      if (typeof shape.text !== 'string' || !shape.text.trim()) errors.push(`${label}: text が必要`);
      else if (shape.text.split('**').length % 2 === 0) errors.push(`${label}: 強調記法 ** の対応が取れていません`);
      if (shape.size !== undefined && !SHAPE_SIZES.includes(shape.size)) errors.push(`${label}: size は ${SHAPE_SIZES.join(' / ')}`);
    }
  }
  return errors;
}
