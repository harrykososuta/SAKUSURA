import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { CATEGORIES, LAYOUTS } from '../src/core.js';
import { DESIGN_SAMPLES } from '../src/design-catalog.js';
import { createStudioServer } from './server.mjs';
import { launchBrowser, until } from './lib/browser.mjs';
import { ROOT, fileHash } from './lib/project.mjs';
import { createDesignStore } from './lib/design-store.mjs';

const reportDir = join(ROOT, 'reports/design');
const report = { passed: false, checks: [], screenshots: [] };
let server, session;
const designDirectory = await mkdtemp(join(tmpdir(), 'sakusura-design-view-qa-'));
await mkdir(reportDir, { recursive: true });
const originals = new Map();
for (const item of await readdir(join(ROOT, 'lectures'), { withFileTypes: true })) {
  if (item.isDirectory()) {
    const path = join(ROOT, 'lectures', item.name, 'lecture.json');
    try { originals.set(path, fileHash(await readFile(path))); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
try {
  server = await createStudioServer({ port: 0, designStore: createDesignStore({ directory: designDirectory }) });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const path of ['/design', '/design/detail', '/design/preview', '/src/design.js', '/src/design-catalog.js', '/src/design.css']) assert.equal((await fetch(base + path)).status, 200, path);
  for (const path of ['/.env', '/config/tts.json', '/AGENTS.md']) assert.ok((await fetch(base + path)).status >= 400, path);
  report.checks.push('デザインページと必要なファイルの配信・非公開ファイルの保護');
  session = await launchBrowser();
  const { cdp, sessionId } = session;
  const send = (method, params) => cdp.send(method, params, sessionId);
  await send('Network.enable');
  const evaluate = expression => cdp.evaluate(expression);
  const layouts = Object.fromEntries(DESIGN_SAMPLES.map(s => [s.layout, s.name]));
  assert.deepEqual(new Set(Object.keys(layouts)), new Set(LAYOUTS));
  const ready = (category, layout) => until(() => evaluate(`document.getElementById('preview-status')?.textContent === ${JSON.stringify(`${CATEGORIES[category].name} / ${layouts[layout]}`)}`), `見本を表示できません: ${category}/${layout}`);
  const frameState = () => evaluate(`(()=>{const doc=document.getElementById('design-frame').contentDocument,stage=doc.getElementById('stage'),css=getComputedStyle(stage);return {primary:css.getPropertyValue('--primary').trim(),heading:css.getPropertyValue('--heading').trim(),body:css.getPropertyValue('--body').trim(),layout:doc.getElementById('slide-content').className,blocks:[...stage.querySelectorAll('[data-block]')].map(el=>({visible:el.classList.contains('visible'),opacity:getComputedStyle(el).opacity})),brand:doc.getElementById('brand').textContent,footer:doc.getElementById('lecture-title').textContent};})()`);
  async function shot(name, full = false) {
    const params = { format: 'png' };
    if (full) { const { cssContentSize } = await send('Page.getLayoutMetrics'); params.captureBeyondViewport = true; params.clip = { x: 0, y: 0, width: cssContentSize.width, height: cssContentSize.height, scale: 1 }; }
    const result = await send('Page.captureScreenshot', params);
    await writeFile(join(reportDir, name), Buffer.from(result.data, 'base64'));
    report.screenshots.push(`reports/design/${name}`);
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${base}/design` });
  await until(() => evaluate("document.body?.dataset.ready === 'true'"), 'デザイン一覧を表示できません');
  assert.equal(await evaluate("document.querySelectorAll('.catalog-theme').length"), 1);
  assert.equal(await evaluate("document.querySelectorAll('iframe,[data-layout-card],#gallery-category').length"), 0);
  await shot('design-gallery.png', true);
  for (const width of [1000, 390, 320]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    await until(() => evaluate('document.documentElement.scrollWidth <= innerWidth'), `一覧が画面幅${width}ではみ出しています`);
    await shot(`gallery-${width}.png`);
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  const previewTarget = await evaluate("(()=>{const r=document.getElementById('theme-detail-link').getBoundingClientRect();return{x:r.right-45,y:r.y+r.height/2};})()");
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...previewTarget, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...previewTarget, button: 'left', clickCount: 1 });
  await ready('cat-a', 'title');
  assert.equal(await evaluate('location.pathname'), '/design/detail');
  assert.match(await evaluate("document.getElementById('layout-page-title').textContent"), /SAKUSURA Standard/);
  await evaluate("document.getElementById('design-category').value='ai';document.getElementById('design-category').dispatchEvent(new Event('change'))");
  await ready('ai', 'title');
  await evaluate("document.querySelector('[data-gallery-link]').click()");
  await until(() => evaluate("document.body?.dataset.ready === 'true' && !!document.getElementById('theme-detail-link')"), '一覧に戻れません');
  assert.match(await evaluate("document.getElementById('theme-detail-link').href"), /category=ai&layout=title/);
  await evaluate("document.getElementById('theme-detail-link').focus()");
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await ready('ai', 'title');
  report.checks.push('一覧はテーマカード1枚のみ・カード全体のクリックとEnterで詳細へ移動・カテゴリを保持した一覧復帰・一覧のレスポンシブ表示');
  await send('Page.navigate', { url: `${base}/design/detail` });
  await ready('cat-a', 'title');
  assert.equal(await evaluate("document.querySelectorAll('#layout-options button').length"), 16);
  assert.equal(await evaluate("document.getElementById('edit-design').textContent"), '複製して編集');
  assert.equal(await evaluate("document.getElementById('duplicate-design').checkVisibility()"), false);
  await evaluate("document.querySelector('#detail-more > summary').click()");
  assert.equal(await evaluate("document.getElementById('duplicate-design').checkVisibility()"), true);
  await evaluate("document.querySelector('.preview-panel').click()");
  assert.equal(await evaluate("document.getElementById('detail-more').open"), false);
  assert.equal(await evaluate("document.querySelector('.theme-summary').contains(document.querySelector('.category-use-setting'))"), true);
  report.checks.push('編集を主操作に表示・複製とAI依頼のメニュー・外側クリックで閉じる・カテゴリ設定は右側に集約');
  assert.equal(await evaluate("document.querySelectorAll('#design-category option').length"), 4);
  assert.equal(await evaluate("document.querySelectorAll('.deck-page').length"), 12);
  assert.equal(await evaluate("document.querySelectorAll('.deck-page.is-message').length"), 2);
  await shot('design-desktop.png', true);
  for (const category of Object.keys(CATEGORIES)) {
    await evaluate(`document.getElementById('design-category').value=${JSON.stringify(category)};document.getElementById('design-category').dispatchEvent(new Event('change'))`);
    await ready(category, 'title');
    for (const layout of Object.keys(layouts)) {
      await evaluate(`document.querySelector('[data-layout=${layout}]').click()`);
      await ready(category, layout);
      const state = await frameState();
      assert.equal(state.primary, CATEGORIES[category].colors.primary);
      assert.equal(state.heading, '40px'); assert.equal(state.body, '28px');
      assert.ok(state.layout.includes(`layout-${layout}`)); assert.equal(state.brand, 'SAKUSURA'); assert.ok(state.footer);
      assert.ok(state.blocks.every(item => item.visible && item.opacity === '1'), `${category}/${layout}: ${JSON.stringify(state.blocks)}`);
      assert.equal(await evaluate("document.querySelector('#palette code').textContent"), CATEGORIES[category].colors.primary.toUpperCase());
      assert.equal(await evaluate("document.querySelector('#layout-options [aria-pressed=true]').dataset.layout"), layout);
      const metric = await evaluate("(()=>{const frame=document.getElementById('design-frame'),row=document.querySelector('#layout-metrics > div');return {displayed:row.querySelector('dd').textContent,actual:getComputedStyle(frame.contentDocument.querySelector('#stage h1')).fontSize};})()");
      assert.equal(metric.displayed, metric.actual);
      assert.equal(metric.actual, layout === 'title' ? '72px' : layout === 'message' ? '76px' : '40px');
      assert.ok(await evaluate("document.querySelectorAll('#layout-rules > div').length >= 3"));
      if (category === 'cat-a') await shot(`layout-${layout}.png`, true);
    }
    await evaluate("document.querySelector('[data-layout=title]').click()"); await ready(category, 'title');
  }
  report.checks.push('4カテゴリ×16レイアウトの見本・項目ごとのルールと実寸・実際の配色と数値表示の一致・固定要素・全要点の表示');
  await evaluate("document.querySelector('[data-layout=flow]').click()"); await ready('ai', 'flow');
  const savedUrl = await evaluate('location.href');
  await send('Page.reload'); await ready('ai', 'flow');
  assert.equal(await evaluate('location.href'), savedUrl);
  report.checks.push('カテゴリとレイアウトをURLから復元');
  await send('Page.navigate', { url: `${base}/design?category=ecg&layout=message` }); await ready('cat-b', 'message');
  assert.equal(await evaluate('location.pathname'), '/design/detail');
  report.checks.push('旧形式のリンクから選択中の詳細へ移動');
  await send('Page.navigate', { url: `${base}/design/detail?category=unknown&layout=unknown` }); await ready('cat-a', 'title');
  assert.equal(await evaluate("document.getElementById('design-category').value"), 'cat-a');
  report.checks.push('無効なカテゴリ・レイアウトは既定の見本へ戻る');
  for (const width of [1440, 1000, 760, 390, 320]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    await until(() => evaluate('document.documentElement.scrollWidth <= innerWidth'), `画面幅${width}ではみ出しがあります`);
    await until(() => evaluate(`(()=>{const frame=document.getElementById('design-frame'),stage=frame.contentDocument.getElementById('stage');return Math.abs(stage.getBoundingClientRect().width-frame.clientWidth)<3;})()`), '見本の縮小表示が更新されません');
    await shot(`design-${width}.png`, width === 390);
  }
  report.checks.push('1440・1000・760・390・320px幅ではみ出しなし・見本の縮小表示');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${base}/library` });
  await until(() => evaluate("!!document.getElementById('design-link')"), 'ライブラリのリンクがありません');
  const target = await evaluate("(()=>{const r=document.getElementById('design-link').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()");
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...target, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...target, button: 'left', clickCount: 1 });
  await until(() => evaluate("document.querySelectorAll('.catalog-theme').length === 1"), 'デザイン一覧へ移動できません');
  assert.equal(await evaluate('location.pathname'), '/design');
  report.checks.push('ライブラリのデザインリンクからマウス操作で移動');
  for (const [path, hash] of originals) assert.equal(fileHash(await readFile(path)), hash, path);
  const requests = cdp.events.filter(e => e.method === 'Network.requestWillBeSent').map(e => e.params.request);
  assert.ok(requests.every(r => r.method === 'GET'));
  assert.ok(requests.every(r => r.url.startsWith(base) || r.url.startsWith('data:') || r.url === 'about:blank'));
  assert.equal(cdp.events.filter(e => e.method === 'Runtime.exceptionThrown').length, 0);
  report.checks.push('既存講義JSONの不変性・書き込み要求と外部API呼び出しなし・JavaScript例外なし');
  report.passed = true;
} catch (error) { report.error = error.message; process.exitCode = 1; }
finally {
  if (session) await session.close();
  if (server) await new Promise(resolve => server.close(resolve));
  assert.ok(resolve(designDirectory).startsWith(resolve(tmpdir()) + sep));
  await rm(designDirectory, { recursive: true, force: true });
  await writeFile(join(reportDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify(report, null, 2));
