// 講義をPDF（16:9・1スライド1ページ）にする。文字は画像にせずテキストのまま残すので、選択・検索ができる。
// 1. 録画モードの画面（1920×1080）で各スライドを最後まで進め、要点・図・動きを最終状態にして画面の要素を写し取る。
// 2. 写し取ったスライドを1ページずつ並べ、ChromeのPDF印刷（Page.printToPDF）で1つのPDFにする。
// npm run pdf（tools/pdf.mjs）と、スタジオの再生画面の「PDFを書き出す」（server.mjs が base を渡して呼ぶ）で使う。
import { loadLecture } from './project.mjs';
import { launchBrowser, until, sleep } from './browser.mjs';
import { cueState } from '../../src/core.js';

export const pdfFileOf = name => `${name}.pdf`;

// 写し取ったスライドどうしで、図（SVG）のグラデーションや矢印のIDが重ならないよう、ページごとに名前を変える。
const CLONE_SLIDE = `(page => {
  const shell = document.getElementById('stage-shell').cloneNode(true);
  const ids = new Map();
  for (const el of shell.querySelectorAll('svg [id], svg[id]')) { const id = el.id; ids.set(id, id + '__p' + page); el.id = ids.get(id); }
  if (ids.size) for (const el of shell.querySelectorAll('*')) for (const attr of [...el.attributes]) {
    if (!attr.value.includes('#')) continue;
    const value = attr.value.replace(/url\\(\\s*(['"]?)#([^'")\\s]+)\\1\\s*\\)/g, (all, q, id) => ids.has(id) ? 'url(#' + ids.get(id) + ')' : all)
      .replace(/^#(.+)$/, (all, id) => /href$/i.test(attr.name) && ids.has(id) ? '#' + ids.get(id) : all);
    if (value !== attr.value) el.setAttribute(attr.name, value);
  }
  shell.removeAttribute('tabindex'); shell.style.cssText = '';
  shell.querySelector('#stage').style.transform = 'none';
  const page$ = document.createElement('div'); page$.className = 'pdf-page'; page$.append(shell);
  (window.__pdfPages ??= []).push(page$);
  return true;
})`;

// 画面の操作部分を外し、写し取ったスライドだけを並べた印刷用の文書にする。プレイヤーの再描画が写しに触れないよう止める。
const BUILD_PRINT = `(() => {
  slideStudio.player.pause?.();
  window.requestAnimationFrame = () => 0;
  const style = document.createElement('style');
  style.textContent = '@page{size:1920px 1080px;margin:0}' +
    'html,body{margin:0!important;padding:0!important;width:1920px!important;height:auto!important;overflow:visible!important;background:#fff!important}' +
    '.pdf-page{width:1920px;height:1080px;position:relative;overflow:hidden;break-after:page;page-break-after:always}' +
    '.pdf-page:last-child{break-after:auto;page-break-after:auto}' +
    '.pdf-page #stage-shell{position:relative!important;width:1920px!important;height:1080px!important;border-radius:0!important;box-shadow:none!important;outline:none!important}' +
    '.pdf-page #stage{transform:none!important}.pdf-page .film-progress{display:none!important}' +
    '*,*::before,*::after{transition:none!important;animation-play-state:paused!important}';
  document.head.append(style);
  document.body.replaceChildren(...window.__pdfPages);
  return document.fonts.ready.then(() => [...document.images].every(img => img.complete));
})()`;

export async function exportPdf(name, { base, log = () => {} } = {}) {
  const lecture = await loadLecture(name); // 講義名と lecture.json を先に確かめる。
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
    // 動画の書き出しと同じく、要点のフェードを止めて時刻どおりに描く。各スライドは最後まで進めた状態（要点も動きも出そろった画面）にする。
    await cdp.evaluate("document.fonts.ready.then(() => { const style = document.createElement('style'); style.textContent = '.reveal{transition:none!important}.film-progress{display:none!important}'; document.head.append(style); slideStudio.frames = true; return true; })");
    for (const [index, slide] of lecture.slides.entries()) {
      const duration = await cdp.evaluate(`slideStudio.player.load(${index}); slideStudio.player.seek(slideStudio.player.duration); slideStudio.player.duration`);
      const expected = JSON.stringify(JSON.stringify([...cueState(slide.cues, duration)].sort()));
      await until(() => cdp.evaluate(`document.body.dataset.slide === ${JSON.stringify(slide.id)} && JSON.stringify([...document.querySelectorAll('[data-block].visible')].map(el => el.dataset.block).sort()) === ${expected}`), `スライド${slide.id}の表示が最後の状態になりません`);
      await until(() => cdp.evaluate("[...document.querySelectorAll('#slide-content img')].every(img => img.complete && img.naturalWidth > 0)"), `スライド${slide.id}の画像を読み込めません`);
      await cdp.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      await sleep(60);
      await cdp.evaluate(`${CLONE_SLIDE}(${index + 1})`);
      log(`写し ${slide.id}`);
    }
    await until(() => cdp.evaluate(BUILD_PRINT), 'PDF用の画面を準備できません');
    await cdp.evaluate('new Promise(resolve => setTimeout(resolve, 200))');
    // 1920×1080px（20×11.25インチ）を1ページに。背景色・図の色もそのまま残す。
    const { data } = await cdp.send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true, paperWidth: 20, paperHeight: 11.25, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0 }, sessionId);
    return Buffer.from(data, 'base64');
  } finally {
    if (session) await session.close();
    if (server) await new Promise(resolve => server.close(resolve));
  }
}
