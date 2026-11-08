// 1枚目（サムネイル）を、動画と同じ録画モードの画面（1920×1080）で撮影してJPGにする。動画サイトのサムネイル用。
// スタジオの再生画面の「サムネイルをJPGで保存」（server.mjs が base を渡して呼ぶ）と npm run thumbnail（tools/thumbnail.mjs）で使う。
import { loadLecture } from './project.mjs';
import { launchBrowser, until, sleep } from './browser.mjs';

export const thumbnailFileOf = name => `${name}_thumbnail.jpg`;

export async function captureThumbnail(name, { base, quality = 92 } = {}) {
  await loadLecture(name); // 講義名と lecture.json を先に確かめる。
  let server, session;
  try {
    if (!base) {
      // server.mjs はこのファイルを読み込むため、循環しないよう実行時に読み込む。
      const { createStudioServer } = await import('../server.mjs');
      server = await createStudioServer({ port: 0 });
      base = `http://127.0.0.1:${server.address().port}`;
    }
    session = await launchBrowser();
    const { cdp, sessionId } = session;
    await cdp.send('Page.navigate', { url: `${base}/?lecture=${encodeURIComponent(name)}&record=1` }, sessionId);
    await until(() => cdp.evaluate(`window.slideStudio?.player?.lecture && new URLSearchParams(location.search).get('lecture') === ${JSON.stringify(name)}`), 'プレイヤーを読み込めません');
    // 表示アニメーションと下端の進行バーを止め、1枚目の要点をすべて表示した状態にする。
    await cdp.evaluate("document.fonts.ready.then(() => { const style = document.createElement('style'); style.textContent = '.reveal{transition:none!important}.film-progress{display:none!important}'; document.head.append(style); return true; })");
    await cdp.evaluate('slideStudio.player.load(0); slideStudio.player.seek(slideStudio.player.duration)');
    await until(() => cdp.evaluate("[...document.querySelectorAll('[data-block]')].every(el => el.classList.contains('visible')) && [...document.querySelectorAll('#slide-content img')].every(img => img.complete && img.naturalWidth > 0)"), 'サムネイルの画像を読み込めません');
    await cdp.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await sleep(60);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality }, sessionId);
    return Buffer.from(shot.data, 'base64');
  } finally {
    if (session) await session.close();
    if (server) await new Promise(resolve => server.close(resolve));
  }
}
