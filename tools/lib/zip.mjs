// Word / PowerPoint（中身はZIP）を外部ライブラリなしで読む。中央ディレクトリから一覧を作り、中身は必要なときだけ展開する。
import { inflateRawSync } from 'node:zlib';

export function readZip(zip, label = 'ファイル') {
  let end = zip.length - 22;
  while (end >= 0 && zip.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error(`${label}（ZIP）として読めません`);
  const entries = new Map();
  let offset = zip.readUInt32LE(end + 16);
  for (let i = 0, count = zip.readUInt16LE(end + 10); i < count; i++) {
    const method = zip.readUInt16LE(offset + 10), size = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28), extraLength = zip.readUInt16LE(offset + 30), commentLength = zip.readUInt16LE(offset + 32);
    const local = zip.readUInt32LE(offset + 42);
    const name = zip.toString('utf8', offset + 46, offset + 46 + nameLength);
    entries.set(name, () => {
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + size);
      return method === 0 ? data : inflateRawSync(data);
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return {
    names: [...entries.keys()],
    has: name => entries.has(name),
    read: name => { if (!entries.has(name)) throw new Error(`${name} がありません`); return entries.get(name)(); },
    text: name => entries.get(name)().toString('utf8'),
  };
}
export const decodeXml = text => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code))).replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16))).replace(/&amp;/g, '&');
