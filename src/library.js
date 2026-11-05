import { readSettings } from './settings.js';
const $ = id => document.getElementById(id);
const make = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; };
let data = null, category = 'all', folderId = null, busy = false, folderMode = 'create', renameId = null, moving = [];
const selected = new Set(), selectedFolders = new Set(), selectedTrash = new Set();
let dragging = null, deleting = null, movingFolders = [], movingCategory = null;
function clearSelection(){ selected.clear();selectedFolders.clear();selectedTrash.clear(); }
const openedLecture = new URLSearchParams(location.search).get('lecture');
const expanded = new Set((() => { try { return JSON.parse(localStorage.getItem('sakusura-library-expanded') ?? '[]'); } catch { return []; } })());
function saveExpanded() { try { localStorage.setItem('sakusura-library-expanded', JSON.stringify([...expanded])); } catch {} }
// 一覧は20件ずつのページに分ける。表示の密度（標準／コンパクト）は設定画面で選ぶ。
const PAGE_SIZE = 20;
let page = 1;
function applyDensity() { document.querySelector('.lecture-section').classList.toggle('is-compact', readSettings().libraryDensity === 'compact'); }
function folderIcon() {
  const holder = document.createElement('span');
  holder.innerHTML = '<svg class="folder-icon" viewBox="0 0 26 22" aria-hidden="true"><path d="M2 18.5V4.5a2 2 0 0 1 2-2h6l3 3h9a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2Z"/><path d="M2 8h22"/></svg>';
  return holder.firstChild;
}
const currentFolder = () => data?.folders.find(folder => folder.id === folderId);
const categoryInfo = id => data.categories.find(item => item.id === id);
const getFolder = id => data.folders.find(item => item.id === id);
function within(id, ancestor) {
  let folder = getFolder(id);
  while (folder) { if (folder.id === ancestor) return true; folder = getFolder(folder.parentId); }
  return false;
}
const childFolders = (parentId, categoryId) => data.folders.filter(item => item.parentId === parentId && item.category === categoryId).sort((a,b) => a.name.localeCompare(b.name,'ja'));
function folderCount(id) { return data.lectures.filter(item => item.folderId && within(item.folderId, id)).length; }
function color(element, id) { element.style.setProperty('--category-color', categoryInfo(id)?.color ?? '#738097'); }
function showError(message = '') {
  $('library-error').textContent = message; $('library-error').hidden = !message;
  const active = document.querySelector('dialog[open] [data-error]');
  if (active) { active.textContent = message; active.hidden = !message; }
}
async function request(url, options) {
  let response;
  try { response = await fetch(url, { cache: 'no-store', ...options }); }
  catch { throw new Error('スタジオに接続できません。起動ターミナルを確認してください。'); }
  let value;
  try { value = await response.json(); } catch { throw new Error('一覧を読み込めません。スタジオを再起動してください。'); }
  if (!response.ok) throw Object.assign(new Error(value.error || '操作に失敗しました。一覧を更新してください。'), { status: response.status });
  return value;
}
async function refresh() {
  data = await request('/api/library');
  if (folderId && !getFolder(folderId)) folderId = null;
  if (category !== 'all' && category !== 'trash' && !categoryInfo(category)) category = 'all';
  for (const name of selected) if (!data.lectures.some(item => item.name === name)) selected.delete(name);
  for(const id of selectedFolders)if(!getFolder(id))selectedFolders.delete(id);
  for(const id of selectedTrash)if(!(data.trash??[]).some(item=>item.id===id))selectedTrash.delete(id);
  render();
}
function readLocation() {
  const params = new URLSearchParams(location.search), folder = getFolder(params.get('folder'));
  if(params.get('view')==='trash'){category='trash';folderId=null;return;}
  folderId = folder?.id ?? null;
  category = folder?.category ?? (categoryInfo(params.get('category')) ? params.get('category') : 'all');
}
function reveal() {
  if (category !== 'all' && category !== 'trash') expanded.add(`category:${category}`);
  for (let folder = currentFolder(); folder; folder = getFolder(folder.parentId)) expanded.add(folder.id);
  saveExpanded();
}
function navigate(nextCategory = 'all', nextFolder = null, push = true) {
  category = nextCategory; folderId = nextFolder; page = 1; clearSelection(); reveal(); $('search').value = ''; showError(); $('library-status').textContent = '';
  const url = new URL(location.href); url.searchParams.delete('category'); url.searchParams.delete('folder'); url.searchParams.delete('view');
  if(category==='trash')url.searchParams.set('view','trash');
  else if (category !== 'all') url.searchParams.set('category', category);
  if (folderId) url.searchParams.set('folder', folderId);
  if (push) history.pushState(null, '', url);
  render();
}
function treeButton(label, count, onClick, { active = false, categoryId = null, folder = null } = {}) {
  const button = make('button', `tree-button${folder ? '' : ' category-root'}`);
  if (folder) { button.dataset.folder = folder.id; button.append(folderIcon()); button.classList.toggle('is-selected', selectedFolders.has(folder.id)); }
  else { const dot = make('span', 'category-dot'); color(dot, categoryId); button.dataset.category = categoryId; button.append(dot); }
  button.append(make('span', 'tree-label', label), make('small', '', count));
  if (active) button.setAttribute('aria-current', 'page');
  button.addEventListener('click', onClick);
  if(folder)attachDrag(button,{folders:[folder.id],lectures:[]});
  attachDrop(button,()=>({category:folder?.category??categoryId,folderId:folder?.id??null}));
  return button;
}
function setExpanded(item, key, open) {
  if (open) expanded.add(key); else expanded.delete(key); saveExpanded();
  item.querySelector(':scope > .tree-row > .tree-toggle').setAttribute('aria-expanded', String(open));
  item.querySelector(':scope > .tree-children').hidden = !open;
}
function treeNode(key, button, folders, depth) {
  const item = make('div', 'tree-item'), row = make('div', 'tree-row'), toggle = make('button', 'tree-toggle'), group = make('div', 'tree-children'), open = expanded.has(key);
  row.style.setProperty('--depth', depth); group.style.setProperty('--depth', depth + 1); group.hidden = !open;
  if (folders.length) {
    toggle.setAttribute('aria-expanded', String(open)); toggle.setAttribute('aria-label', `${button.querySelector('.tree-label').textContent}の中を開閉`);
    toggle.addEventListener('click', () => setExpanded(item, key, !expanded.has(key)));
    // ドラッグ中に閉じたフォルダーの上で止めると開く。
    let timer = null; const stop = () => { clearTimeout(timer); timer = null; };
    button.addEventListener('dragover', () => { if (dragging && !expanded.has(key) && !timer) timer = setTimeout(() => setExpanded(item, key, true), 600); });
    button.addEventListener('dragleave', stop); button.addEventListener('drop', stop);
  } else { toggle.disabled = true; toggle.tabIndex = -1; toggle.setAttribute('aria-hidden', 'true'); }
  for (const folder of folders) group.append(folderNode(folder, depth + 1));
  row.append(toggle, button); item.append(row, group); return item;
}
function folderNode(folder, depth) {
  const button = treeButton(folder.name, folderCount(folder.id), event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey) { if (selectedFolders.has(folder.id)) selectedFolders.delete(folder.id); else selectedFolders.add(folder.id); renderTree(); renderLectures(); return; }
    navigate(folder.category, folder.id);
  }, { folder, active: folderId === folder.id });
  return treeNode(folder.id, button, childFolders(folder.id, folder.category), depth);
}
function renderTree() {
  $('folder-tree').replaceChildren(...data.categories.map(item => treeNode(`category:${item.id}`, treeButton(item.name, data.lectures.filter(lecture => lecture.category === item.id).length, () => navigate(item.id), { categoryId: item.id, active: category === item.id && !folderId }), childFolders(null, item.id), 0)));
}
function tabButton(label, count, onClick, { active = false, categoryId = null } = {}) {
  const button = make('button', 'category-tab');
  if (categoryId) { const dot = make('span', 'category-dot'); color(dot, categoryId); button.dataset.category = categoryId; button.append(dot); attachDrop(button, () => ({ category: categoryId, folderId: null })); }
  else button.append(make('span', '', '▤'));
  button.append(make('span', '', label), make('small', '', count));
  if (active) button.setAttribute('aria-current', 'page');
  button.addEventListener('click', onClick);
  return button;
}
function renderTabs() {
  const trash = tabButton('ごみ箱', (data.trash ?? []).length, () => navigate('trash'), { active: category === 'trash' }); trash.id = 'trash-nav'; trash.classList.add('tab-trash'); attachDrop(trash, () => ({ trash: true }));
  $('category-tabs').replaceChildren(tabButton('すべてのスライド', data.lectures.length, () => navigate(), { active: category === 'all' }), ...data.categories.map(item => tabButton(item.name, data.lectures.filter(lecture => lecture.category === item.id).length, () => navigate(item.id), { categoryId: item.id, active: category === item.id })), trash);
}
function renderBreadcrumbs() {
  const crumbs = [{ text: 'すべてのスライド', category: 'all', folder: null }];
  if (category !== 'all') crumbs.push({ text: category==='trash'?'ごみ箱':categoryInfo(category).name, category, folder: null });
  const path = []; let current = currentFolder();
  while (current) { path.unshift({ text: current.name, category, folder: current.id }); current = getFolder(current.parentId); }
  crumbs.push(...path); $('breadcrumbs').replaceChildren();
  const query = $('search').value.trim();
  if (query) crumbs.push({ text: `「${query}」の検索結果`, search: true });
  for (const [index, crumb] of crumbs.entries()) {
    if (index) $('breadcrumbs').append(make('span', 'crumb-sep', '›'));
    const last = index === crumbs.length - 1;
    const button = make('button', last ? 'crumb-current' : 'crumb', crumb.text);
    if (last) button.setAttribute('aria-current', 'location');
    if (!crumb.search) button.addEventListener('click', () => { if (query) { $('search').value = ''; } navigate(crumb.category, crumb.folder); });
    if(!crumb.search&&crumb.category!=='all'&&crumb.category!=='trash')attachDrop(button,()=>({category:crumb.category,folderId:crumb.folder}));
    $('breadcrumbs').append(button);
  }
}
function visibleFolders(){ return category==='all'||category==='trash'||$('search').value.trim()?[]:childFolders(folderId,category); }
function folderRow(folder) {
  const tr = make('tr','folder-row'); tr.dataset.folderRow = folder.id; attachDrag(tr,{folders:[folder.id],lectures:[]}); attachDrop(tr,()=>({category:folder.category,folderId:folder.id}));
  const checkCell = make('td','check-cell'), check = make('input'); check.type = 'checkbox'; check.checked = selectedFolders.has(folder.id); check.setAttribute('aria-label', `${folder.name}を選択`);
  check.addEventListener('change', () => { if (check.checked) selectedFolders.add(folder.id); else selectedFolders.delete(folder.id); renderTree(); renderSelection(); }); checkCell.append(check);
  const title = make('td','lecture-title-cell'), link = make('a','folder-open'); color(link,folder.category);
  link.href = `/library?category=${encodeURIComponent(folder.category)}&folder=${encodeURIComponent(folder.id)}`; link.append(folderIcon(), make('span','',folder.name));
  link.addEventListener('click', event => { if (event.ctrlKey || event.metaKey || event.shiftKey) return; event.preventDefault(); navigate(folder.category, folder.id); });
  const subs = childFolders(folder.id, folder.category).length;
  title.append(link, make('div','lecture-meta', subs ? `フォルダー · 子フォルダー ${subs}個` : 'フォルダー'));
  const place = make('td','location-cell'), cat = make('strong'), dot = make('span','category-dot'); color(dot,folder.category);
  cat.append(dot,document.createTextNode(categoryInfo(folder.category)?.name ?? 'カテゴリ未設定')); place.append(cat, make('span','',getFolder(folder.parentId)?.path ?? 'カテゴリ直下'));
  const actions = make('td'), buttons = make('div','row-actions'), open = make('a','','開く'); open.href = link.href;
  open.addEventListener('click', event => { event.preventDefault(); navigate(folder.category, folder.id); });
  const move = make('button','','整理'); move.setAttribute('aria-label',`${folder.name}の移動先を変更`); move.addEventListener('click',()=>openMove([],[folder.id]));
  buttons.append(open,move); actions.append(buttons);
  tr.append(checkCell,title,place,make('td','pages-column',`スライド ${folderCount(folder.id)}件`),make('td','date-column','—'),actions);
  return tr;
}
function filteredLectures() {
  const query = $('search').value.trim().normalize('NFKC').toLocaleLowerCase('ja');
  const list = data.lectures.filter(item => {
    if (category !== 'all' && item.category !== category) return false;
    if (category !== 'all') {
      if (query) { if (folderId && !within(item.folderId, folderId)) return false; }
      else if (item.folderId !== folderId) return false;
    }
    return !query || `${item.title} ${item.number} #${String(item.number).padStart(2,'0')} ${item.description} ${item.folderPath} ${item.name}`.normalize('NFKC').toLocaleLowerCase('ja').includes(query);
  });
  return list.sort((a,b) => $('sort').value === 'title' ? a.title.localeCompare(b.title,'ja') : $('sort').value === 'number' ? String(a.number).localeCompare(String(b.number),'ja',{ numeric:true }) : b.updatedAt - a.updatedAt);
}
// 今のページに出すフォルダーとスライド（フォルダーが先）。
function pageItems() {
  const allFolders = visibleFolders(), allLectures = filteredLectures(), total = allFolders.length + allLectures.length, pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  page = Math.min(Math.max(1, page), pages);
  const start = (page - 1) * PAGE_SIZE, end = start + PAGE_SIZE;
  return { folders: allFolders.slice(start, end), lectures: allLectures.slice(Math.max(0, start - allFolders.length), Math.max(0, end - allFolders.length)), allFolders, allLectures, total, pages, start };
}
function goToPage(next) { page = next; renderLectures(); document.querySelector('main').scrollTop = 0; }
function renderPager({ total, pages, start }) {
  $('pager').hidden = pages <= 1; if (pages <= 1) return;
  $('pager-range').textContent = `${start + 1}–${Math.min(start + PAGE_SIZE, total)}件目 / ${total}件`;
  const button = (label, target, { current = false, aria } = {}) => {
    const el = make('button', '', label); el.type = 'button'; el.disabled = target < 1 || target > pages;
    if (aria) el.setAttribute('aria-label', aria);
    if (current) { el.setAttribute('aria-current', 'page'); el.disabled = false; } else el.addEventListener('click', () => goToPage(target));
    return el;
  };
  const numbers = [];
  for (let n = 1; n <= pages; n++) {
    if (n === 1 || n === pages || Math.abs(n - page) <= 1) numbers.push(button(String(n), n, { current: n === page, aria: `${n}ページ目` }));
    else if (numbers.at(-1)?.className !== 'pager-gap') numbers.push(make('span', 'pager-gap', '…'));
  }
  $('pager-pages').replaceChildren(button('‹ 前へ', page - 1, { aria: '前のページ' }), ...numbers, button('次へ ›', page + 1, { aria: '次のページ' }));
}
function renderLectures() {
  if(category==='trash'){$('pager').hidden=true;renderTrash();return;}
  const info = pageItems(), { lectures, folders } = info; $('lecture-list').replaceChildren(...folders.map(folderRow));
  for (const item of lectures) {
    const tr = make('tr'); attachDrag(tr,{lectures:[item.name],folders:[]});tr.dataset.lecture = item.name; tr.dataset.current = String(item.name === openedLecture);
    const checkCell = make('td','check-cell'), check = make('input'); check.type = 'checkbox'; check.checked = selected.has(item.name); check.setAttribute('aria-label', `${item.title}を選択`);
    check.addEventListener('change', () => { if (check.checked) selected.add(item.name); else selected.delete(item.name); renderSelection(); }); checkCell.append(check);
    const htmlDeck = item.format === 'html', playUrl = htmlDeck ? `/html-slides?name=${encodeURIComponent(item.name)}` : `/?lecture=${encodeURIComponent(item.name)}`;
    const title = make('td','lecture-title-cell'), link = make('a','lecture-title-link', item.title); link.href = htmlDeck ? playUrl : `/editor?lecture=${encodeURIComponent(item.name)}`; link.title = item.description || item.title;
    const meta = make('div','lecture-meta');
    if (item.number) meta.append(make('span','',`#${String(item.number).padStart(2,'0')}`));
    if (item.demo) meta.append(make('span','','動作確認デモ'));
    if (htmlDeck) meta.append(make('span','','HTMLスライド'));
    if (item.name === openedLecture) meta.append(make('span','current-mark','開いていたスライド'));
    title.append(link,make('div','lecture-description',item.description),meta);
    const place = make('td','location-cell'), cat = make('strong'), dot = make('span','category-dot'); color(dot,item.category);
    cat.append(dot,document.createTextNode(categoryInfo(item.category)?.name ?? 'カテゴリ未設定')); place.append(cat, make('span','',item.folderPath || 'カテゴリ直下'));
    const pages = make('td','pages-column',`${item.slides}枚`), date = make('td','date-column',new Date(item.updatedAt).toLocaleDateString('ja-JP'));
    const actions = make('td'), buttons = make('div','row-actions');
    const play = make('a','','再生'); play.href = playUrl;
    const edit = make('a','','編集'); edit.href = `/editor?lecture=${encodeURIComponent(item.name)}`;
    const move = make('button','','整理'); move.dataset.move = item.name; move.setAttribute('aria-label',`${item.title}の移動先を変更`); move.addEventListener('click',()=>openMove([item.name]));
    buttons.append(play); if (!htmlDeck) buttons.append(edit); buttons.append(move); actions.append(buttons); tr.append(checkCell,title,place,pages,date,actions); $('lecture-list').append(tr);
  }
  $('result-count').textContent = info.allFolders.length ? `フォルダー ${info.allFolders.length}個 · スライド ${info.allLectures.length}件` : `${info.allLectures.length}件`; $('empty-state').hidden = !!info.total;
  renderPager(info); renderSelection();
}
function renderSelection() {
  const trash=category==='trash',shown=trash?null:pageItems(),visible=trash?filteredTrash():shown.lectures,folders=trash?[]:shown.folders;
  const checked=trash?visible.filter(item=>selectedTrash.has(item.id)).length:visible.filter(item=>selected.has(item.name)).length+folders.filter(item=>selectedFolders.has(item.id)).length;
  const total=visible.length+folders.length,count=trash?selectedTrash.size:selected.size+selectedFolders.size;
  $('select-all').checked=!!total&&checked===total;$('select-all').indeterminate=checked>0&&checked<total;$('select-all').disabled=!total;
  $('selection-actions').hidden=!count;$('selection-count').textContent=`${count}件を選択中`;
  $('move-selected').hidden=trash;$('delete-selected').hidden=trash;$('restore-selected').hidden=!trash;
  const categories=new Set([...data.lectures.filter(item=>selected.has(item.name)).map(item=>item.category),...data.folders.filter(item=>selectedFolders.has(item.id)).map(item=>item.category)]);
  $('move-selected').disabled=busy||selectedFolders.size>0&&categories.size>1;
}
function render() {
  if (!data) return;
  const folder = currentFolder();
  $('rename-folder').hidden = !folder;
  $('delete-folder').hidden = !folder; $('new-folder').hidden=category==='trash';
  $('location-heading').textContent=category==='trash'?'元のカテゴリ':'保存場所';$('content-heading').textContent=category==='trash'?'内容':'枚数';$('date-heading').textContent=category==='trash'?'削除日':'更新日';
  $('empty-title').textContent=category==='trash'?'ごみ箱は空です':'スライドが見つかりません';$('empty-description').textContent=category==='trash'?'削除したスライド・フォルダーはここから復元できます。':'検索条件を変えるか、別のカテゴリ・フォルダーを開いてください。';
  $('total-count').textContent = `スライド ${data.lectures.length}件 · フォルダー ${data.folders.length}個`;
  const opened = data.lectures.find(item=>item.name===openedLecture);
  $('return-link').hidden=!data.lectures.length;
  // メインメニューの「編集」：開いていたスライドがあれば、そのスライドの編集へ戻る。
  $('return-link').href = opened ? `/editor?lecture=${encodeURIComponent(opened.name)}` : '/editor';
  $('return-link').title = opened ? `開いていたスライド（${opened.title}）の編集へ戻る` : '編集画面を開く';
  renderTabs(); renderTree(); renderBreadcrumbs(); renderLectures();
}
function setBusy(value) { busy = value; for (const id of ['folder-submit','move-submit','delete-submit','new-folder','rename-folder','delete-folder','move-selected','delete-selected','restore-selected','refresh']) $(id).disabled = value; }
async function change(body) {
  setBusy(true); showError();
  try {
    data = await request('/api/library', { method:'POST', headers:{'Content-Type':'application/json','X-Studio-Editor':'1'}, body:JSON.stringify({ ...body, revision:data.revision }) });
    try { localStorage.setItem('sakusura-library-updated',String(Date.now())); } catch {}
    return data;
  } catch (error) {
    if (error.status === 409) { try { await refresh(); } catch {} }
    showError(error.message); return null;
  } finally { setBusy(false); }
}
function fillParents(id, preferred = null) {
  $('folder-parent').replaceChildren();
  const root = make('option','', 'カテゴリ直下'); root.value = ''; $('folder-parent').append(root);
  for (const folder of data.folders.filter(item=>item.category===id).sort((a,b)=>a.path.localeCompare(b.path,'ja'))) {
    const option = make('option','',folder.path); option.value=folder.id; $('folder-parent').append(option);
  }
  if (preferred && getFolder(preferred)?.category===id) $('folder-parent').value=preferred;
}
function openFolderDialog(rename = false) {
  if (!data || busy) return;
  folderMode=rename?'rename':'create'; renameId=rename?folderId:null; $('folder-form').reset();
  $('folder-dialog-title').textContent=rename?'フォルダー名を変更':'フォルダーを作成'; $('folder-submit').textContent=rename?'変更を保存':'作成する';
  $('folder-location-fields').hidden=rename; $('folder-category').disabled=rename; $('folder-parent').disabled=rename;
  $('folder-category').replaceChildren();
  const empty=make('option','','カテゴリを選択'); empty.value=''; $('folder-category').append(empty);
  for (const item of data.categories) { const option=make('option','',item.name); option.value=item.id; $('folder-category').append(option); }
  $('folder-category').value=category==='all'?'':category; fillParents($('folder-category').value,folderId);
  $('folder-name').value=rename?currentFolder().name:'';
  $('folder-dialog').querySelector('[data-error]').hidden=true; $('folder-dialog').showModal(); $('folder-name').focus();
}
function openMove(names,ids=[]) {
  if(busy)return;
  moving=names;movingFolders=ids;
  const lectures=data.lectures.filter(item=>names.includes(item.name)),folders=data.folders.filter(item=>ids.includes(item.id));
  const categories=new Set([...lectures,...folders].map(item=>item.category));movingCategory=categories.size===1?[...categories][0]:null;
  if(ids.length&&!movingCategory){showError('フォルダーは同じカテゴリ内で移動してください。');return;}
  const count=names.length+ids.length;
  $('move-summary').textContent=`選択した${count}件の移動先を選んでください。`;$('move-target').replaceChildren();
  const root=make('option','',movingCategory?`${categoryInfo(movingCategory).name}のカテゴリ直下`:'各スライドのカテゴリ直下');root.value='';$('move-target').append(root);
  if(movingCategory)for(const folder of data.folders.filter(item=>item.category===movingCategory&&!ids.some(id=>within(item.id,id))).sort((a,b)=>a.path.localeCompare(b.path,'ja'))){const option=make('option','',folder.path);option.value=folder.id;$('move-target').append(option);}
  if(count===1)$('move-target').value=lectures[0]?.folderId??folders[0]?.parentId??'';
  $('move-dialog').querySelector('[data-error]').hidden=true;$('move-dialog').showModal();
}
function openDelete(items) {
  if(busy||!items.lectures.length&&!items.folders.length)return;
  deleting={lectures:[...new Set(items.lectures)],folders:[...new Set(items.folders)]};
  const folders=data.folders.filter(item=>deleting.folders.some(id=>within(item.id,id))), names=new Set(deleting.lectures);
  for(const lecture of data.lectures)if(lecture.folderId&&folders.some(folder=>folder.id===lecture.folderId))names.add(lecture.name);
  const parts=[];if(names.size)parts.push(`${names.size}件のスライド`);if(folders.length)parts.push(`${folders.length}個のフォルダー`);
  $('delete-summary').textContent=`${parts.join('と')}をごみ箱に移動します。`;$('delete-items').replaceChildren();
  const titles=[...data.folders.filter(item=>deleting.folders.includes(item.id)).map(item=>`フォルダー：${item.name}`),...data.lectures.filter(item=>deleting.lectures.includes(item.name)).map(item=>item.title)];
  for(const title of titles.slice(0,6))$('delete-items').append(make('li','',title));
  if(titles.length>6)$('delete-items').append(make('li','',`ほか${titles.length-6}件`));
  $('delete-dialog').querySelector('[data-error]').hidden=true;$('delete-dialog').showModal();
}
const batchTitle=batch=>batch.folders.length?batch.folders[0].name:batch.lectures[0]?.title??'削除した項目';
function filteredTrash(){
  const query=$('search').value.trim().normalize('NFKC').toLocaleLowerCase('ja');
  return [...(data.trash??[])].filter(batch=>!query||[...batch.lectures.map(item=>item.title),...batch.folders.map(item=>item.name)].join(' ').normalize('NFKC').toLocaleLowerCase('ja').includes(query)).sort((a,b)=>$('sort').value==='title'?batchTitle(a).localeCompare(batchTitle(b),'ja'):Date.parse(b.deletedAt)-Date.parse(a.deletedAt));
}
function renderTrash(){
  const list=filteredTrash();$('lecture-list').replaceChildren();
  for(const batch of list){
    const tr=make('tr');tr.dataset.trash=batch.id;
    const checkCell=make('td','check-cell'),check=make('input');check.type='checkbox';check.checked=selectedTrash.has(batch.id);check.setAttribute('aria-label',`${batchTitle(batch)}を復元対象に選択`);
    check.addEventListener('change',()=>{if(check.checked)selectedTrash.add(batch.id);else selectedTrash.delete(batch.id);renderSelection();});checkCell.append(check);
    const title=make('td','lecture-title-cell');title.append(make('span','lecture-title-link',batchTitle(batch)),make('div','lecture-description',[...batch.folders.map(item=>item.name),...batch.lectures.map(item=>item.title)].join('、')));
    const categories=[...new Set([...batch.folders,...batch.lectures].map(item=>categoryInfo(item.category)?.name??'カテゴリ未設定'))];
    const place=make('td','location-cell',categories.join('・')),contents=make('td','pages-column',`スライド ${batch.lectureCount}件 / フォルダー ${batch.folderCount}個`),date=make('td','date-column',new Date(batch.deletedAt).toLocaleDateString('ja-JP'));
    const actions=make('td'),restore=make('button','restore-button','復元する');restore.addEventListener('click',()=>restoreItems([batch.id]));actions.append(restore);
    tr.append(checkCell,title,place,contents,date,actions);$('lecture-list').append(tr);
  }
  $('result-count').textContent=`${list.length}件`;$('empty-state').hidden=!!list.length;renderSelection();
}
async function restoreItems(ids){
  if(busy||!ids.length)return;
  if(!await change({op:'restore',ids}))return;
  clearSelection();render();$('library-status').textContent='スライド・フォルダーを復元しました。';
}
function clearDrag(){dragging=null;document.body.classList.remove('dragging-items');document.querySelectorAll('.drop-target,.drop-blocked,.drag-source').forEach(el=>el.classList.remove('drop-target','drop-blocked','drag-source'));}
function attachDrag(element,items){
  element.draggable=true;element.title=element.title||'ドラッグでフォルダーへ移動できます';
  element.addEventListener('dragstart',event=>{
    if(busy||category==='trash'||event.target.closest('input,select')||event.target.closest('button')&&event.target.closest('button')!==element){event.preventDefault();return;}
    const included=items.lectures.some(name=>selected.has(name))||items.folders.some(id=>selectedFolders.has(id));
    const payload=included?{lectures:[...selected],folders:[...selectedFolders]}:{lectures:[...items.lectures],folders:[...items.folders]};
    const cats=new Set([...data.lectures.filter(item=>payload.lectures.includes(item.name)),...data.folders.filter(item=>payload.folders.includes(item.id))].map(item=>item.category));
    if(!cats.size){event.preventDefault();return;}
    dragging={...payload,category:cats.size===1?[...cats][0]:null};event.dataTransfer.clearData();event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('application/x-sakusura-library',JSON.stringify(dragging));event.dataTransfer.setData('text/plain',`${payload.lectures.length+payload.folders.length}件の項目`);
    element.classList.add('drag-source');document.body.classList.add('dragging-items');event.stopPropagation();
  });
  element.addEventListener('dragend',clearDrag);
}
function validDrop(target){return dragging&&!busy&&(target.trash||target.category===dragging.category&&!dragging.folders.some(id=>target.folderId&&within(target.folderId,id)));}
function attachDrop(element,targetOf){
  element.dataset.dropZone='true';
  element.addEventListener('dragover',event=>{
    if(!dragging)return;event.stopPropagation();const valid=validDrop(targetOf());
    element.classList.toggle('drop-target',!!valid);element.classList.toggle('drop-blocked',!valid);
    if(valid){event.preventDefault();event.dataTransfer.dropEffect='move';}else event.dataTransfer.dropEffect='none';
  });
  element.addEventListener('dragleave',event=>{if(!element.contains(event.relatedTarget)){element.classList.remove('drop-target','drop-blocked');}});
  element.addEventListener('drop',async event=>{
    if(!dragging)return;event.preventDefault();event.stopPropagation();
    const target=targetOf(),valid=validDrop(target),payload=dragging;clearDrag();if(!valid)return;
    if(target.trash){openDelete(payload);return;}
    if(!await change({op:'move',lectures:payload.lectures,folders:payload.folders,category:target.category,folderId:target.folderId}))return;
    clearSelection();render();$('library-status').textContent='ドラッグした項目を移動しました。';
  });
}
document.addEventListener('dragend',clearDrag);
document.addEventListener('keydown',event=>{if(event.key==='Delete'&&category!=='trash'&&!event.target.matches('input,textarea,select')&&!document.querySelector('dialog[open]')){event.preventDefault();openDelete({lectures:[...selected],folders:[...selectedFolders]});}});
$('new-folder').addEventListener('click',()=>openFolderDialog());$('rename-folder').addEventListener('click',()=>openFolderDialog(true));
$('delete-folder').addEventListener('click',()=>{if(currentFolder())openDelete({lectures:[],folders:[folderId]});});
$('delete-selected').addEventListener('click',()=>openDelete({lectures:[...selected],folders:[...selectedFolders]}));
$('delete-submit').addEventListener('click',async()=>{
  if(!deleting||busy)return;
  const result=await change({op:'trash',...deleting});if(!result)return;
  $('delete-dialog').close();clearSelection();
  if(folderId&&!getFolder(folderId))navigate(category,null);else render();
  $('library-status').textContent='選択した項目をごみ箱に移動しました。';deleting=null;
});
$('folder-category').addEventListener('change',()=>fillParents($('folder-category').value));
$('folder-form').addEventListener('submit',async event=>{
  event.preventDefault(); if (busy) return;
  const name=$('folder-name').value, nextCategory=$('folder-category').value, parent=$('folder-parent').value||null;
  const result=await change(folderMode==='rename'?{op:'rename',id:renameId,name}:{op:'create',name,category:nextCategory,parentId:parent});
  if (!result) return;
  $('folder-dialog').close();
  if (folderMode==='create') navigate(nextCategory,parent); else render();
  $('library-status').textContent=folderMode==='create'?`「${name.trim()}」を作成しました。`:'フォルダー名を変更しました。';
});
$('move-form').addEventListener('submit',async event=>{
  event.preventDefault(); if (busy) return;
  const count=moving.length+movingFolders.length;
  const body=movingFolders.length?{op:'move',lectures:moving,folders:movingFolders,category:movingCategory,folderId:$('move-target').value||null}:{op:'assign',lectures:moving,folderId:$('move-target').value||null};
  if (!await change(body)) return;
  $('move-dialog').close();clearSelection(); render(); $('library-status').textContent=`${count}件を移動しました。`;
});
for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click',()=>{if(!busy)$(button.dataset.close).close();});
for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
$('search').addEventListener('input',()=>{ page=1; clearSelection(); renderTree(); renderBreadcrumbs(); renderLectures(); }); $('sort').addEventListener('change',()=>{page=1;renderLectures();});$('refresh').addEventListener('click',async()=>{setBusy(true);showError();try{await refresh();$('library-status').textContent='一覧を更新しました。';}catch(error){showError(error.message);}finally{setBusy(false);}});
$('select-all').addEventListener('change',event=>{
  if(category==='trash'){for(const item of filteredTrash()){if(event.target.checked)selectedTrash.add(item.id);else selectedTrash.delete(item.id);}}
  else{const shown=pageItems();for(const item of shown.lectures){if(event.target.checked)selected.add(item.name);else selected.delete(item.name);}for(const item of shown.folders){if(event.target.checked)selectedFolders.add(item.id);else selectedFolders.delete(item.id);}}
  renderTree();renderLectures();
});
$('clear-selection').addEventListener('click',()=>{clearSelection();renderTree();renderLectures();});$('move-selected').addEventListener('click',()=>openMove([...selected],[...selectedFolders]));
$('restore-selected').addEventListener('click',()=>restoreItems([...selectedTrash]));
window.addEventListener('popstate',()=>{if(data){readLocation();reveal();clearSelection();$('search').value='';render();}});
window.addEventListener('storage',event=>{if(event.key==='sakusura-ui-settings'){applyDensity();return;}if(event.key==='sakusura-library-updated'&&!busy&&!dragging&&!document.querySelector('dialog[open]'))void refresh().catch(error=>showError(error.message));});
$('sort').value=readSettings().librarySort;applyDensity();
try {
  data=await request('/api/library');readLocation();reveal();
  // 編集画面から戻ったときは、開いていたスライドのあるページを出す。
  if(openedLecture&&category!=='trash'){const index=visibleFolders().length+filteredLectures().findIndex(item=>item.name===openedLecture);if(index>=visibleFolders().length)page=Math.floor(index/PAGE_SIZE)+1;}
  render();
} catch(error){showError(error.message);}
