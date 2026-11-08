// 共有（ZIPの書き出し・取り込み）をブラウザで確認する。npm run qa:share
// 送り主・受け取り側の2つのスタジオを一時フォルダーで起動し、実講義・実ライブラリ・実デザインは変更しない。
// 結果は reports/share/share-qa.json とスクリーンショット。
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, cp, readdir } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { createStudioServer } from './server.mjs';
import { createLibraryStore, listLectures, leaveShareInbox } from './lib/library-store.mjs';
import { createShareStore } from './lib/share.mjs';
import { createDesignStore } from './lib/design-store.mjs';
import { ROOT } from './lib/project.mjs';
import { launchBrowser, until, sleep } from './lib/browser.mjs';
import { standardDesign } from '../src/design-theme.js';

const reportDir = join(ROOT, 'reports', 'share'), work = await mkdtemp(join(tmpdir(), 'sakusura-share-qa-'));
const report = { passed: false, checks: [], screenshots: [] };
const check = (name, ok, detail = '') => { report.checks.push({ name, ok: Boolean(ok), ...(detail ? { detail } : {}) }); assert.ok(ok, `${name} ${detail}`); };
let session, servers = [];
async function studio(label) {
  const root = join(work, label), lectures = join(root, 'lectures');
  await mkdir(lectures, { recursive: true });
  await writeFile(join(root, 'package.json'), await readFile(join(ROOT, 'package.json')));
  const designStore = createDesignStore({ directory: join(root, 'designs'), lecturesDirectory: lectures });
  const libraryStore = createLibraryStore({ directory: join(root, 'library'), getLectures: () => listLectures({ directory: lectures }), leaveInbox: name => leaveShareInbox(name, lectures) });
  const server = await createStudioServer({ port: 0, libraryStore, designStore, shareStore: createShareStore({ root, designStore }) });
  servers.push(server);
  return { root, lectures, designStore, base: `http://127.0.0.1:${server.address().port}` };
}
try {
  await mkdir(reportDir, { recursive: true });
  const sender = await studio('sender'), receiver = await studio('receiver');
  await cp(join(ROOT, 'lectures', 'demo'), join(sender.lectures, 'demo'), { recursive: true });
  session = await launchBrowser();
  const { cdp } = session, send = (method, params) => cdp.send(method, params, session.sessionId);
  const evaluate = expression => cdp.evaluate(expression);
  const shot = async file => { const result = await send('Page.captureScreenshot', { format: 'png' }); await writeFile(join(reportDir, file), Buffer.from(result.data, 'base64')); report.screenshots.push(`reports/share/${file}`); };
  const open = async url => { await send('Page.navigate', { url }); await until(() => evaluate("!!document.querySelector('#category-tabs button')"), '画面を読み込めません', 30000); };
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 960, deviceScaleFactor: 1, mobile: false });

  // 送り主：講義の行の「共有」→ 名前を入れて書き出す → ZIPがダウンロードされる
  const downloads = join(work, 'downloads'); await mkdir(downloads, { recursive: true });
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
  await open(`${sender.base}/library`);
  await until(() => evaluate("!!document.querySelector('tr[data-lecture=\"demo\"] .row-actions button:last-child')"), '一覧に講義が出ません');
  check('講義の行に「共有」ボタン', await evaluate("document.querySelector('tr[data-lecture=\"demo\"] .row-actions button:last-child').textContent==='共有'"));
  await click('tr[data-lecture="demo"] .row-actions button:last-child');
  await until(() => evaluate("document.getElementById('share-export-dialog').open"), '書き出しの画面が開きません');
  await evaluate("document.getElementById('share-export-author').value='検証の送り主'");
  await shot('01-export-dialog.png');
  await click('#share-export-submit');
  await until(async () => (await readdir(downloads)).some(name => name.endsWith('.zip')), 'ZIPがダウンロードされません', 30000);
  const zipName = (await readdir(downloads)).find(name => name.endsWith('.zip'));
  check('ZIPをダウンロード', /_v1\.zip$/.test(zipName), zipName);
  await until(() => evaluate("/共有ファイル/.test(document.getElementById('library-status').textContent)"), '完了の表示が出ません');
  check('送り主の講義に共有IDを保存', JSON.parse(await readFile(join(sender.lectures, 'demo', 'share.json'), 'utf8')).id.startsWith('SKS-'));

  // 受け取り側：「取り込む」でZIPを選ぶ → 確認画面 → 取り込む →「共有で受け取った」に並ぶ
  await open(`${receiver.base}/library`);
  check('「共有で受け取った」タブ（0件）', await evaluate("document.getElementById('inbox-nav')?.textContent.includes('0')"));
  const pick = async (file = join(downloads, zipName)) => {
    const { root } = await send('DOM.getDocument', {});
    const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: '#share-file' });
    await send('DOM.setFileInputFiles', { nodeId, files: [file] });
    await until(() => evaluate("document.getElementById('share-import-dialog').open"), '取り込みの確認画面が開きません', 30000);
  };
  await pick();
  check('確認画面に送り主と版', await evaluate("/検証の送り主/.test(document.getElementById('share-import-summary').textContent)&&/v1/.test(document.getElementById('share-import-summary').textContent)"));
  check('初回は衝突の選択なし', await evaluate("document.getElementById('share-import-choice').hidden"));
  await shot('02-import-dialog.png');
  await click('#share-import-submit');
  await until(() => evaluate("new URLSearchParams(location.search).get('view')==='inbox'&&!!document.querySelector('tr[data-lecture=\"demo\"]')"), '受け取り箱に表示されません', 30000);
  check('受け取り箱に1件・送り主の表示', await evaluate("document.getElementById('inbox-nav').textContent.includes('1')&&/受け取り：検証の送り主/.test(document.querySelector('tr[data-lecture=\"demo\"] .share-mark').textContent)"));
  await shot('03-inbox.png');

  // 同じ共有IDをもう一度：更新／別に残すを選ぶ
  await pick();
  check('同じ共有IDは選択肢を表示', await evaluate("!document.getElementById('share-import-choice').hidden&&/同じ共有ID/.test(document.getElementById('share-import-conflict').textContent)"));
  await evaluate("document.querySelector('input[name=share-mode][value=copy]').checked=true");
  await shot('04-import-conflict.png');
  await click('#share-import-submit');
  await until(() => evaluate("!!document.querySelector('tr[data-lecture=\"demo-2\"]')"), '別に残した講義が表示されません', 30000);
  check('別に残すと demo-2 として追加', true);

  // 「整理」でカテゴリ直下へ移すと受け取り箱から外れる
  await click('tr[data-lecture="demo"] [data-move]');
  await until(() => evaluate("document.getElementById('move-dialog').open"), '整理の画面が開きません');
  await click('#move-submit');
  await until(() => evaluate("!document.getElementById('move-dialog').open&&!document.querySelector('tr[data-lecture=\"demo\"]')"), '整理しても受け取り箱から外れません', 15000);
  check('整理すると受け取り箱から外れる', JSON.parse(await readFile(join(receiver.lectures, 'demo', 'share.json'), 'utf8')).inbox === false);

  // デザイン一覧：送り主の「···」→「共有ファイルに書き出す」→ 受け取り側の「共有ファイルを取り込む」
  const created = await sender.designStore.change({ op: 'create', design: { ...standardDesign(), name: '共有検証のテンプレート' } });
  const tile = `article[data-design="${created.id}"]`;
  for (const name of await readdir(downloads)) await rm(join(downloads, name));
  const openDesign = async url => { await send('Page.navigate', { url }); await until(() => evaluate("document.body?.dataset.ready==='true'"), 'デザイン一覧を読み込めません', 30000); };
  await openDesign(`${sender.base}/design`);
  check('デザイン一覧に「共有ファイルを取り込む」', await evaluate("document.getElementById('share-import')?.textContent.includes('共有ファイルを取り込む')"));
  await evaluate(`document.querySelector('${tile} .design-tile-menu').open=true`);
  check('標準デザインには「共有ファイルに書き出す」がない', await evaluate("![...document.querySelectorAll('article.design-tile')].filter(a=>a.querySelector('.design-tile-meta')?.textContent.includes('標準')).some(a=>a.textContent.includes('共有ファイルに書き出す'))"));
  await evaluate(`[...document.querySelectorAll('${tile} .design-tile-actions button')].find(b=>b.textContent.startsWith('共有ファイルに書き出す')).click()`);
  await until(() => evaluate("document.getElementById('share-export-dialog').open"), 'デザインの書き出し画面が開きません');
  check('デザインの書き出し画面（送り主の名前は前回の登録）', await evaluate("document.getElementById('share-export-author').value==='検証の送り主'&&document.getElementById('share-export-audio-row').hidden&&/デザイン/.test(document.getElementById('share-export-heading').textContent)"));
  await shot('05-design-export-dialog.png');
  await click('#share-export-submit');
  await until(async () => (await readdir(downloads)).some(name => name.endsWith('.zip')), 'デザインのZIPがダウンロードされません', 30000);
  const designZip = (await readdir(downloads)).find(name => name.endsWith('.zip'));
  check('デザインのZIPをダウンロード', /共有検証のテンプレート_v1\.zip$/.test(designZip), designZip);
  await openDesign(`${receiver.base}/design`);
  check('受け取り側にはまだない', !await evaluate(`!!document.querySelector('${tile}')`));
  await pick(join(downloads, designZip));
  check('確認画面にデザインテンプレート', await evaluate("/デザインテンプレート/.test(document.getElementById('share-import-summary').textContent)&&/共有検証のテンプレート/.test(document.getElementById('share-import-summary').textContent)"));
  await shot('06-design-import-dialog.png');
  await click('#share-import-submit');
  await until(() => evaluate(`!!document.querySelector('${tile}')&&/取り込みました/.test(document.getElementById('design-gallery-status').textContent)`), '取り込んだデザインが一覧に出ません', 30000);
  check('取り込んだデザインが一覧に表示', true);
  await shot('07-design-imported.png');
  await open(`${receiver.base}/library`);

  // 不正なZIPは確認の段階で断る（何も書かない）
  const bad = join(work, 'bad.zip'); await writeFile(bad, 'not a zip');
  const before = (await readdir(receiver.lectures)).sort().join(',');
  const { root } = await send('DOM.getDocument', {});
  const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: '#share-file' });
  await send('DOM.setFileInputFiles', { nodeId, files: [bad] });
  await until(() => evaluate("!document.getElementById('library-error').hidden&&/ZIP|共有ファイル/.test(document.getElementById('library-error').textContent)"), '不正なZIPのエラーが出ません', 15000);
  check('不正なZIPはエラー表示・書き込みなし', (await readdir(receiver.lectures)).sort().join(',') === before);
  report.passed = true;
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
} finally {
  await session?.close();
  for (const server of servers) await new Promise(done => server.close(done));
  if (resolve(work).startsWith(resolve(tmpdir()) + sep)) await rm(work, { recursive: true, force: true, maxRetries: 3 });
  await writeFile(join(reportDir, 'share-qa.json'), `${JSON.stringify(report, null, 2)}\n`);
  for (const item of report.checks) console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.name}${item.detail ? `（${item.detail}）` : ''}`);
  console.log(report.passed ? `共有のブラウザ確認：PASS（${report.checks.length}項目）reports/share/` : `共有のブラウザ確認：FAIL ${report.error}`);
  await sleep(0);
}
