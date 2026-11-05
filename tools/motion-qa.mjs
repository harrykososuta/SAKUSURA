// 動きの種類・音声なしの確認・巻き戻し・動画を書き出しまで、隔離した講義で検査する。
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, rm, rename } from 'node:fs/promises';
import { join, resolve, sep, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createStudioServer } from './server.mjs';
import { ROOT, reportRoot } from './lib/project.mjs';
import { launchBrowser, until, sleep } from './lib/browser.mjs';
import { renderLecture, nextExportPath } from './render.mjs';
import { validateLecture } from '../src/core.js';

const name = `zz-motion-qa-${randomUUID().slice(0, 8)}`, root = join(ROOT, 'lectures', name), reports = join(ROOT, 'reports/motion');
const report = { passed: false, checks: [], screenshots: [], export: null };
let session, server;
try {
  await mkdir(root); await mkdir(reports, { recursive: true });
  const baseSlide = { title: '項目を順番に説明する', narration: '', plannedSeconds: 3.2, gapAfter: .15, blocks: [{ id: 'a', label: '準備', text: '条件を確認する' }, { id: 'b', label: '処理', text: '順番に組み立てる' }, { id: 'c', label: '確認', text: '結果を確かめる' }], cues: [{ target: 'a', at: 0 }, { target: 'b', at: .8 }, { target: 'c', at: 1.8 }] };
  const slides = [
    { layout: 'statement', animation: { type: 'subtle' }, title: '短い動きで要点を置く' },
    { layout: 'flow', animation: { type: 'flow', targets: ['a', 'b', 'c'], verdicts: [{ target: 'c', result: 'pass' }], links: [{ target: 'b', style: 'dashed', result: 'fail' }] }, title: '線が届いてから、次の箱を出す' },
    { layout: 'steps', animation: { type: 'preview' }, title: '全体を予告し、順番に埋める' },
    { layout: 'statement', animation: { type: 'focus' }, title: '今説明している項目に注目する' },
    { layout: 'bars', max: 150, animation: { type: 'limit', limit: 100, blockedTargets: ['c'] }, title: '上限で止まり、後の処理を薄くする' },
    { layout: 'statement', animation: { type: 'none' }, title: '動きなしでも、表示順は保つ' },
  ].map((options, i) => ({ ...structuredClone(baseSlide), ...options, id: String(i + 1).padStart(3, '0') }));
  slides[0].cues[1].at = 0;
  slides[4].blocks.forEach((block, i) => { block.value = [60, 120, 40][i]; block.unit = '%'; });
  const lecture = { version: 1, title: '動きの検証用サンプル', category: 'va', number: '00', rules: 'free', demo: true, targetSeconds: 20, slides };
  assert.deepEqual(validateLecture(lecture), []);
  await writeFile(join(root, 'lecture.json'), JSON.stringify(lecture, null, 2) + '\n');
  server = await createStudioServer({ port: 0 }); const base = `http://127.0.0.1:${server.address().port}`;
  session = await launchBrowser(); const cdp = session.cdp, send = (method, params) => cdp.send(method, params, session.sessionId);
  const open = async (path, ready) => { await send('Page.navigate', { url: base + path }); await until(() => cdp.evaluate(ready), '画面を読み込めません'); await cdp.evaluate('document.fonts.ready'); await sleep(100); };
  const shot = async file => { const png = await send('Page.captureScreenshot', { format: 'png' }); await writeFile(join(reports, file), Buffer.from(png.data, 'base64')); report.screenshots.push(`reports/motion/${file}`); };
  await open(`/editor?lecture=${name}`, '!!window.slideEditor?.lecture');
  await cdp.evaluate(`document.querySelector('.animation-settings').open=true;var s=document.getElementById('animation-type');s.value='focus';s.dispatchEvent(new Event('change'))`);
  assert.equal(await cdp.evaluate('slideEditor.lecture.slides[0].animation.type'), 'focus');
  assert.equal(await cdp.evaluate('document.getElementById("animation-limit-field").checkVisibility()'), false);
  await cdp.evaluate('document.getElementById("animation-preview").click()');
  await until(() => cdp.evaluate('Number(document.getElementById("audio-seek").value)>.15'), '無音で動きを確認できません');
  await cdp.evaluate('document.getElementById("animation-preview").click()');
  const stopped = await cdp.evaluate('document.getElementById("audio-seek").value'); await sleep(160);
  assert.equal(await cdp.evaluate('document.getElementById("audio-seek").value'), stopped);
  await cdp.evaluate(`slideEditor.select('block:b');var v=document.getElementById('animation-verdict');v.value='pass';v.dispatchEvent(new Event('change'))`);
  assert.deepEqual(await cdp.evaluate('slideEditor.lecture.slides[0].animation.verdicts'), [{ target: 'b', result: 'pass' }]);
  assert.equal(await cdp.evaluate('slideEditor.save()'), true);
  await cdp.evaluate("document.querySelector('.animation-settings').scrollIntoView({block:'center'})");
  await shot('editor-animation.png');
  report.checks.push('編集画面で動きと判定を設定・API不要の無音確認と停止・保存');
  await open(`/?lecture=${name}&record=1`, '!!window.slideStudio?.player');
  await cdp.evaluate('slideStudio.player.preview=true;slideStudio.player.load(0)');
  const seek = async (i, t) => { await cdp.evaluate(`slideStudio.player.load(${i});slideStudio.player.seek(${t})`); await cdp.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'); };
  await seek(0, .04);
  assert.ok(await cdp.evaluate(`Number(document.querySelector('[data-block="b"]').style.opacity)<1`));
  await seek(1, .9);
  assert.equal(await cdp.evaluate(`document.querySelector('[data-block="b"] > .block-body').style.opacity`), '0');
  assert.equal(await cdp.evaluate(`document.querySelector('.flow-link-line').getAttribute('stroke-dasharray')`), '7 7');
  assert.ok(await cdp.evaluate(`Number(document.querySelector('.flow-link-tip').getAttribute('opacity'))>0`));
  await shot('flow-arrow-first.png');
  await seek(1, 1.5); await shot('flow-blocked.png');
  assert.equal(await cdp.evaluate(`document.querySelector('[data-block="b"] > .block-body').style.opacity`), '1');
  assert.equal(await cdp.evaluate(`document.querySelector('.flow-link-verdict').getAttribute('opacity')`), '1');
  await seek(1, 2.7); assert.equal(await cdp.evaluate(`document.querySelector('.motion-verdict').style.opacity`), '1');
  report.checks.push('矢印の描画→カード出現→判定の順序・点線と遮断・成立マーク');
  await seek(2, .4);
  assert.equal(await cdp.evaluate(`document.querySelector('[data-block="b"] .motion-placeholder').style.opacity`), '1');
  assert.equal(await cdp.evaluate(`document.querySelector('[data-block="b"] > .block-body').style.opacity`), '0');
  await shot('preview-build-up.png');
  await seek(3, 1.3);
  assert.equal(await cdp.evaluate(`Number(document.querySelector('[data-block="a"]').style.opacity).toFixed(2)`), '.35'.replace(/^\./, '0.'));
  assert.equal(await cdp.evaluate(`document.querySelector('[data-block="b"]').style.opacity`), '1');
  await shot('focus.png');
  report.checks.push('点線の全体予告と段階出現・説明中以外の不透明度35％');
  await seek(4, 2.5);
  assert.equal(await cdp.evaluate(`document.querySelector('[data-block="b"] .bar-number').textContent`), '100');
  assert.equal(await cdp.evaluate('slideStudio.player.slide.blocks[1].value'), 120);
  assert.equal(await cdp.evaluate(`document.querySelector('[data-block="b"] .motion-limit-hit').style.opacity`), '1');
  assert.equal(await cdp.evaluate(`Number(document.querySelector('[data-block="c"]').style.opacity).toFixed(2)`), '0.35');
  await shot('limit-stop.png'); report.checks.push('指定上限でバーが停止・要求値を併記・×表示・指定した後続項目だけ薄くする');
  await cdp.evaluate("window.savedAnimation=slideStudio.player.slide.animation;slideStudio.player.slide.animation={type:'focus'}");
  await seek(3, 0); await seek(4, .1);
  assert.equal(await cdp.evaluate(`document.querySelector('[data-block="c"] .bar-number').textContent`), '40');
  await cdp.evaluate('slideStudio.player.slide.animation=window.savedAnimation;delete window.savedAnimation');
  // 同じ時刻に戻ると、途中の描画・数値・不透明度まで完全に復元する。
  await seek(1, .93); const before = await cdp.evaluate('document.getElementById("slide-content").outerHTML');
  await seek(1, 2.6); await cdp.evaluate('slideStudio.player.seek(.93)');
  assert.equal(await cdp.evaluate('document.getElementById("slide-content").outerHTML'), before);
  await cdp.evaluate('slideStudio.frames=true;slideStudio.player.seek(.93)');
  assert.equal(await cdp.evaluate('document.getElementById("slide-content").outerHTML'), before);
  await cdp.evaluate('slideStudio.player.step(1)');
  const began = await cdp.evaluate('slideStudio.player.time'); await sleep(700);
  assert.ok(await cdp.evaluate('slideStudio.player.time') >= began);
  await cdp.evaluate('slideStudio.player.pause()');
  await seek(5, 1); assert.equal(await cdp.evaluate(`document.querySelector('[data-block="b"]').style.transform`), 'none');
  report.checks.push('巻き戻し・再シークで同じ描画に戻る・動画フレームと通常描画の一致・音声なしの手動送り');
  const exceptions = cdp.events.filter(e => e.method === 'Runtime.exceptionThrown'); assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
  await session.close(); session = null; await new Promise(resolve => server.close(resolve)); server = null;
  if (process.argv.includes('--render')) {
    const result = await renderLecture(name, { silent: true, tail: .5, log: line => console.log(line) });
    const output = await nextExportPath('animation-patterns-preview'); await rename(result.output, output); report.export = relative(ROOT, output);
    report.checks.push('6パターンを1920×1080・30fpsの無音MP4に書き出し');
  }
  report.passed = true;
} catch (error) { report.error = error.stack; console.error(error.stack); process.exitCode = 1; }
finally {
  if (session) await session.close(); if (server) await new Promise(resolve => server.close(resolve));
  assert.ok(resolve(root).startsWith(resolve(ROOT, 'lectures') + sep) && name.startsWith('zz-motion-qa-')); await rm(root, { recursive: true, force: true });
  const temporaryReport = resolve(reportRoot(name)); assert.ok(temporaryReport.startsWith(resolve(ROOT, 'reports') + sep) && name.startsWith('zz-motion-qa-')); await rm(temporaryReport, { recursive: true, force: true });
  await writeFile(join(reports, 'motion-qa.json'), JSON.stringify(report, null, 2)); console.log(`Motion QA ${report.passed ? 'PASS' : 'FAIL'} / ${report.checks.length}項目 / reports/motion/motion-qa.json`);
}
