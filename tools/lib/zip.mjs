// Word / PowerPoint（中身はZIP）を外部ライブラリなしで読む。中央ディレクトリから一覧を作り、中身は必要なときだけ展開する。
import { inflateRawSync, crc32 } from 'node:zlib';

// maxEntrySize：1ファイルの展開後の上限（バイト）。共有の取り込みなど、他人から受け取ったZIPでは必ず指定する。
// 指定時は展開後のサイズとCRC32も照合する（中央ディレクトリの値と食い違えば読まない）。
export function readZip(zip, label = 'ファイル', { maxEntrySize } = {}) {
  let end = zip.length - 22;
  while (end >= 0 && zip.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error(`${label}（ZIP）として読めません`);
  const entries = new Map(), sizes = new Map();
  let offset = zip.readUInt32LE(end + 16);
  for (let i = 0, count = zip.readUInt16LE(end + 10); i < count; i++) {
    if (offset + 46 > zip.length || zip.readUInt32LE(offset) !== 0x02014b50) throw new Error(`${label}（ZIP）の目次が壊れています`);
    const method = zip.readUInt16LE(offset + 10), crc = zip.readUInt32LE(offset + 16), size = zip.readUInt32LE(offset + 20), rawSize = zip.readUInt32LE(offset + 24);
    const nameLength = zip.readUInt16LE(offset + 28), extraLength = zip.readUInt16LE(offset + 30), commentLength = zip.readUInt16LE(offset + 32);
    const local = zip.readUInt32LE(offset + 42);
    const name = zip.toString('utf8', offset + 46, offset + 46 + nameLength);
    if (maxEntrySize !== undefined && (entries.has(name) || rawSize > maxEntrySize || ![0, 8].includes(method))) throw new Error(`${label}（ZIP）に読めないファイルがあります：${name}`);
    sizes.set(name, rawSize);
    entries.set(name, () => {
      if (local + 30 > zip.length || zip.readUInt32LE(local) !== 0x04034b50) throw new Error(`${name} が壊れています`);
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      if (start + size > zip.length) throw new Error(`${name} が壊れています`);
      const data = zip.subarray(start, start + size);
      if (maxEntrySize === undefined) return method === 0 ? data : inflateRawSync(data);
      const raw = method === 0 ? data : inflateRawSync(data, { maxOutputLength: Math.max(1, rawSize) });
      if (raw.length !== rawSize || crc32(raw) !== crc) throw new Error(`${name} が壊れています（サイズまたはCRCが一致しません）`);
      return raw;
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return {
    names: [...entries.keys()],
    size: name => sizes.get(name),
    has: name => entries.has(name),
    read: name => { if (!entries.has(name)) throw new Error(`${name} がありません`); return entries.get(name)(); },
    text: name => entries.get(name)().toString('utf8'),
  };
}
export const decodeXml = text => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code))).replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16))).replace(/&amp;/g, '&');
