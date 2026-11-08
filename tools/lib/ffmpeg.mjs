// ffmpeg の場所を探す。FFMPEG_PATH → PATH → wingetの導入先 の順（winget直後はPATHが未反映のことがある）。
// エージェントのサンドボックスなどから起動すると PATH や LOCALAPPDATA が削られることがあるので、
// wingetの導入先はホームフォルダーと作業フォルダーの場所からも求める。
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from './project.mjs';

export const FFMPEG_MISSING = 'ffmpeg が見つかりません。winget install Gyan.FFmpeg で入れるか、FFMPEG_PATH に ffmpeg.exe の絶対パスを指定してください。';

export function wingetPackageRoots({ env = process.env, home = homedir(), root = ROOT } = {}) {
  const userFolder = /^[A-Za-z]:[\\/]Users[\\/][^\\/]+/.exec(root)?.[0];
  const locals = [env.LOCALAPPDATA, ...[env.USERPROFILE, home, userFolder].filter(Boolean).map(folder => join(folder, 'AppData', 'Local'))];
  return [...new Set(locals.filter(Boolean).map(local => join(local, 'Microsoft', 'WinGet', 'Packages')))];
}

// 見つかるだけでは足りない（権限で実行できないことがある）ので、実際に動くものを返す。
const runs = command => new Promise(resolve => {
  const child = spawn(command, ['-version'], { stdio: 'ignore', windowsHide: true });
  child.on('error', () => resolve(false));
  child.on('exit', code => resolve(code === 0));
});

export async function ffmpegExecutable({ env = process.env, works = runs, roots = wingetPackageRoots({ env }) } = {}) {
  if (env.FFMPEG_PATH) return env.FFMPEG_PATH;
  if (await works('ffmpeg')) return 'ffmpeg';
  for (const packages of roots) {
    try {
      for (const entry of await readdir(packages)) if (entry.startsWith('Gyan.FFmpeg')) {
        for (const build of await readdir(join(packages, entry))) {
          const path = join(packages, entry, build, 'bin', 'ffmpeg.exe');
          if (await works(path)) return path;
        }
      }
    } catch {}
  }
  throw new Error(FFMPEG_MISSING);
}
