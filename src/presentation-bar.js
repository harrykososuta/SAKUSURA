// 全画面プレゼン中の操作バー（PowerPointのスライドショー左下のツールバーに相当）。
// マウスを動かすと左下に出て、止めると隠れる。バーの上にマウスがある間は隠さない。
// 音声付き再生中は呼ばれないので、収録には映らない。
const HIDE_AFTER_MS = 2500;

export function initPresentationBar({ bar, commands, state, colors }) {
  let shown = false, hideTimer = 0;
  const counter = bar.querySelector('[data-counter]');
  const toggles = [...bar.querySelectorAll('[data-state]')];
  // ペンの色はペンを選んでいる間だけ出す。
  const swatches = colors.map(({ id, label, value }, index) => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'bar-swatch';
    button.dataset.command = 'color'; button.dataset.color = id;
    button.title = `ペンの色：${label}（${index + 1}）`;
    button.setAttribute('aria-label', `ペンの色：${label}`);
    button.style.setProperty('--swatch', value);
    return button;
  });
  bar.querySelector('[data-colors]').append(...swatches);

  const sync = () => {
    if (!shown) return;
    const current = state();
    for (const button of toggles) button.setAttribute('aria-pressed', String(!!current[button.dataset.state]));
    for (const button of swatches) button.setAttribute('aria-pressed', String(button.dataset.color === current.color));
    bar.classList.toggle('is-pen', !!current.pen);
    counter.textContent = current.counter;
  };
  const hide = () => {
    clearTimeout(hideTimer);
    shown = false;
    bar.classList.remove('is-shown');
  };
  const scheduleHide = () => {
    clearTimeout(hideTimer);
    if (!bar.matches(':hover')) hideTimer = setTimeout(hide, HIDE_AFTER_MS);
  };
  const show = () => {
    shown = true;
    bar.classList.add('is-shown');
    sync();
    scheduleHide();
  };

  // ボタンにフォーカスを移さない（続けて Space や → で操作できるように）。
  bar.addEventListener('mousedown', event => event.preventDefault());
  bar.addEventListener('contextmenu', event => event.preventDefault());
  bar.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  bar.addEventListener('mouseleave', () => { if (shown) hideTimer = setTimeout(hide, HIDE_AFTER_MS); });
  bar.addEventListener('click', event => {
    const button = event.target.closest('[data-command]');
    if (!button) return;
    commands[button.dataset.command](button.dataset);
    sync();
  });

  return { show, hide, sync };
}
