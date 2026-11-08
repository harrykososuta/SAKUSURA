// lecture.json の変更を、開いている編集画面へ知らせる（Server-Sent Events）。
// AIエージェントや別の画面・エディターでの書き換えを、保存を待たずに画面へ反映するために使う。
// Googleドライブ上でも確実に動くよう、fs.watch ではなく更新時刻とサイズを短い間隔で確かめる。
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { lectureRoot } from './project.mjs';
import { revisionOf } from './editor-store.mjs';

// 接続した直後にも現在の版を送る。画面側は自分の版と比べ、違えば読み込み直す（切断中の変更も取りこぼさない）。
const send = (client, revision) => client.write(`event: change\ndata: ${JSON.stringify({ revision })}\n\n`);
export function createLectureWatch({ interval = 700 } = {}) {
  const watches = new Map(); // 講義名 → { clients, timer, signature, revision }
  async function check(name, watch) {
    try {
      const path = join(lectureRoot(name), 'lecture.json');
      const info = await stat(path), signature = `${info.mtimeMs}:${info.size}`;
      if (signature === watch.signature) return;
      watch.signature = signature;
      const revision = revisionOf(await readFile(path));
      if (revision === watch.revision) return;
      watch.revision = revision;
      for (const client of watch.clients) send(client, revision);
    } catch { /* 保存の途中（置き換え中）は次の確認で読み直す。 */ }
  }
  return {
    subscribe(name, response) {
      lectureRoot(name);
      response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      response.write('retry: 2000\n\n');
      let watch = watches.get(name);
      if (!watch) {
        watch = { clients: new Set(), timer: null, signature: null, revision: null };
        watches.set(name, watch);
        void check(name, watch);
        watch.timer = setInterval(() => { void check(name, watch); }, interval);
      }
      watch.clients.add(response);
      if (watch.revision) send(response, watch.revision);
      const heartbeat = setInterval(() => response.write(': keep-alive\n\n'), 20000);
      response.on('close', () => {
        clearInterval(heartbeat); watch.clients.delete(response);
        if (!watch.clients.size) { clearInterval(watch.timer); watches.delete(name); }
      });
    },
    close() { for (const watch of watches.values()) { clearInterval(watch.timer); for (const client of watch.clients) client.end(); } watches.clear(); },
  };
}
