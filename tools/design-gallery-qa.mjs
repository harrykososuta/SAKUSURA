// デザインを多数用意した一時ストアで、収納・削除・復元とサムネイルを検査する。
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { createStudioServer } from './server.mjs';
import { createDesignStore } from './lib/design-store.mjs';
import { createDesignPdfStore } from './lib/design-pdf-store.mjs';
import { createPdfDesignStore, pdfSourceFor } from './lib/pdf-design-store.mjs';
import { createCategoryDesignStore } from './lib/category-design-store.mjs';
import { standardDesign } from '../src/design-theme.js';
import { launchBrowser, until, sleep } from './lib/browser.mjs';
import { ROOT } from './lib/project.mjs';

const directory = await mkdtemp(join(tmpdir(), 'sakusura-design-gallery-qa-'));
const reports = join(ROOT, 'reports/design-gallery'), report = { passed: false, checks: [], screenshots: [] };
const pdfStore = createDesignPdfStore({ directory: join(directory, 'references') });
const pdfDesignStore = createPdfDesignStore({ directory: join(directory, 'pdf-pages'), pdfStore });
const store = createDesignStore({ directory, lecturesDirectory: join(directory, 'lectures'), pdfStore, pdfDesignStore });
let session, server;
try {
  await mkdir(reports, { recursive: true });
  const designs = [];
  for (let i = 1; i <= 16; i++) {
    const design = { ...standardDesign(), name: `講義のデザイン ${String(i).padStart(2, '0')}` };
    if (i % 2) design.settings.categories.va.primary = '#146b6b';
    if (i === 2) design.css = '#stage { --paper: #fff1db } #stage .heading-text { color: #673c12 }';
    designs.push(await store.change({ op: 'create', design }));
  }
  const pdf = await pdfStore.add(await readFile(join(ROOT, 'tests/fixtures/design-reference.pdf')), '見本.pdf');
  const manifest = await pdfDesignStore.prepare(pdf.id);
  const pdfEntry = await store.change({ op: 'create', design: { ...standardDesign(), name: 'PDFの見本', pdfSource: pdfSourceFor(pdf.id, manifest) } });
  const bindings = createCategoryDesignStore({ directory, designStore: store });
  const config = await bindings.get(); config.categories[0].designId = designs[0].id; await bindings.save(config);
  server = await createStudioServer({ port: 0, designStore: store, pdfStore, pdfDesignStore, categoryDesignStore: bindings });
  const base = `http://127.0.0.1:${server.address().port}`;
  session = await launchBrowser(); const { cdp, sessionId } = session;
  const send = (method, params) => cdp.send(method, params, sessionId);
  const evaluate = expression => cdp.evaluate(expression);
  async function click(selector) {
    const point = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});for(let p=e.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS'&&!p.querySelector('summary')?.contains(e))p.open=true;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  }
  async function ready() { await until(() => evaluate("document.body?.dataset.ready==='true'"), '一覧を表示できません'); }
  async function shot(file) { const { data } = await send('Page.captureScreenshot', { format: 'png' }); await writeFile(join(reports, file), Buffer.from(data, 'base64')); report.screenshots.push(file); }
  async function open() { await send('Page.navigate', { url: base + '/design' }); await ready(); }
  const row = id => `[data-design="${id}"]`;
  async function action(id, text) {
    await click(`${row(id)} summary`);
    const at = await evaluate(`[...document.querySelector(${JSON.stringify(row(id))}).querySelectorAll('.design-tile-actions button')].findIndex(b=>b.textContent.includes(${JSON.stringify(text)}))`);
    assert.ok(at >= 0, text); await click(`${row(id)} .design-tile-actions button:nth-of-type(${at + 1})`);
  }
  async function nativeDrag(id, destination, capture = false) {
    const source = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(row(id))});e.scrollIntoView({block:'center'});const r=e.querySelector('.design-thumb').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    const target = await evaluate(`(()=>{const r=document.querySelector('[data-design-folder="${destination}"]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    const start = cdp.events.length;
    await send('Input.setInterceptDrags', { enabled: true });
    try {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...source });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...source, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: source.x + 20, y: source.y + 20, button: 'left', buttons: 1 });
      await until(() => Promise.resolve(cdp.events.slice(start).some(event => event.method === 'Input.dragIntercepted')), 'ドラッグを開始できません', 5000);
      const data = cdp.events.slice(start).find(event => event.method === 'Input.dragIntercepted').params.data;
      for (const type of ['dragEnter', 'dragOver']) await send('Input.dispatchDragEvent', { type, ...target, data });
      assert.equal(await evaluate(`document.querySelector('[data-design-folder="${destination}"]').classList.contains('drop-target')`), true);
      if (capture) await shot('gallery-drag.png');
      await send('Input.dispatchDragEvent', { type: 'drop', ...target, data });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...target, button: 'left', clickCount: 1 });
    } finally { await send('Input.setInterceptDrags', { enabled: false }); }
  }
  async function syntheticDrag(id, destination, cancel = false) {
    await evaluate(`(()=>{const card=document.querySelector(${JSON.stringify(row(id))}),target=document.querySelector('[data-design-folder="${destination}"]'),data=new DataTransfer();card.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));card.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:data}));target.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:data}));if(!${cancel})target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));card.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:data}));})()`);
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1906, height: 1000, deviceScaleFactor: 1, mobile: false }); await open();
  assert.equal(await evaluate("document.querySelectorAll('.design-tile').length"), 18);
  assert.equal(await evaluate("document.querySelector('.gallery-category-settings').open"), false);
  assert.ok(await evaluate("document.querySelector('.design-main').getBoundingClientRect().width>innerWidth*.94"));
  assert.ok(await evaluate("getComputedStyle(document.getElementById('design-list')).gridTemplateColumns.split(' ').length>=5"));
  await click('.design-tile-menu summary');
  await until(() => evaluate("document.querySelector('.design-tile-menu').open"), '操作メニューを開けません');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await evaluate("document.querySelector('.design-tile-menu summary').focus()");
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await until(() => evaluate("document.querySelector('.design-tile-menu').open"), 'Enterで操作メニューを開けません');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  assert.equal(await evaluate("document.querySelector('.design-tile-menu').open"), false);
  await until(() => evaluate("document.querySelectorAll('.design-thumb[data-preview-ready=true]').length>=5"), 'スライドのサムネイルがありません');
  await until(() => evaluate(`document.querySelector('${row(pdfEntry.id)} .design-thumb').dataset.previewReady==='true'`), 'PDFサムネイルがありません');
  await shot('gallery-1906.png');
  // サムネイルから本物のドラッグを開始し、収納→ゴミ箱→指定先への復元を確認する。
  await nativeDrag(designs[2].id, 'unused', true);
  await until(async () => (await store.get(designs[2].id)).folder === 'unused', 'ドラッグで収納できません');
  await until(() => evaluate("!document.querySelector('body.dragging-design')&&document.getElementById('design-list').getAttribute('aria-busy')==='false'"), 'ドラッグ後の表示を復元できません');
  await click('[data-design-folder=unused]');
  await nativeDrag(designs[2].id, 'trash');
  await until(() => evaluate("document.getElementById('design-delete-dialog').open"), 'ドロップ時の削除確認がありません');
  await click('#design-delete-cancel');
  assert.equal((await store.get(designs[2].id)).folder, 'unused');
  await nativeDrag(designs[2].id, 'trash'); await click('#design-delete-confirm');
  await until(() => evaluate("!document.getElementById('design-delete-dialog').open"), 'ドロップで削除できません');
  await click('[data-design-folder=trash]');
  await nativeDrag(designs[2].id, 'active');
  await until(async () => (await store.get(designs[2].id, { includeTrash: true })).folder === 'active', '指定したフォルダーへ復元できません');
  await until(() => evaluate("document.getElementById('design-gallery-status').textContent.includes('復元しました')&&document.getElementById('design-list').getAttribute('aria-busy')==='false'"), '復元後の一覧を表示できません');
  await click('[data-design-folder=active]');
  const beforeDrag = (await store.get(designs[2].id)).revision;
  await syntheticDrag(designs[2].id, 'active');
  await syntheticDrag(designs[2].id, 'unused', true);
  assert.equal((await store.get(designs[2].id)).revision, beforeDrag, '同じ場所へのドロップやドラッグ中止では保存しない');
  await syntheticDrag('sakusura-standard', 'trash');
  assert.equal(await evaluate("document.getElementById('design-delete-dialog').open"), false, '標準デザインはゴミ箱へ落とせない');
  assert.equal(await evaluate("document.querySelectorAll('.drop-target,.drop-allowed,.is-dragging').length"), 0);
  report.checks.push('ネイティブのドラッグで収納・ドロップ先の強調・ゴミ箱の確認とキャンセル・指定先へ復元・同じ場所と中止は変更なし・標準デザインの削除保護');
  await evaluate("var input=document.getElementById('design-search');input.value='デザイン 02';input.dispatchEvent(new Event('input'))");
  assert.equal(await evaluate("document.querySelectorAll('.design-tile').length"), 1);
  await until(() => evaluate(`document.querySelector('${row(designs[1].id)} .design-thumb').dataset.previewReady==='true'`), 'CSSのサムネイルがありません');
  assert.equal(await evaluate(`(()=>{const root=document.querySelector('${row(designs[1].id)} .design-thumb').shadowRoot;return getComputedStyle(root.querySelector('.heading-text')).color})()`), 'rgb(103, 60, 18)');
  await action(designs[1].id, '使わない');
  await until(() => evaluate("document.getElementById('design-gallery-status').textContent.includes('移動しました')"), '収納できません');
  await click('[data-design-folder=unused]');
  assert.equal(await evaluate("document.querySelectorAll('.design-tile').length"), 1);
  await action(designs[1].id, '削除');
  await until(() => evaluate("document.getElementById('design-delete-dialog').open"), '削除の確認がありません');
  await click('#design-delete-cancel');
  assert.equal((await store.get(designs[1].id)).folder, 'unused');
  await action(designs[1].id, '削除'); await click('#design-delete-confirm');
  await until(() => evaluate("!document.getElementById('design-delete-dialog').open"), 'ゴミ箱へ移動できません');
  await click('[data-design-folder=trash]');
  assert.equal(await evaluate("document.querySelectorAll('.design-tile').length"), 1);
  await shot('gallery-trash.png');
  await action(designs[1].id, '復元');
  await until(() => evaluate("document.getElementById('design-gallery-status').textContent.includes('復元しました')"), '復元できません');
  assert.equal((await store.get(designs[1].id)).folder, 'unused');
  report.checks.push('18デザインのグリッド・画面幅を活用・PDFとCSSの実サムネイル・検索・使わないへの収納・削除キャンセル・ゴミ箱と復元');
  await open();
  await action(designs[0].id, '削除'); await click('#design-delete-confirm');
  await until(() => evaluate("!document.getElementById('design-delete-error').hidden"), '使用中の削除を拒否しません');
  assert.equal((await store.get(designs[0].id)).folder, 'active');
  await shot('gallery-delete-in-use.png'); await click('#design-delete-cancel');
  await action(designs[0].id, '使わない');
  await until(() => evaluate("document.getElementById('design-gallery-status').textContent.includes('移動しました')"), '使用中の収納に失敗');
  await click('[data-design-folder=unused]');
  assert.equal(await evaluate("document.querySelectorAll('.design-tile').length"), 2);
  await action(designs[0].id, '一覧に戻す');
  await until(() => evaluate("document.getElementById('design-gallery-status').textContent.includes('移動しました')"), '通常一覧に戻せません');
  await send('Page.reload', {}); await ready();
  assert.equal(await evaluate("document.querySelectorAll('.design-tile').length"), 1, '収納先のURLと保存状態を復元する');
  report.checks.push('使用中の削除拒否と収納許可・通常一覧へ戻す・再読み込みで分類保持・カテゴリ設定を保護');
  await click('[data-design-folder=active]');
  for (const [width, height] of [[1147, 802], [820, 900], [390, 844], [320, 844]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }); await sleep(150);
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'), true, `${width}pxで横にはみ出す`);
    await evaluate('window.scrollTo(0,0)'); await shot(`gallery-${width}.png`);
  }
  report.checks.push('1906/1147/820/390/320pxの表示・フォルダーと操作メニューのキーボード利用');
  assert.equal(cdp.events.filter(event => event.method === 'Runtime.exceptionThrown').length, 0);
  report.passed = true;
} catch (error) { report.error = error.stack; process.exitCode = 1; }
finally {
  if (session) await session.close(); if (server) await new Promise(done => server.close(done));
  assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep)); await rm(directory, { recursive: true, force: true });
  await mkdir(reports, { recursive: true }); await writeFile(join(reports, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
