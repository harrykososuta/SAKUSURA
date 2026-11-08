import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, unlink, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { lectureRoot, synthesisInput, inputHash, fileHash, writeJson } from '../tools/lib/project.mjs';
import { inspectAudio } from '../tools/lib/cache.mjs';
import { pcmToWav } from '../tools/lib/wav.mjs';
import { createStudioServer } from '../tools/server.mjs';

test('実ファイルのキャッシュ判定・音声改変・HTTP Rangeを検証する', async () => {
  const name = `qa-${randomUUID()}`;
  const root = lectureRoot(name), directory = join(root, 'audio');
  const config = { model: 'test-model', voice: { id: 'voice_test' }, defaultStyle: 'calm' };
  const slide = { id: '001', narration: 'テスト音声' };
  const pcm = Buffer.alloc(4800);
  for (let index = 0; index < pcm.length / 2; index++) pcm.writeInt16LE(Math.round(Math.sin(index / 10) * 5000), index * 2);
  const wav = pcmToWav(pcm);
  await mkdir(directory, { recursive: true });
  let server;
  try {
    assert.equal((await inspectAudio(name, slide, config)).ready, false);
    await writeFile(join(directory, '001.wav'), wav);
    await writeJson(join(directory, '001.json'), { hash: inputHash(synthesisInput(slide, config)), fileHash: fileHash(wav) });
    assert.equal((await inspectAudio(name, slide, config)).ready, true);
    assert.equal((await inspectAudio(name, { ...slide, narration: '修正済み' }, config)).ready, false);
    server = await createStudioServer({ port: 0 });
    const url = `http://127.0.0.1:${server.address().port}/audio/${name}/001.wav`;
    const partial = await fetch(url, { headers: { Range: 'bytes=0-43' } });
    assert.equal(partial.status, 206); assert.equal((await partial.arrayBuffer()).byteLength, 44);
    const suffix = await fetch(url, { headers: { Range: 'bytes=-10' } });
    assert.equal(suffix.status, 206); assert.equal((await suffix.arrayBuffer()).byteLength, 10);
    assert.equal((await fetch(url, { headers: { Range: 'bytes=999999-' } })).status, 416);
    const changed = Buffer.from(wav); changed[changed.length - 1] ^= 1;
    await writeFile(join(directory, '001.wav'), changed);
    assert.match((await inspectAudio(name, slide, config)).reason, /ファイルの内容/);
    await writeFile(join(directory, '001.wav'), Buffer.from('broken'));
    assert.equal((await inspectAudio(name, slide, config)).ready, false);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    // 個別ファイルだけを削除してから空ディレクトリを削除する。
    await unlink(join(directory, '001.wav')).catch(() => {});
    await unlink(join(directory, '001.json')).catch(() => {});
    await rmdir(directory); await rmdir(root);
  }
});
