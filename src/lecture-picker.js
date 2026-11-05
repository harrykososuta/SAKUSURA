// 既存の選択欄を残し、カテゴリとライブラリのフォルダーごとにグループ表示する。
export async function loadLectureOptions(select) {
  let data;
  try {
    const response = await fetch('/api/library', { cache: 'no-store' });
    if (!response.ok) throw new Error();
    data = await response.json();
  } catch {
    const response = await fetch('/api/lectures', { cache: 'no-store' });
    if (!response.ok) throw new Error('講義一覧を読み込めません。');
    data = { lectures: (await response.json()).map(item => ({ ...item, category: 'other' })) };
  }
  data.lectures = data.lectures.filter(item => item.format !== 'html');
  const selected = select.value;
  select.replaceChildren();
  const groups = new Map();
  // カテゴリは designs/category-presets.json の一覧（/api/library が返す）。
  const roots = (data.categories ?? [{ id: 'other', name: 'カテゴリ未設定' }]).map(item => [item.id, item.name]);
  for (const [category, label] of roots) {
    const lectures = data.lectures.filter(item => (item.category ?? 'other') === category);
    for (const item of lectures) {
      const path = item.folderPath ? `${label} / ${item.folderPath}` : label;
      if (!groups.has(path)) {
        const group = document.createElement('optgroup'); group.label = path; select.append(group); groups.set(path, group);
      }
      const option = document.createElement('option'); option.value = item.name; option.textContent = item.title;
      groups.get(path).append(option);
    }
  }
  if (data.lectures.some(item => item.name === selected)) select.value = selected;
  return data.lectures;
}
