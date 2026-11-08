// 全画面プレゼン中のマウスカーソルとレーザーポインター（L）。
// カーソルはマウスを動かしたときだけ出し、止まると隠す。音声付き再生（Space）中は収録に映らないよう出さない。
// レーザーポインターは L を押したときだけ出すので、音声付き再生中にも使える。
const HIDE_AFTER_MS = 2500;
// 全画面への切り替えでブラウザが送る座標の変わらない mousemove や、机の振動による微小な動きには反応しない。
const MOVE_THRESHOLD_PX = 3;

export function initPresentationPointer({ dot, presenting, autoplaying, penActive, onActivity }) {
  let laser = false, inside = true, clientPoint = null, screenPoint = null, hideTimer = 0;

  const drawDot = () => {
    dot.hidden = !(laser && inside && clientPoint);
    if (!dot.hidden) dot.style.translate = `${clientPoint.x}px ${clientPoint.y}px`;
  };
  const hideCursor = () => {
    clearTimeout(hideTimer);
    document.body.classList.remove('pointer-cursor');
  };
  const showCursor = () => {
    document.body.classList.add('pointer-cursor');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hideCursor, HIDE_AFTER_MS);
  };
  const movedEnough = event => {
    const moved = screenPoint && Math.abs(event.screenX - screenPoint.x) + Math.abs(event.screenY - screenPoint.y) >= MOVE_THRESHOLD_PX;
    if (moved || !screenPoint) screenPoint = { x: event.screenX, y: event.screenY };
    return !!moved;
  };

  document.addEventListener('mousemove', event => {
    clientPoint = { x: event.clientX, y: event.clientY };
    inside = true;
    const moved = movedEnough(event);
    drawDot();
    if (!moved || !presenting() || autoplaying()) return;
    onActivity();
    if (!laser && !penActive()) showCursor();
  });
  document.documentElement.addEventListener('mouseleave', () => { inside = false; drawDot(); });

  return {
    get laser() { return laser; },
    hideCursor,
    toggleLaser() {
      laser = !laser;
      hideCursor();
      drawDot();
    },
    reset() {
      laser = false;
      hideCursor();
      drawDot();
    },
  };
}
