// 共有（講義・デザインのZIP受け渡し）のHTTP API。ライブラリ画面（src/library.js）が使う。docs/SHARE.md
//   GET  /api/share/settings            送り主の名前（前回の登録）
//   POST /api/share/export   JSON       {lecture, audio, author?} → 共有ZIPをダウンロードとして返す（exports/share/ にも保存）
//   POST /api/share/export-design JSON  {design, author?} → デザインテンプレートだけの共有ZIP（デザイン一覧の「共有ファイルに書き出す」）
//   POST /api/share/inspect  ZIP本体     中身と衝突を確認するだけ（何も書かない）
//   POST /api/share/import   ZIP本体     ?mode=update|copy で取り込む。同じ共有IDがあり mode がなければ 409 と確認内容
// 書き込みを伴う操作は、スタジオの画面（同じOrigin・専用ヘッダー）からの要求だけを受け付ける（server.mjs の fromStudio）。
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { createShareStore } from './share.mjs';

const MAX_UPLOAD = 1024 ** 3;
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
async function readUpload(request) {
  if (Number(request.headers['content-length']) > MAX_UPLOAD) { request.resume(); fail(413, '共有ファイルは1GB以内にしてください。'); }
  let size = 0; const chunks = [];
  for await (const chunk of request) { size += chunk.length; if (size > MAX_UPLOAD) fail(413, '共有ファイルは1GB以内にしてください。'); chunks.push(chunk); }
  return Buffer.concat(chunks);
}

export function createShareApi({ store = createShareStore(), fromStudio, localRequest, assertActiveLecture = async () => {} } = {}) {
  const send = (response, body, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(body)); };
  const failure = (response, error) => {
    if (!error.status) throw error;
    send(response, { error: error.message, ...(error.summary ? { summary: error.summary } : {}), ...(/送り主の名前が未登録/.test(error.message) ? { needAuthor: true } : {}) }, error.status);
  };
  // 扱ったら true。server.mjs のルーティングの先頭近くで呼ぶ。
  async function handle(request, response, url) {
    if (!url.pathname.startsWith('/api/share/')) return false;
    try {
      if (url.pathname === '/api/share/settings') {
        if (request.method !== 'GET' || !localRequest(request)) { send(response, { error: 'このPCのスタジオ画面から開いてください。' }, 403); return true; }
        send(response, await store.settings()); return true;
      }
      if (request.method !== 'POST') { send(response, { error: '対応していない操作です。' }, 405); return true; }
      if (url.pathname === '/api/share/export' || url.pathname === '/api/share/export-design') {
        if (!fromStudio(request)) { send(response, { error: 'スタジオの画面から書き出してください。' }, 403); return true; }
        let body;
        try { body = JSON.parse((await readUpload(request)).toString('utf8') || '{}'); } catch (error) { if (error.status) throw error; fail(400, '書き出す内容を確認してください。'); }
        const author = typeof body.author === 'string' && body.author.trim() ? body.author : undefined;
        let result;
        if (url.pathname === '/api/share/export-design') {
          if (typeof body.design !== 'string') fail(400, '書き出すデザインを指定してください。');
          result = await store.exportDesign(body.design, { author });
        } else {
          if (typeof body.lecture !== 'string') fail(400, '書き出す講義を指定してください。');
          await assertActiveLecture(body.lecture);
          result = await store.exportLecture(body.lecture, { author, audio: body.audio !== false });
        }
        const data = await readFile(result.path), name = basename(result.path);
        response.writeHead(200, {
          'Content-Type': 'application/zip', 'Content-Length': data.length, 'Cache-Control': 'no-store',
          'Content-Disposition': `attachment; filename="share.zip"; filename*=UTF-8''${encodeURIComponent(name)}`,
          'X-Share-Id': result.manifest.id, 'X-Share-Revision': String(result.manifest.revision), 'X-Share-Forwarded': String(Boolean(result.forwarded)),
          'Access-Control-Expose-Headers': 'Content-Disposition, X-Share-Id, X-Share-Revision, X-Share-Forwarded',
        });
        response.end(data); return true;
      }
      if (url.pathname === '/api/share/inspect' || url.pathname === '/api/share/import') {
        if (!fromStudio(request, 'application/zip')) { send(response, { error: 'スタジオのライブラリ画面から取り込んでください。' }, 403); return true; }
        const buffer = await readUpload(request);
        if (url.pathname === '/api/share/inspect') { send(response, await store.inspect(buffer)); return true; }
        const mode = url.searchParams.get('mode') || undefined;
        if (mode !== undefined && !['update', 'copy'].includes(mode)) fail(400, '取り込み方（update / copy）を確認してください。');
        const result = await store.importPackage(buffer, { mode });
        const { backup, ...rest } = result; // 画面にはPCの絶対パスを返さない
        send(response, { ...rest, backedUp: Boolean(backup) }, 201); return true;
      }
      send(response, { error: '見つかりません。' }, 404); return true;
    } catch (error) { failure(response, error); return true; }
  }
  return { handle };
}
