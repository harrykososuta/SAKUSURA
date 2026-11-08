import { STANDARD_DESIGN_ID, BASE_PALETTE, designCategories } from './design-theme.js';
const option = (value, label) => { const node = document.createElement('option'); node.value = value; node.textContent = label; return node; };
async function load() {
  const [bindingsResponse, designsResponse] = await Promise.all([fetch('/api/category-designs', { cache: 'no-store' }), fetch('/api/designs', { cache: 'no-store' })]);
  const config = await bindingsResponse.json(), designs = await designsResponse.json();
  if (!bindingsResponse.ok || !designsResponse.ok) throw new Error(config.error || designs.error || 'カテゴリ設定を読み込めません。');
  return { config, designs: designs.designs };
}
async function save(config) {
  const response = await fetch('/api/category-designs', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Editor': '1' }, body: JSON.stringify({ revision: config.revision, categories: config.categories }) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error); return result;
}
const designOptions = designs => [option('', '未設定'), ...designs.map(entry => option(entry.id, entry.design.name + (entry.design.pdfSource ? '（PDF原本）' : '') + (entry.folder === 'unused' ? '（使わない）' : '')))];
export async function renderCategoryAssignments(container, { onSaved = () => {} } = {}) {
  let { config, designs } = await load();
  container.className = 'category-design-panel'; container.id = 'category-assignments';
  const heading = document.createElement('h2'); heading.textContent = 'カテゴリごとに使うプリセット';
  const description = document.createElement('p'); description.textContent = 'カテゴリとデザインの対応を保存します。カテゴリを選ぶと、指定したプリセットを開きます。';
  const rows = document.createElement('div'); rows.className = 'category-assignment-rows';
  const status = document.createElement('p'); status.setAttribute('role', 'status'); status.id = 'category-assignment-status';
  function draw() {
    rows.replaceChildren(...config.categories.map(category => {
      const row = document.createElement('label'); row.textContent = category.name;
      const select = document.createElement('select'); select.dataset.assignmentCategory = category.id; select.setAttribute('aria-label', `${category.name}で使用するプリセット`); select.append(...designOptions(designs)); select.value = category.designId ?? '';
      select.addEventListener('change', () => { category.designId = select.value || null; status.textContent = '未保存の変更があります。'; });
      const open = document.createElement('a'); open.className = 'text-link'; open.textContent = '開く';
      const update = () => { open.href = `/design/detail?category=${category.id}&theme=${encodeURIComponent(category.designId || STANDARD_DESIGN_ID)}`; };
      select.addEventListener('change', update); update(); row.append(select, open); return row;
    }));
  }
  const actions = document.createElement('div'); actions.className = 'category-assignment-actions';
  const name = document.createElement('input'); name.placeholder = '新しいカテゴリ名'; name.maxLength = 32; name.setAttribute('aria-label', '追加するカテゴリ名');
  const add = document.createElement('button'); add.type = 'button'; add.className = 'view-badge'; add.textContent = '＋ カテゴリを追加';
  add.addEventListener('click', () => {
    const value = name.value.trim(); if (!value) { name.focus(); return; }
    if (config.categories.some(item => item.name.trim().normalize('NFKC') === value.normalize('NFKC'))) { status.textContent = '同じカテゴリ名があります。'; return; }
    if (config.categories.length >= 48) { status.textContent = 'カテゴリは48種類までです。'; return; }
    config.categories.push({ id: `custom-${crypto.randomUUID().slice(0, 8)}`, name: value, designId: null }); name.value = ''; draw(); status.textContent = '追加したカテゴリと対応を保存してください。';
  });
  const commit = document.createElement('button'); commit.type = 'button'; commit.className = 'design-primary-link'; commit.textContent = 'カテゴリの設定を保存'; commit.id = 'save-category-assignments';
  commit.addEventListener('click', async () => { commit.disabled = true; try { config = await save(config); draw(); status.textContent = 'カテゴリと使用するプリセットを保存しました。'; await onSaved(); } catch (error) { status.textContent = error.message; } finally { commit.disabled = false; } });
  actions.append(name, add, commit); container.append(heading, description, rows, actions, status); draw();
}
export async function wireCategoryAssignment(select, entry) {
  let { config, designs } = await load();
  if (entry.design.pdfSource) for (const category of config.categories) if (![...select.options].some(item => item.value === category.id)) select.append(option(category.id, category.name));
  const panel = document.createElement('div'); panel.className = 'category-use-setting';
  const heading = document.createElement('h3'); heading.id = 'category-use-title'; panel.setAttribute('aria-labelledby', heading.id);
  const current = document.createElement('p'); current.className = 'category-current';
  const currentLabel = document.createElement('span'); currentLabel.textContent = '現在使用中';
  const currentName = document.createElement('strong'); current.append(currentLabel, currentName);
  const advanced = document.createElement('details'); advanced.className = 'category-use-advanced';
  const summary = document.createElement('summary'); summary.textContent = '別のデザインを選ぶ'; advanced.append(summary);
  const label = document.createElement('label'); label.textContent = '使用するデザイン';
  const choice = document.createElement('select'); choice.id = 'category-use-preset'; choice.append(...designOptions(designs)); label.append(choice);
  advanced.append(label);
  const commit = document.createElement('button'); commit.type = 'button'; commit.className = 'category-use-button'; commit.id = 'assign-current-category';
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  let saving = false;
  function buttonState() {
    const assigned = config.categories.find(item => item.id === select.value)?.designId;
    const same = (assigned || '') === choice.value;
    commit.disabled = saving || same; choice.disabled = saving;
    commit.textContent = same ? 'このカテゴリで使用中 ✓' : choice.value === entry.id ? 'このデザインを使う' : '選んだデザインを使う';
  }
  const update = () => {
    // カテゴリのない版の「標準」配色はカテゴリではないため、使用設定を出さない（カテゴリはデザイン一覧で追加する）。
    panel.hidden = select.value === BASE_PALETTE && !config.categories.some(item => item.id === BASE_PALETTE);
    const categoryName = select.selectedOptions[0]?.textContent || select.value;
    heading.textContent = `${categoryName}で使う`;
    const assigned = config.categories.find(item => item.id === select.value)?.designId;
    currentName.textContent = designs.find(item => item.id === assigned)?.design.name || '未設定';
    choice.value = entry.id; status.textContent = ''; buttonState();
  };
  choice.addEventListener('change', buttonState);
  select.addEventListener('change', event => {
    update(); const binding = config.categories.find(item => item.id === select.value);
    if (binding?.designId && binding.designId !== entry.id) { event.stopImmediatePropagation(); location.assign(`/design/detail?theme=${encodeURIComponent(binding.designId)}&category=${encodeURIComponent(binding.id)}`); }
  }, true);
  commit.addEventListener('click', async () => {
    if (saving) return;
    saving = true; buttonState();
    try {
      const pending = structuredClone(config);
      let category = pending.categories.find(item => item.id === select.value);
      if (!category) { category = { id: select.value, name: designCategories(entry.design)[select.value].name, designId: null }; pending.categories.push(category); }
      category.designId = choice.value || null; config = await save(pending); update(); status.textContent = 'カテゴリの設定を保存しました。';
      if (category.designId && category.designId !== entry.id) location.assign(`/design/detail?theme=${encodeURIComponent(category.designId)}&category=${encodeURIComponent(category.id)}`);
    } catch (error) { status.textContent = error.message; } finally { saving = false; buttonState(); }
  });
  panel.append(heading, current, commit, advanced, status); document.querySelector('.theme-summary').prepend(panel); update(); return { refresh: update };
}
