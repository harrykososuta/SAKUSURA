import { spawn, execFileSync } from 'node:child_process';
import { ROOT, argumentValue, codeVersion } from './lib/project.mjs';
import { RESTART_EXIT_CODE } from './lib/server-code.mjs';
import { ffmpegExecutable } from './lib/ffmpeg.mjs';

const port = Number(argumentValue(process.argv, '--port', 4173));
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('ポート番号は1〜65535です');
const base = `http://127.0.0.1:${port}`;
// 通常の起動はHOME。講義を明示した場合だけ直接プレイヤーを開く。
const lecture = argumentValue(process.argv, '--lecture');
const url = lecture ? `${base}/?lecture=${encodeURIComponent(lecture)}` : `${base}/home`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function isStudio() {
  try {
    const response = await fetch(base, { signal: AbortSignal.timeout(1000) });
    if (!response.ok) return false;
    const body = await response.text();
    return body.includes('HTMLスライド収録スタジオ') && body.includes('/src/player.js') || /(?:講義|スライド)ライブラリ/.test(body) && body.includes('/src/library.js') || body.includes('SAKUSURA') && body.includes('/src/home.js');
  } catch { return false; }
}
async function health() {
  try { const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) }); return response.ok ? await response.json() : null; } catch { return null; }
}
// 古いスタジオ（/api/health がない版）のプロセス番号を、ポートを使っているプロセスから調べる。
function pidOnPort() {
  try {
    if (process.platform === 'win32') {
      const line = execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/).find(row => new RegExp(`127\\.0\\.0\\.1:${port}\\s+\\S+\\s+LISTENING`).test(row));
      return line ? Number(line.trim().split(/\s+/).at(-1)) : null;
    }
    return Number(execFileSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).trim().split('\n')[0]) || null;
  } catch { return null; }
}
function openBrowser() {
  if (process.argv.includes('--no-open')) return;
  const command = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const browser = spawn(command, [url], { stdio: 'ignore', detached: true, windowsHide: true });
  browser.on('error', () => console.log(`ブラウザで開いてください: ${url}`));
  browser.unref();
}

const current = await codeVersion();
if (await isStudio()) {
  const running = await health();
  // エージェントのサンドボックスなどから起動されたスタジオは動画を書き出せないことがある。
  // この起動元なら書き出せるときは、同じ版でも使い回さず起動し直す。
  const cannotExport = running?.ffmpeg === false && await ffmpegExecutable().then(() => true, () => false);
  if (running?.codeVersion === current && !cannotExport) {
    console.log(`起動済みのスタジオを開きます: ${url}`);
    openBrowser();
    process.exit(0);
  }
  // プログラムが更新されているのに古いサーバーが動いている。スタジオであることを確かめた上で止めて起動し直す。
  const pid = running?.pid ?? pidOnPort();
  if (!pid) { console.error(`古いスタジオが ${base} で動いています。そのウィンドウを閉じてから、もう一度起動してください。`); process.exit(1); }
  console.log(cannotExport ? '動いているスタジオは動画を書き出せない環境で起動されているため、起動し直します。' : 'スタジオのプログラムが更新されているため、起動し直します。');
  try { process.kill(pid); } catch { console.error('古いスタジオを停止できません。そのウィンドウを閉じてから、もう一度起動してください。'); process.exit(1); }
  for (let attempt = 0; attempt < 40 && await isStudio(); attempt++) await sleep(250);
}

// 画面の「再起動」ボタンでサーバーが RESTART_EXIT_CODE で終わったら、このウィンドウのまま起動し直す。
let server, ended = false, restarting = false;
function startServer() {
  ended = false;
  server = spawn(process.execPath, ['tools/server.mjs', '--port', String(port)], { cwd: ROOT, stdio: 'inherit', windowsHide: true, env: { ...process.env, SAKUSURA_SUPERVISED: '1' } });
  server.on('error', () => { ended = true; process.exitCode = 1; console.error('サーバーを起動できませんでした'); });
  server.on('exit', code => {
    ended = true;
    if (code === RESTART_EXIT_CODE && !restarting) {
      restarting = true;
      console.log('画面から再起動を受け付けました。最新のプログラムで起動し直します…');
      setTimeout(async () => {
        startServer();
        const version = await codeVersion();
        for (let attempt = 0; attempt < 60 && !ended; attempt++) { if ((await health())?.codeVersion === version) break; await sleep(250); }
        restarting = false;
        if (!ended) console.log(`再起動しました: ${base}
このウィンドウは収録中も開いたままにしてください。`);
      }, 300);
      return;
    }
    process.exitCode = code ?? 1;
  });
}
process.once('SIGINT', () => { server.kill(); });
startServer();
let started = false;
for (let attempt = 0; attempt < 60 && !ended; attempt++) {
  if ((await health())?.codeVersion === current) { started = true; break; }
  await sleep(250);
}
if (started) {
  console.log(`準備完了: ${url}
このウィンドウは収録中も開いたままにしてください。`);
  openBrowser();
} else {
  console.error('サーバーの起動に失敗しました。上のエラー内容を確認してください。');
  server.kill(); process.exitCode = 1;
}
