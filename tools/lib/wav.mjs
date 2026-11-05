export function wavInfo(buf) {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('RIFF/WAVEではありません');
  let fmt, data;
  for (let offset = 12; offset + 8 <= buf.length;) {
    const id = buf.toString('ascii', offset, offset + 4);
    const declared = buf.readUInt32LE(offset + 4);
    const size = declared === 0xffffffff && id === 'data' ? buf.length - offset - 8 : declared;
    if (offset + 8 + size > buf.length) throw new Error('WAVが途中で切れています');
    if (id === 'fmt ') {
      if (size < 16) throw new Error('WAVのfmtが不正です');
      fmt = { encoding: buf.readUInt16LE(offset + 8), channels: buf.readUInt16LE(offset + 10), rate: buf.readUInt32LE(offset + 12), bits: buf.readUInt16LE(offset + 22) };
    }
    if (id === 'data') data = buf.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size + size % 2;
  }
  if (!fmt || !data || fmt.encoding !== 1 || fmt.bits !== 16 || !fmt.channels || !fmt.rate) throw new Error('16bit PCM WAVが必要です');
  const frameBytes = fmt.channels * 2;
  if (data.length % frameBytes) throw new Error('WAVのサンプル境界が不正です');
  const frames = data.length / frameBytes;
  const duration = frames / fmt.rate;
  if (!duration) throw new Error('WAVに音声データがありません');
  const window = Math.max(1, Math.round(fmt.rate / 100));
  let first = -1, last = -1, peak = 0;
  for (let start = 0; start < frames; start += window) {
    let sum = 0, count = 0;
    for (let frame = start; frame < Math.min(frames, start + window); frame++) {
      for (let channel = 0; channel < fmt.channels; channel++) {
        const sample = data.readInt16LE(frame * frameBytes + channel * 2) / 32768;
        sum += sample * sample; count++; peak = Math.max(peak, Math.abs(sample));
      }
    }
    if (Math.sqrt(sum / count) > 0.01) { if (first < 0) first = start; last = Math.min(frames, start + window); }
  }
  return { duration: +duration.toFixed(4), speechStart: first < 0 ? null : +(first / fmt.rate).toFixed(4), speechEnd: last < 0 ? null : +(last / fmt.rate).toFixed(4), peak: +peak.toFixed(4), sampleRate: fmt.rate, channels: fmt.channels, bits: fmt.bits };
}

export function pcmToWav(pcm, rate = 24000) {
  if (!pcm.length || pcm.length % 2) throw new Error('PCMデータ長が不正です');
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
