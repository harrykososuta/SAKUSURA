import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createDesignStore } from './lib/design-store.mjs';
import { createStudioServer } from './server.mjs';
import { launchBrowser, until } from './lib/browser.mjs';
import { ROOT } from './lib/project.mjs';
import { DESIGN_SAMPLES } from '../src/design-catalog.js';

const directory = await mkdtemp(join(tmpdir(), 'sakusura-design-editor-qa-'));
const reportDir = join(ROOT, 'reports/design-editor'), report = { passed: false, checks: [], screenshots: [] };
const store = createDesignStore({ directory });
let server, session;
await mkdir(reportDir, { recursive: true });
try {
  server = await createStudioServer({ port: 0, designStore: store });
  const base = `http://127.0.0.1:${server.address().port}`;
  session = await launchBrowser();
  const { cdp, sessionId } = session;
  const send = (method, params) => cdp.send(method, params, sessionId);
  const evaluate = expression => cdp.evaluate(expression);
  const editorReady = () => until(() => evaluate("document.body?.dataset.ready === 'true' && document.body?.dataset.previewReady === 'true'"), 'デザイン追加画面を表示できません');
  const detailReady = () => until(() => evaluate("!!document.getElementById('layout-metrics')?.children.length && !!document.getElementById('edit-design')?.getAttribute('href')"), '保存したデザインを表示できません');
  async function click(selector) {
    const point = await evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});for(let parent=element.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;element.scrollIntoView({block:'center'});const r=element.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  }
  async function input(selector, value, event = 'input') {
    await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}));})()`);
  }
  async function clickPreview(selector) {
    const point = await evaluate(`(()=>{const f=document.getElementById('theme-preview-frame'),r=f.getBoundingClientRect(),t=f.contentDocument.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+t.x+t.width/2,y:r.y+t.y+t.height/2}})()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  }
  async function shot(name, full = false) {
    const params = { format: 'png' };
    if (full) { const { cssContentSize } = await send('Page.getLayoutMetrics'); params.captureBeyondViewport = true; params.clip = { x: 0, y: 0, width: cssContentSize.width, height: cssContentSize.height, scale: 1 }; }
    const result = await send('Page.captureScreenshot', params); await writeFile(join(reportDir, name), Buffer.from(result.data, 'base64')); report.screenshots.push(`reports/design-editor/${name}`);
  }
  const previewState = () => evaluate("(()=>{const doc=document.getElementById('theme-preview-frame').contentDocument,stage=doc.getElementById('stage'),css=getComputedStyle(stage);return {brand:doc.getElementById('brand').textContent,paper:css.getPropertyValue('--paper').trim(),primary:css.getPropertyValue('--primary').trim(),heading:css.getPropertyValue('--heading').trim(),body:css.getPropertyValue('--body').trim(),gap:css.getPropertyValue('--design-flow-gap').trim(),font:css.fontFamily};})()");
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: base + '/design' });
  await until(() => evaluate("document.body?.dataset.ready === 'true'"), '一覧を表示できません');
  // 複製は選んだデザインの詳細から行う。新規追加の入口はPDF用。
  await click('#theme-detail-link');
  await until(() => evaluate("!!document.getElementById('edit-design')?.getAttribute('href')"), '詳細を表示できません');
  await click('#edit-design'); await editorReady();
  assert.equal(await evaluate("new URLSearchParams(location.search).get('base')"), 'sakusura-standard');
  assert.equal(await evaluate("document.querySelectorAll('.design-page-item').length"), 12);
  assert.equal(await evaluate("(()=>{const l=document.querySelector('.design-pages').getBoundingClientRect(),c=document.querySelector('.theme-preview-panel').getBoundingClientRect(),r=document.querySelector('.design-inspector').getBoundingClientRect();return l.right<=c.left&&c.right<=r.left&&r.right<=innerWidth})()"), true);
  await clickPreview('.heading-text');
  await input('#design-text-value', '編集したデザイン見本');
  await until(() => evaluate("document.getElementById('theme-preview-frame').contentDocument.querySelector('.heading-text').textContent==='編集したデザイン見本'"), '選んだ見出しを編集できません');
  await clickPreview('.block-text');
  await input('#design-text-value', '選んだ文章を**編集**できます');
  await until(() => evaluate("document.getElementById('theme-preview-frame').contentDocument.querySelector('.block-text strong')?.textContent==='編集'"), '選んだ本文が見本に反映されません');
  assert.equal(await evaluate("document.getElementById('design-text-value').value"), '選んだ文章を**編集**できます');
  await shot('editor-selected-text.png');
  await click('.design-page-item:nth-child(2)'); await editorReady();
  assert.equal(await evaluate("document.getElementById('preview-layout').value"), 'agenda');
  await click('.design-page-item:first-child'); await editorReady();
  assert.equal(await evaluate("document.getElementById('theme-preview-frame').contentDocument.querySelector('.heading-text').textContent"), '編集したデザイン見本');
  report.checks.push('左にページ一覧・中央に見本・右に編集スペース・文字クリックと即時編集・強調記法・ページ切替で編集保持');
  await shot('editor-initial.png');
  await input('#design-name', 'ティールのデザイン'); await input('#design-brand', 'MY LECTURE');
  await input('#design-description', '白い背景と青緑の線。余白を整えた講義用デザイン。');
  await input('[data-color-path="colors.paper"][type=text]', '#ffffff');
  await input('#design-font', 'biz');
  for (const [path, value] of [['typography.heading', 44], ['typography.body', 30], ['typography.title', 80], ['typography.message', 84], ['spacing.left', 200]]) await input(`[data-path="${path}"]`, String(value));
  for (const [key, value] of [['primary', '#154e56'], ['accent', '#3aa6b9'], ['soft', '#c6e4e8'], ['marker', '#d9eef0']]) await input(`[data-color-path="categories.va.${key}"][type=text]`, value);
  await input('#preview-layout', 'flow', 'change');
  await until(() => evaluate("document.getElementById('preview-state').textContent === 'カテゴリA / フロー図'"), 'フロー図に切り替えられません');
  await input('[data-path="layouts.flow.gap"]', '100'); await input('[data-path="layouts.flow.minHeight"]', '240');
  await until(async () => (await previewState()).gap === '100px', 'プレビューに設定が反映されません');
  const state = await previewState(); assert.equal(state.brand, 'MY LECTURE'); assert.equal(state.paper, '#ffffff'); assert.equal(state.primary, '#154e56'); assert.equal(state.heading, '44px'); assert.equal(state.body, '30px'); assert.match(state.font, /BIZ UDPGothic/);
  await input('#preview-category', 'ecg', 'change');
  await input('[data-color-path="categories.ecg.primary"][type=text]', '#5b284f');
  await input('#preview-category', 'va', 'change');
  assert.equal(await evaluate("document.querySelector('[data-color-path=\"categories.va.primary\"][type=text]').value"), '#154e56');
  await until(() => evaluate("document.body.dataset.previewReady === 'true' && document.getElementById('preview-state').textContent === 'カテゴリA / フロー図'"), 'カテゴリ切り替え後の見本を表示できません');
  await shot('editor-custom.png');
  await click('#save-design'); await detailReady();
  const id = await evaluate("new URLSearchParams(location.search).get('theme')");
  const created = await store.get(id); assert.equal(created.design.name, 'ティールのデザイン'); assert.equal(created.design.settings.categories.ecg.primary, '#5b284f');
  assert.equal(created.design.deck.slides[0].purpose, '編集したデザイン見本');
  assert.equal(created.design.deck.slides[0].texts['blocks.0.text'], '選んだ文章を**編集**できます');
  await until(() => evaluate("document.getElementById('preview-status').textContent === 'カテゴリA / フロー図'"), '保存後の見本を表示できません');
  assert.equal(await evaluate("document.querySelector('#layout-metrics dd').textContent"), '44px');
  await shot('saved-detail.png', true);
  await click('[data-gallery-link]');
  await until(() => evaluate("document.querySelectorAll('.catalog-theme').length === 2"), '保存したデザインが一覧にありません');
  assert.equal(await evaluate("document.getElementById('design-count').textContent"), '2テーマ');
  await shot('gallery-two-designs.png');
  await click(`[data-theme-id="${id}"]`); await detailReady();
  await click('#edit-design'); await editorReady();
  await input('[data-path="typography.heading"]', '46'); await click('#save-design'); await detailReady();
  assert.equal((await store.get(id)).design.settings.typography.heading, 46);
  assert.equal((await readdir(join(directory, 'backups'))).length, 1);
  report.checks.push('一覧から追加・ライブプレビュー・4カテゴリの配色保持・保存後の一覧と詳細・再編集とバックアップ');
  await click('#duplicate-design'); await editorReady();
  assert.equal(await evaluate("document.querySelector('[data-path=\"typography.heading\"]').value"), '46');
  assert.match(await evaluate("document.getElementById('design-name').value"), /コピー/);
  for (const sample of DESIGN_SAMPLES) {
    await input('#preview-layout', sample.layout, 'change');
    await until(() => evaluate(`document.getElementById('preview-state').textContent === ${JSON.stringify('カテゴリA / ' + sample.name)}`), `カスタム見本を表示できません: ${sample.layout}`);
    assert.equal((await previewState()).primary, '#154e56');
    const selector = sample.layout === 'table' ? '.block-text:last-child' : sample.layout === 'bars' ? '.block-detail' : sample.layout === 'code' ? '.code-body' : sample.layout === 'message' ? '.heading-text' : '.block-text';
    await clickPreview(selector);
    const original = await evaluate("document.getElementById('design-text-value').value"), key = await evaluate("document.getElementById('design-text-select').value");
    assert.ok(key, `${sample.layout} の文字を選択できません`);
    await input('#design-text-value', '選択編集の検証');
    await until(() => evaluate(`document.getElementById('theme-preview-frame').contentDocument.querySelector('[data-design-text="${key}"]')?.textContent.includes('選択編集の検証')`), `${sample.layout} の文字を編集できません`);
    await input('#design-text-value', original);
  }
  report.checks.push('保存済みデザインの複製・16レイアウトのカスタムプレビューと文字選択・表のセル／棒グラフの補足／コードを編集');
  await input('[data-path="typography.body"]', '5');
  assert.equal(await evaluate("document.getElementById('save-design').disabled"), true);
  assert.equal((await previewState()).body, '30px');
  await input('[data-path="typography.body"]', '30');
  await input('#design-name', 'SAKUSURA Standard'); await click('#save-design');
  await until(() => evaluate("document.getElementById('editor-error').textContent.includes('同じ名前')"), '同名保存が拒否されません');
  assert.equal((await store.list()).designs.length, 2);
  await input('#design-name', 'ティールの別案');
  for (const width of [1000, 390, 320]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    await until(() => evaluate('document.documentElement.scrollWidth <= innerWidth'), `追加画面が${width}pxではみ出しています`);
    await shot(`editor-${width}.png`, width === 390);
  }
  await click('#save-design'); await detailReady();
  assert.equal((await createDesignStore({ directory }).list()).designs.length, 3);
  report.checks.push('範囲外設定はプレビュー・保存に使わない・同名保存を拒否・1000/390/320px表示・ファイルから再取得');
  const exceptions=cdp.events.filter(event => event.method === 'Runtime.exceptionThrown');
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
  report.passed = true;
} catch (failure) { report.error = failure.message; process.exitCode = 1; }
finally {
  if (session) await session.close();
  if (server) await new Promise(done => server.close(done));
  assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep)); await rm(directory, { recursive: true, force: true });
  await writeFile(join(reportDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify(report, null, 2));
