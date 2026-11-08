// 実データは読み取り専用。状態別の表示は注入した固定データで検証する。
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createStudioServer } from './server.mjs';
import { homeSnapshot } from './lib/lecture-status.mjs';
import { ttsUsage } from './lib/tts-usage.mjs';
import { ROOT } from './lib/project.mjs';
import { launchBrowser, until, sleep } from './lib/browser.mjs';

const reportDir = join(ROOT, 'reports', 'home');
await mkdir(reportDir, { recursive: true });
const report = { passed: false, checks: [], screenshots: [], errors: [] };
const now = Date.now();
const lectures = [
  { name: 'qa-home-images', title: '伝わるスライドのつくり方', number: '01', slides: 12, statuses: ['images', 'audio', 'validation'], missingImages: 2, pendingAudio: 4 },
  { name: 'qa-home-audio', title: 'チームで学ぶコミュニケーション', number: '02', slides: 18, statuses: ['audio', 'validation'], pendingAudio: 8 },
  { name: 'qa-home-validation', title: 'プレゼンテーションの基本', number: '03', slides: 14, statuses: ['validation'] },
  { name: 'qa-home-ready', title: 'アイデアをかたちにする', number: '04', slides: 10, statuses: ['ready'] },
  { name: 'qa-home-exported', title: '新しい学びを、次の一歩へ', number: '05', slides: 16, statuses: ['ready', 'exported'] },
  { name: 'qa-home-html', title: '受け取ったHTMLスライド', format: 'html', slides: 24, statuses: ['validation'], share: { version: 1, id: 'SKS-TEST-1234', revision: 3, author: '制作チーム', importedAt: new Date(now).toISOString() } },
].map((item, index) => ({ missingImages: 0, pendingAudio: 0, updatedAt: now - index * 3600000, ...item }));
const fixture = { generatedAt: new Date().toISOString(), lectures, counts: Object.fromEntries(['images', 'audio', 'validation', 'ready', 'exported'].map(status => [status, lectures.filter(item => item.statuses.includes(status)).length])), recent: lectures.slice(0, 6), imported: [lectures.at(-1)], excludedDemos: 3, imageJobs: [{ id: 'image', name: lectures[0].name, kind: 'images', phase: 'running', state: 'running' }] };
let mode = 'live', server, session, cdp;
const activeJobs = [{ id: 'render', kind: 'render', name: lectures[4].name, state: 'running', count: 16, completed: 7 }, { id: 'tts', kind: 'tts', name: lectures[1].name, state: 'running', count: 8, completed: 3 }];
try {
  server = await createStudioServer({ port: 0,
    getHomeSnapshot: async options => { if (mode === 'live') return homeSnapshot(options); if (mode === 'error') throw new Error('simulated'); if (mode === 'empty') return { ...fixture, lectures: [], recent: [], imported: [], imageJobs: [], counts: Object.fromEntries(Object.keys(fixture.counts).map(key => [key, 0])) }; return structuredClone(fixture); },
    getTtsUsage: async options => { if (mode === 'live') return ttsUsage(options); const result = await ttsUsage({ model: 'gemini-3.8-flash-lite-tts', file: join(reportDir, 'qa-unused-usage.json') }); result.current.count = 37; result.current.remaining = 63; if (mode === 'ended') { result.current.exhausted = true; result.current.remaining = 0; } return result; },
    renderJobs: { list: () => mode !== 'live' && mode !== 'empty' ? [activeJobs[0]] : [] }, ttsJobs: { list: () => mode !== 'live' && mode !== 'empty' ? [activeJobs[1]] : [] },
  });
  const base = `http://127.0.0.1:${server.address().port}`; report.port = server.address().port;
  assert.notEqual(report.port, 4173);
  session = await launchBrowser(); cdp = session.cdp;
  const send = (method, params) => cdp.send(method, params, session.sessionId);
  // 通常ブラウザと同じ通知欄を検証する（既存部品はwebdriver環境では通知を抑止する）。
  await send('Page.addScriptToEvaluateOnNewDocument', { source: "Object.defineProperty(navigator,'webdriver',{get:()=>false})" });
  const open = async path => { await send('Page.navigate', { url: base + path }); await until(() => cdp.evaluate("document.getElementById('status-filters')?.children.length===5 && !document.getElementById('refresh').disabled"), 'HOMEを読み込めません', 90000); await sleep(150); };
  const size = (width, height) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const shot = async file => { await cdp.evaluate('window.scrollTo(0,0)'); const metrics = await send('Page.getLayoutMetrics'); const png = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: await cdp.evaluate('innerWidth'), height: metrics.cssContentSize.height, scale: 1 } }); await writeFile(join(reportDir, file), Buffer.from(png.data, 'base64')); report.screenshots.push(`reports/home/${file}`); };
  const fits = async () => assert.equal(await cdp.evaluate('document.documentElement.scrollWidth<=innerWidth+1'), true, '横方向のはみ出し');
  const theme = async value => { await cdp.evaluate(`localStorage.setItem('sakusura-ui-settings',JSON.stringify({mode:${JSON.stringify(value)}}));window.applyUiTheme()`); await sleep(200); };
  await size(1440, 1000); const start = Date.now(); await open('/home'); report.liveLoadMs = Date.now() - start; await fits(); await shot('home-live-light.png');
  const warm = Date.now(); const warmResponse = await fetch(base + '/api/home'); assert.equal(warmResponse.status, 200); await warmResponse.json(); report.warmApiMs = Date.now() - warm;
  assert.equal((await fetch(base + '/home-assets/saku-receive.webp')).headers.get('content-type'), 'image/webp');
  await until(() => cdp.evaluate("!!document.querySelector('.jobs-button')&&!!document.querySelector('.cmdk-launcher')"), '共通ヘッダー部品を読み込めません');
  assert.equal(await cdp.evaluate("!document.querySelector('.usage-section img')&&!document.querySelector('.page-heading')"), true);
  const fullWidth = () => cdp.evaluate("(()=>{const r=document.getElementById('main').getBoundingClientRect();return r.left<=1&&r.width>=document.documentElement.clientWidth-1})()");
  assert.equal(await fullWidth(), true, 'HOMEが画面全幅を使用していません');
  assert.equal(await cdp.evaluate("document.querySelectorAll('main a[href^=\"/library\"]').length"), 0, '本文内に重複するライブラリへの案内があります');
  await size(1920, 1080); await fits(); assert.equal(await fullWidth(), true);
  await shot('home-wide-light.png'); await size(1440, 1000);
  report.checks.push('1440/1920pxで画面全幅を使用・重複するライブラリ案内の削除');
  report.checks.push('実データの読み取り・画像配信・ベルとコマンドパレットの共通部品');
  mode = 'fixture'; await open('/home');
  assert.equal(await cdp.evaluate("document.getElementById('status-details').hidden"), true, '最初から一覧が開いています');
  assert.equal(await cdp.evaluate("document.querySelectorAll('#active-jobs .job-row').length"), 3);
  assert.match(await cdp.evaluate("document.getElementById('tts-usage').textContent"), /37.*100/);
  for (const status of Object.keys(fixture.counts)) {
    await cdp.evaluate(`document.querySelector('[data-status=${status}]').click()`);
    assert.equal(await cdp.evaluate(`document.querySelector('[data-status=${status}]').getAttribute('aria-expanded')`), 'true');
    assert.equal(await cdp.evaluate("document.querySelectorAll('#status-list .lecture-row').length"), fixture.counts[status]);
    await cdp.evaluate(`document.querySelector('[data-status=${status}]').click()`);
    assert.equal(await cdp.evaluate("document.getElementById('status-details').hidden"), true, '同じ項目で一覧を閉じられません');
    assert.equal(await cdp.evaluate("document.querySelectorAll('#status-list .lecture-row').length"), 0);
  }
  await cdp.evaluate("document.querySelector('[data-status=ready]').click();document.getElementById('status-close').click()");
  assert.equal(await cdp.evaluate("document.getElementById('status-details').hidden&&document.activeElement.dataset.status==='ready'"), true, '閉じるボタンで項目に戻れません');
  await cdp.evaluate("document.getElementById('refresh').click()");
  await until(() => cdp.evaluate("!document.getElementById('refresh').disabled"), '更新が終わりません');
  assert.equal(await cdp.evaluate("document.getElementById('status-details').hidden"), true, '更新で閉じた一覧が再表示されています');
  const extraReady = Array.from({ length:8 }, (_, index) => ({ ...lectures[3], name:`qa-home-extra-${index}`, title:`表示件数の検証 ${index + 1}` }));
  fixture.lectures.push(...extraReady); fixture.counts.ready += extraReady.length;
  await cdp.evaluate("document.getElementById('refresh').click()");
  await until(() => cdp.evaluate("!document.getElementById('refresh').disabled&&document.querySelector('[data-status=ready] strong').textContent==='10'"), '検証用の件数を表示できません');
  await cdp.evaluate("document.querySelector('[data-status=ready]').click()");
  assert.equal(await cdp.evaluate("document.querySelectorAll('#status-list .lecture-row').length"), 5);
  await cdp.evaluate("document.getElementById('show-more').click()");
  assert.equal(await cdp.evaluate("document.querySelectorAll('#status-list .lecture-row').length"), 10);
  await shot('home-status-expanded.png');
  await cdp.evaluate("document.getElementById('status-close').click()");
  fixture.lectures.splice(-extraReady.length); fixture.counts.ready -= extraReady.length;
  await cdp.evaluate("document.getElementById('refresh').click()");
  await until(() => cdp.evaluate("!document.getElementById('refresh').disabled"), '検証用の件数を戻せません');
  await cdp.evaluate("document.querySelector('[data-status=audio]').focus()");
  for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key:'Enter', code:'Enter', windowsVirtualKeyCode:13, ...(type === 'keyDown' ? { text:'\r' } : {}) });
  assert.equal(await cdp.evaluate("document.querySelector('[data-status=audio]').getAttribute('aria-expanded')"), 'true', 'Enterで開けません');
  await cdp.evaluate("document.getElementById('status-close').focus()");
  await send('Input.dispatchKeyEvent', { type:'keyDown', key:'Escape', code:'Escape', windowsVirtualKeyCode:27 });
  assert.equal(await cdp.evaluate("document.getElementById('status-details').hidden"), true, 'Escapeで閉じられません');
  await shot('home-status-collapsed.png');
  report.checks.push('状態の初期折りたたみ・同じ項目の再クリックで開閉・閉じるボタン・Enter/Escape・更新後の維持・さらに表示');
  assert.equal(await cdp.evaluate('window.qaXss===undefined'), true);
  assert.equal(await cdp.evaluate("document.querySelector('#imported-list a').getAttribute('href')"), '/html-slides?name=qa-home-html');
  await cdp.evaluate("document.querySelector('[data-status=audio]').click()");
  await shot('home-desktop-light.png'); await theme('dark'); await shot('home-desktop-dark.png');
  report.checks.push('5種類の状態の絞り込み・音声/動画/画像の進捗・取り込んだHTML講義と送り主の安全な表示');
  for (const value of ['light', 'dark']) { await theme(value); await size(390, 844); await fits(); await shot(`home-mobile-${value}.png`); }
  // 大きな表示設定でも横にはみ出さないこと。
  await size(1440, 1000); await cdp.evaluate("localStorage.setItem('sakusura-ui-settings',JSON.stringify({mode:'light',uiScale:1.25}));window.applyUiTheme()"); await fits();
  await theme('light'); await size(390, 844); await cdp.evaluate("localStorage.setItem('sakusura-ui-settings',JSON.stringify({mode:'light',uiScale:1.25}));window.applyUiTheme()"); await fits(); await theme('light');
  await size(1440, 1000); mode = 'empty'; await open('/home'); assert.match(await cdp.evaluate("document.getElementById('recent-list').textContent"), /最初の講義/);
  const mascotReady = () => cdp.evaluate("(()=>{const image=document.querySelector('#imported-list .inbox-mascot');return !!image&&image.complete&&image.naturalWidth>0&&image.checkVisibility()})()");
  await until(mascotReady, 'ファイルを受け取るサクを表示できません');
  await shot('home-empty.png');
  await theme('dark'); await shot('home-inbox-dark.png');
  for (const value of ['light', 'dark']) { await theme(value); await size(390, 844); await fits(); assert.equal(await mascotReady(), true); await shot(`home-inbox-mobile-${value}.png`); }
  await cdp.evaluate("localStorage.setItem('sakusura-ui-settings',JSON.stringify({mode:'light',uiScale:1.25}));window.applyUiTheme()"); await fits(); assert.equal(await mascotReady(), true);
  await size(1440, 1000); await theme('light');
  report.checks.push('最近取り込んだ講義の空状態にファイルを受け取るサクを表示・PC/スマートフォン・ライト/ダーク');
  mode = 'ended'; await open('/home'); assert.match(await cdp.evaluate("document.getElementById('tts-usage').textContent"), /本日分は終了/); await shot('home-tts-ended.png');
  mode = 'error'; await cdp.evaluate("document.getElementById('refresh').click()"); await until(() => cdp.evaluate("!document.getElementById('home-error').hidden&&!document.getElementById('refresh').disabled"), '接続エラーを表示できません'); await shot('home-error.png');
  mode = 'fixture'; await cdp.evaluate("document.getElementById('refresh').click()"); await until(() => cdp.evaluate("document.getElementById('home-error').hidden&&!document.getElementById('refresh').disabled"), '接続エラーから復帰できません');
  fixture.imported[0].share.author = '<script>window.qaXss=true</script>';
  await cdp.evaluate("document.getElementById('refresh').click()"); await until(() => cdp.evaluate("document.getElementById('imported-list').textContent.includes('<script>')&&!document.getElementById('refresh').disabled"), '送り主の特殊文字を安全に表示できません');
  assert.equal(await cdp.evaluate('window.qaXss===undefined'), true); fixture.imported[0].share.author = '制作チーム';
  report.checks.push('PC/スマートフォン・ライト/ダーク・125%表示・空状態・429終了状態・通信失敗からの復帰');
  await cdp.evaluate("document.querySelector('.cmdk-launcher').click()"); await until(() => cdp.evaluate("!!document.querySelector('dialog.cmdk[open]')"), '検索を開けません');
  await cdp.evaluate("var input=document.querySelector('.cmdk input');input.value='ダッシュボード';input.dispatchEvent(new Event('input'))"); await until(() => cdp.evaluate("document.querySelector('.cmdk-list')?.textContent.includes('HOME')"), 'HOMEの検索候補がありません');
  await cdp.evaluate("document.querySelector('dialog.cmdk').close()");
  for (const path of ['/library', '/editor?lecture=demo', '/design', '/player?lecture=demo', '/settings']) {
    await send('Page.navigate', { url: base + path }); await until(() => cdp.evaluate("!!document.querySelector('nav.app-nav a[href=\"/home\"]')"), 'HOMEのリンクがありません');
    await cdp.evaluate("document.querySelector('nav.app-nav a[href=\"/home\"]').click()"); await until(() => cdp.evaluate("!!document.getElementById('welcome-title')"), 'HOMEに移動できません');
  }
  await open('/'); assert.match(await cdp.evaluate('document.title'), /HOME/);
  report.checks.push('全主要画面からHOMEへ移動・初期ルート・コマンドパレットからHOMEの検索');
  report.errors = cdp.events.filter(event => event.method === 'Runtime.exceptionThrown').map(event => event.params.exceptionDetails.text);
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) { report.failure = error.message; process.exitCode = 1; }
finally { if (session) await session.close(); if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } report.serverStopped = true; await writeFile(join(reportDir, 'qa-home.json'), JSON.stringify(report, null, 2) + '\n'); }
console.log(`${report.passed ? 'PASS' : 'FAIL'} HOME QA / reports/home/qa-home.json${report.failure ? ` / ${report.failure}` : ''}`);
