// 画面の配色を描画前に適用する（各ページの <head> で type="module" を付けずに読み込む）。
// 設定は src/settings.js が localStorage に保存する。別のタブで変えた配色や、Windowsのライト／ダーク切り替えもすぐ反映する。
(() => {
  const KEY = 'sakusura-ui-settings';
  const system = matchMedia('(prefers-color-scheme: dark)');
  // 標準（Noto Sans JP）以外の書体。PCに入っているフォントだけを使う。
  const FONTS = {
    yugothic: "'Yu Gothic UI','Yu Gothic','Meiryo',sans-serif",
    meiryo: "'Meiryo UI','Meiryo','Yu Gothic',sans-serif",
    bizud: "'BIZ UDPGothic','BIZ UDゴシック','Yu Gothic',sans-serif",
  };
  const SCALES = [0.9, 1, 1.1, 1.25];
  const apply = () => {
    let settings = {};
    try { settings = JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { /* 保存できない環境では標準の配色。 */ }
    const mode = settings.mode === 'dark' || settings.mode === 'system' && system.matches ? 'dark' : 'light';
    document.documentElement.dataset.uiTheme = settings.theme ?? 'navy';
    document.documentElement.dataset.uiMode = mode;
    // 画面の書体と表示サイズ。スライド本体（#stage）は自分の書体を持つので変わらない。
    const font = FONTS[settings.uiFont];
    if (font) { document.documentElement.dataset.uiFont = settings.uiFont; document.documentElement.style.setProperty('--ui-font', font); }
    else { delete document.documentElement.dataset.uiFont; document.documentElement.style.removeProperty('--ui-font'); }
    const scale = SCALES.includes(Number(settings.uiScale)) ? Number(settings.uiScale) : 1;
    if (scale !== 1) { document.documentElement.dataset.uiScale = String(scale); document.documentElement.style.setProperty('--ui-scale', String(scale)); }
    else { delete document.documentElement.dataset.uiScale; document.documentElement.style.removeProperty('--ui-scale'); }
  };
  apply();
  addEventListener('storage', event => { if (event.key === KEY) apply(); });
  system.addEventListener('change', apply);
  window.applyUiTheme = apply;
})();
