import { readFile, mkdir, rename, writeFile, unlink, rm } from 'node:fs/promises';
import { join, resolve, sep, basename } from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { ROOT } from './project.mjs';
import { createDesignPdfStore, isDesignPdfId } from './design-pdf-store.mjs';

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const pending = new Map();
const execute = promisify(execFile);
let detectedPython;
async function pdfPython(configured) {
  if (configured) return configured;
  // PATHのPythonと、Windowsランチャーに登録済みのPythonから導入済みの変換環境を探す。
  if (!detectedPython) detectedPython = (async () => {
    const candidates = ['python'];
    if (process.platform === 'win32') {
      try {
        const result = await execute('py', ['-0p'], { windowsHide: true, timeout: 5000 });
        for (const line of `${result.stdout}\n${result.stderr}`.split(/\r?\n/)) {
          const match = line.match(/^\s*-\S+\s+\*?\s*(.+\.exe)\s*$/i);
          if (match) candidates.push(match[1]);
        }
      } catch { /* PythonランチャーがなくてもPATHを使える。 */ }
    }
    candidates.push('python3');
    for (const candidate of new Set(candidates)) {
      try { await execute(candidate, ['-c', 'import fitz'], { windowsHide: true, timeout: 5000 }); return candidate; }
      catch { /* 別の導入済みPythonを確認する。 */ }
    }
    fail(422, 'PDF変換にはPythonとPyMuPDFが必要です。PYTHON_PATHに利用するPythonを設定してください。');
  })().catch(error => { detectedPython = null; throw error; });
  return detectedPython;
}
export function pdfSourceFor(id, manifest) {
  return { pdfId: id, pages: manifest.pages.map((page, index) => {
    const texts = [...page.texts].sort((a, b) => b.fontSize - a.fontSize);
    const label = (texts[0]?.text.trim() || `${index + 1}ページ`).slice(0, 100);
    return { page: page.page, label, layout: index === 0 ? 'title' : /目次|アジェンダ/.test(label) ? 'agenda' : /流れ|手順/.test(label) ? 'flow' : 'figure', edits: [] };
  }) };
}
export function createPdfDesignStore({ directory = join(ROOT, 'designs/pdf-pages'), pdfStore = createDesignPdfStore(), python = process.env.PYTHON_PATH } = {}) {
  directory = resolve(directory);
  const folder = id => { if (!isDesignPdfId(id)) fail(400, 'PDFのIDを確認してください。'); return join(directory, id); };
  async function get(id) {
    let result;
    try { result = JSON.parse(await readFile(join(folder(id), 'manifest.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') fail(404, 'PDFのページをまだ取り込んでいません。'); throw error; }
    const { metadata } = await pdfStore.read(id);
    if (result.sourceHash !== metadata.sha256 || result.version !== 1 || !Array.isArray(result.pages) || !result.pages.length || result.pages.length > 60) fail(422, 'PDFのページ情報を確認してください。');
    return result;
  }
  async function prepare(id) {
    const key = folder(id);
    try { return await get(id); } catch (error) { if (error.status !== 404) throw error; }
    if (pending.has(key)) return pending.get(key);
    let temporaryPath;
    const job = (async () => {
      const { metadata, buffer } = await pdfStore.read(id);
      const temp = join(directory, `.prepare-${randomUUID()}`); await mkdir(temp, { recursive: true });
      temporaryPath = temp;
      const input = join(temp, 'source.pdf'); await writeFile(input, buffer);
      const executable = await pdfPython(python);
      await new Promise((accept, reject) => {
        const child = spawn(executable, [join(ROOT, 'tools/pdf-design-export.py'), input, temp], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
        let diagnostics = ''; child.stderr.on('data', data => { diagnostics = (diagnostics + data.toString()).slice(-500); });
        const timer = setTimeout(() => { child.kill(); reject(Object.assign(new Error('PDFの取り込みが時間内に完了しませんでした。'), { status: 422 })); }, 120000);
        child.on('error', () => { clearTimeout(timer); reject(Object.assign(new Error('PDF変換にはPythonとPyMuPDFが必要です。PYTHON_PATHに利用するPythonを設定してください。'), { status: 422 })); });
        child.on('exit', code => { clearTimeout(timer); if (code === 0) accept(); else reject(Object.assign(new Error(diagnostics.includes('PDF_ENGINE_MISSING') ? 'PDF変換用のPyMuPDFが見つかりません。Python環境にPyMuPDFを用意してください。' : 'PDFを取り込めません。保護されていない1〜60ページのPDFを確認してください。'), { status: 422 })); });
      });
      const manifest = JSON.parse(await readFile(join(temp, 'manifest.json'), 'utf8'));
      manifest.sourceHash = metadata.sha256;
      await writeFile(join(temp, 'manifest.json'), JSON.stringify(manifest));
      // 公開するのは確定したファイルのみ。準備途中のフォルダーはAPIから取得できない。
      await unlink(input);
      await mkdir(directory, { recursive: true });
      if (!resolve(temp).startsWith(directory + sep) || !resolve(key).startsWith(directory + sep)) fail(400, 'PDFの保存先を確認してください。');
      try { await rename(temp, key); }
      catch (error) { try { await get(id); } catch { throw error; } }
      return get(id);
    })();
    pending.set(key, job);
    try { return await job; } finally {
      pending.delete(key);
      if (temporaryPath && resolve(temporaryPath).startsWith(directory + sep) && /^\.prepare-[0-9a-f-]+$/.test(basename(temporaryPath))) await rm(temporaryPath, { recursive: true, force: true, maxRetries: 2 }).catch(() => {});
    }
  }
  async function asset(id, file) {
    const manifest = await get(id);
    const allowed = [...manifest.pages.map(page => page.file), ...manifest.fonts.map(font => font.file)];
    if (!allowed.includes(file) || !/^(?:page-\d{3}\.svg|font-\d+\.(?:ttf|otf|woff))$/.test(file)) fail(404, 'PDFの素材が見つかりません。');
    return { buffer: await readFile(join(folder(id), file)), type: file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.otf') ? 'font/otf' : file.endsWith('.woff') ? 'font/woff' : 'font/ttf' };
  }
  return { get, prepare, asset };
}
