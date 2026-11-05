// デザインの見本文字だけを扱う。講義データや音声には適用しない。
const textPath = /^(?:title|eyebrow|note|center|columns\.[0-3]|blocks\.[0-7]\.(?:label|text|detail|code|command|output|unit|cells\.[0-1]))$/;
export function validateDesignTexts(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length <= 80 && Object.entries(value).every(([key, text]) => textPath.test(key) && typeof text === 'string' && text.length <= 6000);
}
export function applyDesignTexts(slide, values = {}) {
  for (const [path, value] of Object.entries(values)) {
    if (!textPath.test(path) || typeof value !== 'string') continue;
    const keys = path.split('.'), last = keys.pop();
    const owner = keys.reduce((item, key) => item?.[key], slide);
    if (owner && Object.hasOwn(owner, last) && typeof owner[last] === 'string') owner[last] = value;
  }
  return slide;
}
export function designTextNodes(stage) {
  const entries = [];
  function add(node, key, label) { if (node) { node.dataset.designText = key; entries.push({ node, key, label }); } }
  add(stage.querySelector('.heading-text'), 'title', '見出し');
  add(stage.querySelector('#eyebrow'), 'eyebrow', '見出し上の補足');
  add(stage.querySelector('#brand'), 'brand', 'ブランド名（全ページ）');
  [...stage.querySelectorAll('[data-element^="block:"]')].forEach((block, i) => {
    const prefix = `blocks.${i}.`;
    for (const [selector, key, label] of [['.block-label', 'label', '小見出し'], ['.block-text', 'text', '本文'], ['.block-detail', stage.querySelector('.layout-bars') ? 'text' : 'detail', '補足'], ['.code-body', 'code', 'コード'], ['.term-command', 'command', 'コマンド'], ['.term-output', 'output', '実行結果'], ['.bar-unit', 'unit', '単位']]) add(block.querySelector(selector), prefix + key, `${i + 1} · ${label}`);
    [...block.querySelectorAll('.block-text')].slice(1).forEach((node, j) => add(node, `${prefix}cells.${j}`, `${i + 1} · 表の${j + 3}列目`));
  });
  [...stage.querySelectorAll('.table-column')].forEach((node, i) => add(node, `columns.${i}`, `表の列見出し ${i + 1}`));
  add(stage.querySelector('.slide-note'), 'note', 'まとめの一文');
  add(stage.querySelector('.cycle-center'), 'center', '輪の図の中央');
  return entries.filter(entry => entry.node.textContent.trim());
}
