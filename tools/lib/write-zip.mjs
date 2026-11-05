// 配布用ZIPをNode標準機能だけで作る。UTF-8名・CRC32・DEFLATE対応。
import { deflateRawSync } from 'node:zlib';
const table = Array.from({ length:256 }, (_, n) => {
  for (let i=0;i<8;i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
const crc32 = buffer => {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};
export function writeZip(entries) {
  const local = [], central = [], names = new Set(); let offset=0;
  if (entries.length>65535) throw new Error('ZIPのファイル数が多すぎます');
  for (const { name, data } of entries) {
    if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').some(part => !part || part==='.' || part==='..') || names.has(name)) throw new Error('ZIPのパスが不正です');
    names.add(name);
    const filename = Buffer.from(name), raw=Buffer.from(data), packed=deflateRawSync(raw), crc=crc32(raw);
    const header=Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20,4); header.writeUInt16LE(0x800,6); header.writeUInt16LE(8,8); header.writeUInt16LE(33,12); header.writeUInt32LE(crc,14); header.writeUInt32LE(packed.length,18); header.writeUInt32LE(raw.length,22); header.writeUInt16LE(filename.length,26);
    local.push(header,filename,packed);
    const record=Buffer.alloc(46); record.writeUInt32LE(0x02014b50); record.writeUInt16LE(20,4); record.writeUInt16LE(20,6); record.writeUInt16LE(0x800,8); record.writeUInt16LE(8,10); record.writeUInt16LE(33,14); record.writeUInt32LE(crc,16); record.writeUInt32LE(packed.length,20); record.writeUInt32LE(raw.length,24); record.writeUInt16LE(filename.length,28); record.writeUInt32LE(offset,42);
    central.push(record,filename); offset+=header.length+filename.length+packed.length;
  }
  const directory=Buffer.concat(central), end=Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length,8); end.writeUInt16LE(entries.length,10); end.writeUInt32LE(directory.length,12); end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directory,end]);
}
