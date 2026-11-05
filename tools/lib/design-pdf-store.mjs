import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { ROOT } from './project.mjs';

export const MAX_DESIGN_PDF_BYTES = 10 * 1024 * 1024;
export const isDesignPdfId = value => typeof value === 'string' && /^pdf-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const hash = buffer => createHash('sha256').update(buffer).digest('hex');
export function validatePdfBytes(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) fail(422, 'PDFファイルを選んでください。');
  if (buffer.length > MAX_DESIGN_PDF_BYTES) fail(413, 'PDFは10MB以内のファイルを選んでください。');
  if (!buffer.subarray(0, 1024).toString('latin1').match(/%PDF-\d\.\d/) || !buffer.subarray(-2048).toString('latin1').includes('%%EOF')) fail(422, '有効なPDFファイルを選んでください。');
  if (/\/Encrypt\s*(?:\d+\s+\d+\s+R|<<)/.test(buffer.toString('latin1'))) fail(422, 'パスワード保護を解除したPDFを選んでください。');
}
export async function readPdfUpload(request) {
  if (Number(request.headers['content-length']) > MAX_DESIGN_PDF_BYTES) { request.resume(); fail(413, 'PDFは10MB以内のファイルを選んでください。'); }
  let length = 0; const chunks = [];
  for await (const chunk of request) { length += chunk.length; if (length > MAX_DESIGN_PDF_BYTES) fail(413, 'PDFは10MB以内のファイルを選んでください。'); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
export function createDesignPdfStore({ directory = join(ROOT, 'designs/references') } = {}) {
  directory = resolve(directory);
  async function get(id) {
    if (!isDesignPdfId(id)) fail(400, '参考PDFのIDを確認してください。');
    let metadata;
    try { const raw = await readFile(join(directory, `${id}.json`)); if (raw.length > 8192) throw new Error(); metadata = JSON.parse(raw); }
    catch (error) { if (error.code === 'ENOENT') fail(404, '参考PDFが見つかりません。'); fail(422, '参考PDFの保存情報を確認してください。'); }
    if (metadata.id !== id || typeof metadata.name !== 'string' || !/^[a-f0-9]{64}$/.test(metadata.sha256 ?? '') || !Number.isInteger(metadata.size) || metadata.size <= 0 || metadata.size > MAX_DESIGN_PDF_BYTES) fail(422, '参考PDFの保存情報を確認してください。');
    return { id, name: metadata.name, size: metadata.size, sha256: metadata.sha256, createdAt: metadata.createdAt };
  }
  async function read(id) {
    const metadata = await get(id);
    let buffer;
    try { buffer = await readFile(join(directory, `${id}.pdf`)); } catch (error) { if (error.code === 'ENOENT') fail(404, '参考PDFが見つかりません。'); throw error; }
    validatePdfBytes(buffer);
    if (buffer.length !== metadata.size || hash(buffer) !== metadata.sha256) fail(422, '参考PDFが保存後に変更されています。もう一度アップロードしてください。');
    return { metadata, buffer };
  }
  async function add(buffer, name) {
    validatePdfBytes(buffer);
    if (typeof name !== 'string' || !name.trim() || name.length > 180 || !/\.pdf$/i.test(name) || /[\\/\u0000-\u001f\u007f]/.test(name)) fail(422, 'PDFのファイル名を確認してください。');
    const id = `pdf-${randomUUID()}`, metadata = { id, name: name.trim(), size: buffer.length, sha256: hash(buffer), createdAt: new Date().toISOString() };
    await mkdir(directory, { recursive: true });
    const path = join(directory, `${id}.pdf`);
    await writeFile(path, buffer, { flag: 'wx' });
    try { await writeFile(join(directory, `${id}.json`), JSON.stringify(metadata, null, 2) + '\n', { flag: 'wx' }); }
    catch (error) { await unlink(path); throw error; }
    return metadata;
  }
  return { get, read, add };
}
