// 全画面プレゼン中のスライド一覧（G）。縮小表示を選ぶと、そのスライドへ移る。
const PADDING_PX = 40, GAP_PX = 20, SCROLLBAR_PX = 16;

export const overviewColumns = count => count <= 9 ? 3 : count <= 16 ? 4 : count <= 30 ? 5 : 6;
// 矢印キーでの移動先。端では止まり、最後の行の途中で ↓ を押したら最後のスライドへ移る。
export const overviewTarget = (index, code, columns, count) => {
  const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }[code];
  if (delta === undefined) return index;
  const next = index + delta;
  if (next < 0) return index;
  if (next >= count) return code === 'ArrowDown' && Math.floor(index / columns) < Math.floor((count - 1) / columns) ? count - 1 : index;
  return next;
};

export function initSlideOverview({ dialog, slides, currentIndex, drawThumbnail, onSelect, onClose }) {
  const grid = dialog.querySelector('[data-overview-grid]');
  let built = false;

  const items = () => [...grid.children];
  const layout = () => {
    const columns = overviewColumns(items().length);
    const width = Math.floor((window.innerWidth - PADDING_PX * 2 - SCROLLBAR_PX - GAP_PX * (columns - 1)) / columns);
    dialog.style.setProperty('--overview-columns', String(columns));
    dialog.style.setProperty('--thumb-width', `${width}px`);
    dialog.style.setProperty('--thumb-scale', String(width / 1920));
  };
  const build = () => {
    grid.replaceChildren(...slides().map((title, index) => {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'overview-item'; button.dataset.index = String(index);
      button.setAttribute('aria-label', `${index + 1}枚目 ${title}`);
      const thumb = document.createElement('span'); thumb.className = 'overview-thumb'; thumb.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span'); label.className = 'overview-label';
      const number = document.createElement('b'); number.textContent = String(index + 1).padStart(2, '0');
      const name = document.createElement('span'); name.textContent = title;
      label.append(number, name);
      button.append(thumb, label);
      drawThumbnail(thumb, index);
      return button;
    }));
    built = true;
  };

  const close = () => { if (dialog.open) dialog.close(); };
  const open = () => {
    if (dialog.open) return;
    if (!built) build();
    layout();
    const current = currentIndex();
    items().forEach((item, index) => item.setAttribute('aria-current', String(index === current)));
    dialog.showModal();
    items()[current]?.focus({ preventScroll: true });
    items()[current]?.scrollIntoView({ block: 'nearest' });
  };

  dialog.addEventListener('close', onClose);
  dialog.addEventListener('click', event => {
    const item = event.target.closest('.overview-item');
    if (item) { onSelect(Number(item.dataset.index)); close(); }
    else if (event.target === dialog || event.target === grid || event.target.closest('[data-overview-close]')) close();
  });
  dialog.addEventListener('contextmenu', event => event.preventDefault());
  // 一覧のスクロールが、裏のスライドの拡大（ホイール）として働かないようにする。
  dialog.addEventListener('wheel', event => event.stopPropagation(), { passive: true });
  dialog.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.code === 'KeyG') { event.preventDefault(); close(); return; }
    if (!event.code.startsWith('Arrow')) return;
    event.preventDefault();
    const list = items(), index = list.indexOf(document.activeElement);
    const target = list[overviewTarget(Math.max(0, index), event.code, overviewColumns(list.length), list.length)];
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'nearest' });
  });
  window.addEventListener('resize', () => { if (dialog.open) layout(); });

  return { open, close, toggle() { if (dialog.open) close(); else open(); }, invalidate() { close(); built = false; grid.replaceChildren(); } };
}
