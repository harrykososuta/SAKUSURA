import { ANIMATION_TYPES, supportsAnimation } from './animation.js';

export function initEditorAnimation({ current, change, preview }) {
  const $ = id => document.getElementById(id), section = document.createElement('details'); section.className = 'animation-settings';
  section.innerHTML = `<summary>動き・ビルドアップ</summary><label class="field">このページの動き<select id="animation-type"></select></label><p class="format-note">表示タイミングに合わせて組み立てます。APIキーなしでも使えます。</p><label class="animation-check"><input id="animation-stagger" type="checkbox"> 同時の項目を0.09秒ずらす</label><label id="animation-limit-field" class="field" hidden>上限値（実際の数値）<input id="animation-limit" type="number" min="0.0001" step="any" placeholder="上限を入力してください"></label><fieldset id="animation-blocked" hidden><legend>上限超過後に薄くする項目</legend><div id="animation-blocked-items"></div></fieldset><button id="animation-preview" type="button">無音で動きを確認</button>`;
  document.querySelector('.slide-properties').append(section);
  const blockSection = document.createElement('section'); blockSection.className = 'property-section'; blockSection.id = 'animation-block-options'; blockSection.hidden = true;
  blockSection.innerHTML = `<h2>この項目の演出</h2><label class="field">表示後の判定<select id="animation-verdict"><option value="">なし</option><option value="pass">✓ 成立</option><option value="fail">× 不成立</option></select></label><div id="animation-link-options" hidden><label class="field">この項目へ向かう矢印<select id="animation-link-style"><option value="solid">実線</option><option value="dashed">点線</option></select></label><label class="field">矢印の判定<select id="animation-link-result"><option value="">なし</option><option value="pass">✓ 通過</option><option value="fail">× 遮断</option></select></label></div>`;
  $('element-properties').append(blockSection);
  const get = () => current().slide;
  function ensure() {
    const s = get();
    if (!s.animation || s.animation.type === 'none') s.animation = s.layout === 'flow' ? { type: 'flow', targets: s.blocks.map(b => b.id) } : { type: 'subtle' };
    return s.animation;
  }
  function sync() {
    const { slide: s, selected } = current(); if (!s) return;
    $('animation-type').replaceChildren();
    for (const [value, label] of [['', 'おまかせ'], ...Object.entries(ANIMATION_TYPES).filter(([type]) => supportsAnimation(s.layout, type) && (type !== 'flow' || s.blocks.length > 1))]) { const option = document.createElement('option'); option.value = value; option.textContent = label; $('animation-type').append(option); }
    $('animation-type').value = s.animation?.type ?? '';
    $('animation-stagger').checked = s.animation?.stagger !== false; $('animation-stagger').disabled = s.animation?.type === 'none' || !supportsAnimation(s.layout, 'subtle');
    $('animation-limit-field').hidden = s.animation?.type !== 'limit'; $('animation-limit').value = s.animation?.limit ?? '';
    $('animation-blocked').hidden = s.animation?.type !== 'limit'; $('animation-blocked-items').replaceChildren();
    if (s.animation?.type === 'limit') for (const block of s.blocks) {
      const label = document.createElement('label'); label.className = 'animation-check'; const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = s.animation.blockedTargets?.includes(block.id) ?? false;
      checkbox.addEventListener('change', () => change(() => { const a = ensure(), ids = new Set(a.blockedTargets ?? []); if (checkbox.checked) ids.add(block.id); else ids.delete(block.id); a.blockedTargets = [...ids]; }));
      label.append(checkbox, block.label ?? block.text); $('animation-blocked-items').append(label);
    }
    const block = s.blocks.find(b => `block:${b.id}` === selected), usable = block && supportsAnimation(s.layout, 'subtle') && s.animation?.type !== 'none';
    blockSection.hidden = !usable;
    if (!usable) return;
    $('animation-verdict').value = s.animation?.verdicts?.find(v => v.target === block.id)?.result ?? '';
    const path = s.animation?.targets ?? s.blocks.map(b => b.id);
    $('animation-link-options').hidden = s.layout !== 'flow' || path.indexOf(block.id) < 1;
    const link = s.animation?.links?.find(v => v.target === block.id);
    $('animation-link-style').value = link?.style ?? 'solid'; $('animation-link-result').value = link?.result ?? '';
  }
  $('animation-type').addEventListener('change', event => change(() => {
    const s = get(), type = event.target.value, previous = s.animation ?? {};
    if (!type) { delete s.animation; return; }
    if (type === 'none') { s.animation = { type }; return; }
    s.animation = { type, ...(previous.stagger === false ? { stagger: false } : {}), ...(previous.verdicts ? { verdicts: previous.verdicts } : {}) };
    if (type === 'flow') s.animation.targets = previous.targets ?? s.blocks.map(b => b.id);
    if (s.layout === 'flow' && previous.links) s.animation.links = previous.links;
    if (type === 'limit' && previous.limit !== undefined) s.animation.limit = previous.limit;
  }));
  $('animation-stagger').addEventListener('change', event => change(() => { ensure().stagger = event.target.checked; }));
  $('animation-limit').addEventListener('change', event => change(() => { const a = ensure(); if (event.target.value === '') delete a.limit; else a.limit = Number(event.target.value); }));
  $('animation-verdict').addEventListener('change', event => change(() => { const { selected } = current(), id = selected.slice(6), a = ensure(); a.verdicts = (a.verdicts ?? []).filter(v => v.target !== id); if (event.target.value) a.verdicts.push({ target: id, result: event.target.value }); }));
  function editLink() { const { selected } = current(), id = selected.slice(6), style = $('animation-link-style').value, result = $('animation-link-result').value; change(() => { const a = ensure(); a.links = (a.links ?? []).filter(v => v.target !== id); a.links.push({ target: id, style, ...(result ? { result } : {}) }); }); }
  $('animation-link-style').addEventListener('change', editLink); $('animation-link-result').addEventListener('change', editLink);
  $('animation-preview').addEventListener('click', preview);
  return { sync };
}
