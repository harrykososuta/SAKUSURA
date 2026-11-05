import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { lectureRoot } from './project.mjs';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
export function imageExtension(buffer) {
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && buffer.toString('ascii', 12, 16) === 'IHDR') return 'png';
  if (buffer.length >= 4 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255 && buffer.at(-2) === 255 && buffer.at(-1) === 217) return 'jpg';
  if (buffer.length >= 20 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP' && ['VP8 ', 'VP8L', 'VP8X'].includes(buffer.toString('ascii', 12, 16)) && buffer.readUInt32LE(4) === buffer.length - 8) return 'webp';
  fail(422, 'PNG・JPEG・WebPの画像ファイルを選んでください。');
}
export async function readImageUpload(request) {
  if (Number(request.headers['content-length']) > MAX_IMAGE_BYTES) { request.resume(); fail(413, '画像は10MB以内にしてください。'); }
  let size = 0; const chunks = [];
  for await (const chunk of request) { size += chunk.length; if (size > MAX_IMAGE_BYTES) fail(413, '画像は10MB以内にしてください。'); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
export async function saveImageUpload(name, buffer) {
  const root = lectureRoot(name);
  await readFile(join(root, 'lecture.json')); // 存在する講義にだけ追加する。
  if (buffer.length > MAX_IMAGE_BYTES) fail(413, '画像は10MB以内にしてください。');
  const file = `upload-${randomUUID()}.${imageExtension(buffer)}`;
  await mkdir(join(root, 'images'), { recursive: true });
  // 一度保存した画像は上書きしない。取消・履歴復元でも元の画像を使える。
  await writeFile(join(root, 'images', file), buffer, { flag: 'wx' });
  return { file, ready: true, url: `/images/${name}/${file}`, labels: [], labelProblems: [] };
}
