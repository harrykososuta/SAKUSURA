// 検索パレット（src/command-palette.js）の絞り込みと並べ替え。全角・半角、大文字・小文字の違いは無視する。
export const norm = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase('ja');
export const HOME_COMMAND = ['HOME', '/home', 'ホーム ほーむ ダッシュボード 制作状況 home dashboard'];

// 空白で区切ったすべての言葉を含むものだけを残す。演題番号の完全一致 > 題名の語頭一致 > 題名に含む > 説明などに含む の順。
export function rank(items, query) {
  const terms = norm(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return items;
  return items.map((item, order) => {
    const label = norm(item.label), hay = `${label} ${norm(item.keywords)}`;
    if (!terms.every(term => hay.includes(term))) return null;
    let score = 0;
    for (const term of terms) score += item.exact?.includes(term) ? 20 : label.startsWith(term) || label.includes(` ${term}`) ? 4 : label.includes(term) ? 3 : 1;
    return { item, score, order };
  }).filter(Boolean).sort((a, b) => b.score - a.score || a.order - b.order).map(entry => entry.item);
}
