// 編集・再生画面のスライド選択。ヘッダーのボタンから、ライブラリと同じカテゴリ・フォルダーの構成をエクスプローラーのように開いて選ぶ。
// 選んだスライドは、隠してある従来の選択欄（#lecture-select）に入れて change を送る。未保存の確認や読み込みは editor.js / player.js の従来の処理に任せる。
// フォルダーの開閉はライブラリと同じ保存先（sakusura-library-expanded）を使う。
const $ = id => document.getElementById(id);
const make = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; };
const EXPANDED = 'sakusura-library-expanded';
const numberLabel = value => value ? `#${String(value).padStart(2, '0')}` : '';
function folderIcon() {
  const holder = make('span'); holder.innerHTML = '<svg class="browser-folder-icon" viewBox="0 0 26 22" aria-hidden="true"><path d="M2 18.5V4.5a2 2 0 0 1 2-2h6l3 3h9a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2Z"/><path d="M2 8h22"/></svg>';
  return holder.firstChild;
}

export function initLectureBrowser({ select, currentLabel = '編集中' }) {
  let data = null, place = { category: 'all', folder: null }, chosen = null;
  const dialog = $('lecture-browser');
  const expanded = new Set((() => { try { return JSON.parse(localStorage.getItem(EXPANDED) ?? '[]'); } catch { return []; } })());
  const saveExpanded = () => { try { localStorage.setItem(EXPANDED, JSON.stringify([...expanded])); } catch {} };
  const category = id => data.categories.find(item => item.id === id);
  const folder = id => data.folders.find(item => item.id === id);
  const within = (id, ancestor) => { for (let item = folder(id); item; item = folder(item.parentId)) if (item.id === ancestor) return true; return false; };
  const childFolders = (parentId, categoryId) => data.folders.filter(item => item.parentId === parentId && item.category === categoryId).sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  const lectureCount = (categoryId, folderId) => data.lectures.filter(item => item.category === categoryId && (!folderId || (item.folderId && within(item.folderId, folderId)))).length;
  const dot = categoryId => { const el = make('span', 'browser-dot'); el.style.setProperty('--category-color', category(categoryId)?.color ?? '#738097'); return el; };
  const sortLectures = list => list.sort((a, b) => String(a.number ?? '').localeCompare(String(b.number ?? ''), 'ja', { numeric: true }) || a.title.localeCompare(b.title, 'ja'));

  // ---- ヘッダーのボタン（表示中のスライド） ----
  const trigger = $('lecture-trigger');
  function sync() {
    const current = data?.lectures.find(item => item.name === select.value);
    const option = select.selectedOptions[0];
    trigger.querySelector('.trigger-number').textContent = numberLabel(current?.number);
    trigger.querySelector('.trigger-title').textContent = current?.title ?? option?.textContent ?? 'スライドを選択';
    trigger.querySelector('.browser-dot').style.setProperty('--category-color', current ? category(current.category)?.color ?? '#738097' : 'transparent');
    trigger.disabled = select.disabled;
  }
  async function loadData() {
    try { data = await (await fetch('/api/library', { cache: 'no-store' })).json(); } catch { data ??= { categories: [], folders: [], lectures: [] }; }
    data.lectures = data.lectures.filter(item => item.format !== 'html');
    sync();
  }

  // ---- 左：カテゴリとフォルダー ----
  function treeRow(label, count, { categoryId = null, folderItem = null, depth = 0, children = [], key = null }) {
    const item = make('div', 'browser-tree-item'), row = make('div', 'browser-tree-row'), toggle = make('button', 'browser-toggle'), button = make('button', 'browser-tree-button');
    row.style.setProperty('--depth', depth); toggle.type = 'button'; button.type = 'button';
    const open = key && expanded.has(key);
    if (children.length) {
      toggle.setAttribute('aria-expanded', String(open)); toggle.setAttribute('aria-label', `${label}を開閉`);
      toggle.addEventListener('click', () => { if (expanded.has(key)) expanded.delete(key); else expanded.add(key); saveExpanded(); renderTree(); });
    } else { toggle.disabled = true; toggle.tabIndex = -1; toggle.setAttribute('aria-hidden', 'true'); }
    if (folderItem) button.append(folderIcon()); else if (categoryId) button.append(dot(categoryId)); else button.append(make('span', 'browser-all', '▤'));
    button.append(make('span', 'browser-tree-label', label), make('small', '', count));
    const active = folderItem ? place.folder === folderItem.id : categoryId ? place.category === categoryId && !place.folder : place.category === 'all';
    if (active && !$('browser-search').value.trim()) button.setAttribute('aria-current', 'true');
    button.addEventListener('click', () => go(folderItem?.category ?? categoryId ?? 'all', folderItem?.id ?? null));
    row.append(toggle, button); item.append(row);
    if (children.length && open) { const group = make('div', 'browser-tree-children'); group.append(...children.map(child => child())); item.append(group); }
    return item;
  }
  function folderNode(item, depth) {
    return () => treeRow(item.name, lectureCount(item.category, item.id), { folderItem: item, depth, key: item.id, children: childFolders(item.id, item.category).map(child => folderNode(child, depth + 1)) });
  }
  function renderTree() {
    $('browser-tree').replaceChildren(
      treeRow('すべてのスライド', data.lectures.length, {}),
      ...data.categories.map(item => treeRow(item.name, lectureCount(item.id, null), { categoryId: item.id, key: `category:${item.id}`, children: childFolders(null, item.id).map(child => folderNode(child, 1)) })));
  }

  // ---- 右：いまの場所のフォルダーとスライド ----
  function rows() {
    const query = $('browser-search').value.trim().normalize('NFKC').toLocaleLowerCase('ja');
    if (query) return { folders: [], lectures: sortLectures(data.lectures.filter(item => `${item.title} ${numberLabel(item.number)} ${item.number ?? ''} ${item.folderPath ?? ''} ${category(item.category)?.name ?? ''}`.normalize('NFKC').toLocaleLowerCase('ja').includes(query))) };
    if (place.category === 'all') return { folders: [], lectures: sortLectures([...data.lectures]) };
    return { folders: childFolders(place.folder, place.category), lectures: sortLectures(data.lectures.filter(item => item.category === place.category && (item.folderId ?? null) === place.folder)) };
  }
  function renderCrumbs() {
    const query = $('browser-search').value.trim();
    const crumbs = [{ text: 'すべてのスライド', category: 'all', folder: null }];
    if (query) crumbs.push({ text: `「${query}」の検索結果`, category: null });
    else if (place.category !== 'all') {
      crumbs.push({ text: category(place.category)?.name ?? 'カテゴリ', category: place.category, folder: null });
      const path = []; for (let item = folder(place.folder); item; item = folder(item.parentId)) path.unshift({ text: item.name, category: place.category, folder: item.id });
      crumbs.push(...path);
    }
    $('browser-crumbs').replaceChildren(...crumbs.flatMap((crumb, index) => {
      const part = crumb.category === null || index === crumbs.length - 1 ? make('span', 'browser-crumb-current', crumb.text) : make('button', 'browser-crumb', crumb.text);
      if (part.tagName === 'BUTTON') { part.type = 'button'; part.addEventListener('click', () => { $('browser-search').value = ''; go(crumb.category, crumb.folder); }); }
      return index ? [make('span', 'browser-crumb-sep', '›'), part] : [part];
    }));
  }
  function renderList() {
    const { folders, lectures } = rows(), list = $('browser-list');
    const items = [
      ...folders.map(item => {
        const row = make('div', 'browser-row is-folder'); row.dataset.folder = item.id; row.setAttribute('role', 'option'); row.tabIndex = -1;
        const name = make('span', 'browser-row-name'); name.append(folderIcon(), make('strong', '', item.name));
        row.append(name, make('span', 'browser-row-meta', `スライド ${lectureCount(item.category, item.id)}件`));
        row.addEventListener('click', () => go(item.category, item.id));
        return row;
      }),
      ...lectures.map(item => {
        const row = make('div', 'browser-row is-lecture'); row.dataset.lecture = item.name; row.setAttribute('role', 'option'); row.tabIndex = -1;
        row.setAttribute('aria-selected', String(chosen === item.name));
        const name = make('span', 'browser-row-name'); name.append(dot(item.category));
        const text = make('span', 'browser-row-text'); text.append(make('strong', '', item.title));
        const meta = [numberLabel(item.number), `${item.slides}枚`, $('browser-search').value.trim() || place.category === 'all' ? [category(item.category)?.name, item.folderPath].filter(Boolean).join(' / ') : null, new Date(item.updatedAt).toLocaleDateString('ja-JP')].filter(Boolean).join(' · ');
        text.append(make('small', '', meta)); name.append(text); row.append(name);
        if (item.name === select.value) row.append(make('span', 'browser-current', currentLabel));
        row.addEventListener('click', () => choose(item.name));
        row.addEventListener('dblclick', () => { choose(item.name); openChosen(); });
        return row;
      }),
    ];
    list.replaceChildren(...(items.length ? items : [make('p', 'browser-empty', $('browser-search').value.trim() ? '見つかりません。別の言葉で検索してください。' : 'このフォルダーにはスライドがありません。')]));
    list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }
  function choose(name) {
    chosen = name;
    for (const row of $('browser-list').querySelectorAll('.is-lecture')) row.setAttribute('aria-selected', String(row.dataset.lecture === name));
    const item = data.lectures.find(lecture => lecture.name === name);
    $('browser-selection').textContent = item ? `${numberLabel(item.number)} ${item.title}`.trim() : '';
    $('browser-open').disabled = !item || name === select.value;
  }
  function go(categoryId, folderId) {
    place = { category: categoryId, folder: folderId };
    if (categoryId !== 'all') expanded.add(`category:${categoryId}`);
    for (let item = folder(folderId); item; item = folder(item.parentId)) expanded.add(item.id);
    saveExpanded(); renderTree(); renderCrumbs(); renderList();
  }
  function openChosen() {
    if (!chosen || chosen === select.value) return;
    dialog.close();
    select.value = chosen; select.dispatchEvent(new Event('change'));
  }

  // ---- 操作 ----
  trigger.addEventListener('click', async () => {
    if (trigger.disabled) return;
    await loadData();
    const current = data.lectures.find(item => item.name === select.value);
    $('browser-search').value = ''; chosen = null; choose(select.value);
    go(current?.category ?? 'all', current?.folderId ?? null);
    dialog.showModal(); $('browser-search').focus();
  });
  $('browser-search').addEventListener('input', () => { renderTree(); renderCrumbs(); renderList(); });
  $('browser-open').addEventListener('click', openChosen);
  for (const id of ['browser-cancel', 'browser-close']) $(id).addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  // ↑↓で選ぶ・Enterで開く・Backspaceで上のフォルダーへ（検索欄で文字を消すときは除く）。
  dialog.addEventListener('keydown', event => {
    const lectures = [...$('browser-list').querySelectorAll('.is-lecture')].map(row => row.dataset.lecture);
    if (['ArrowDown', 'ArrowUp'].includes(event.key) && lectures.length) {
      event.preventDefault();
      const index = lectures.indexOf(chosen), next = event.key === 'ArrowDown' ? Math.min(lectures.length - 1, index + 1) : Math.max(0, index - 1);
      choose(lectures[index < 0 ? 0 : next]); $('browser-list').querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    }
    if (event.key === 'Enter' && !event.isComposing && chosen && chosen !== select.value) { event.preventDefault(); openChosen(); }
    if (event.key === 'Backspace' && event.target !== $('browser-search') && place.folder) { event.preventDefault(); go(place.category, folder(place.folder)?.parentId ?? null); }
  });
  void loadData();
  return { sync, refresh: loadData };
}
