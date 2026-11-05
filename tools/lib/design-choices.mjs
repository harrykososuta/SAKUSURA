// スライド作成時にユーザーへ示すデザインの選択肢（標準デザイン・LLMにおまかせ・「デザイン」画面で保存したプリセット）。
// npm run designs・UserPromptSubmit フック・npm run new の --design 検査で共通に使う。
import { createDesignStore } from './design-store.mjs';
import { createCategoryDesignStore } from './category-design-store.mjs';
import { STANDARD_DESIGN_ID } from '../../src/design-theme.js';

export { STANDARD_DESIGN_ID };
// テンプレートに頼らず、講義ごとにLLMが theme.css を書いて見た目を作る（AGENTS.md「LLMにおまかせのデザイン」）。
export const LLM_DESIGN_ID = 'llm';
const LLM_CHOICE = { id: LLM_DESIGN_ID, name: 'LLMにおまかせ', description: 'テンプレートを使わず、内容に合わせてLLMが色・書体・配置・装飾をCSSで自由に作ります。できあがったデザインはテンプレートとして保存できます。', builtin: true, llm: true, pdf: false, css: false, categories: [] };

export async function designChoices() {
  const { designs } = await createDesignStore().list();
  // カテゴリごとの使用プリセット（designs/category-presets.json）。未設定は標準デザイン。
  let categories = [];
  try { categories = (await createCategoryDesignStore().get()).categories; } catch { /* 対応表が読めなくても一覧は出す */ }
  const saved = designs.map(item => ({
    id: item.id,
    name: item.design.name,
    description: item.design.description ?? '',
    builtin: item.builtin === true,
    pdf: !!item.design.pdfSource,
    css: !!item.design.css,
    categories: categories.filter(category => (category.designId ?? STANDARD_DESIGN_ID) === item.id).map(category => category.name)
  }));
  return [saved[0], LLM_CHOICE, ...saved.slice(1)];
}

// 保存したプリセットの設計情報（CSSテンプレートの css など）。標準・LLMにおまかせは null。
export async function designRecord(id) {
  if (id === LLM_DESIGN_ID || id === STANDARD_DESIGN_ID) return null;
  return (await createDesignStore().get(id)).design;
}

export function formatDesignChoices(choices) {
  const tags = item => [item.builtin && !item.llm ? '標準' : '', item.llm ? '自由' : '', item.pdf ? 'PDF原本' : '', item.css ? 'CSSテンプレート' : ''].filter(Boolean).map(tag => ` ${tag}`).join('');
  return choices.map(item => `- ${item.name}（id: ${item.id}）${tags(item)}${item.categories.length ? ` ／ 使用カテゴリ: ${item.categories.join('・')}` : ''}${item.description ? `\n  ${item.description}` : ''}`).join('\n');
}
