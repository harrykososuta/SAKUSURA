import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createDesignPdfStore } from './lib/design-pdf-store.mjs';
import { createDesignStore } from './lib/design-store.mjs';
import { createDesignImportStore } from './lib/design-import-store.mjs';
import { createStudioServer } from './server.mjs';
import { launchBrowser, until } from './lib/browser.mjs';
import { ROOT } from './lib/project.mjs';

const directory = await mkdtemp(join(tmpdir(), 'sakusura-design-pdf-qa-'));
const pdfStore = createDesignPdfStore({ directory: join(directory, 'references') });
const designStore = createDesignStore({ directory, pdfStore });
const designImportStore = createDesignImportStore({ directory: join(directory, 'imports'), designStore, pdfStore });
const reportDir = join(ROOT, 'reports/design-pdf');
const report = { passed: false, checks: [], screenshots: [] };
let server, session;
await mkdir(reportDir, { recursive: true });
try {
  server = await createStudioServer({ port: 0, designStore, pdfStore, designImportStore });
  const base = `http://127.0.0.1:${server.address().port}`;
  session = await launchBrowser();
  const { cdp, sessionId } = session;
  const send = (method, params) => cdp.send(method, params, sessionId);
  const evaluate = expression => cdp.evaluate(expression);
  await send('Log.enable', {});
  const ready = () => until(() => evaluate("document.body?.dataset.ready === 'true' && document.body?.dataset.previewReady === 'true'"), '編集画面を表示できません');
  const detail = () => until(() => evaluate("!!document.getElementById('edit-design')?.getAttribute('href')"), '詳細を表示できません');
  async function click(selector) {
    const point = await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});for(let parent=el.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  }
  async function shot(name) {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(reportDir, name), Buffer.from(data, 'base64'));
    report.screenshots.push(`reports/design-pdf/${name}`);
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: base + '/design' });
  await until(() => evaluate("document.body?.dataset.ready === 'true'"), '一覧を表示できません');
  assert.equal(await evaluate("document.querySelectorAll('#add-pdf-design').length"), 0, '追加の入口はひとつ');
  await click('#add-design'); await ready();
  assert.equal(await evaluate("new URLSearchParams(location.search).has('base')"), false);
  assert.equal(await evaluate("document.getElementById('editor-title').textContent"), 'PDFからデザインを追加');
  assert.equal(await evaluate("document.getElementById('save-design').disabled"), true);
  assert.equal(await evaluate("document.querySelectorAll('.design-page-item').length"), 0, '新規追加に標準テンプレートのページを表示しない');
  assert.equal(await evaluate("document.getElementById('choose-reference-pdf').disabled"), false);
  const noPresetYet = async () => {
    assert.equal(await evaluate("document.getElementById('theme-preview-frame').hasAttribute('src')"), false);
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.theme-preview-controls')).display"), 'none');
    assert.equal(await evaluate("document.body.innerText.includes('SAKUSURA')"), false);
  };
  await noPresetYet();
  assert.equal(await evaluate("document.getElementById('import-preview-empty').hidden"), false);
  assert.equal(await evaluate("document.getElementById('draft-state').textContent"), 'PDF未選択');
  assert.equal(await evaluate("document.getElementById('design-brand').value"), 'SLIDES');
  await shot('empty-desktop.png');
  async function importFits(label) {
    await until(() => evaluate(`(()=>{const panel=document.querySelector('.theme-preview-panel'),r=panel.getBoundingClientRect(),b=document.getElementById('save-design').getBoundingClientRect(),p=document.querySelector('#reference-preview-pane:not([hidden]),#import-preview-empty:not([hidden])').getBoundingClientRect(),empty=document.querySelector('#import-preview-empty:not([hidden])');return document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight+1&&r.bottom<=innerHeight&&b.top>=0&&b.bottom<=innerHeight&&p.bottom<=r.bottom&&p.height>120&&panel.scrollHeight<=panel.clientHeight+1&&(!empty||[...empty.children].every(el=>{const e=el.getBoundingClientRect();return e.top>=p.top&&e.bottom<=p.bottom}))})()`), `${label}がウィンドウに収まりません`);
  }
  for (const [width,height] of [[1906,756],[1147,802],[1366,600],[820,680]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await importFits(`未選択画面${width}×${height}`);
    await shot(`empty-${width}x${height}.png`);
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 1000, deviceScaleFactor: 1, mobile: false });
  await until(() => evaluate('document.documentElement.scrollWidth <= innerWidth'), '未選択画面が320pxで横にはみ出しています');
  await shot('empty-320.png');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  async function selectPdf() {
    const { root } = await send('DOM.getDocument', {});
    const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: '#reference-pdf-input' });
    await send('DOM.setFileInputFiles', { nodeId, files: [join(ROOT, 'tests/fixtures/design-reference.pdf')] });
    await until(() => evaluate("!document.getElementById('reference-info').hidden && !document.getElementById('save-design').disabled"), 'PDFを追加できません');
  }
  await selectPdf();
  await until(() => evaluate("!document.getElementById('reference-info').hidden && !document.getElementById('save-design').disabled"), 'PDFを追加できません');
  assert.equal(await evaluate("document.getElementById('reference-preview-pane').hidden"), false);
  assert.equal(await evaluate("document.getElementById('design-name').value"), 'design-reference');
  // PDFの内部ビューアは別プロセスになる。ナビゲーション完了後にスクリーンショットで内容も確認する。
  await until(() => evaluate("document.getElementById('reference-pdf-frame').contentDocument?.readyState === 'complete'"), 'PDFの読み込みが終わりません');
  await new Promise(done => setTimeout(done, 2000));
  await shot('pdf-desktop.png');
  assert.equal(await evaluate("document.getElementById('reference-pdf-frame').src.endsWith('#view=Fit')"), true, 'PDFはページ全体を枠に収める');
  for (const [width,height] of [[1906,756],[1147,802],[1366,600],[820,680]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await importFits(`PDF選択画面${width}×${height}`);
    await shot(`pdf-${width}x${height}.png`);
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  report.checks.push('PDF追加画面は1906/1147/1366/820pxでウィンドウ内に収まり、選択後もページ全体を表示・320pxでは縦に配置');
  await noPresetYet();
  assert.equal(await evaluate("document.getElementById('show-slide-preview').hidden"), true);
  assert.equal(await evaluate("document.getElementById('draft-state').textContent"), 'プリセット未作成');
  await click('#remove-reference');
  assert.equal(await evaluate("document.getElementById('import-preview-empty').hidden"), false);
  await noPresetYet();
  await selectPdf();
  await click('#save-design');
  await until(() => evaluate("location.pathname==='/design/edit' && document.body?.dataset.ready==='true' && document.body?.dataset.previewReady==='true'"), '取り込み後にPDFの編集画面へ進めません', 30000);
  const id = await evaluate("new URLSearchParams(location.search).get('theme')");
  const taskId = id.replace('design-', 'import-'), task = await designImportStore.get(taskId);
  assert.equal(task.status, 'complete');
  assert.equal(task.entry.design.pdfSource.pages.length, 2);
  await until(() => evaluate("document.getElementById('theme-preview-frame').contentDocument?.getElementById('stage')?.dataset.pdfScene==='true'"), '取り込んだページの描画が完了しません');
  assert.equal(await evaluate("document.getElementById('pdf-native-preview-page').options.length"), 2);
  assert.equal(await evaluate("document.querySelectorAll('.design-page-item').length"), 2);
  await shot('native-import-complete.png');
  const resumeUrl = `${base}/design/new?task=${encodeURIComponent(taskId)}`;
  await send('Page.navigate', { url: resumeUrl }); await ready();
  await until(() => evaluate("location.pathname==='/design/edit' && document.body?.dataset.previewReady==='true'"), '保存済みの取り込みを再開できません');
  await click('#editor-cancel');
  await until(() => evaluate("document.body?.dataset.ready==='true' && !!document.getElementById('pdf-detail-page')"), '原本デザインの詳細を表示できません');
  const saved = await designStore.get(id);
  assert.equal(await evaluate("document.getElementById('summary-slide-count').textContent"), '2枚');
  assert.equal(await evaluate("document.getElementById('reference-pdf-link').hidden"), false);
  assert.equal((await fetch(await evaluate("document.getElementById('reference-pdf-link').href"))).headers.get('content-type'), 'application/pdf');
  await click('#assign-current-category');
  await until(async () => (await (await fetch(base+'/api/category-designs')).json()).categories.some(item => item.id==='va' && item.designId===id), 'カテゴリの使用プリセットを保存できません');
  await shot('native-detail.png');
  assert.equal(await evaluate("document.getElementById('pdf-page-position').textContent"), '1 / 2');
  assert.equal(await evaluate("document.getElementById('pdf-page-previous').disabled"), true);
  assert.equal(await evaluate("document.getElementById('assign-current-category').disabled"), true);
  await click('#pdf-page-next');
  await until(() => evaluate("document.getElementById('preview-status').textContent.includes('PDF 2ページ')"), '次ページボタンで切り替えられません');
  assert.equal(await evaluate("document.getElementById('pdf-page-next').disabled"), true);
  assert.equal(await evaluate("new URL(document.getElementById('edit-design').href).searchParams.get('slot')"), '1');
  await click('#edit-design'); await ready();
  assert.equal(await evaluate("document.getElementById('pdf-page-select').value"), '1');
  await click('#editor-cancel');
  await until(() => evaluate("!!document.getElementById('pdf-detail-page')&&document.getElementById('preview-status').textContent.includes('PDF 2ページ')"), '編集から元のページに戻れません');
  await click('#pdf-page-previous');
  await until(() => evaluate("document.getElementById('preview-status').textContent.includes('PDF 1ページ')"), '前ページボタンで切り替えられません');
  report.checks.push('PDFの前後移動・端のボタン無効化・使用中の表示・選択中のページを編集して元のページへ戻る');
  await evaluate("document.getElementById('pdf-detail-page').value='1';document.getElementById('pdf-detail-page').dispatchEvent(new Event('change'))");
  await until(() => evaluate("document.getElementById('preview-status').textContent.includes('PDF 2ページ')"), '元PDFの2ページ目に切り替えられません');
  await send('Page.navigate', {url:base+'/design/detail?category=ecg&theme='+id});
  await until(() => evaluate("document.body?.dataset.ready==='true'"), 'カテゴリの詳細を表示できません');
  await evaluate("var preset=document.getElementById('category-use-preset');preset.value='sakusura-standard';preset.dispatchEvent(new Event('change',{bubbles:true}))");
  await click('#assign-current-category');
  await until(() => evaluate("new URLSearchParams(location.search).get('theme')==='sakusura-standard' && document.body?.dataset.ready==='true'"), '指定プリセットに切り替わりません');
  await evaluate("document.getElementById('design-category').value='va';document.getElementById('design-category').dispatchEvent(new Event('change'))");
  await until(() => evaluate(`new URLSearchParams(location.search).get('theme')===${JSON.stringify(id)} && document.body?.dataset.ready==='true'`), 'カテゴリ選択で割り当てたPDFプリセットが開きません');
  await click('#edit-design'); await ready();
  await until(() => evaluate("!!document.getElementById('pdf-text-select').options.length"), 'PDFの文字を編集できません');
  assert.equal(await evaluate("document.getElementById('remove-reference').hidden"), true);
  assert.equal(await evaluate("document.querySelectorAll('.design-page-item').length"), 2);
  await until(() => evaluate("document.getElementById('theme-preview-frame').contentDocument.querySelectorAll('.design-pdf-hit').length>1"), 'PDFの文字をプレビュー上で選べません');
  const selected = await evaluate("(()=>{const f=document.getElementById('theme-preview-frame'),n=f.contentDocument.querySelectorAll('.design-pdf-hit')[1],a=f.getBoundingClientRect(),r=n.getBoundingClientRect();return{id:n.dataset.designText,x:a.x+r.x+r.width/2,y:a.y+r.y+r.height/2}})()");
  await send('Input.dispatchMouseEvent', { type:'mousePressed',x:selected.x,y:selected.y,button:'left',clickCount:1 });
  await send('Input.dispatchMouseEvent', { type:'mouseReleased',x:selected.x,y:selected.y,button:'left',clickCount:1 });
  assert.equal(await evaluate("document.getElementById('pdf-text-select').value"), selected.id);
  const textId = await evaluate("document.getElementById('pdf-text-select').value");
  await evaluate("var t=document.getElementById('pdf-text-value');t.value='編集した見出し';t.dispatchEvent(new Event('input',{bubbles:true}))");
  await ready();
  await until(() => evaluate("!!document.getElementById('theme-preview-frame').contentDocument.querySelector('.pdf-text-replacement')"), '文字の差し替えが反映されません');
  assert.equal(await evaluate("document.getElementById('theme-preview-frame').contentDocument.querySelector('.pdf-text-replacement').textContent"), '編集した見出し');
  await shot('native-selected-text.png');
  await click('#duplicate-pdf-page'); await ready();
  assert.equal(await evaluate("document.getElementById('pdf-page-select').options.length"), 3);
  await click('#delete-pdf-page'); await ready();
  assert.equal(await evaluate("document.getElementById('pdf-page-select').options.length"), 2);
  await shot('native-text-editor.png');
  await click('#save-design');
  await until(() => evaluate("document.body?.dataset.ready==='true' && !!document.getElementById('pdf-detail-page')"), '変更したPDFデザインを保存できません');
  assert.equal((await designStore.get(id)).design.pdfSource.pages[0].edits.find(edit=>edit.id===textId).text, '編集した見出し');
  assert.equal((await pdfStore.get(saved.referencePdfId)).name, 'design-reference.pdf');
  for (const width of [390, 320]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    await until(() => evaluate('document.documentElement.scrollWidth <= innerWidth'), `${width}pxでPDF詳細がはみ出しています`);
    await shot(`native-detail-${width}.png`);
  }
  await click('#edit-design'); await ready();
  for (const width of [390, 320]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    await until(() => evaluate('document.documentElement.scrollWidth <= innerWidth'), `${width}pxでPDF編集がはみ出しています`);
    await shot(`native-editor-${width}.png`);
  }
  await send('Page.navigate', {url:base+'/design'});
  await until(() => evaluate("document.body?.dataset.ready==='true'"), 'カテゴリ設定の一覧を表示できません');
  assert.equal(await evaluate("document.querySelector('[data-assignment-category=va]').value"), id);
  await until(() => evaluate("document.querySelectorAll('.pdf-card-preview[data-preview-ready=true]').length===1"), 'PDFのサムネイルを描画できません');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  await shot('category-assignments-320.png');
  report.checks.push('新規追加の入口をPDFに統一・未選択時は空の画面・PDF選択/解除・原本2ページを取込後に編集へ自動遷移・再開・詳細と元PDFリンク');
  report.checks.push('カテゴリに使用プリセットを保存・カテゴリ選択でPDF原本と標準プリセットを切替・対応を一覧で復元');
  report.checks.push('プレビュー上のPDF文字をクリックして選択・入力を即時反映・ページ複製と削除・保存後の復元・元PDF保持・390/320px表示');
  assert.equal(cdp.events.filter(event => event.method === 'Runtime.exceptionThrown').length, 0);
  report.passed = true;
} catch (error) { report.error = error.message; process.exitCode = 1; }
finally {
  if (session) await session.close();
  if (server) await new Promise(done => server.close(done));
  assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
  await rm(directory, { recursive: true, force: true });
  await writeFile(join(reportDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify(report, null, 2));
