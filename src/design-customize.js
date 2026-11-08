import { designCategories, designDeck, validateDesign } from './design-theme.js';
import { DESIGN_SAMPLES } from './design-catalog.js';
import { COMPOSITIONS } from './design-compositions.js';
const $ = id => document.getElementById(id);
const option = (value, label) => { const node = document.createElement('option'); node.value = value; node.textContent = label; return node; };
const button = (label, action, disabled = false) => { const node = document.createElement('button'); node.type = 'button'; node.textContent = label; node.disabled = disabled; node.addEventListener('click', action); return node; };

export function createPresetControls({ getDraft, getCategory, setCategory, onChange, onPreviewSlot }) {
  function refreshCategories() {
    const categories = designCategories(getDraft());
    $('edit-category').replaceChildren(...Object.entries(categories).map(([id, item]) => option(id, item.name)));
    $('edit-category').value = getCategory();
    $('category-name').value = categories[getCategory()].name;
    $('delete-category').disabled = Object.keys(categories).length <= 1;
    $('add-category').disabled = Object.keys(categories).length >= 24;
  }
  $('edit-category').addEventListener('change', event => setCategory(event.target.value));
  $('category-name').addEventListener('input', event => {
    const draft = getDraft(); draft.categoryNames ??= {}; draft.categoryNames[getCategory()] = event.target.value;
    setCategory(getCategory(), false); onChange();
  });
  $('add-category').addEventListener('click', () => {
    const draft = getDraft(), name = $('new-category-name').value.trim(), normalized = value => value.trim().normalize('NFKC').toLocaleLowerCase('ja');
    if (!name || name.length > 32) { $('category-feedback').textContent = 'カテゴリ名を1〜32文字で入力してください。'; $('new-category-name').focus(); return; }
    if (Object.values(designCategories(draft)).some(item => normalized(item.name) === normalized(name))) { $('category-feedback').textContent = '同じ名前のカテゴリがあります。'; return; }
    if (Object.keys(draft.settings.categories).length >= 24) return;
    const id = `custom-${crypto.randomUUID().slice(0, 8)}`;
    draft.settings.categories[id] = structuredClone(draft.settings.categories[getCategory()]);
    draft.categoryNames ??= {}; draft.categoryNames[id] = name;
    $('new-category-name').value = ''; $('category-feedback').textContent = `「${name}」を追加しました。下の配色で調整できます。`;
    setCategory(id); onChange(); $('category-name').focus();
  });
  $('delete-category').addEventListener('click', () => {
    const draft = getDraft(); if (Object.keys(draft.settings.categories).length <= 1) return;
    delete draft.settings.categories[getCategory()]; if (draft.categoryNames) delete draft.categoryNames[getCategory()];
    setCategory(Object.keys(draft.settings.categories)[0]); onChange(); $('category-feedback').textContent = 'カテゴリを削除しました。';
  });
  const ensureDeck = () => getDraft().deck ??= designDeck(getDraft());
  function renderDeck() {
    const plan = designDeck(getDraft());
    $('deck-count').value = plan.slides.length; $('deck-seconds').value = plan.targetSeconds; $('deck-takehome-count').value = plan.takehomeCount;
    $('add-deck-slide').disabled = plan.slides.length >= 60;
    $('deck-rows').replaceChildren(...plan.slides.map((slot, index) => {
      const row = document.createElement('li'); row.dataset.slot = index;
      const number = document.createElement('span'); number.className = 'slot-number'; number.textContent = String(index + 1).padStart(2, '0');
      const layout = document.createElement('select'); layout.setAttribute('aria-label', `${index + 1}枚目のレイアウト`);
      layout.append(...DESIGN_SAMPLES.map(item => option(item.layout, item.name))); layout.value = slot.layout;
      layout.addEventListener('change', () => { const slot=ensureDeck().slides[index]; slot.layout=layout.value; delete slot.composition; renderDeck(); onChange(); onPreviewSlot(index); });
      const composition = document.createElement('select'); composition.setAttribute('aria-label', `${index + 1}枚目の配置パターン`);
      composition.append(option('', '標準の配置'), ...Object.entries(COMPOSITIONS).filter(([,item])=>item.layout===slot.layout).map(([key,item])=>option(key,item.name)));
      composition.value=slot.composition??'';
      composition.addEventListener('change',()=>{const target=ensureDeck().slides[index]; if(composition.value)target.composition=composition.value;else delete target.composition;onChange();onPreviewSlot(index);});
      const purpose = document.createElement('input'); purpose.value = slot.purpose; purpose.maxLength = 100; purpose.placeholder = '用途・見出しのひな形'; purpose.setAttribute('aria-label', `${index + 1}枚目の用途`);
      purpose.addEventListener('input', () => { const slot = ensureDeck().slides[index]; slot.purpose = purpose.value; if (slot.texts) delete slot.texts.title; onChange(); });
      const sizes = document.createElement('div'); sizes.className = 'slot-sizes';
      for (const [key, label, min, max] of [['headingSize', '見出し', 16, 160], ['bodySize', '本文', 12, 72]]) {
        const wrapper = document.createElement('label'); wrapper.append(label);
        const input = document.createElement('input'); input.type = 'number'; input.min = min; input.max = max; input.step = 1; input.value = slot[key] ?? ''; input.placeholder = '共通'; input.dataset.slotSize = key; input.setAttribute('aria-label', `${index + 1}枚目の${label}サイズ`);
        input.addEventListener('input', () => { const target = ensureDeck().slides[index]; if (input.value === '') delete target[key]; else target[key] = Number(input.value); onChange(); });
        wrapper.append(input); sizes.append(wrapper);
      }
      const actions = document.createElement('div'); actions.className = 'slot-actions';
      for (const [offset, label] of [[-1, '↑'], [1, '↓']]) {
        const move = button(label, () => { const slots = ensureDeck().slides; [slots[index], slots[index + offset]] = [slots[index + offset], slots[index]]; renderDeck(); onChange(); onPreviewSlot(index + offset); }, index + offset < 0 || index + offset >= plan.slides.length);
        move.setAttribute('aria-label', `${index + 1}枚目を${offset < 0 ? '上' : '下'}へ`); actions.append(move);
      }
      actions.append(button('見本', () => onPreviewSlot(index)), button('削除', () => { ensureDeck().slides.splice(index, 1); renderDeck(); onChange(); onPreviewSlot(Math.max(0, index - 1)); }, plan.slides.length <= 1));
      const layoutGroup=document.createElement('div'); layoutGroup.append(layout);
      if (getDraft().css?.includes('[data-composition=system]') || slot.composition) layoutGroup.append(composition);
      row.append(number, layoutGroup, purpose, sizes, actions); return row;
    }));
  }
  $('apply-deck-count').addEventListener('click', () => {
    const count = Number($('deck-count').value);
    if (!Number.isInteger(count) || count < 1 || count > 60) { $('deck-feedback').textContent = '枚数は1〜60枚で指定してください。'; return; }
    const plan = ensureDeck();
    if (count < plan.slides.length) {
      if (count > 1 && plan.slides.at(-1).layout === 'takehome') plan.slides.splice(count - 1, plan.slides.length - count);
      else plan.slides.splice(count);
    }
    while (plan.slides.length < count) plan.slides.splice(plan.slides.at(-1)?.layout === 'takehome' ? plan.slides.length - 1 : plan.slides.length, 0, { layout: 'statement', purpose: '' });
    renderDeck(); onChange(); onPreviewSlot(0); $('deck-feedback').textContent = `${count}枚に変更しました。並びと各ページの用途を調整してください。`;
  });
  $('add-deck-slide').addEventListener('click', () => { const plan = ensureDeck(); if (plan.slides.length >= 60) return; plan.slides.splice(plan.slides.at(-1)?.layout === 'takehome' ? plan.slides.length - 1 : plan.slides.length, 0, { layout: 'statement', purpose: '' }); renderDeck(); onChange(); });
  for (const [id, key] of [['deck-seconds', 'targetSeconds'], ['deck-takehome-count', 'takehomeCount']]) $(id).addEventListener('input', event => { ensureDeck()[key] = Number(event.target.value); onChange(); });
  refreshCategories(); renderDeck();
  return { refreshCategories, renderDeck };
}

export function createAiCustomization({ getDraft, pdfReference, lock, saved, resumed = null }) {
  let task = null, timer, checking = false, starting = false;
  const feedback = message => { $('ai-feedback').textContent = message; };
  const update = () => { $('start-ai-customize').disabled = starting || !!task || pdfReference.busy || !getDraft().aiInstructions?.trim() || !!validateDesign(getDraft()).length; };
  function show(value) {
    task = value; lock(true); saved(); $('ai-task-panel').hidden = false; $('ai-prompt').value = value.prompt;
    feedback('依頼を保存しました。依頼文をCLIのAIチャットに貼り付けて実行してください。完成すると新しいプリセットの編集画面を開きます。'); update();
  }
  async function check(manual = false) {
    if (!task || checking) return; checking = true; clearTimeout(timer); const id = task.id;
    try {
      const response = await fetch(`/api/design-imports?id=${encodeURIComponent(id)}`, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      if (task?.id !== id) return;
      if (result.status === 'complete') { location.assign(`/design/edit?theme=${encodeURIComponent(result.entry.id)}&category=${encodeURIComponent($('preview-category').value)}`); return; }
      if (manual) feedback('作業完了を待っています。CLIで依頼書の完了コマンドまで実行してください。');
    } catch (error) { if (task?.id === id) feedback(error.message || '完了を確認できません。「完了を確認」で再試行できます。'); }
    finally { checking = false; if (task?.id === id) timer = setTimeout(() => check(), 2500); }
  }
  $('ai-instructions').value = getDraft().aiInstructions ?? '';
  $('start-ai-customize').addEventListener('click', async () => {
    if (starting || task || validateDesign(getDraft()).length || !getDraft().aiInstructions?.trim() || pdfReference.busy) return;
    starting = true; update();
    try {
      const response = await fetch('/api/design-imports', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Editor': '1' }, body: JSON.stringify({ kind: 'customize', design: getDraft(), referencePdfId: pdfReference.id, instructions: getDraft().aiInstructions }) });
      const value = await response.json(); if (!response.ok) throw new Error(value.error);
      show(value); const url = new URL(location.href); url.searchParams.set('aiTask', value.id); history.replaceState(null, '', url); check();
    } catch (error) { feedback(error.message || '依頼を保存できません。'); }
    finally { starting = false; update(); }
  });
  $('copy-ai-prompt').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('ai-prompt').value); feedback('コピーしました。Cursor・OrcaなどのAIチャットに貼り付けて実行してください。'); }
    catch { $('ai-prompt').focus(); $('ai-prompt').select(); feedback('依頼文を選択しました。Ctrl+C（Macは⌘C）でコピーしてください。'); }
  });
  $('check-ai-task').addEventListener('click', () => check(true));
  $('resume-customize').addEventListener('click', () => {
    clearTimeout(timer); task = null; lock(false); $('ai-task-panel').hidden = true;
    const url = new URL(location.href); url.searchParams.delete('aiTask'); history.replaceState(null, '', url); update();
    feedback('画面の編集を再開しました。作成済みの依頼書は残っています。');
  });
  window.addEventListener('pagehide', () => clearTimeout(timer));
  if (resumed) { show(resumed); check(); }
  update(); return { update };
}
