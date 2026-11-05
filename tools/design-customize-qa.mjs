import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createDesignStore } from './lib/design-store.mjs';
import { createDesignPdfStore } from './lib/design-pdf-store.mjs';
import { createDesignImportStore } from './lib/design-import-store.mjs';
import { createStudioServer } from './server.mjs';
import { launchBrowser, until } from './lib/browser.mjs';
import { ROOT } from './lib/project.mjs';

const directory = await mkdtemp(join(tmpdir(), 'sakusura-customize-qa-'));
const pdfStore = createDesignPdfStore({ directory: join(directory, 'references') });
const designStore = createDesignStore({ directory, pdfStore });
const designImportStore = createDesignImportStore({ directory: join(directory, 'imports'), designStore, pdfStore });
const reportDir = join(ROOT, 'reports/design-customize'), report = { passed: false, checks: [], screenshots: [] };
let server, session;
await mkdir(reportDir, { recursive: true });
try {
  server = await createStudioServer({ port: 0, designStore, pdfStore, designImportStore });
  const base = `http://127.0.0.1:${server.address().port}`;
  session = await launchBrowser(); const { cdp, sessionId } = session;
  const send = (method, params) => cdp.send(method, params, sessionId), evaluate = value => cdp.evaluate(value);
  const ready = () => until(() => evaluate("document.body?.dataset.ready === 'true' && document.body?.dataset.previewReady === 'true'"), '編集画面が準備できません');
  async function input(selector, value, event = 'input') {
    await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}));})()`);
  }
  async function click(selector) {
    const point = await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});for(let parent=el.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  }
  async function shot(name, full = false) {
    const params = { format: 'png' };
    if (full) { const { cssContentSize } = await send('Page.getLayoutMetrics'); params.captureBeyondViewport = true; params.clip = { x: 0, y: 0, width: cssContentSize.width, height: cssContentSize.height, scale: 1 }; }
    const { data } = await send('Page.captureScreenshot', params); await writeFile(join(reportDir, name), Buffer.from(data, 'base64')); report.screenshots.push(name);
  }
  const preview = () => evaluate("(()=>{const doc=document.getElementById('theme-preview-frame').contentDocument,stage=doc.getElementById('stage');return {category:stage.querySelector('.category-tag')?.textContent,heading:getComputedStyle(stage.querySelector('h1')).fontSize,body:getComputedStyle(stage).getPropertyValue('--body').trim(),primary:getComputedStyle(stage).getPropertyValue('--primary').trim(),title:stage.querySelector('h1').textContent};})()");
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: base + '/design/new?base=sakusura-standard' }); await ready();
  await input('#design-name', '接客研修のプリセット');
  await input('#new-category-name', '接客研修'); await click('#add-category'); await ready();
  const category = await evaluate("document.getElementById('preview-category').value");
  assert.match(category, /^custom-/);
  await until(async () => (await preview()).category === '接客研修', '追加カテゴリの表示名が見本に反映されません');
  await input(`[data-color-path="categories.${category}.primary"][type=text]`, '#146b6b');
  await until(async () => (await preview()).primary === '#146b6b', '追加カテゴリの色が反映されません');
  await input('#category-name', '営業研修');
  await until(async () => (await preview()).category === '営業研修', 'カテゴリ名の変更が反映されません');
  await input('#new-category-name', '営業研修'); await click('#add-category');
  assert.match(await evaluate("document.getElementById('category-feedback').textContent"), /同じ名前/);
  await input('#new-category-name', '一時カテゴリ'); await click('#add-category'); await click('#delete-category');
  await input('#preview-category', category, 'change'); await ready();
  await input('#deck-count', '6'); await click('#apply-deck-count'); await ready();
  assert.equal(await evaluate("document.querySelectorAll('#deck-rows>li').length"), 6);
  assert.equal(await evaluate("document.querySelector('[data-slot=\"5\"] select').value"), 'takehome');
  await input('[data-slot="5"] select', 'takehome', 'change'); await ready();
  await input('#deck-seconds', '300'); await input('#deck-takehome-count', '3');
  await input('[data-slot="0"] [aria-label="1枚目の用途"]', '顧客の課題から考える');
  await input('[data-slot="0"] [data-slot-size="headingSize"]', '112');
  await input('[data-slot="0"] [data-slot-size="bodySize"]', '32');
  await click('[data-slot="0"] .slot-actions button:nth-child(3)'); await ready();
  await until(async () => (await preview()).heading === '112px', 'ページ別の見出しサイズが反映されません');
  assert.equal((await preview()).body, '32px'); assert.equal((await preview()).title, '顧客の課題から考える');
  await input('[data-slot="2"] [aria-label="3枚目の用途"]', '手順を説明する');
  await click('[data-slot="2"] .slot-actions button:nth-child(2)'); await ready();
  assert.equal(await evaluate("document.querySelector('[data-slot=\"3\"] input').value"), '手順を説明する');
  await shot('customize-desktop.png', true);
  await click('#save-design');
  await until(() => evaluate("document.body?.dataset.ready==='true' && !!document.getElementById('edit-design')?.href"), '保存した詳細を表示できません');
  const id = await evaluate("new URLSearchParams(location.search).get('theme')"), original = await designStore.get(id);
  assert.equal(original.design.deck.slides.length, 6); assert.equal(original.design.deck.takehomeCount, 3);
  assert.equal(original.design.categoryNames[category], '営業研修');
  assert.equal(await evaluate("document.getElementById('summary-slide-count').textContent"), '6枚');
  assert.equal(await evaluate("document.querySelectorAll('.deck-page').length"), 6);
  assert.equal(await evaluate("document.getElementById('summary-category').textContent"), '営業研修');
  await click('.deck-page');
  await until(() => evaluate("document.getElementById('layout-metrics')?.querySelector('dd')?.textContent==='112px'"), '保存したページ別文字サイズを詳細に表示できません');
  assert.equal(await evaluate("document.querySelector('#type-specimens [data-kind=heading] code').textContent"), '40px');
  await shot('custom-detail.png', true);
  await click('#customize-design'); await ready();
  await input('#preview-category', category, 'change'); await ready();
  assert.equal(await evaluate("document.getElementById('deck-count').value"), '6');
  assert.equal(await evaluate("document.getElementById('preview-category').value"), category);
  await input('#ai-instructions', '6枚の構成とカテゴリを保ち、共通の本文サイズを34pxにしてください。');
  await click('#start-ai-customize');
  await until(() => evaluate("!document.getElementById('ai-task-panel').hidden"), 'AIへの依頼を作れません');
  assert.equal(await evaluate("document.getElementById('theme-fields').disabled && document.getElementById('customization-fields').disabled"), true);
  const taskId = await evaluate("new URLSearchParams(location.search).get('aiTask')"), task = await designImportStore.get(taskId);
  assert.equal(task.snapshot.deck.slides.length, 6); assert.equal(task.snapshot.categoryNames[category], '営業研修');
  assert.match(await readFile(task.requestPath, 'utf8'), /34px/);
  await writeFile(join(task.folder, 'preset.json'), '{');
  await assert.rejects(designImportStore.complete(taskId), { status: 422 });
  const resumeUrl = await evaluate('location.href');
  await send('Page.navigate', { url: resumeUrl }); await ready();
  assert.equal(await evaluate("document.getElementById('theme-fields').disabled"), true);
  assert.equal(await evaluate("document.getElementById('deck-count').value"), '6');
  await shot('ai-waiting.png', true);
  await click('#resume-customize');
  assert.equal(await evaluate("document.getElementById('theme-fields').disabled"), false);
  await click('#start-ai-customize');
  await until(() => evaluate("!document.getElementById('ai-task-panel').hidden"), '編集再開後に依頼を作れません');
  const nextId = await evaluate("new URLSearchParams(location.search).get('aiTask')"), next = await designImportStore.get(nextId);
  const result = structuredClone(next.snapshot); result.settings.typography.body = 34;
  await writeFile(join(next.folder, 'preset.json'), JSON.stringify(result));
  const completed = await designImportStore.complete(nextId);
  await until(() => evaluate(`new URLSearchParams(location.search).get('theme')===${JSON.stringify(completed.entry.id)} && document.body?.dataset.previewReady==='true'`), 'AI完了後のプリセットに自動で切り替わりません');
  assert.deepEqual(await designStore.get(id), original);
  assert.equal(await evaluate("document.querySelector('[data-path=\"typography.body\"]').value"), '34');
  assert.equal(await evaluate("document.getElementById('deck-count').value"), '6');
  assert.equal(await evaluate("document.getElementById('preview-category').value"), category);
  await shot('ai-complete.png', true);
  for (const width of [1000, 390, 320]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    await until(() => evaluate('document.documentElement.scrollWidth <= innerWidth'), `${width}pxで横にはみ出しています`);
    await shot(`customize-${width}.png`, width === 390);
  }
  report.checks.push('独自カテゴリの追加・名前変更・重複拒否・削除・選択・サムネイルと配色への反映');
  report.checks.push('6枚の自由構成・用途・並べ替え・予定尺・まとめ3項目・ページ別見出し112pxと本文32px・保存と詳細の実寸表示');
  report.checks.push('設定と希望を依頼書に保存・依頼中の編集固定・壊れたAI結果の拒否・URL再開・編集に戻る・完了後の自動切替・元プリセットの保持');
  report.checks.push('1000/390/320pxで横のはみ出しなし');
  assert.equal(cdp.events.filter(event => event.method === 'Runtime.exceptionThrown').length, 0);
  report.passed = true;
} catch (error) { report.error = error.message; process.exitCode = 1; }
finally {
  if (session) await session.close();
  if (server) await new Promise(done => server.close(done));
  assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep)); await rm(directory, { recursive: true, force: true });
  await writeFile(join(reportDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify(report, null, 2));
