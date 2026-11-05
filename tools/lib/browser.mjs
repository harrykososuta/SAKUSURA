// インストール済みChrome/EdgeをCDPで操作する共通部品（ブラウザ検査と動画書き出しで使う）。外部npm依存なし。
import { spawn } from 'node:child_process';
import { access, readFile, readdir, stat, mkdir, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function browserExecutable() {
  const paths = [process.env.CHROME_PATH,
    join(process.env.PROGRAMFILES || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
    join(process.env['PROGRAMFILES(X86)'] || 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  for (const path of paths) { try { await access(path); return path; } catch {} }
  throw new Error('Chrome/Edgeが見つかりません。CHROME_PATHへ実行ファイルの絶対パスを指定してください。');
}
export class Cdp {
  constructor(socket) {
    this.socket = socket; this.nextId = 0; this.pending = new Map(); this.events = [];
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const job = this.pending.get(message.id);
        if (!job) return;
        clearTimeout(job.timer); this.pending.delete(message.id);
        if (message.error) job.reject(new Error(message.error.message)); else job.resolve(message.result);
      } else { this.events.push(message); }
    });
  }
  async send(method, params = {}, sessionId) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  async evaluate(expression, userGesture = false) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture }, this.session);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ': ' + (result.exceptionDetails.exception?.description || ''));
    return result.result.value;
  }
  close() { this.socket.close(); for (const job of this.pending.values()) { clearTimeout(job.timer); job.reject(new Error('CDP closed')); } this.pending.clear(); }
}
export async function until(check, message, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await sleep(100); }
  throw new Error(message);
}

// Chromeの一時DBやロックをGoogleドライブ等の同期対象へ作らない。
const PROFILE_PARENT = resolve(tmpdir(), 'html-slide-recording-harness', 'browser-profiles');
// 以前の実行で削除しきれなかった隔離プロファイル（10分以上前）を片付ける。
async function removeStaleProfiles() {
  try {
    for (const entry of await readdir(PROFILE_PARENT, { withFileTypes: true })) {
      const path = resolve(PROFILE_PARENT, entry.name);
      if (!path.startsWith(PROFILE_PARENT + sep) || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(entry.name)) continue;
      if (entry.isDirectory() && Date.now() - (await stat(path)).mtimeMs > 600000) await rm(path, { recursive: true, force: true, maxRetries: 2 }).catch(() => {});
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

// 隔離プロファイルでヘッドレスのブラウザを起動し、1920×1080のページに接続する。
// close() はこの実行で作ったプロファイルだけを削除し、通常のChromeプロファイルには触れない。
export async function launchBrowser() {
  await removeStaleProfiles();
  const profile = join(PROFILE_PARENT, randomUUID());
  await mkdir(profile, { recursive: true });
  const session = { profile, diagnostics: '', cleanupNote: '' };
  const browser = spawn(await browserExecutable(), ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-extensions', '--autoplay-policy=no-user-gesture-required', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  browser.stderr.on('data', data => { session.diagnostics = (session.diagnostics + data.toString()).slice(-4000); });
  let launchError;
  browser.on('error', error => { launchError = error; });
  session.close = async () => {
    if (session.cdp) { try { await session.cdp.send('Browser.close'); } catch {} session.cdp.close(); }
    browser.kill();
    if (resolve(profile).startsWith(resolve(PROFILE_PARENT) + sep)) {
      if (browser.exitCode === null) await Promise.race([new Promise(resolve => browser.once('exit', resolve)), sleep(3000)]);
      try { await rm(resolve(profile), { recursive: true, force: true, maxRetries: 4, retryDelay: 200 }); } catch { session.cleanupNote = '検証用ブラウザのプロファイルが残っています'; }
    }
  };
  try {
    let websocketUrl;
    await until(async () => {
      if (launchError) throw launchError;
      try { const lines = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/); websocketUrl = `ws://127.0.0.1:${lines[0]}${lines[1]}`; return true; } catch { return false; }
    }, 'ブラウザの起動がタイムアウトしました');
    const socket = new WebSocket(websocketUrl);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    const cdp = new Cdp(socket); session.cdp = cdp;
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }); cdp.session = sessionId;
    await cdp.send('Runtime.enable', {}, sessionId); await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false }, sessionId);
    session.sessionId = sessionId;
    return session;
  } catch (error) { await session.close(); error.diagnostics = session.diagnostics; throw error; }
}
