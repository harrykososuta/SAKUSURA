// インストール済みChrome/EdgeをCDPで操作。外部npm依存なし。
import { readdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createStudioServer } from './server.mjs';
import { ensureLectureReports, reportRoot, argumentValue, writeJson } from './lib/project.mjs';
import { launchBrowser, until, sleep } from './lib/browser.mjs';
import { CATEGORIES } from '../src/core.js';

let session, server, cdp;
const checks = [];
const name = argumentValue(process.argv, '--lecture', 'demo');
const report = { name, passed: false, generatedAt: new Date().toISOString(), checks, screenshots: [] };
const reportDir = reportRoot(name);
try {
  await ensureLectureReports(name);
  // この講義の古い画面PNGを消してから撮り直す（枚数が減ったときに古い画像が残らないように）。
  for (const file of await readdir(reportDir)) if (/^slide-\d+\.png$/.test(file)) await rm(join(reportDir, file));
  session = await launchBrowser();
  cdp = session.cdp;
  const { sessionId } = session;
  server = await createStudioServer({ port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  await cdp.send('Page.navigate', { url: `${base}/?lecture=${encodeURIComponent(name)}` }, sessionId);
  await until(() => cdp.evaluate('!!window.slideStudio?.player'), 'プレイヤーを読み込めません');
  checks.push('講義の読み込み');
  // 通常再生は固定の中央幅にせず、ウィンドウ全体を作業領域にする。
  for (const [width,height] of [[1918,811],[1440,900],[1147,802],[1366,600],[2560,1080]]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor:1, mobile:false }, sessionId);
    await until(() => cdp.evaluate(`(()=>{const canvas=document.querySelector('.player-canvas'),c=canvas.getBoundingClientRect(),s=document.getElementById('stage-shell').getBoundingClientRect(),stage=document.getElementById('stage').getBoundingClientRect(),controls=document.querySelector('.player-controls').getBoundingClientRect(),side=document.querySelector('.player-side').getBoundingClientRect();return document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight+1&&c.left<24&&side.right>innerWidth-24&&controls.bottom<=innerHeight&&s.width>0&&Math.abs(s.width/s.height-16/9)<.002&&s.left>=c.left-1&&s.right<=c.right+1&&s.top>=c.top-1&&s.bottom<=c.bottom+1&&Math.abs(s.width-Math.min(canvas.clientWidth,canvas.clientHeight*16/9))<1&&Math.abs(stage.width-s.width)<1})()`), `通常再生が画面に収まりません (${width}×${height})`);
    const file = `player-${width}x${height}.png`;
    const shot = await cdp.send('Page.captureScreenshot', { format:'png' }, sessionId);
    await writeFile(join(reportDir,file),Buffer.from(shot.data,'base64'));
    report.screenshots.push(`reports/${name}/${file}`);
  }
  for (const width of [820,390,320]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height:900, deviceScaleFactor:1, mobile:false }, sessionId);
    await until(() => cdp.evaluate('document.documentElement.scrollWidth<=innerWidth'), `通常再生が横にはみ出しています (${width}px)`);
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width:1920,height:1080,deviceScaleFactor:1,mobile:false },sessionId);
  checks.push('通常再生の幅を全体に広げ、実際の操作バーの高さに合わせて16:9で最大表示・5画面サイズと820/390/320px');
  const slideCount = await cdp.evaluate('slideStudio.player.lecture.slides.length');
  const hasAudio = await cdp.evaluate('Object.values(slideStudio.payload.audio).every(item => item.ready)');
  if (!hasAudio) {
    await cdp.evaluate("document.getElementById('preview').checked=true;document.getElementById('preview').dispatchEvent(new Event('change'))");
    await until(() => cdp.evaluate('!!slideStudio.player?.preview'), '無音リハーサルへ切り替えられません');
  }
  await cdp.evaluate("document.getElementById('play').click()");
  await until(() => cdp.evaluate("slideStudio.player.state==='playing' && slideStudio.player.time > 0.15"), '再生位置が進みません');
  await cdp.evaluate('slideStudio.player.pause()');
  const before = await cdp.evaluate('slideStudio.player.time'); await sleep(220);
  const after = await cdp.evaluate('slideStudio.player.time');
  if (Math.abs(before - after) > .02) throw new Error('停止中に再生位置が進みました');
  checks.push(hasAudio ? '実WAVの再生・一時停止' : '無音リハーサルの再生・一時停止');
  await cdp.evaluate('slideStudio.player.seek(0);slideStudio.player.play()');
  await until(() => cdp.evaluate('slideStudio.player.time > 0.15'), '再開できません');
  checks.push('再開・シーク');
  await cdp.evaluate('slideStudio.player.pause();slideStudio.player.load(0)');
  // ユーザーが押す「全画面」ボタンから検証する。録画モードへの直接切り替えだけで済ませない。
  await cdp.evaluate("document.getElementById('fullscreen').focus();document.getElementById('fullscreen').click()", true);
  await until(() => cdp.evaluate("!!document.fullscreenElement && document.body.classList.contains('recording')"), '全画面プレゼンを開始できません');
  await sleep(350);
  const hidden = await cdp.evaluate("[...document.querySelectorAll('[data-ui]')].every(el=>getComputedStyle(el).display==='none') && getComputedStyle(document.body).cursor==='none'");
  if (!hidden) throw new Error('録画モードで操作画面またはカーソルが残っています');
  const bounds = await cdp.evaluate('JSON.stringify(document.getElementById("stage").getBoundingClientRect().toJSON())');
  const rectangle = JSON.parse(bounds);
  if (Math.abs(rectangle.width - 1920) > 1 || Math.abs(rectangle.height - 1080) > 1) throw new Error('録画画面が1920×1080ではありません');
  checks.push('録画モード・1920×1080・UI非表示');
  if (!await cdp.evaluate("document.activeElement.id==='stage-shell'")) throw new Error('全画面ボタンにフォーカスが残っています');
  // 縦横比・DPI・全画面切り替えにかかわらず、16:9を中央に最大表示する。
  for (const [width, height, deviceScaleFactor] of [[1440, 900, 1], [2560, 1080, 1], [1280, 720, 1.5], [1920, 1080, 1]]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile: false }, sessionId);
    await sleep(200);
    const geometry = await cdp.evaluate(`(() => {
      const r=document.getElementById('stage').getBoundingClientRect();
      const s=document.getElementById('stage-shell').getBoundingClientRect();
      return {width:r.width,height:r.height,x:r.x,y:r.y,shellWidth:s.width,shellHeight:s.height,vw:innerWidth,vh:innerHeight};
    })()`);
    const scale = Math.min(geometry.vw / 1920, geometry.vh / 1080);
    if (Math.abs(geometry.width - 1920 * scale) > 1 || Math.abs(geometry.height - 1080 * scale) > 1 || Math.abs(geometry.x - (geometry.vw - geometry.width) / 2) > 1 || Math.abs(geometry.y - (geometry.vh - geometry.height) / 2) > 1 || Math.abs(geometry.shellWidth - geometry.width) > 1) throw new Error(`全画面のサイズ・中央配置が不正です (${width}×${height}, DPR ${deviceScaleFactor}): ${JSON.stringify(geometry)}`);
  }
  checks.push('全画面のリサイズ・16:10・横長画面・150% DPIで16:9を中央に最大表示');
  // 全画面中のカーソルとレーザーポインター：実際のマウス・キー入力で確認する。
  const moveMouse = (x, y) => cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, sessionId);
  const pressL = () => cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'l', code: 'KeyL', windowsVirtualKeyCode: 76 }, sessionId).then(() => cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'l', code: 'KeyL', windowsVirtualKeyCode: 76 }, sessionId));
  const cursorIs = value => cdp.evaluate(`getComputedStyle(document.getElementById('stage-shell')).cursor===${JSON.stringify(value)}`);
  const laserAt = (x, y) => cdp.evaluate(`(()=>{const d=document.getElementById('laser-pointer');if(d.hidden)return false;const r=d.getBoundingClientRect();return Math.abs(r.x+r.width/2-${x})<2&&Math.abs(r.y+r.height/2-${y})<2;})()`);
  await moveMouse(300, 300); await moveMouse(301, 300);
  if (!await cursorIs('none')) throw new Error('全画面でマウスのわずかな動きにカーソルが反応しました');
  await moveMouse(340, 340);
  await until(() => cursorIs('default'), '全画面でマウスを動かしてもカーソルが出ません');
  await until(() => cursorIs('none'), '全画面でマウスを止めてもカーソルが隠れません');
  await pressL();
  await until(() => laserAt(340, 340), 'Lでレーザーポインターが出ません');
  await moveMouse(500, 400);
  await until(() => laserAt(500, 400), 'レーザーポインターがマウスに追従しません');
  if (!await cursorIs('none')) throw new Error('レーザーポインター中にカーソルが残っています');
  if (await cdp.evaluate("document.elementFromPoint(500,400).id==='laser-pointer'")) throw new Error('レーザーポインターがスライドのクリックを遮っています');
  await pressL();
  if (!await cdp.evaluate("document.getElementById('laser-pointer').hidden")) throw new Error('Lでレーザーポインターを消せません');
  await cdp.evaluate('slideStudio.player.play()');
  await until(() => cdp.evaluate('slideStudio.player.active'), '全画面で再生を開始できません');
  await moveMouse(600, 500);
  if (!await cursorIs('none')) throw new Error('音声付き再生中にカーソルが出ました（収録に映ります）');
  await pressL();
  await until(() => laserAt(600, 500), '音声付き再生中にレーザーポインターを使えません');
  await pressL();
  await cdp.evaluate('slideStudio.player.pause();slideStudio.player.load(0)');
  checks.push('全画面のカーソル自動表示・自動非表示・Lのレーザーポインター・音声付き再生中はカーソル非表示');
  // スケッチと拡大：実際のドラッグ・キー・ホイールで確認する。
  const pressKey = (key, code, virtualKey, modifiers = 0) => cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: virtualKey, modifiers }, sessionId).then(() => cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: virtualKey, modifiers }, sessionId));
  const dragMouse = async (from, to) => {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from[0], y: from[1] }, sessionId);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from[0], y: from[1], button: 'left', buttons: 1, clickCount: 1 }, sessionId);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: to[0], y: to[1], button: 'left', buttons: 1 }, sessionId);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to[0], y: to[1], button: 'left', buttons: 0, clickCount: 1 }, sessionId);
    await sleep(60);
  };
  const strokeCount = () => cdp.evaluate("document.querySelectorAll('#sketch-layer path').length");
  const stageWidth = () => cdp.evaluate("document.getElementById('stage').getBoundingClientRect().width");
  const playerPlace = () => cdp.evaluate("slideStudio.player.index+':'+slideStudio.player.time");
  await cdp.evaluate('slideStudio.player.load(0)');
  const placeBefore = await playerPlace();
  await pressKey('p', 'KeyP', 80);
  if (!await cursorIs('crosshair')) throw new Error('Pでペンのカーソルになりません');
  await dragMouse([400, 400], [800, 600]);
  if (await strokeCount() !== 1) throw new Error('ドラッグで線を描けません');
  if (await playerPlace() !== placeBefore) throw new Error('ペン中のドラッグでスライドが進みました');
  const stroke = await cdp.evaluate("document.querySelector('#sketch-layer path').getAttribute('d')");
  if (stroke !== 'M400 400L800 600') throw new Error(`線の座標がマウスとずれています: ${stroke}`);
  await pressKey('z', 'KeyZ', 90, 2);
  if (await strokeCount() !== 0) throw new Error('Ctrl+Zで線を戻せません');
  await dragMouse([400, 400], [800, 600]);
  if (slideCount > 1) {
    await cdp.evaluate('slideStudio.player.load(1)');
    await until(async () => await strokeCount() === 0, '別のスライドに線が残っています');
    await cdp.evaluate('slideStudio.player.load(0)');
    await until(async () => await strokeCount() === 1, 'スライドに戻ると線が消えています');
  }
  await pressKey('e', 'KeyE', 69);
  if (await strokeCount() !== 0) throw new Error('Eで線を全消去できません');
  await pressKey('p', 'KeyP', 80);
  if (!await cursorIs('none')) throw new Error('Pでペンを解除できません');
  checks.push('全画面のスケッチ：描画・座標・Ctrl+Z・E・スライドごとの保持・描画中はスライドを送らない');
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 480, y: 270 }, sessionId);
  await pressKey('z', 'KeyZ', 90);
  await until(async () => Math.abs(await stageWidth() - 3840) < 1, 'Zで拡大できません');
  const anchored = await cdp.evaluate("(()=>{const r=document.getElementById('stage').getBoundingClientRect();return Math.abs((480-r.left)/r.width-.25)<.001&&Math.abs((270-r.top)/r.height-.25)<.001})()");
  if (!anchored) throw new Error('マウスの位置を中心に拡大していません');
  const leftBefore = await cdp.evaluate("document.getElementById('stage').getBoundingClientRect().left");
  const placeZoomed = await playerPlace();
  await dragMouse([700, 500], [800, 500]);
  const leftAfter = await cdp.evaluate("document.getElementById('stage').getBoundingClientRect().left");
  if (Math.abs(leftAfter - leftBefore - 100) > 1) throw new Error('拡大中のドラッグで移動できません');
  if (await playerPlace() !== placeZoomed) throw new Error('拡大中のドラッグでスライドが進みました');
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 800, y: 500, deltaX: 0, deltaY: -200 }, sessionId);
  await until(async () => await stageWidth() > 3900, 'ホイールで拡大できません');
  await pressKey('z', 'KeyZ', 90);
  await until(async () => Math.abs(await stageWidth() - 1920) < 1, 'Zで拡大を解除できません');
  await sleep(260);
  await pressKey('z', 'KeyZ', 90);
  await until(async () => await stageWidth() > 3800, '再度拡大できません');
  await cdp.evaluate(`slideStudio.player.load(${slideCount > 1 ? 1 : 0})`);
  if (slideCount > 1) await until(async () => Math.abs(await stageWidth() - 1920) < 1, 'スライドを移っても拡大が解除されません');
  else await pressKey('z', 'KeyZ', 90);
  await cdp.evaluate('slideStudio.player.load(0)');
  checks.push('全画面の拡大：Z・マウス位置中心・ドラッグ移動・ホイール・スライド移動で解除');
  // 操作バー：実際のマウス操作で、表示・自動非表示・各ボタンを確認する。
  const barShown = () => cdp.evaluate("document.getElementById('presentation-bar').classList.contains('is-shown')");
  const barButton = command => cdp.evaluate(`(()=>{const r=document.querySelector('#presentation-bar [data-command=${command}]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  const barPressed = command => cdp.evaluate(`document.querySelector('#presentation-bar [data-command=${command}]').getAttribute('aria-pressed')==='true'`);
  const clickBar = async command => {
    const { x, y } = await barButton(command);
    await moveMouse(x, y);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }, sessionId);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }, sessionId);
    await sleep(60);
  };
  await until(async () => !await barShown(), '操作バーが自動で隠れません');
  await moveMouse(900, 600);
  if (!await barShown()) throw new Error('マウスを動かしても操作バーが出ません');
  const { x: hoverX, y: hoverY } = await barButton('pen');
  await moveMouse(hoverX, hoverY); await sleep(2700);
  if (!await barShown()) throw new Error('操作バーの上にマウスがあるのに隠れました');
  await moveMouse(900, 600);
  const placeBar = await playerPlace();
  await clickBar('pen');
  if (await playerPlace() !== placeBar) throw new Error('操作バーのクリックでスライドが進みました');
  if (!await barPressed('pen') || !await cursorIs('crosshair')) throw new Error('操作バーからペンを選べません');
  await clickBar('laser');
  if (await barPressed('pen') || !await barPressed('laser')) throw new Error('操作バーでペンとレーザーを切り替えられません');
  await clickBar('laser');
  await clickBar('zoom');
  await until(async () => Math.abs(await stageWidth() - 3840) < 1, '操作バーから拡大できません');
  const centered = await cdp.evaluate("(()=>{const r=document.getElementById('stage').getBoundingClientRect();return Math.abs(r.left+960)<1&&Math.abs(r.top+540)<1})()");
  if (!centered || !await barPressed('zoom')) throw new Error('操作バーの拡大が画面中央になっていません');
  await clickBar('zoom');
  await until(async () => Math.abs(await stageWidth() - 1920) < 1, '操作バーから拡大を解除できません');
  await clickBar('next');
  if (await playerPlace() === placeBar) throw new Error('操作バーの「次へ」で進みません');
  await clickBar('prev');
  await clickBar('play');
  await until(() => cdp.evaluate('slideStudio.player.active'), '操作バーから再生できません');
  await moveMouse(1000, 700);
  if (await barShown()) throw new Error('音声付き再生中に操作バーが出ました（収録に映ります）');
  await cdp.evaluate('slideStudio.player.pause();slideStudio.player.load(0)');
  await until(() => cursorIs('none'), '再生前のカーソルが隠れません');
  checks.push('全画面の操作バー：表示・自動非表示・送り・ペン・レーザー・拡大・再生・音声付き再生中は非表示');
  // ペンの色：数字キーと操作バーの色ボタンで切り替え、線ごとに色が残ることを確認する。
  const lastStrokeColor = () => cdp.evaluate("document.querySelector('#sketch-layer path:last-child').getAttribute('stroke')");
  const swatchesVisible = () => cdp.evaluate("document.querySelector('#presentation-bar [data-color=red]').getBoundingClientRect().width>0");
  await pressKey('p', 'KeyP', 80);
  await dragMouse([400, 300], [700, 300]);
  if (await lastStrokeColor() !== '#e5252a') throw new Error('ペンの最初の色が赤ではありません');
  await pressKey('2', 'Digit2', 50);
  await dragMouse([400, 400], [700, 400]);
  if (await lastStrokeColor() !== '#1f6fe5') throw new Error('数字キーでペンの色を変えられません');
  await moveMouse(900, 600);
  if (!await swatchesVisible()) throw new Error('ペン中に色のボタンが出ません');
  const greenSwatch = await cdp.evaluate("(()=>{const r=document.querySelector('#presentation-bar [data-color=green]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
  await moveMouse(greenSwatch.x, greenSwatch.y);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: greenSwatch.x, y: greenSwatch.y, button: 'left', buttons: 1, clickCount: 1 }, sessionId);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: greenSwatch.x, y: greenSwatch.y, button: 'left', buttons: 0, clickCount: 1 }, sessionId);
  await dragMouse([400, 500], [700, 500]);
  if (await lastStrokeColor() !== '#12a150') throw new Error('操作バーからペンの色を変えられません');
  const strokeColors = await cdp.evaluate("[...document.querySelectorAll('#sketch-layer path')].map(p=>p.getAttribute('stroke')).join()");
  if (strokeColors !== '#e5252a,#1f6fe5,#12a150') throw new Error(`線ごとの色が保たれていません: ${strokeColors}`);
  await pressKey('1', 'Digit1', 49);
  await pressKey('e', 'KeyE', 69);
  await pressKey('p', 'KeyP', 80);
  await moveMouse(900, 600);
  if (await swatchesVisible()) throw new Error('ペンを切っても色のボタンが残っています');
  checks.push('ペンの色：数字キー・操作バー・線ごとの色の保持');
  // スライド一覧：実際のマウス・キー操作で、開く・縮小表示・移動・閉じるを確認する。
  const overviewOpen = () => cdp.evaluate("document.getElementById('slide-overview').open");
  await clickBar('overview');
  await until(overviewOpen, '操作バーからスライド一覧を開けません');
  const overviewState = await cdp.evaluate(`(()=>{
    const items=[...document.querySelectorAll('.overview-item')];
    const thumb=items[0].querySelector('.overview-thumb'), box=thumb.getBoundingClientRect(), inner=thumb.shadowRoot.getElementById('stage').getBoundingClientRect();
    return {count:items.length,drawn:items.every(i=>i.querySelector('.overview-thumb').shadowRoot.getElementById('slide-content').childElementCount>0),fit:Math.abs(inner.width-box.width)<1&&Math.abs(inner.height-box.height)<1,current:items.findIndex(i=>i.getAttribute('aria-current')==='true'),scrollX:document.getElementById('slide-overview').scrollWidth<=innerWidth};
  })()`);
  if (overviewState.count !== slideCount || !overviewState.drawn) throw new Error(`スライド一覧の枚数・縮小表示が不正です: ${JSON.stringify(overviewState)}`);
  if (!overviewState.fit || !overviewState.scrollX) throw new Error(`スライド一覧の大きさが不正です: ${JSON.stringify(overviewState)}`);
  if (overviewState.current !== 0) throw new Error('スライド一覧で現在のスライドが示されていません');
  if (slideCount > 1) {
    await pressKey('ArrowRight', 'ArrowRight', 39);
    if (await cdp.evaluate("document.activeElement.dataset.index") !== '1') throw new Error('スライド一覧を矢印キーで移動できません');
  }
  await pressKey('g', 'KeyG', 71);
  await until(async () => !await overviewOpen(), 'Gでスライド一覧を閉じられません');
  if (!await cdp.evaluate("document.activeElement.id==='stage-shell'")) throw new Error('スライド一覧を閉じてもキー操作がスライドに戻りません');
  await pressKey('g', 'KeyG', 71);
  await until(overviewOpen, 'Gでスライド一覧を開けません');
  const lastItem = await cdp.evaluate(`(()=>{const e=document.querySelector('.overview-item[data-index="${slideCount - 1}"]');e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/3}})()`);
  await moveMouse(lastItem.x, lastItem.y);
  await sleep(250);
  if (await cdp.evaluate(`(()=>{const s=getComputedStyle(document.querySelector('.overview-item[data-index="${slideCount - 1}"]'));return s.backgroundColor!=='rgba(0, 0, 0, 0)'||s.color!=='rgb(255, 255, 255)'})()`)) throw new Error('スライド一覧でマウスを乗せると題名が読めなくなります');
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: lastItem.x, y: lastItem.y, button: 'left', buttons: 1, clickCount: 1 }, sessionId);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: lastItem.x, y: lastItem.y, button: 'left', buttons: 0, clickCount: 1 }, sessionId);
  await until(async () => !await overviewOpen(), 'スライド一覧で選んでも閉じません');
  if (!await cdp.evaluate(`slideStudio.player.index===${slideCount - 1}&&slideStudio.player.time<=slideStudio.player.settleTo&&slideStudio.player.state==='paused'`)) throw new Error('スライド一覧で選んだスライドへ移動できません');
  await cdp.evaluate('slideStudio.player.load(0);slideStudio.player.play()');
  await until(() => cdp.evaluate('slideStudio.player.active'), 'スライド一覧の確認で再生できません');
  await pressKey('g', 'KeyG', 71);
  await until(overviewOpen, '音声付き再生中にスライド一覧を開けません');
  if (await cdp.evaluate('slideStudio.player.active')) throw new Error('スライド一覧を開いても再生が止まりません');
  await pressKey('g', 'KeyG', 71);
  await until(async () => !await overviewOpen(), 'スライド一覧を閉じられません');
  await cdp.evaluate('slideStudio.player.presentSlide(0)');
  // 一覧をホイールでスクロールしても、裏のスライドを拡大しない。
  await pressKey('g', 'KeyG', 71);
  await until(overviewOpen, 'スライド一覧を開けません');
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 900, y: 500, deltaX: 0, deltaY: -300 }, sessionId);
  await sleep(150);
  await pressKey('g', 'KeyG', 71);
  await until(async () => !await overviewOpen(), 'スライド一覧を閉じられません');
  if (Math.abs(await stageWidth() - 1920) > 1) throw new Error('スライド一覧をホイールで操作すると、戻ったときに拡大されています');
  // 拡大中に一覧を開いたら、戻ったときは等倍にする（同じスライドを選んだときも）。
  await pressKey('z', 'KeyZ', 90);
  await until(async () => await stageWidth() > 3800, 'Zで拡大できません');
  await pressKey('g', 'KeyG', 71);
  await until(overviewOpen, '拡大中にスライド一覧を開けません');
  await pressKey('g', 'KeyG', 71);
  await until(async () => !await overviewOpen(), 'スライド一覧を閉じられません');
  await sleep(260);
  if (Math.abs(await stageWidth() - 1920) > 1) throw new Error('拡大中に一覧を開いて戻ると、拡大が残っています');
  await cdp.evaluate('slideStudio.player.load(0)');
  await until(async () => !await barShown() && await cursorIs('none'), '操作バー・カーソルが隠れません');
  checks.push('全画面のスライド一覧：開閉・縮小表示・矢印キー・選択で移動・再生中は一時停止・戻ったときは等倍');
  for (let index = 0; index < slideCount; index++) {
    await cdp.evaluate(`slideStudio.player.load(${index});slideStudio.player.seek(slideStudio.player.duration - .01)`);
    await sleep(350);
    // 画像（とその上のラベル枠の大きさ）が確定してから検査・撮影する。
    await until(() => cdp.evaluate("[...document.querySelectorAll('#slide-content img')].every(img => img.complete && img.naturalWidth > 0)"), `スライド${index + 1}の画像を読み込めません`);
    await sleep(100);
    const layoutErrors = await cdp.evaluate(`(() => {
      const stage=document.getElementById('stage').getBoundingClientRect();
      const footer=document.querySelector('.slide-footer').getBoundingClientRect();
      const h=document.querySelector('h1').getBoundingClientRect();
      const blocks=[...document.querySelectorAll('#slide-content [data-block]')];
      const issues=[];
      if(slideStudio.player.slide.layout==='document') {
        for(const el of [document.querySelector('h1'),...blocks]){
          const r=el.getBoundingClientRect();
          if(r.left<stage.left-1||r.top<stage.top-1||r.right>stage.right+1||r.bottom>stage.bottom+1)issues.push(el.textContent||el.alt||'画像');
          if(el.clientWidth&&el.scrollWidth>el.clientWidth+2)issues.push('文字の幅: '+el.textContent.slice(0,25));
        }
        return issues;
      }
      // 年表（timeline）は年・出来事を列の外へ広げて上下交互に置くため、列ではなく文字の箱で測る。
      for(const block of [document.querySelector('h1'),...blocks]) {
        const el=block.matches('.layout-timeline .blocks > [data-block]') ? block.querySelector('.block-body') : block;
        const r=el.getBoundingClientRect();
        if(r.left < stage.left || r.right > stage.right || r.bottom > footer.top-10 || el.scrollWidth > el.clientWidth+2 || el.scrollHeight > el.clientHeight+2) issues.push(el.textContent);
      }
      for(const el of blocks) if(el.getBoundingClientRect().top < h.bottom-1) issues.push('見出しと本文が重なっています');
      return issues;
    })()`);
    if (layoutErrors.length) throw new Error(`スライド${index + 1}のはみ出し: ${layoutErrors.join(' / ')}`);
    // デザイン規格：右上SAKUSURA・右下ページ番号・左下表題、見出し40px・本文28px、文字は2階調のグレー。
    const designErrors = await cdp.evaluate(`(() => {
      const stage=document.getElementById('stage').getBoundingClientRect();
      const issues=[]; const css=el=>getComputedStyle(el);
      // 講義のCSS（LLMにおまかせ・CSSテンプレート）があれば見た目の規格（位置・文字サイズ・色・書体）は検査せず、構成ルールが自由（rules: free）なら構成の規格を検査しない。
      const appearance=slideStudio.player.slide.appearance;
      const themed=!!(appearance ? appearance.css : slideStudio.player.lecture.theme?.css), free=slideStudio.player.lecture.rules==='free';
      const corner=(id,label,right,bottom)=>{ const el=document.getElementById(id); const r=el.getBoundingClientRect();
        if(!el.textContent.trim()) issues.push(label+'が空です');
        if((r.left+r.right)/2 > stage.left+stage.width/2 !== right || (r.top+r.bottom)/2 > stage.top+stage.height/2 !== bottom) issues.push(label+'の位置が違います'); };
      if(!themed){ corner('brand','右上のSAKUSURA',true,false); corner('slide-number','右下のページ番号',true,true); corner('lecture-title','左下の表題',false,true); }
      if(!free && document.getElementById('brand').textContent.trim()!=='SAKUSURA') issues.push('右上はSAKUSURAです');
      if(document.getElementById('slide-number').textContent.trim()!==String(slideStudio.player.index+1).padStart(2,'0')) issues.push('ページ番号が違います');
      const layout=slideStudio.player.slide.layout;
      if(!free && layout==='title' && slideStudio.player.lecture.demo!==true && !/^#\\d+$/.test(document.querySelector('.deck-number')?.textContent||'')) issues.push('サムネイルに #演題番号 がありません');
      if(!themed && !['title','message'].includes(layout) && css(document.querySelector('h1')).fontSize!=='40px') issues.push('見出しが40pxではありません');
      if(!themed) for(const el of document.querySelectorAll('.block-text')) if(css(el).fontSize!=='28px') issues.push('本文が28pxではありません');
      if(!themed && layout==='message' && css(document.querySelector('h1')).fontSize!==(slideStudio.player.slide.people?.length ? '68px' : '76px')) issues.push('一文スライドの一文が76px（人物紹介つきは68px）ではありません');
      // 本文の下のまとめの一文：28px・1行に収まること（省略記号で切れていないこと）
      for(const el of document.querySelectorAll('.slide-note')) {
        if(!themed && css(el).fontSize!=='28px') issues.push('まとめの一文が28pxではありません');
        if(el.scrollWidth>el.clientWidth+1) issues.push('まとめの一文が1行に収まりません: '+el.textContent.slice(0,20));
        // 本文・画像の下端が、まとめの一文の線より上にあること（16pxの余白）
        const top=el.getBoundingClientRect().top;
        for(const other of document.querySelectorAll('.blocks .block-text, .blocks .block-detail, .blocks .block-label, .blocks img, .slide-image')) if(other.getBoundingClientRect().bottom>top-16) { issues.push('本文がまとめの一文に近すぎるか重なっています: '+(other.textContent||other.alt||'画像').slice(0,20)); break; }
      }
      const grays=new Set(['rgb(51, 51, 51)','rgb(118, 118, 118)','rgb(138, 138, 138)']);
      if(!themed) for(const el of document.querySelectorAll('#slide-content *')) if(el.childNodes.length && [...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()) && !grays.has(css(el).color)) issues.push('グレー以外の文字色: '+el.textContent.slice(0,20));
      if(!free && layout==='message' && document.querySelectorAll('#slide-content [data-block]').length) issues.push('一文スライドに本文があります');
      // カテゴリの配色（左端の帯の色）と、サムネイルのカテゴリ名
      const category=${JSON.stringify(CATEGORIES)}[appearance ? appearance.category : slideStudio.player.lecture.category];
      if(category && !themed){
        if(css(document.getElementById('stage')).getPropertyValue('--primary').trim()!==category.colors.primary) issues.push('カテゴリの配色が反映されていません');
        if(layout==='title' && document.querySelector('.category-tag')?.textContent!==category.name) issues.push('サムネイルにカテゴリ名がありません');
      }
      if(!themed && !/Noto Sans JP|BIZ UDPGothic/.test(css(document.querySelector('h1')).fontFamily)) issues.push('書体が規格外です');
      // 画像の上のラベル：スライドの外にはみ出さない・ラベル同士が重ならない
      const tags=[...document.querySelectorAll('.image-label span')].map(el=>({text:el.textContent,r:el.getBoundingClientRect()}));
      for(const t of tags) if(t.r.left<stage.left||t.r.right>stage.right||t.r.top<stage.top||t.r.bottom>stage.bottom) issues.push('ラベルがはみ出しています: '+t.text);
      for(let i=0;i<tags.length;i++) for(let j=i+1;j<tags.length;j++){const a=tags[i].r,b=tags[j].r; if(a.left<b.right-2&&b.left<a.right-2&&a.top<b.bottom-2&&b.top<a.bottom-2) issues.push('ラベルが重なっています: '+tags[i].text+' / '+tags[j].text);}
      // 編集画面で足した図形・文字：スライドの内側・左端の帯や固定要素（SAKUSURA・ページ番号・表題）と重ならない。
      // 文字は28px／40px・グレー2階調・枠からはみ出さない・見出しや本文の文字と重ならない。
      const overlap=(a,b)=>a.left<b.right-2&&b.left<a.right-2&&a.top<b.bottom-2&&b.top<a.bottom-2;
      const fixed=['brand','slide-number','lecture-title'].map(id=>document.getElementById(id).getBoundingClientRect());
      const band=document.getElementById('stage').getBoundingClientRect().left+69*stage.width/1920;
      const texts=[...document.querySelectorAll('#slide-content .heading-text, #slide-content .block-text, #slide-content .block-label, #slide-content .block-detail, #slide-content .slide-note')].map(el=>el.getBoundingClientRect());
      for(const el of document.querySelectorAll('.shape-layer .shape')) {
        const r=el.getBoundingClientRect(), name=el.classList.contains('shape-text')?'追加した文字「'+el.textContent.slice(0,12)+'」':'追加した図形（'+el.dataset.element+'）';
        if(r.left<band-1||r.right>stage.right+1||r.top<stage.top-1||r.bottom>stage.bottom+1) issues.push(name+'がスライドの外または左端の帯にはみ出しています');
        if(fixed.some(f=>overlap(r,f))) issues.push(name+'がSAKUSURA・ページ番号・表題と重なっています');
        if(!el.classList.contains('shape-text')) continue;
        if(!themed && !['28px','40px'].includes(css(el).fontSize)) issues.push(name+'が28px／40pxではありません');
        if(!themed && !grays.has(css(el).color)) issues.push(name+'がグレー以外の文字色です');
        if(el.scrollWidth>el.clientWidth+2) issues.push(name+'が枠からはみ出しています');
        if(texts.some(t=>overlap(r,t))) issues.push(name+'が見出し・本文の文字と重なっています');
      }
      return [...new Set(issues)];
    })()`);
    if (designErrors.length) throw new Error(`スライド${index + 1}のデザイン規格: ${designErrors.join(' / ')}`);
    const file = `slide-${String(index + 1).padStart(3, '0')}.png`;
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    await writeFile(join(reportDir, file), Buffer.from(shot.data, 'base64'));
    report.screenshots.push(`reports/${name}/${file}`);
  }
  checks.push(`全${slideCount}枚のはみ出し・重なり検査とスクリーンショット`);
  // 実際のendedイベントによる自動送り。音声を消費せず末尾へシークする。
  await cdp.evaluate('slideStudio.player.load(0);slideStudio.player.play()');
  await until(() => cdp.evaluate("slideStudio.player.state==='playing'"), '自動送りテストの再生に失敗');
  await cdp.evaluate('slideStudio.player.seek(Math.max(0,slideStudio.player.duration-.2))');
  await until(() => cdp.evaluate(slideCount > 1 ? 'slideStudio.player.index===1' : "slideStudio.player.state==='ended'"), '音声終了後に自動送りしません');
  checks.push('音声終了時の自動送り');
  await cdp.evaluate('slideStudio.player.pause();slideStudio.player.load(slideStudio.player.lecture.slides.length-1);slideStudio.player.play()');
  await until(() => cdp.evaluate("slideStudio.player.state==='playing'"), '最終枚の再生に失敗');
  await cdp.evaluate('slideStudio.player.seek(Math.max(0,slideStudio.player.duration-.2))');
  await until(() => cdp.evaluate("slideStudio.player.state==='ended'"), '最終枚で終了しません');
  checks.push('最終枚で終了');
  await cdp.evaluate('slideStudio.player.pause()');
  await pressKey('p', 'KeyP', 80);
  await dragMouse([400, 400], [800, 600]);
  if (await strokeCount() !== 1) throw new Error('全画面を抜ける前の線を描けません');
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, sessionId);
  if (await cdp.evaluate("document.body.classList.contains('recording')")) throw new Error('Escで録画モードを解除できません');
  checks.push('Escによる録画モード解除');
  await until(() => cdp.evaluate('!document.fullscreenElement'), 'Escで全画面を解除できません');
  await until(async () => await strokeCount() === 0 && !await cdp.evaluate("document.body.classList.contains('pointer-pen')"), '全画面を抜けても線・ペンが残っています（収録に映ります）');
  checks.push('全画面を抜けると線とペンを消去');
  await cdp.evaluate("document.getElementById('fullscreen').click()", true);
  await until(() => cdp.evaluate('!!document.fullscreenElement'), '全画面に戻せません');
  await moveMouse(900, 600); await moveMouse(960, 640);
  await clickBar('exit');
  await until(() => cdp.evaluate("!document.fullscreenElement && !document.body.classList.contains('recording')"), '操作バーから全画面を終了できません');
  checks.push('操作バーから全画面を終了');
  const exceptions = cdp.events.filter(event => event.method === 'Runtime.exceptionThrown');
  if (exceptions.length) throw new Error(`ブラウザ内の例外が${exceptions.length}件あります`);
  report.passed = true;
} catch (error) { report.error = error.message; report.events = cdp?.events.slice(-10); report.diagnostics = session?.diagnostics ?? error.diagnostics; console.error(error.message); process.exitCode = 1; }
finally {
  if (session) { await session.close(); if (session.cleanupNote) report.cleanupNote = session.cleanupNote; }
  if (server) await new Promise(resolve => server.close(resolve));
  await ensureLectureReports(name); await writeJson(join(reportDir, 'browser-qa.json'), report);
  console.log(`Browser QA ${report.passed ? 'PASS' : 'FAIL'} / ${checks.length}項目 / reports/${name}/browser-qa.json`);
}
