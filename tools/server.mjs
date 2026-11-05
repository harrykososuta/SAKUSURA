import { createServer } from 'node:http';
import { readFile, readdir, stat, mkdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, lectureRoot, loadLecture, loadTtsConfig, argumentValue, codeVersion } from './lib/project.mjs';
import { ffmpegExecutable } from './lib/ffmpeg.mjs';
import { audioManifest } from './lib/cache.mjs';
import { imageManifest } from './lib/images.mjs';
import { readEditableLecture, saveEditableLecture, readEditorBody } from './lib/editor-store.mjs';
import { createTtsJobs } from './lib/tts-jobs.mjs';
import { createRenderJobs } from './lib/render-jobs.mjs';
import { captureThumbnail, thumbnailFileOf } from './lib/thumbnail.mjs';
import { exportPdf, pdfFileOf } from './lib/pdf.mjs';
import { spawn } from 'node:child_process';
import { createLibraryStore, listLectures } from './lib/library-store.mjs';
import { createLectureWatch } from './lib/lecture-watch.mjs';
import { createDesignStore } from './lib/design-store.mjs';
import { createDesignPdfStore, readPdfUpload } from './lib/design-pdf-store.mjs';
import { createDesignImportStore } from './lib/design-import-store.mjs';
import { createPdfDesignStore } from './lib/pdf-design-store.mjs';
import { createCategoryDesignStore } from './lib/category-design-store.mjs';
import { listLectureHistory, readLectureHistory } from './lib/lecture-history.mjs';
import { readImageUpload, saveImageUpload } from './lib/image-upload.mjs';
import { readHtmlDeck, htmlDeckPage, HTML_DECK_CSP } from './lib/html-decks.mjs';

const PUBLIC_FILES = new Map([
  ['/sakusura.svg', ['public/sakusura.svg', 'image/svg+xml']],
  ['/', ['public/index.html', 'text/html; charset=utf-8']],
  ['/editor', ['public/editor.html', 'text/html; charset=utf-8']],
  ['/library', ['public/library.html', 'text/html; charset=utf-8']],
  ['/settings', ['public/settings.html', 'text/html; charset=utf-8']],
  ['/src/settings.js', ['src/settings.js', 'text/javascript; charset=utf-8']],
  ['/src/settings.css', ['src/settings.css', 'text/css; charset=utf-8']],
  ['/src/theme.js', ['src/theme.js', 'text/javascript; charset=utf-8']],
  ['/src/theme.css', ['src/theme.css', 'text/css; charset=utf-8']],
  ['/design', ['public/design-gallery.html', 'text/html; charset=utf-8']],
  ['/design/detail', ['public/design.html', 'text/html; charset=utf-8']],
  ['/design/new', ['public/design-editor.html', 'text/html; charset=utf-8']],
  ['/design/edit', ['public/design-editor.html', 'text/html; charset=utf-8']],
  ['/design/preview', ['public/design-preview.html', 'text/html; charset=utf-8']],
  ['/src/design.js', ['src/design.js', 'text/javascript; charset=utf-8']],
  ['/src/design-gallery.js', ['src/design-gallery.js', 'text/javascript; charset=utf-8']],
  ['/src/design-gallery.css', ['src/design-gallery.css', 'text/css; charset=utf-8']],
  ['/src/design-catalog.js', ['src/design-catalog.js', 'text/javascript; charset=utf-8']],
  ['/src/design-theme.js', ['src/design-theme.js', 'text/javascript; charset=utf-8']],
  ['/src/design-theme.css', ['src/design-theme.css', 'text/css; charset=utf-8']],
  ['/src/design-editor.js', ['src/design-editor.js', 'text/javascript; charset=utf-8']],
  ['/src/design-workspace.js', ['src/design-workspace.js', 'text/javascript; charset=utf-8']],
  ['/src/design-text.js', ['src/design-text.js', 'text/javascript; charset=utf-8']],
  ['/src/design-sample.js', ['src/design-sample.js', 'text/javascript; charset=utf-8']],
  ['/src/design-compositions.js', ['src/design-compositions.js', 'text/javascript; charset=utf-8']],
  ['/src/design-motion-controls.js', ['src/design-motion-controls.js', 'text/javascript; charset=utf-8']],
  ['/src/design-pdf.js', ['src/design-pdf.js', 'text/javascript; charset=utf-8']],
  ['/src/design-import.js', ['src/design-import.js', 'text/javascript; charset=utf-8']],
  ['/src/design-customize.js', ['src/design-customize.js', 'text/javascript; charset=utf-8']],
  ['/src/pdf-design.js', ['src/pdf-design.js', 'text/javascript; charset=utf-8']],
  ['/src/category-designs.js', ['src/category-designs.js', 'text/javascript; charset=utf-8']],
  ['/src/design-editor.css', ['src/design-editor.css', 'text/css; charset=utf-8']],
  ['/src/design.css', ['src/design.css', 'text/css; charset=utf-8']],
  ['/player', ['public/index.html', 'text/html; charset=utf-8']],
  ['/src/library.js', ['src/library.js', 'text/javascript; charset=utf-8']],
  ['/src/library.css', ['src/library.css', 'text/css; charset=utf-8']],
  ['/src/lecture-picker.js', ['src/lecture-picker.js', 'text/javascript; charset=utf-8']],
  ['/src/lecture-browser.js', ['src/lecture-browser.js', 'text/javascript; charset=utf-8']],
  ['/src/insert-browser.js', ['src/insert-browser.js', 'text/javascript; charset=utf-8']],
  ['/src/document-layout.js', ['src/document-layout.js', 'text/javascript; charset=utf-8']],
  ['/src/lecture-browser.css', ['src/lecture-browser.css', 'text/css; charset=utf-8']],
  ['/src/editor.js', ['src/editor.js', 'text/javascript; charset=utf-8']],
  ['/src/editor-history.js', ['src/editor-history.js', 'text/javascript; charset=utf-8']],
  ['/src/editor-images.js', ['src/editor-images.js', 'text/javascript; charset=utf-8']],
  ['/src/editor-animation.js', ['src/editor-animation.js', 'text/javascript; charset=utf-8']],
  ['/src/history-data.js', ['src/history-data.js', 'text/javascript; charset=utf-8']],
  ['/src/image-data.js', ['src/image-data.js', 'text/javascript; charset=utf-8']],
  ['/src/editor.css', ['src/editor.css', 'text/css; charset=utf-8']],
  ['/src/editor-elements.js', ['src/editor-elements.js', 'text/javascript; charset=utf-8']],
  ['/src/slide-view.js', ['src/slide-view.js', 'text/javascript; charset=utf-8']],
  ['/src/placement.js', ['src/placement.js', 'text/javascript; charset=utf-8']],
  ['/src/shapes.js', ['src/shapes.js', 'text/javascript; charset=utf-8']],
  ['/src/icons.js', ['src/icons.js', 'text/javascript; charset=utf-8']],
  ['/src/motion.js', ['src/motion.js', 'text/javascript; charset=utf-8']],
  ['/src/hd-circuit-motion.js', ['src/hd-circuit-motion.js', 'text/javascript; charset=utf-8']],
  ['/src/animation.js', ['src/animation.js', 'text/javascript; charset=utf-8']],
  ['/src/presentation-motion.js', ['src/presentation-motion.js', 'text/javascript; charset=utf-8']],
  ['/src/player.js', ['src/player.js', 'text/javascript; charset=utf-8']],
  ['/src/extension-stubs.js', ['src/extension-stubs.js', 'text/javascript; charset=utf-8']],
  ['/src/presentation-pointer.js', ['src/presentation-pointer.js', 'text/javascript; charset=utf-8']],
  ['/src/presentation-tools.js', ['src/presentation-tools.js', 'text/javascript; charset=utf-8']],
  ['/src/presentation-bar.js', ['src/presentation-bar.js', 'text/javascript; charset=utf-8']],
  ['/src/presentation-overview.js', ['src/presentation-overview.js', 'text/javascript; charset=utf-8']],
  ['/src/core.js', ['src/core.js', 'text/javascript; charset=utf-8']],
  ['/src/style.css', ['src/style.css', 'text/css; charset=utf-8']],
]);
// 書き込み・実行を伴う操作は、このスタジオの画面（同じOrigin・専用ヘッダー・JSON）からの要求だけを受け付ける。
const fromStudio = (request, contentType = 'application/json') => {
  const host = request.headers.host;
  return /^(127\.0\.0\.1|localhost):\d+$/.test(host ?? '') && request.headers.origin === `http://${host}` && request.headers['x-studio-editor'] === '1' && (request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase() === contentType;
};
// 読み取りでも、AIの作業記録や変更通知は別サイトから覗かれないよう、このPCのアドレスで開いた画面に限る。
const localRequest = request => /^(127\.0\.0\.1|localhost):\d+$/.test(request.headers.host ?? '');
// 書き出し先（exports/）をエクスプローラーなどで開く。開く場所は固定で、画面からは指定させない。
const openExports = () => {
  const command = { win32: 'explorer.exe', darwin: 'open' }[process.platform] ?? 'xdg-open';
  spawn(command, [join(ROOT, 'exports')], { detached: true, stdio: 'ignore', windowsHide: false }).on('error', () => {}).unref();
};
export async function createStudioServer({ port = 4173, checkFfmpeg = false, ttsJobs = createTtsJobs(), renderJobs = createRenderJobs(), openFolder = openExports, libraryStore = createLibraryStore(), thumbnail = captureThumbnail, deckPdf = exportPdf, lectureWatch = createLectureWatch(), designStore = createDesignStore(), pdfStore = createDesignPdfStore(), pdfDesignStore = designStore.pdfDesignStore ?? createPdfDesignStore({ pdfStore }), designImportStore = createDesignImportStore({ directory: join(designStore.directory ?? join(ROOT, 'designs'), 'imports'), designStore, pdfStore, pdfDesignStore }), categoryDesignStore = createCategoryDesignStore({ directory: designStore.directory ?? join(ROOT, 'designs'), designStore }) } = {}) {
  let capturing = false; // サムネイルの撮影はブラウザを起動するので同時に1つだけ。
  let printing = false; // PDFの作成も同じくブラウザを起動するので同時に1つだけ。
  const config = await loadTtsConfig();
  const startedVersion = await codeVersion();
  // スタジオとして起動したときだけ、この環境で動画を書き出せるかを調べて /api/health で知らせる（launch.mjs が見る）。
  let ffmpegAvailable = null;
  if (checkFfmpeg) ffmpegExecutable().then(() => { ffmpegAvailable = true; }, () => { ffmpegAvailable = false; });
  const assertActiveLecture = async name => {
    lectureRoot(name);
    if(await libraryStore.isTrashed(name))throw Object.assign(new Error('この講義はごみ箱にあります。講義ライブラリから復元してください。'),{status:410});
  };
  const server = createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    const json = (data, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(data)); };
    // DNSリバインディング対策：このPCのアドレス（127.0.0.1 / localhost）で開いた要求だけに応える。
    if (!localRequest(request)) { json({ error: 'このPCのアドレス（http://127.0.0.1）で開いてください。' }, 403); return; }
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.pathname === '/html-slides' || url.pathname === '/html-slides/document') {
        if (!['GET', 'HEAD'].includes(request.method)) { json({ error: '対応していない操作です。' }, 405); return; }
        const name = url.searchParams.get('name');
        await assertActiveLecture(name);
        const deck = await readHtmlDeck(name);
        const document = url.pathname.endsWith('/document');
        const data = document ? await readFile(deck.path) : Buffer.from(htmlDeckPage(deck.item));
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': data.length, 'Content-Security-Policy': document ? HTML_DECK_CSP : "default-src 'none'; style-src 'unsafe-inline'; frame-src 'self'; img-src data:; base-uri 'none'; frame-ancestors 'self'", 'Referrer-Policy': 'no-referrer' });
        response.end(request.method === 'HEAD' ? undefined : data); return;
      }
      if (url.pathname === '/api/lecture/history') {
        if (!localRequest(request) || (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`)) { json({ error: 'スタジオの編集画面から開いてください。' }, 403); return; }
        if (request.method !== 'GET') { json({ error: '対応していない操作です。' }, 405); return; }
        const name = url.searchParams.get('name'); await assertActiveLecture(name);
        if (!url.searchParams.has('file')) json(await listLectureHistory(name));
        else {
          const lecture = await readLectureHistory(name, url.searchParams.get('file'));
          json({ lecture, images: await imageManifest(name, lecture) });
        }
        return;
      }
      if (url.pathname === '/api/lecture/images') {
        if (request.method !== 'POST') { json({ error: '対応していない操作です。' }, 405); return; }
        if (!fromStudio(request, 'application/octet-stream')) { json({ error: 'スタジオの編集画面から画像を追加してください。' }, 403); return; }
        const name = url.searchParams.get('name'); await assertActiveLecture(name);
        json(await saveImageUpload(name, await readImageUpload(request)), 201); return;
      }
      if (url.pathname === '/api/category-designs') {
        if (!localRequest(request)) { json({ error: 'このPCのデザイン画面から操作してください。' }, 403); return; }
        try {
          if (request.method === 'GET') json(await categoryDesignStore.get());
          else if (request.method === 'POST' && fromStudio(request)) json(await categoryDesignStore.save(await readEditorBody(request)));
          else json({ error: 'デザイン画面から保存してください。' }, 403);
        } catch (error) { json({ error: error.status ? error.message : 'カテゴリの設定を読み書きできません。' }, error.status ?? 500); }
        return;
      }
      if (url.pathname === '/api/pdf-designs' || url.pathname === '/api/pdf-designs/asset') {
        if (!localRequest(request)) { json({ error: 'このPCのデザイン画面から操作してください。' }, 403); return; }
        try {
          if (!['GET', 'HEAD'].includes(request.method)) { json({ error: '対応していない操作です。' }, 405); return; }
          if (url.pathname === '/api/pdf-designs') json(await pdfDesignStore.get(url.searchParams.get('id')));
          else {
            const { buffer, type } = await pdfDesignStore.asset(url.searchParams.get('id'), url.searchParams.get('file'));
            response.writeHead(200, { 'Content-Type': type, 'Content-Length': buffer.length, 'Cross-Origin-Resource-Policy': 'same-origin', 'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'" });
            response.end(request.method === 'HEAD' ? undefined : buffer);
          }
        } catch (error) { json({ error: error.status ? error.message : 'PDFのページを読み込めません。' }, error.status ?? 500); }
        return;
      }
      if (url.pathname === '/api/design-imports') {
        if (!localRequest(request)) { json({ error: 'このPCのデザイン画面から操作してください。' }, 403); return; }
        try {
          if (request.method === 'GET') { json(await designImportStore.get(url.searchParams.get('id'))); return; }
          if (request.method !== 'POST') { json({ error: '対応していない操作です。' }, 405); return; }
          if (!fromStudio(request)) { json({ error: 'デザインの画面から操作してください。' }, 403); return; }
          let body;
          try { body = await readEditorBody(request); } catch { json({ error: '送信内容を確認してください。' }, 400); return; }
          const task = await designImportStore.create(body);
          json(body.finishPdf === true && task.kind === 'pdf' ? await designImportStore.complete(task.id) : task, 201);
        } catch (error) { json({ error: error.status ? error.message : '作業情報を読み書きできません。保存先を確認してください。' }, error.status ?? 500); }
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/design-pdfs') {
        if (!fromStudio(request, 'application/pdf')) { json({ error: 'デザインの画面からPDFを追加してください。' }, 403); return; }
        try {
          let name;
          try { name = decodeURIComponent(request.headers['x-file-name'] || 'reference.pdf'); } catch { throw Object.assign(new Error('PDFのファイル名を確認してください。'), { status: 400 }); }
          json(await pdfStore.add(await readPdfUpload(request), name), 201);
        } catch (error) { json({ error: error.status ? error.message : 'PDFを保存できません。ファイルと保存先を確認してください。' }, error.status ?? 500); }
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/designs') {
        if (!fromStudio(request)) { json({ error: 'デザインの画面から保存してください。' }, 403); return; }
        let body;
        try { body = await readEditorBody(request); } catch { json({ error: '送信内容を確認してください。' }, 400); return; }
        try { json(await designStore.change(body), body.op === 'create' ? 201 : 200); }
        catch (error) { json({ error: error.status ? error.message : 'デザインを保存できません。保存先を確認してください。' }, error.status ?? 500); }
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/library') {
        if (!fromStudio(request)) { json({ error: '講義ライブラリの画面から操作してください。' }, 403); return; }
        let body;
        try { body = await readEditorBody(request); }
        catch { json({ error: '送信内容を確認してください。' }, 400); return; }
        try { json(await libraryStore.change(body)); }
        catch (error) { json({ error: error.status ? error.message : '分類を保存できません。フォルダー名と保存先を確認してください。' }, error.status ?? 400); }
        return;
      }
      if (request.method === 'POST' && ['/api/tts/plan', '/api/tts/start'].includes(url.pathname)) {
        if (!fromStudio(request)) { json({ error: 'スタジオの編集画面から操作してください。' }, 403); return; }
        let body;
        try { body = await readEditorBody(request); }
        catch { json({ error: '送信内容を確認してください。' }, 400); return; }
        try {
          const name = url.searchParams.get('name');
          await assertActiveLecture(name);
          const result = url.pathname === '/api/tts/plan' ? await ttsJobs.plan(name, body) : await ttsJobs.start(name, body);
          json(result, url.pathname === '/api/tts/start' ? 202 : 200);
        } catch (error) { json({ error: error.status ? error.message : '音声生成の準備ができません。講義名・原稿・設定を確認してください。' }, error.status ?? 400); }
        return;
      }
      // サムネイル（1枚目）をJPGで返す。画面側でダウンロードとして保存する。
      if (request.method === 'POST' && url.pathname === '/api/thumbnail') {
        if (!fromStudio(request)) { json({ error: 'スタジオの再生画面から操作してください。' }, 403); return; }
        if (capturing) { json({ error: 'サムネイルを作成中です。少しお待ちください。' }, 409); return; }
        const name = url.searchParams.get('name');
        try { await assertActiveLecture(name); }
        catch (error) { json({ error: error.status ? error.message : '講義名を確認してください。' }, error.status ?? 400); return; }
        capturing = true;
        try {
          const jpg = await thumbnail(name, { base: `http://127.0.0.1:${server.address().port}` });
          response.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': jpg.length, 'Content-Disposition': `attachment; filename="${thumbnailFileOf(name)}"` });
          response.end(jpg);
        } catch { json({ error: 'サムネイルを作成できませんでした。Chrome / Edge と講義の画像を確認してください。' }, 500); }
        finally { capturing = false; }
        return;
      }
      // 講義全体をPDF（1スライド1ページ・文字はテキストのまま）で返す。画面側でダウンロードとして保存する。
      if (request.method === 'POST' && url.pathname === '/api/pdf') {
        if (!fromStudio(request)) { json({ error: 'スタジオの再生画面から操作してください。' }, 403); return; }
        if (printing) { json({ error: 'PDFを作成中です。少しお待ちください。' }, 409); return; }
        const name = url.searchParams.get('name');
        try { await assertActiveLecture(name); }
        catch (error) { json({ error: error.status ? error.message : '講義名を確認してください。' }, error.status ?? 400); return; }
        printing = true;
        try {
          const pdf = await deckPdf(name, { base: `http://127.0.0.1:${server.address().port}` });
          response.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': pdf.length, 'Content-Disposition': `attachment; filename="${pdfFileOf(name)}"` });
          response.end(pdf);
        } catch { json({ error: 'PDFを作成できませんでした。Chrome / Edge と講義の画像を確認してください。' }, 500); }
        finally { printing = false; }
        return;
      }
      if (request.method === 'POST' && ['/api/render/start', '/api/exports/open'].includes(url.pathname)) {
        if (!fromStudio(request)) { json({ error: 'スタジオの再生画面から操作してください。' }, 403); return; }
        if (url.pathname === '/api/exports/open') { await mkdir(join(ROOT, 'exports'), { recursive: true }); openFolder(); json({ opened: true }); return; }
        try {
          const name = url.searchParams.get('name');
          await assertActiveLecture(name);
          json(await renderJobs.start(name, { silent: url.searchParams.get('silent') === '1' }), 202);
        } catch (error) { json({ error: error.status ? error.message : '動画の書き出しを開始できません。講義名と lecture.json を確認してください。' }, error.status ?? 400); }
        return;
      }
      if (request.method === 'PUT' && url.pathname === '/api/lecture') {
        if (!fromStudio(request)) {
          json({ error: 'スタジオの編集画面から保存してください。' }, 403); return;
        }
        let body;
        try { body = await readEditorBody(request); }
        catch (error) { json({ error: '保存データの形式・サイズを確認してください。' }, error.message === 'BODY_TOO_LARGE' ? 413 : 400); return; }
        if (!body?.lecture || typeof body.revision !== 'string') { json({ error: '講義と版の情報が必要です。' }, 400); return; }
        await assertActiveLecture(url.searchParams.get('name'));
        const result = await saveEditableLecture(url.searchParams.get('name'), body.lecture, body.revision, body.imports);
        json(result, result.status); return;
      }
      if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
      if (url.pathname === '/api/design-pdfs' || url.pathname === '/api/design-pdfs/file') {
        if (!localRequest(request)) { json({ error: 'このPCのデザイン画面から開いてください。' }, 403); return; }
        try {
          if (url.pathname === '/api/design-pdfs') { json(await pdfStore.get(url.searchParams.get('id'))); return; }
          const { metadata, buffer } = await pdfStore.read(url.searchParams.get('id'));
          let start = 0, end = buffer.length - 1, status = 200;
          if (request.headers.range) {
            const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
            if (match && (match[1] || match[2])) {
              if (!match[1]) start = Math.max(0, buffer.length - Number(match[2]));
              else { start = Number(match[1]); if (match[2]) end = Math.min(Number(match[2]), end); }
            }
            if (!match || (!match[1] && !match[2]) || start > end || start >= buffer.length || (!match[1] && Number(match[2]) === 0)) { response.writeHead(416, { 'Content-Range': `bytes */${buffer.length}` }); response.end(); return; }
            status = 206;
          }
          response.writeHead(status, { 'Content-Type': 'application/pdf', 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', 'Content-Disposition': `inline; filename="reference.pdf"; filename*=UTF-8''${encodeURIComponent(metadata.name)}`, 'Content-Security-Policy': "frame-ancestors 'self'", 'Cross-Origin-Resource-Policy': 'same-origin', ...(status === 206 ? { 'Content-Range': `bytes ${start}-${end}/${buffer.length}` } : {}) });
          response.end(request.method === 'HEAD' ? undefined : buffer.subarray(start, end + 1));
        } catch (error) { json({ error: error.status ? error.message : 'PDFを読み込めません。' }, error.status ?? 500); }
        return;
      }
      if (url.pathname === '/api/designs') {
        if (!localRequest(request)) { json({ error: 'このPCのデザイン画面から開いてください。' }, 403); return; }
        try { json(url.searchParams.has('id') ? await designStore.get(url.searchParams.get('id')) : await designStore.list({ includeTrash: url.searchParams.get('includeTrash') === '1' })); }
        catch (error) { json({ error: error.status ? error.message : 'デザインを読み込めません。保存先を確認してください。' }, error.status ?? 500); }
        return;
      }
      if (url.pathname === '/api/library') {
        try { json(await libraryStore.snapshot()); }
        catch (error) { json({ error: error.status ? error.message : '講義ライブラリを読み込めません。' }, error.status ?? 500); }
        return;
      }
      if (url.pathname === '/api/render/job') {
        const name = url.searchParams.get('name'); lectureRoot(name);
        json({ job: renderJobs.get(name, url.searchParams.get('id')) }); return;
      }
      // lecture.json の変更通知（AIツールや別の画面での書き換えを編集画面へ反映する）。
      if (url.pathname === '/api/lecture/events') {
        if (!localRequest(request)) { json({ error: 'スタジオの画面から開いてください。' }, 403); return; }
        const name = url.searchParams.get('name'); await assertActiveLecture(name); lectureWatch.subscribe(name, response);
        return;
      }
      if (url.pathname === '/api/tts/job') {
        const name = url.searchParams.get('name'); lectureRoot(name);
        json({ job: ttsJobs.get(name, url.searchParams.get('id')) }); return;
      }
      // 起動用スクリプトが、このサーバーが古いプログラムのままか確かめるための情報。
      if (url.pathname === '/api/health') { json({ studio: true, pid: process.pid, codeVersion: startedVersion, ffmpeg: ffmpegAvailable }); return; }
      if (url.pathname === '/api/lectures') {
        json((await libraryStore.snapshot()).lectures); return;
      }
      if (url.pathname === '/api/lecture') {
        const name = url.searchParams.get('name') || 'demo';
        await assertActiveLecture(name);
        const editable = await readEditableLecture(name);
        json({ ...editable, audio: await audioManifest(name, editable.lecture, config), images: await imageManifest(name, editable.lecture) }); return;
      }
      const image = url.pathname.match(/^\/images\/([a-z0-9][a-z0-9_-]{0,63})\/([a-zA-Z0-9][a-zA-Z0-9_-]*)\.(png|jpg|webp)$/);
      if (image) {
        const data = await readFile(join(lectureRoot(image[1]), 'images', `${image[2]}.${image[3]}`));
        response.writeHead(200, { 'Content-Type': { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[image[3]], 'Content-Length': data.length });
        response.end(request.method === 'HEAD' ? undefined : data); return;
      }
      const audio = url.pathname.match(/^\/audio\/([a-z0-9][a-z0-9_-]{0,63})\/([a-zA-Z0-9][a-zA-Z0-9_-]*)\.wav$/);
      if (audio) {
        const path = join(lectureRoot(audio[1]), 'audio', `${audio[2]}.wav`);
        const { size } = await stat(path);
        response.setHeader('Content-Type', 'audio/wav'); response.setHeader('Accept-Ranges', 'bytes');
        let start = 0, end = size - 1;
        if (request.headers.range) {
          const range = request.headers.range.match(/^bytes=(\d*)-(\d*)$/);
          if (!range || (!range[1] && !range[2])) { response.writeHead(416, { 'Content-Range': `bytes */${size}` }); response.end(); return; }
          if (!range[1]) start = Math.max(0, size - Number(range[2]));
          else { start = Number(range[1]); if (range[2]) end = Math.min(end, Number(range[2])); }
          if (start > end || start >= size) { response.writeHead(416, { 'Content-Range': `bytes */${size}` }); response.end(); return; }
          response.statusCode = 206; response.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
        }
        response.setHeader('Content-Length', end - start + 1);
        if (request.method === 'HEAD') response.end();
        // pipeline はブラウザが途中で読み込みを打ち切っても読み込み側を閉じる（Windowsでファイルのロックが残り、TTSの上書き保存が失敗するのを防ぐ）。
        else pipeline(createReadStream(path, { start, end }), response, () => {});
        return;
      }
      const file = url.pathname==='/'&&!url.searchParams.has('lecture')&&url.searchParams.get('record')!=='1' ? PUBLIC_FILES.get('/library') : PUBLIC_FILES.get(url.pathname);
      if (file) {
        const data = await readFile(join(ROOT, file[0]));
        response.writeHead(200, { 'Content-Type': file[1], 'Content-Length': data.length, 'Cache-Control': 'no-cache', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; media-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'self'" });
        response.end(request.method === 'HEAD' ? undefined : data); return;
      }
      if (url.pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
      json({ error: 'Not found' }, 404);
    } catch (error) { json({ error: error.status ? error.message : error.code === 'ENOENT' ? '講義またはファイルがありません' : '講義データを確認してください' }, error.status ?? 400); }
  });
  server.on('close', () => lectureWatch.close());
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(argumentValue(process.argv, '--port', 4173));
  const server = await createStudioServer({ port, checkFfmpeg: true });
  console.log(`HTMLスライド収録スタジオ: http://127.0.0.1:${server.address().port}`);
  console.log('停止: Ctrl+C / 音声生成後はブラウザを再読み込み');
}
