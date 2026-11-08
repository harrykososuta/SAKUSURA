// 挿入元を探すエクスプローラー。講義データや挿入処理は editor.js に任せる。

const $ = id => document.getElementById(id);
const make = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const normalize = text => String(text).normalize('NFKC').toLocaleLowerCase('ja');
const numberLabel = number => number ? `#${String(number).padStart(2, '0')}` : '';
function folderIcon() {
  const holder = make('span');
  holder.innerHTML = '<svg class="browser-folder-icon" viewBox="0 0 26 22" aria-hidden="true"><path d="M2 18.5V4.5a2 2 0 0 1 2-2h6l3 3h9a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2Z"/><path d="M2 8h22"/></svg>';
  return holder.firstChild;
}

export function initInsertBrowser({ select, currentName }) {
  let data = { categories: [], folders: [], lectures: [] }, place = { category: 'all', folder: null }, history = [];
  const expanded = new Set();
  const category = id => data.categories.find(item => item.id === id);
  const folder = id => data.folders.find(item => item.id === id);
  const children = (parent, categoryId) => data.folders.filter(item => item.parentId === parent && item.category === categoryId).sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  function within(id, ancestor) {
    for (let item = folder(id); item; item = folder(item.parentId)) if (item.id === ancestor) return true;
    return false;
  }
  const count = (categoryId, folderId) => data.lectures.filter(item => item.category === categoryId && (!folderId || within(item.folderId, folderId))).length;
  const dot = id => { const node = make('span', 'browser-dot'); node.style.setProperty('--category-color', category(id)?.color ?? '#738097'); return node; };
  function treeRow(label, total, categoryId = 'all', folderId = null, depth = 0) {
    const wrapper = make('div', 'browser-tree-item'), row = make('div', 'browser-tree-row');
    const nodes = categoryId === 'all' ? [] : children(folderId, categoryId), key = folderId ?? `category:${categoryId}`;
    row.style.setProperty('--depth', depth);
    const toggle = make('button', 'browser-toggle'); toggle.type = 'button';
    if (nodes.length) {
      toggle.setAttribute('aria-expanded', String(expanded.has(key))); toggle.setAttribute('aria-label', `${label}を開閉`);
      toggle.addEventListener('click', () => { expanded.has(key) ? expanded.delete(key) : expanded.add(key); renderTree(); });
    } else { toggle.disabled = true; toggle.tabIndex = -1; }
    const button = make('button', 'browser-tree-button'); button.type = 'button'; button.title = label;
    button.append(folderId ? folderIcon() : categoryId === 'all' ? make('span', 'browser-all', '▤') : dot(categoryId), make('span', 'browser-tree-label', label), make('small', '', total));
    if (place.category === categoryId && place.folder === folderId && !$('insert-search').value.trim()) button.setAttribute('aria-current', 'true');
    button.addEventListener('click', () => go({ category: categoryId, folder: folderId }));
    row.append(toggle, button); wrapper.append(row);
    if (nodes.length && expanded.has(key)) wrapper.append(...nodes.map(item => treeRow(item.name, count(item.category, item.id), item.category, item.id, depth + 1)));
    return wrapper;
  }
  function renderTree() {
    $('insert-tree').replaceChildren(treeRow('すべての講義', data.lectures.length), ...data.categories.map(item => treeRow(item.name, count(item.id, null), item.id)));
  }
  function renderCrumbs() {
    const crumbs = [{ text: 'すべての講義', category: 'all', folder: null }];
    if ($('insert-search').value.trim()) crumbs.push({ text: '検索結果' });
    else if (place.category !== 'all') {
      crumbs.push({ text: category(place.category)?.name ?? 'カテゴリ', category: place.category, folder: null });
      const path = [];
      for (let item = folder(place.folder); item; item = folder(item.parentId)) path.unshift({ text: item.name, category: item.category, folder: item.id });
      crumbs.push(...path);
    }
    $('insert-crumbs').replaceChildren(...crumbs.flatMap((item, i) => {
      const node = make(i === crumbs.length - 1 ? 'span' : 'button', i === crumbs.length - 1 ? 'browser-crumb-current' : 'browser-crumb', item.text);
      if (node.tagName === 'BUTTON') { node.type = 'button'; node.addEventListener('click', () => go({ category: item.category, folder: item.folder })); }
      return i ? [make('span', 'browser-crumb-sep', '›'), node] : [node];
    }));
    $('insert-back').disabled = !history.length;
    $('insert-up').disabled = place.category === 'all' && !$('insert-search').value.trim();
  }
  function sync() {
    for (const row of document.querySelectorAll('#insert-current [data-lecture], #insert-lectures [data-lecture]')) row.setAttribute('aria-pressed', String(row.dataset.lecture === select.value));
  }
  function renderList() {
    const query = normalize($('insert-search').value.trim());
    const current = data.lectures.find(item => item.name === currentName());
    const lectures = data.lectures.filter(item => item.name !== currentName()).filter(item => query
      ? normalize(`${item.title} ${item.number ?? ''} ${numberLabel(item.number)} ${item.folderPath ?? ''} ${category(item.category)?.name ?? ''}`).includes(query)
      : place.category === 'all' || item.category === place.category && (item.folderId ?? null) === place.folder)
      .sort((a, b) => String(a.number ?? '').localeCompare(String(b.number ?? ''), 'ja', { numeric: true }) || a.title.localeCompare(b.title, 'ja'));
    const folders = query || place.category === 'all' ? [] : children(place.folder, place.category);
    const rows = folders.map(item => {
      const row = make('button', 'insert-source-row is-folder'); row.type = 'button'; row.dataset.folder = item.id;
      const text = make('span', 'insert-source-text'); text.append(make('strong', '', item.name), make('small', '', `${count(item.category, item.id)}講義`));
      row.append(folderIcon(), text, make('span', 'insert-folder-arrow', '›'));
      row.addEventListener('click', () => go({ category: item.category, folder: item.id }));
      return row;
    });
    function sourceRow(item, isCurrent = false) {
      const row = make('button', 'insert-source-row'); row.type = 'button'; row.dataset.lecture = item.name;
      const path = [category(item.category)?.name, item.folderPath].filter(Boolean).join(' / ');
      row.title = `${item.title}\n${path}`;
      const text = make('span', 'insert-source-text'), heading = make('strong', '', item.title);
      if (isCurrent) text.append(make('span', 'insert-editing-badge', '編集中'));
      text.append(heading, make('small', '', [numberLabel(item.number), `${item.slides ?? '?'}枚`].filter(Boolean).join(' · ')));
      if (query || place.category === 'all' || isCurrent) text.append(make('small', 'insert-source-path', path));
      row.append(dot(item.category), text);
      row.addEventListener('click', () => {
        if (select.value === item.name) return;
        select.value = item.name; sync(); select.dispatchEvent(new Event('change'));
      });
      return row;
    }
    // 編集中は検索・フォルダー・スクロールにかかわらず最上段に固定する。
    $('insert-current').replaceChildren(...(current ? [sourceRow(current, true)] : []));
    $('insert-current').hidden = !current;
    rows.push(...lectures.map(item => sourceRow(item)));
    $('insert-lectures').replaceChildren(...(rows.length ? rows : [make('p', 'browser-empty', query ? '講義が見つかりません。検索する言葉を変えてください。' : 'このフォルダーに講義はありません。')]));
    $('insert-source-count').textContent = `${lectures.length + (current ? 1 : 0)}件${folders.length ? ` / ${folders.length}フォルダー` : ''}`;
    sync();
  }
  function render() { renderTree(); renderCrumbs(); renderList(); }
  function go(next, remember = true, query = '') {
    if (remember) history.push({ ...place, query: $('insert-search').value });
    place = { category: next.category, folder: next.folder };
    $('insert-search').value = query;
    expanded.add(`category:${place.category}`);
    for (let item = folder(place.folder); item; item = folder(item.parentId)) expanded.add(item.id);
    render();
  }
  $('insert-back').addEventListener('click', () => { const previous = history.pop(); if (previous) go(previous, false, previous.query); });
  $('insert-up').addEventListener('click', () => go($('insert-search').value.trim() ? place : place.folder ? { category: place.category, folder: folder(place.folder)?.parentId ?? null } : { category: 'all', folder: null }));
  $('insert-search').addEventListener('input', render);
  select.addEventListener('change', sync);
  // リスト内の矢印移動。Tab/Enter/Spaceはネイティブのボタン操作を使う。
  for (const id of ['insert-tree', 'insert-current', 'insert-lectures']) $(id).addEventListener('keydown', event => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const rows = [...(id === 'insert-tree' ? $(id).querySelectorAll('.browser-tree-button') : document.querySelectorAll('#insert-current button, #insert-lectures button'))];
    const at = rows.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)));
    if (rows[next]) { event.preventDefault(); rows[next].focus(); }
  });
  return {
    async open() {
      $('insert-library-status').hidden = true;
      try {
        const response = await fetch('/api/library', { cache: 'no-store' });
        if (!response.ok) throw new Error();
        data = await response.json();
        data.lectures = data.lectures.filter(item => item.format !== 'html');
      } catch {
        data = { categories: [{ id: 'other', name: 'カテゴリ未設定' }], folders: [], lectures: [...select.options].map(item => ({ name: item.value, title: item.textContent, category: 'other' })) };
        $('insert-library-status').textContent = 'フォルダーを取得できませんでした。講義一覧から選択できます。';
        $('insert-library-status').hidden = false;
      }
      const current = data.lectures.find(item => item.name === select.value);
      history = [];
      go({ category: current?.category ?? 'all', folder: current?.folderId ?? null }, false);
      if (select.value === currentName()) $('insert-lectures').scrollTop = 0;
      else $('insert-lectures').querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest' });
    },
    sync,
  };
}
