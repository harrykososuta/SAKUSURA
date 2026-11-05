import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ffmpegExecutable, wingetPackageRoots, FFMPEG_MISSING } from '../tools/lib/ffmpeg.mjs';

const packages = local => join(local, 'Microsoft', 'WinGet', 'Packages');

test('LOCALAPPDATAが削られた起動でも、ホームと作業フォルダーからwingetの導入先を求める', () => {
  const roots = wingetPackageRoots({ env: {}, home: 'C:\\Users\\a', root: 'C:\\Users\\b\\Drive\\work' });
  assert.deepEqual(roots, [packages('C:\\Users\\a\\AppData\\Local'), packages('C:\\Users\\b\\AppData\\Local')]);
  const set = wingetPackageRoots({ env: { LOCALAPPDATA: 'D:\\local', USERPROFILE: 'C:\\Users\\a' }, home: 'C:\\Users\\a', root: 'D:\\work' });
  assert.deepEqual(set, [packages('D:\\local'), packages('C:\\Users\\a\\AppData\\Local')]);
});

test('PATHになければ、wingetの導入先で実際に動くffmpegを返す', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ffmpeg-test-'));
  try {
    const bin = join(dir, 'Gyan.FFmpeg_x', 'build', 'bin');
    await mkdir(bin, { recursive: true });
    await writeFile(join(bin, 'ffmpeg.exe'), '');
    const expected = join(bin, 'ffmpeg.exe');
    assert.equal(await ffmpegExecutable({ env: {}, roots: [join(dir, 'none'), dir], works: async command => command === expected }), expected);
    await assert.rejects(ffmpegExecutable({ env: {}, roots: [dir], works: async () => false }), { message: FFMPEG_MISSING });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('FFMPEG_PATHとPATHを優先する', async () => {
  assert.equal(await ffmpegExecutable({ env: { FFMPEG_PATH: 'X:\\ffmpeg.exe' }, roots: [], works: async () => false }), 'X:\\ffmpeg.exe');
  assert.equal(await ffmpegExecutable({ env: {}, roots: [], works: async command => command === 'ffmpeg' }), 'ffmpeg');
});
