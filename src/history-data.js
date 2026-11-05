// 比較と復元はスライドのIDで対応付ける。並べ替え後も同じページを見比べられる。
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const names = { title: '見出し', narration: '表示用の原稿', ttsText: '音声用の原稿', blocks: '本文', cues: '表示タイミング', shapes: '追加した図形・文字', placement: '配置', image: '画像', animation: '動き・ビルドアップ', layout: 'レイアウト', note: 'まとめの一文', eyebrow: '補足文', plannedSeconds: '表示時間', gapAfter: '次ページまでの間隔', style: '話し方', ttsModel: '音声モデル', ttsVoice: '声', category: 'カテゴリ', number: '演題番号', theme: 'デザインのCSS', design: 'デザイン', targetSeconds: '目標時間', rules: '構成ルール', slidesEdited: '構成の編集済み', description: '説明', brand: 'ロゴ', source: '元資料' };
names.appearance = 'スライドのデザイン';
export function fieldChanges(before, current) {
  return [...new Set([...Object.keys(before ?? {}), ...Object.keys(current ?? {})])].filter(key => canonical(before?.[key]) !== canonical(current?.[key])).map(key => ({ key, label: names[key] ?? key, before: before?.[key], current: current?.[key] }));
}
export function lectureChanges(before, current) {
  const { slides: a, ...oldSettings } = before, { slides: b, ...newSettings } = current;
  const beforeById = new Map(a.map((s, i) => [s.id, { slide: s, page: i + 1 }]));
  const currentById = new Map(b.map((s, i) => [s.id, { slide: s, page: i + 1 }]));
  return { settings: fieldChanges(oldSettings, newSettings), pages: [...new Set([...b.map(s => s.id), ...a.map(s => s.id)])].map(id => {
    const old = beforeById.get(id), now = currentById.get(id);
    return { id, before: old?.slide, current: now?.slide, beforePage: old?.page, currentPage: now?.page, fields: fieldChanges(old?.slide, now?.slide), moved: !!old && !!now && old.page !== now.page };
  }) };
}
export function restoreLectureVersion(current, before, slideId = null) {
  if (slideId !== null) {
    const old = before.slides.find(s => s.id === slideId), position = current.slides.findIndex(s => s.id === slideId);
    if (!old || position < 0) throw new Error('このページは選んだ履歴にありません。講義全体の復元を使ってください。');
    const result = structuredClone(current); result.slides[position] = structuredClone(old); return result;
  }
  const result = structuredClone(before);
  if (current.slidesEdited === true || canonical(current.slides.map(s => s.id)) !== canonical(result.slides.map(s => s.id))) result.slidesEdited = true;
  return result;
}
