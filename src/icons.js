// 図解に添える線画アイコン（blocks[].icon に名前を書く）。48×48 の枠に描く。
// 線はカテゴリの濃い色（--primary）、class "a" は差し色の線（--accent）、"f" は淡い塗り（--soft）、"d" は差し色の塗り。
// 文字は描かない。名前を増やすときはここに1行足し、docs/LECTURE_FORMAT.md の一覧も更新する。
export const ICONS = {
  // 人・画面・端末
  user: '<circle class="f" cx="24" cy="16" r="8"/><path d="M9 42c0-9 6.5-14 15-14s15 5 15 14"/><path class="a" d="M19 35h10"/>',
  users: '<circle class="f" cx="18" cy="17" r="6.5"/><path d="M5 40c0-7.5 5.5-12 13-12s13 4.5 13 12"/><circle class="a" cx="33" cy="15" r="5"/><path class="a" d="M31 26c7 0 12 4 12 11"/>',
  app: '<rect class="f" x="5" y="7" width="38" height="27" rx="3"/><path d="M5 14h38M18 41h12M24 34v7"/><path class="a" d="M12 21h16M12 27h10"/>',
  device: '<rect class="f" x="13" y="4" width="22" height="40" rx="4"/><path d="M13 11h22M13 36h22"/><path class="a" d="M21 40h6M19 20h10M19 26h7"/>',
  web: '<circle class="f" cx="24" cy="24" r="18"/><path d="M6 24h36M24 6c-7 6-7 30 0 36M24 6c7 6 7 30 0 36"/><path class="a" d="M10 15h28M10 33h28"/>',
  terminal: '<rect class="f" x="5" y="8" width="38" height="32" rx="3"/><path d="M12 18l6 6-6 6"/><path class="a" d="M22 31h13"/>',
  code: '<path d="M16 14l-10 10 10 10M32 14l10 10-10 10"/><path class="a" d="M28 9l-8 30"/>',
  ai: '<path class="f" d="M24 5l4.5 14.5L43 24l-14.5 4.5L24 43l-4.5-14.5L5 24l14.5-4.5z"/><path class="a" d="M38 4v8M34 8h8"/>',
  // データ・保存
  database: '<ellipse class="f" cx="24" cy="11" rx="15" ry="6"/><path d="M9 11v26c0 3.3 6.7 6 15 6s15-2.7 15-6V11"/><path class="a" d="M9 24c0 3.3 6.7 6 15 6s15-2.7 15-6"/>',
  server: '<rect class="f" x="7" y="6" width="34" height="15" rx="3"/><rect class="f" x="7" y="27" width="34" height="15" rx="3"/><circle class="d" cx="14" cy="13.5" r="2.4"/><circle class="d" cx="14" cy="34.5" r="2.4"/><path d="M22 13.5h12M22 34.5h12"/>',
  table: '<path class="f" d="M5 11a3 3 0 0 1 3-3h32a3 3 0 0 1 3 3v7H5z"/><rect x="5" y="8" width="38" height="32" rx="3"/><path d="M5 18h38M5 29h38M18 8v32"/><path class="a" d="M23 23.5h14"/>',
  file: '<path class="f" d="M11 4h18l9 9v31H11z"/><path d="M29 4v9h9"/><path class="a" d="M17 22h15M17 29h15M17 36h9"/>',
  list: '<rect class="f" x="8" y="5" width="32" height="38" rx="3"/><path d="M22 14h12M22 23h12M22 32h12"/><path class="a" d="M14 14h3M14 23h3M14 32h3"/>',
  disk: '<rect class="f" x="5" y="13" width="38" height="22" rx="3"/><path d="M21 19v10M27 19v10M33 19v10"/><circle class="d" cx="12.5" cy="24" r="2.6"/>',
  memory: '<rect class="f" x="12" y="12" width="24" height="24" rx="2"/><path d="M18 5v7M24 5v7M30 5v7M18 36v7M24 36v7M30 36v7M5 18h7M5 24h7M5 30h7M36 18h7M36 24h7M36 30h7"/><rect class="a" x="19" y="19" width="10" height="10"/>',
  cloud: '<path class="f" d="M14 38h21a9 9 0 0 0 1.5-17.9A12 12 0 0 0 13.3 22 8 8 0 0 0 14 38z"/><path class="a" d="M18 31h12"/>',
  image: '<rect class="f" x="5" y="8" width="38" height="32" rx="3"/><path d="M5 34l11-11 9 9 5-5 13 13"/><circle class="a" cx="32" cy="18" r="4"/>',
  save: '<path class="f" d="M7 7h27l7 7v27H7z"/><path d="M14 7v10h17V7"/><rect class="a" x="14" y="27" width="20" height="14"/>',
  vector: '<path d="M7 6v35h35"/><circle class="d" cx="17" cy="30" r="3"/><circle class="d" cx="24" cy="22" r="3"/><circle class="f" cx="35" cy="14" r="3"/><circle class="f" cx="33" cy="32" r="3"/><path class="a" d="M17 30l7-8"/>',
  doc: '<path d="M18 7c-5 0-5 3-5 7.5S12 22 7 24c5 2 6 5 6 9.5s0 7.5 5 7.5M30 7c5 0 5 3 5 7.5S36 22 41 24c-5 2-6 5-6 9.5s0 7.5-5 7.5"/><circle class="d" cx="24" cy="24" r="3"/>',
  kv: '<rect class="f" x="4" y="14" width="15" height="20" rx="2"/><rect x="29" y="14" width="15" height="20" rx="2"/><path class="a" d="M21 24h6M24 21l3 3-3 3"/><path d="M8 24h7M33 21h7M33 27h7"/>',
  graph: '<path d="M14.5 14.5l17 0M13.5 16l9 17M34.5 17l-9 16"/><circle class="f" cx="11" cy="13" r="5"/><circle class="f" cx="36" cy="14" r="5"/><circle class="a" cx="24" cy="36" r="5"/>',
  columns: '<path d="M6 41h36"/><rect class="f" x="10" y="24" width="7" height="17"/><rect class="a" x="20.5" y="13" width="7" height="28"/><rect class="f" x="31" y="7" width="7" height="34"/>',
  // 探す・計る・考える
  search: '<circle class="f" cx="20" cy="20" r="13"/><path d="M30 30l12 12"/><path class="a" d="M13 18a7 7 0 0 1 6-6"/>',
  filter: '<path class="f" d="M6 8h36L28 25v13l-8 5V25z"/><path class="a" d="M13 14h22"/>',
  join: '<circle class="f" cx="18" cy="24" r="12"/><circle cx="30" cy="24" r="12"/><path class="a" d="M24 14v20"/>',
  tree: '<rect class="f" x="18" y="5" width="12" height="9" rx="1.5"/><path d="M24 14v7M11 21h26M11 21v8M24 21v8M37 21v8"/><rect class="f" x="5" y="29" width="12" height="9" rx="1.5"/><rect class="f" x="18" y="29" width="12" height="9" rx="1.5"/><rect class="a" x="31" y="29" width="12" height="9" rx="1.5"/>',
  scan: '<rect class="f" x="6" y="5" width="25" height="38" rx="2"/><path d="M12 13h13M12 21h13M12 29h13M12 37h13"/><path class="a" d="M39 7v31M35 34l4 5 4-5"/>',
  gauge: '<path class="f" d="M7 35a17 17 0 1 1 34 0z"/><path d="M12 22l3 2M24 15v4M36 22l-3 2"/><path class="a" d="M24 35l8-11"/><circle class="d" cx="24" cy="35" r="3"/>',
  target: '<circle class="f" cx="24" cy="24" r="17"/><circle cx="24" cy="24" r="9"/><circle class="d" cx="24" cy="24" r="3"/>',
  sliders: '<path d="M7 13h34M7 24h34M7 35h34"/><circle class="f" cx="16" cy="13" r="4"/><circle class="a" cx="31" cy="24" r="4"/><circle class="f" cx="20" cy="35" r="4"/>',
  route: '<path d="M16 37h11a6.5 6.5 0 0 0 0-13h-6a6.5 6.5 0 0 1 0-13h11"/><circle class="f" cx="11" cy="37" r="5"/><circle class="a" cx="37" cy="11" r="5"/>',
  parse: '<path d="M14 7H8v34h6M34 7h6v34h-6"/><path class="a" d="M16 17h16M16 24h10M16 31h13"/>',
  pen: '<path class="f" d="M30 7l11 11-21 21H9V28z"/><path class="a" d="M25 12l11 11"/><path d="M26 41h15"/>',
  play: '<circle class="f" cx="24" cy="24" r="18"/><path class="a" d="M20 16l12 8-12 8z"/>',
  idea: '<path class="f" d="M17 32c-4-3-6-7-6-11a13 13 0 0 1 26 0c0 4-2 8-6 11v4H17z"/><path d="M18 41h12"/><path class="a" d="M21 26l3 3 3-3"/>',
  // 安全・確定・復旧
  shield: '<path class="f" d="M24 4l16 6v12c0 10.5-6.8 18-16 22C14.8 40 8 32.5 8 22V10z"/><path class="a" d="M16.5 24l5.5 5.5 10-11"/>',
  lock: '<rect class="f" x="9" y="21" width="30" height="22" rx="3"/><path d="M15 21v-6a9 9 0 0 1 18 0v6"/><path class="a" d="M24 29v7"/>',
  key: '<circle class="f" cx="15" cy="31" r="9"/><path d="M21.5 24.5L40 6M34 12l5 5M28.5 17.5l4 4"/><circle class="d" cx="15" cy="31" r="2.6"/>',
  link: '<path d="M21 14l3.5-3.5a8.5 8.5 0 0 1 12 12L33 26M27 34l-3.5 3.5a8.5 8.5 0 0 1-12-12L15 22"/><path class="a" d="M19 29l10-10"/>',
  check: '<circle class="f" cx="24" cy="24" r="18"/><path class="a" d="M15.5 24.5l6 6 11-12"/>',
  restore: '<path d="M10 24a14 14 0 1 0 4.1-9.9"/><path d="M10 7v8h8"/><path class="a" d="M24 16v9l6 4"/>',
  refresh: '<path d="M39 20A15 15 0 0 0 11.5 14M9 28a15 15 0 0 0 27.5 6"/><path d="M11 6v8h8"/><path class="a" d="M37 42v-8h-8"/>',
  clock: '<circle class="f" cx="24" cy="24" r="18"/><path class="a" d="M24 13v11l7 5"/>',
  warning: '<path class="f" d="M24 5l20 36H4z"/><path class="a" d="M24 18v11M24 34v1"/>',
  bundle: '<path class="f" d="M24 5l17 8.5v19L24 41 7 32.5v-19z"/><path d="M7 13.5L24 22l17-8.5M24 22v19"/><path class="a" d="M15.5 9.3l17 8.5"/>',
  flag: '<path d="M11 43V5"/><path class="f" d="M11 7h24l-5.5 7.5L35 22H11"/><path class="a" d="M17 14h7"/>',
  scale: '<path d="M24 7v33M15 41h18M9 13h30"/><path class="f" d="M9 13L4 25h10z"/><path class="f" d="M39 13l-5 12h10z"/><circle class="d" cx="24" cy="9" r="2.5"/>',
  isolate: '<rect class="f" x="4" y="13" width="15" height="22" rx="2"/><rect class="f" x="29" y="13" width="15" height="22" rx="2"/><path class="a" d="M24 6v4M24 15v4M24 24v4M24 33v4M24 42v1"/>',
  bolt: '<path class="f" d="M28 3L9 27h13l-3 18 20-25H26z"/><path class="a" d="M33 8l4-3M38 14h4"/>',
  out: '<path d="M21 11H10a3 3 0 0 0-3 3v24a3 3 0 0 0 3 3h24a3 3 0 0 0 3-3V27"/><path class="a" d="M23 25L41 7M31 7h10v10"/>',
  in: '<path d="M21 11H10a3 3 0 0 0-3 3v24a3 3 0 0 0 3 3h24a3 3 0 0 0 3-3V27"/><path class="a" d="M41 7L23 25M23 15v10h10"/>',
  yen: '<circle class="f" cx="24" cy="24" r="18"/><path d="M17 13l7 10 7-10M24 23v13"/><path class="a" d="M18 27h12M18 32h12"/>',
  cart: '<path d="M4 8h6l5 22h22l4-15H12"/><circle class="f" cx="18" cy="37" r="3.5"/><circle class="a" cx="34" cy="37" r="3.5"/>',
  // 学ぶ・進める・つなぐ
  book: '<path class="f" d="M24 12C19 8 12 8 6 10v28c6-2 13-2 18 2 5-4 12-4 18-2V10c-6-2-13-2-18 2z"/><path d="M24 12v28"/><path class="a" d="M11 17h7M30 17h7"/>',
  rocket: '<path class="f" d="M24 4c8 6 10.5 15 8 24H16c-2.5-9 0-18 8-24z"/><circle class="a" cx="24" cy="17" r="3.5"/><path d="M16 27l-6 6v7l7-4M32 27l6 6v7l-7-4"/><path class="a" d="M21 34l3 8 3-8"/>',
  map: '<path class="f" d="M5 10l12-5 14 5 12-5v33l-12 5-14-5-12 5z"/><path d="M17 5v33M31 10v33"/><circle class="d" cx="24" cy="22" r="3"/>',
  layers: '<path class="f" d="M24 5l19 9.5L24 24 5 14.5z"/><path d="M5 24l19 9.5L43 24"/><path class="a" d="M5 33l19 9.5L43 33"/>',
  api: '<path d="M18 5v9M30 5v9M24 35v8"/><path class="f" d="M12 14h24v8a12 12 0 0 1-24 0z"/><path class="a" d="M19 23h10"/>',
  gear: '<circle class="f" cx="24" cy="24" r="11"/><path d="M24 5v6M24 37v6M5 24h6M37 24h6M10.6 10.6l4.2 4.2M33.2 33.2l4.2 4.2M10.6 37.4l4.2-4.2M33.2 14.8l4.2-4.2"/><circle class="a" cx="24" cy="24" r="4.5"/>',
  todo: '<rect class="f" x="8" y="5" width="32" height="38" rx="3"/><path class="a" d="M13 16l3 3 5-6M13 30l3 3 5-6"/><path d="M26 16h9M26 31h9"/>',
  // 医療（透析など）
  blood: '<path class="f" d="M24 5C17 15 11 22 11 30a13 13 0 0 0 26 0c0-8-6-15-13-25z"/><path class="a" d="M17.5 31a6.5 6.5 0 0 0 6.5 6.5"/>',
  diffusion: '<path d="M24 5v38" stroke-dasharray="3 5"/><circle class="d" cx="10" cy="13" r="2.8"/><circle class="d" cx="16" cy="22" r="2.8"/><circle class="d" cx="9" cy="31" r="2.8"/><circle class="d" cx="15" cy="39" r="2.8"/><circle class="d" cx="36" cy="35" r="2.8"/><path class="a" d="M17 30h19M32 26l4 4-4 4"/>',
  filtration: '<path class="f" d="M15 9C11 15 7 19 7 24.5a8 8 0 0 0 16 0C23 19 19 15 15 9z"/><path d="M29 5v38"/><path class="a" d="M17 36h24M37 32l4 4-4 4"/><path class="a" d="M33 12h6M33 20h6"/>',
  heart: '<path class="f" d="M24 41C12 32 6 25 6 17.5a9 9 0 0 1 18-3 9 9 0 0 1 18 3C42 25 36 32 24 41z"/><path class="a" d="M11 23h7l3-5 4 9 3-4h9"/>',
  // 連絡・確認・支払い
  mail: '<rect class="f" x="5" y="10" width="38" height="28" rx="3"/><path d="M5 13l19 14 19-14"/><path class="a" d="M5 36l13-11M43 36L30 25"/>',
  chat: '<path class="f" d="M6 9h36v22H20l-9 8v-8H6z"/><path class="a" d="M13 17h22M13 23h14"/>',
  eye: '<path class="f" d="M3 24c5-9 12-14 21-14s16 5 21 14c-5 9-12 14-21 14S8 33 3 24z"/><circle cx="24" cy="24" r="7"/><circle class="d" cx="24" cy="24" r="2.6"/>',
  card: '<rect class="f" x="4" y="11" width="40" height="27" rx="3"/><path d="M4 19h40"/><path class="a" d="M10 30h10M26 30h5"/>',
  bug: '<rect class="f" x="15" y="15" width="18" height="25" rx="9"/><path d="M19 15a5 5 0 0 1 10 0M15 23H7M15 32H7M33 23h8M33 32h8M12 9l5 5M36 9l-5 5"/><path class="a" d="M24 20v17"/>',
  trash: '<path class="f" d="M11 13h26l-2.5 29h-21z"/><path d="M7 13h34M19 13V7h10v6"/><path class="a" d="M20 20v15M28 20v15"/>',
};
export const ICON_NAMES = Object.keys(ICONS);
// アイコンを置けるレイアウト（図解の各ブロック）。chat・code・message・title は対象外。
export const ICON_LAYOUTS = ['agenda', 'statement', 'flow', 'steps', 'compare', 'table', 'bars', 'timeline', 'cycle', 'stack', 'takehome'];

// <span class="block-icon"><svg>…</svg></span> を作る（ブラウザ専用）。
export function iconElement(name) {
  const holder = document.createElement('span'); holder.className = 'block-icon'; holder.dataset.icon = name;
  holder.innerHTML = `<svg viewBox="0 0 48 48" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return holder;
}
