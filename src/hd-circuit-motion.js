// 血液透析の回路図（教育用の固定の模式図）。実際の回路構成は施設・装置で異なる。
// 動きはすべて再生位置 time から計算し、停止・巻き戻し・動画の書き出しで同じ絵になる。
const NS = 'http://www.w3.org/2000/svg';
const MODEL = 'hd-circuit-v1';
const WIDTH = 1840, HEIGHT = 690;
// 各段階の動きの長さ（秒）：脱血・透析液・拡散・除水・返血（満ちるのは前半5秒、そのあと気泡を検知して止まる場面）。
export const HD_SECONDS = [6, 5.5, 2, 3, 12];
// 返血のcueからの秒数：気泡が流れ始める・検知器に届く（ここから血流が止まる）・再開する。
const ALARM = { bubble: 7, stop: 8.8, resume: 12 };
// 部品に液が届いたときの波紋：[段階, その段階の進み具合, x, y, 半径]。
const RIPPLES = [
  [0, .1, 230, 150, 30], [0, .2, 400, 150, 92], [0, .33, 560, 204, 30], [0, .46, 720, 163, 66], [0, .76, 930, 120, 66],
  [1, .12, 1662, 325, 30], [1, .32, 1290, 325, 38], [1, .56, 998, 490, 28], [1, .68, 998, 170, 28], [1, .76, 1240, 170, 38], [1, .86, 1502, 170, 62], [1, .98, 1770, 170, 50],
  [2, 0, 930, 400, 40], [3, .05, 1500, 95, 34],
  [4, .17, 720, 457, 66], [4, .2, 618, 424, 26], [4, .3, 593, 560, 38], [4, .36, 450, 560, 36], [4, .42, 300, 600, 26],
];
const RIPPLE_COLOR = ['#c9303a', '#0f9c8c', '#1f2b33', '#2c9fd9', '#2f5fb3'];
const easeOut = p => 1 - (1 - p) ** 3;
const clamp = n => Math.max(0, Math.min(1, n));
const COLOR = {
  ink: '#1f2b33', sub: '#4f5f68', line: '#c8d6dc', empty: '#e4eaed', steel: '#64747e',
  a: '#c9303a', aTint: '#f6d2d1', v: '#2f5fb3', vTint: '#d3def3',
  fresh: '#0f9c8c', freshTint: '#c9eee8', used: '#c1861a', usedTint: '#f5e3bb',
  water: '#2c9fd9', heparin: '#8a6fc0', ok: '#2fa36b',
};
let uid = 0;

const el = (tag, attrs = {}, ...children) => {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  node.append(...children);
  return node;
};
const label = (x, y, value, { size = 22, weight = 500, anchor = 'start', fill = COLOR.ink } = {}) =>
  el('text', { x, y, 'font-size': size, 'font-weight': weight, 'text-anchor': anchor, fill }, value);
// 段階 stage に入るまで薄く表示する部品。
const part = (stage, ...children) => el('g', { 'data-hd-part': stage }, ...children);

// 管は「空の管 → 液が満ちる → 粒が流れる」の3層。from・to は段階の進み具合のうち、この管が満ちる範囲。
function tube(id, d, { stage, from = 0, to = 1, flow = 'blood', tint, color, width = 18 }) {
  const mask = `hd-${id}-mask`;
  const maskPath = el('path', { d, fill: 'none', stroke: '#fff', 'stroke-width': width + 8, pathLength: 1, 'stroke-dasharray': 1, 'stroke-dashoffset': 1, 'data-hd-mask': '' });
  const dots = (dash, dotWidth, opacity, shift) => el('path', { d, fill: 'none', stroke: color, 'stroke-width': dotWidth, 'stroke-linecap': 'round', 'stroke-dasharray': dash, opacity, 'data-hd-dots': shift });
  return el('g', { 'data-hd-tube': '', 'data-stage': stage, 'data-from': from, 'data-to': to, 'data-flow': flow },
    el('mask', { id: mask, maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: WIDTH, height: HEIGHT }, maskPath),
    el('path', { d, fill: 'none', stroke: COLOR.empty, 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
    el('path', { d, fill: 'none', stroke: tint, 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', pathLength: 1, 'stroke-dasharray': 1, 'stroke-dashoffset': 1, 'data-hd-fill': '' }),
    el('g', { mask: `url(#${mask})`, 'data-hd-flowing': '', opacity: 0 }, dots(`1 ${Math.round(width * 1.55)}`, width * .55, 1, 0), dots(`1 ${Math.round(width * 2.3)}`, width * .32, .6, 11)),
    // 液の先頭の光る点。満ちている間だけ出す。
    el('circle', { r: width * .72, fill: color, stroke: '#fff', 'stroke-width': 3, opacity: 0, 'data-hd-head': '' }));
}

// 矢印（流れの向きを静止画でも読めるようにする）。
const arrow = (x, y, angle, color, stage) => el('path', { d: 'M-10 -9 L6 0 L-10 9 Z', fill: color, transform: `translate(${x} ${y}) rotate(${angle})`, 'data-hd-part': stage });

function dripChamber(x, top, height, tint, color, stage, key) {
  const level = top + 34;
  const drops = [0, 1].map(i => el('circle', { cx: x, r: 5, fill: color, 'data-hd-drop': key, 'data-i': i, 'data-top': top + 4, 'data-level': level, opacity: 0 }));
  const bubbles = key === 'v' ? [0, 1, 2].map(i => el('circle', { cx: x - 12 + i * 12, r: 4, fill: '#fff', stroke: color, 'stroke-width': 1.5, 'data-hd-bubble': '', 'data-i': i, 'data-bottom': top + height - 10, 'data-level': level, opacity: 0 })) : [];
  return part(stage,
    el('rect', { x: x - 34, y: top, width: 68, height, rx: 16, fill: '#fff', stroke: COLOR.steel, 'stroke-width': 3 }),
    el('rect', { x: x - 31, y: level, width: 62, height: height - 37, rx: 13, fill: tint, 'data-hd-liquid': key, opacity: 0 }),
    ...drops, ...bubbles);
}

function bloodCircuit() {
  const a1 = 'M110 600 V172 Q110 150 132 150 H322 A78 78 0 0 1 478 150 H640 Q660 150 660 130 V95 Q660 75 680 75 H700 Q720 75 720 95 V108';
  const a2 = 'M720 218 V235 Q720 255 740 255 H795 Q815 255 815 235 V80 Q815 60 835 60 H910 Q930 60 930 80 V102';
  const v1 = 'M930 558 V625 Q930 645 910 645 H835 Q815 645 815 625 V385 Q815 365 795 365 H740 Q720 365 720 385 V402';
  const v2 = 'M720 512 V540 Q720 560 700 560 H320 Q300 560 300 580 V600';
  const blood = { flow: 'blood' };
  return [
    tube('a1', a1, { ...blood, stage: 0, from: 0, to: .5, tint: COLOR.aTint, color: COLOR.a }),
    tube('a2', a2, { ...blood, stage: 0, from: .5, to: .78, tint: COLOR.aTint, color: COLOR.a }),
    tube('v1', v1, { ...blood, stage: 4, from: 0, to: .17, tint: COLOR.vTint, color: COLOR.v }),
    tube('v2', v2, { ...blood, stage: 4, from: .19, to: .42, tint: COLOR.vTint, color: COLOR.v }),
    arrow(230, 150, 0, COLOR.a, 0), arrow(590, 150, 0, COLOR.a, 0), arrow(875, 60, 0, COLOR.a, 0), arrow(110, 340, -90, COLOR.a, 0),
    arrow(815, 500, -90, COLOR.v, 4), arrow(640, 560, 180, COLOR.v, 4), arrow(375, 560, 180, COLOR.v, 4),
  ];
}

function arm() {
  return el('g', {},
    el('path', { d: 'M10 594 Q200 582 370 596 Q392 640 370 684 Q200 690 10 684 Z', fill: '#f5e0d0', stroke: '#d9b9a2', 'stroke-width': 2.5 }),
    tube('shunt', 'M26 632 H356', { stage: -1, flow: 'shunt', tint: COLOR.aTint, color: COLOR.a, width: 20 }),
    arrow(205, 632, 0, COLOR.a, -1),
    // 穿刺針。脱血は上流（吻合部に近い側）、返血は下流（心臓に近い側）。
    el('path', { d: 'M110 596 L110 630', stroke: COLOR.steel, 'stroke-width': 6, 'stroke-linecap': 'round' }),
    el('path', { d: 'M300 596 L300 630', stroke: COLOR.steel, 'stroke-width': 6, 'stroke-linecap': 'round' }),
    label(190, 674, '患者の腕（シャント血管）', { size: 21, anchor: 'middle', weight: 600, fill: '#6e5140' }),
    label(124, 540, '脱血（A側の針）', { size: 21, weight: 600, fill: COLOR.a }),
    part(4, label(288, 577, '返血（V側の針）', { size: 21, weight: 600, anchor: 'end', fill: COLOR.v })));
}

function pump() {
  const roller = angle => el('circle', { cx: 56 * Math.cos(angle), cy: 56 * Math.sin(angle), r: 15, fill: '#fff', stroke: COLOR.ink, 'stroke-width': 4 });
  return part(0,
    el('circle', { cx: 400, cy: 150, r: 92, fill: 'none', stroke: COLOR.line, 'stroke-width': 3, 'stroke-dasharray': '6 8' }),
    el('g', { 'data-hd-rotor': '', transform: 'translate(400 150)' },
      el('circle', { r: 66, fill: '#f3f7f8', stroke: COLOR.steel, 'stroke-width': 3 }),
      el('path', { d: 'M-56 0 H56', stroke: COLOR.ink, 'stroke-width': 10, 'stroke-linecap': 'round' }),
      roller(0), roller(Math.PI),
      el('circle', { r: 12, fill: COLOR.ink })),
    label(400, 272, '血液ポンプ', { size: 25, weight: 700, anchor: 'middle' }));
}

const CLAMP_OPEN = 'M418 536 L450 546 L482 536 M418 584 L450 574 L482 584', CLAMP_SHUT = 'M418 545 L450 557 L482 545 M418 575 L450 563 L482 575';
function monitors() {
  return [
    part(0,
      el('ellipse', { cx: 230, cy: 150, rx: 25, ry: 17, fill: COLOR.aTint, stroke: COLOR.a, 'stroke-width': 3 }),
      label(230, 106, 'ピロー', { size: 22, weight: 700, anchor: 'middle' }),
      label(230, 80, '脱血不良を確認', { size: 20, anchor: 'middle', fill: COLOR.sub })),
    // 抗凝固薬のシリンジポンプ。プランジャーが時間とともにゆっくり押し込まれる。
    part(0,
      tube('heparin', 'M560 204 V158', { stage: 0, from: .25, to: .4, flow: 'slow', tint: '#e2d9f3', color: COLOR.heparin, width: 9 }),
      el('rect', { x: 540, y: 204, width: 40, height: 122, rx: 7, fill: '#fff', stroke: COLOR.steel, 'stroke-width': 3 }),
      el('rect', { x: 543, y: 208, width: 34, height: 86, rx: 3, fill: '#e2d9f3', 'data-hd-syringe': '' }),
      el('g', { 'data-hd-plunger': '' },
        el('rect', { x: 543, y: 294, width: 34, height: 9, fill: COLOR.steel }),
        el('rect', { x: 556, y: 303, width: 8, height: 54, fill: COLOR.steel }),
        el('rect', { x: 544, y: 355, width: 32, height: 7, rx: 2, fill: COLOR.steel })),
      label(526, 310, '抗凝固薬', { size: 24, weight: 700, anchor: 'end' }),
      label(526, 338, 'シリンジポンプ', { size: 20, anchor: 'end', fill: COLOR.sub })),
    dripChamber(720, 108, 110, COLOR.aTint, COLOR.a, 0, 'a'),
    part(0, label(720, 293, '動脈側チャンバ', { size: 22, weight: 700, anchor: 'middle' })),
    dripChamber(720, 402, 110, COLOR.vTint, COLOR.v, 4, 'v'),
    part(4,
      label(676, 472, '静脈側チャンバ', { size: 22, weight: 700, anchor: 'end' }),
      el('path', { d: 'M686 424 H640', stroke: COLOR.steel, 'stroke-width': 4 }),
      el('circle', { cx: 618, cy: 424, r: 22, fill: '#fff', stroke: COLOR.steel, 'stroke-width': 3 }),
      el('path', { d: 'M618 424 L618 407', stroke: COLOR.ink, 'stroke-width': 4, 'stroke-linecap': 'round', 'data-hd-gauge': '', 'data-cx': 618, 'data-cy': 424 }),
      label(588, 432, '静脈圧', { size: 22, weight: 700, anchor: 'end' }),
      // 気泡検知器：管をはさむセンサーとランプ。
      el('rect', { x: 560, y: 532, width: 66, height: 56, rx: 9, fill: '#ffffffd9', stroke: COLOR.ink, 'stroke-width': 3 }),
      el('circle', { cx: 593, cy: 523, r: 8, fill: COLOR.ok, 'data-hd-alarm-led': '' }),
      label(593, 618, '気泡検知器', { size: 22, weight: 700, anchor: 'middle' }),
      // 静脈クランプ：平常時は開いていて、気泡検知などの異常で閉じる。
      el('path', { d: CLAMP_OPEN, 'data-hd-clamp': '', fill: 'none', stroke: COLOR.ink, 'stroke-width': 5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
      label(450, 618, '静脈クランプ', { size: 22, weight: 700, anchor: 'middle' })),
    el('circle', { r: 10, fill: '#fff', stroke: COLOR.v, 'stroke-width': 3, cy: 560, opacity: 0, 'data-hd-alarm-bubble': '' }),
    el('text', { x: 600, y: 654, 'font-size': 22, 'font-weight': 800, 'text-anchor': 'middle', fill: COLOR.a, opacity: 0, 'data-hd-alarm-text': '' }, '気泡を検知 → クランプ閉・ポンプ停止'),
  ];
}

function dialyzer() {
  const fibers = [888, 902, 916, 930, 944, 958, 972];
  const gaps = [895, 923, 951, 965];
  const defs = el('defs', {},
    el('linearGradient', { id: 'hd-fiber', gradientUnits: 'userSpaceOnUse', x1: 0, y1: 140, x2: 0, y2: 520 },
      el('stop', { offset: 0, 'stop-color': COLOR.a }), el('stop', { offset: 1, 'stop-color': COLOR.v })),
    el('linearGradient', { id: 'hd-fiber-tint', gradientUnits: 'userSpaceOnUse', x1: 0, y1: 140, x2: 0, y2: 520 },
      el('stop', { offset: 0, 'stop-color': COLOR.aTint }), el('stop', { offset: 1, 'stop-color': COLOR.vTint })),
    el('linearGradient', { id: 'hd-shell', gradientUnits: 'userSpaceOnUse', x1: 0, y1: 140, x2: 0, y2: 520 },
      el('stop', { offset: 0, 'stop-color': COLOR.usedTint }), el('stop', { offset: 1, 'stop-color': COLOR.freshTint })));
  return el('g', {}, defs,
    el('rect', { x: 870, y: 140, width: 120, height: 380, fill: '#f7fafb', stroke: COLOR.steel, 'stroke-width': 3.5 }),
    el('rect', { x: 872, y: 142, width: 116, height: 376, fill: 'url(#hd-shell)', 'data-hd-shell': '', opacity: 0 }),
    // 透析液は中空糸の外側を、血液と逆向き（下から上）に流れる。
    el('g', { 'data-hd-shell': '', opacity: 0 }, ...gaps.map(x => el('path', { d: `M${x} 516 V144`, fill: 'none', stroke: COLOR.fresh, 'stroke-width': 5, 'stroke-linecap': 'round', 'stroke-dasharray': '1 30', opacity: .85, 'data-hd-shell-dots': '' }))),
    ...fibers.map(x => el('path', { d: `M${x} 140 V520`, fill: 'none', stroke: 'url(#hd-fiber-tint)', 'stroke-width': 7, 'data-hd-fiber-base': '' })),
    el('g', { 'data-hd-fibers': '', opacity: 0 }, ...fibers.map((x, i) => el('path', { d: `M${x} 140 V520`, fill: 'none', stroke: 'url(#hd-fiber)', 'stroke-width': 5, 'stroke-linecap': 'round', 'stroke-dasharray': '1 24', 'data-hd-fiber-dots': i }))),
    el('path', { d: 'M870 140 Q870 100 930 100 Q990 100 990 140 Z', fill: COLOR.aTint, stroke: COLOR.steel, 'stroke-width': 3.5, 'data-hd-header': 'a' }),
    el('path', { d: 'M870 520 Q870 560 930 560 Q990 560 990 520 Z', fill: COLOR.empty, stroke: COLOR.steel, 'stroke-width': 3.5, 'data-hd-header': 'v' }),
    el('rect', { x: 990, y: 158, width: 16, height: 24, fill: COLOR.steel }),
    el('rect', { x: 990, y: 478, width: 16, height: 24, fill: COLOR.steel }),
    label(944, 672, 'ダイアライザ', { size: 25, weight: 800 }));
}

function console_() {
  const box = (x, y, w, h, text) => el('g', {},
    el('rect', { x, y, width: w, height: h, rx: 9, fill: '#fff', stroke: COLOR.steel, 'stroke-width': 2.5 }),
    label(x + w / 2, y + h / 2 + 8, text, { size: 21, weight: 700, anchor: 'middle' }));
  const dial = { flow: 'dialysate' };
  return el('g', {},
    el('rect', { x: 1120, y: 14, width: 708, height: 408, rx: 18, fill: '#eef4f6', stroke: COLOR.line, 'stroke-width': 2.5 }),
    label(1142, 56, '透析装置', { size: 27, weight: 800 }),
    // 新しい透析液：RO水・A原液・B原液を混ぜ、等量制御を通ってダイアライザの下の口へ。
    tube('ro', 'M1704 268 H1682 Q1662 268 1662 288 V325', { ...dial, stage: 1, from: 0, to: .14, tint: COLOR.freshTint, color: COLOR.fresh, width: 12 }),
    tube('aconc', 'M1704 325 H1662', { ...dial, stage: 1, from: 0, to: .14, tint: COLOR.freshTint, color: COLOR.fresh, width: 12 }),
    tube('bconc', 'M1704 382 H1682 Q1662 382 1662 362 V325', { ...dial, stage: 1, from: 0, to: .14, tint: COLOR.freshTint, color: COLOR.fresh, width: 12 }),
    tube('fresh', 'M1662 325 H1080 Q1060 325 1060 345 V470 Q1060 490 1040 490 H1004', { ...dial, stage: 1, from: .14, to: .56, tint: COLOR.freshTint, color: COLOR.fresh }),
    // 使用済み透析液：ダイアライザの上の口から、漏血検知器と等量制御を通って排液へ。
    tube('used', 'M1004 170 H1730', { ...dial, stage: 1, from: .68, to: 1, tint: COLOR.usedTint, color: COLOR.used }),
    // 除水ポンプの経路：等量制御を迂回して抜く。抜いた分だけ血液側から水が移る。
    tube('uf', 'M1346 170 V115 Q1346 95 1366 95 H1640 Q1660 95 1660 115 V170', { flow: 'dialysate', stage: 3, from: 0, to: .7, tint: '#cfe9f7', color: COLOR.water, width: 13 }),
    arrow(1060, 420, 90, COLOR.fresh, 1), arrow(1200, 325, 180, COLOR.fresh, 1), arrow(1060, 170, 0, COLOR.used, 1), arrow(1400, 170, 0, COLOR.used, 1), arrow(1690, 170, 0, COLOR.used, 1), arrow(1590, 95, 0, COLOR.water, 3),
    part(1, label(1034, 150, '出口', { size: 20, weight: 600, fill: COLOR.used }), label(1008, 466, '入口', { size: 20, weight: 600, fill: COLOR.fresh })),
    part(1, box(1704, 246, 106, 44, 'RO水'), box(1704, 303, 106, 44, 'A原液'), box(1704, 360, 106, 44, 'B原液'),
      label(1625, 372, '混合', { size: 20, weight: 700, anchor: 'end', fill: COLOR.sub }),
      el('rect', { x: 1262, y: 303, width: 56, height: 44, rx: 8, fill: '#ffffffe0', stroke: COLOR.ink, 'stroke-width': 2.5 }),
      el('circle', { cx: 1290, cy: 325, r: 7, fill: COLOR.ok, 'data-hd-led': '' }),
      label(1290, 288, '濃度・温度の監視', { size: 21, weight: 700, anchor: 'middle' }),
      // 漏血検知器
      el('rect', { x: 1212, y: 148, width: 56, height: 44, rx: 8, fill: '#ffffffe0', stroke: COLOR.ink, 'stroke-width': 2.5 }),
      el('circle', { cx: 1240, cy: 170, r: 7, fill: COLOR.ok, 'data-hd-led': '' }),
      label(1240, 224, '漏血検知器', { size: 21, weight: 700, anchor: 'middle' }),
      // 等量制御：給液と排液を同じ量に保つ（複式ポンプなど）。
      el('rect', { x: 1442, y: 134, width: 120, height: 228, rx: 12, fill: '#ffffffa6', stroke: COLOR.ink, 'stroke-width': 3 }),
      el('path', { d: 'M1502 138 V205 M1502 292 V358', stroke: COLOR.steel, 'stroke-width': 8, 'data-hd-piston': '' }),
      label(1502, 240, '等量制御', { size: 21, weight: 800, anchor: 'middle' }),
      label(1502, 266, '複式ポンプ等', { size: 19, anchor: 'middle', fill: COLOR.sub }),
      // 排液
      el('rect', { x: 1730, y: 142, width: 80, height: 56, rx: 9, fill: '#fff', stroke: COLOR.steel, 'stroke-width': 2.5 }),
      label(1770, 179, '排液', { size: 22, weight: 800, anchor: 'middle', fill: COLOR.used })),
    part(3,
      el('g', { 'data-hd-uf-rotor': '', transform: 'translate(1500 95)' },
        el('circle', { r: 30, fill: '#fff', stroke: COLOR.water, 'stroke-width': 4 }),
        el('path', { d: 'M-18 0 H18 M0 -18 V18', stroke: COLOR.water, 'stroke-width': 7, 'stroke-linecap': 'round' })),
      label(1548, 66, '除水ポンプ', { size: 24, weight: 800 })));
}

function inset() {
  const left = 1140, right = 1810;
  const clip = 'hd-inset-clip';
  const rbc = Array.from({ length: 5 }, (_, i) => el('ellipse', { rx: 25, ry: 12, fill: COLOR.a, opacity: .85, 'data-hd-rbc': i, cy: 500 + (i % 3) * 19 }));
  const pool = (kind, count, r, color) => Array.from({ length: count }, (_, i) => el('circle', { r, fill: color, opacity: 0, 'data-hd-mol': kind, 'data-i': i, 'data-n': count }));
  const legend = (x, color, text, disc) => el('g', {},
    disc ? el('ellipse', { cx: x, cy: 456, rx: 15, ry: 8, fill: COLOR.a, opacity: .85 }) : el('circle', { cx: x, cy: 456, r: 7, fill: color }),
    label(x + (disc ? 22 : 14), 463, text, { size: 20, weight: 600, fill: COLOR.sub }));
  return el('g', {},
    el('path', { d: 'M955 372 L1120 436 M955 428 L1120 684', stroke: COLOR.steel, 'stroke-width': 2, 'stroke-dasharray': '7 7', fill: 'none', 'data-hd-zoom-guide': '' }),
    el('circle', { cx: 930, cy: 400, r: 38, fill: 'none', stroke: COLOR.ink, 'stroke-width': 3, 'stroke-dasharray': '7 6', 'data-hd-zoom-guide': '' }),
    el('g', { 'data-hd-zoom': '' },
    el('rect', { x: 1120, y: 436, width: 708, height: 250, rx: 18, fill: '#fff', stroke: COLOR.line, 'stroke-width': 2.5 }),
    label(left, 466, 'ダイアライザの中（拡大）', { size: 24, weight: 800 }),
    legend(1454, COLOR.a, '尿素・K'), legend(1568, COLOR.fresh, '重炭酸'), legend(1668, COLOR.water, '水'), legend(1728, COLOR.a, '血球', true),
    el('defs', {}, el('clipPath', { id: clip }, el('rect', { x: left, y: 480, width: right - left, height: 192, rx: 10 }))),
    el('g', { 'clip-path': `url(#${clip})` },
      el('rect', { x: left, y: 480, width: right - left, height: 86, fill: '#fbe9e8' }),
      el('rect', { x: left, y: 576, width: right - left, height: 96, fill: '#e4f6f3' }),
      el('g', { 'data-hd-inset': '', opacity: 0 }, ...rbc, ...pool('urea', 16, 6, '#a3222c'), ...pool('bicarb', 8, 6, COLOR.fresh), ...pool('water', 12, 5, COLOR.water)),
      // 半透膜：小さな孔だけが通り道。血球は通れない。
      el('path', { d: `M${left} 571 H${right}`, stroke: COLOR.steel, 'stroke-width': 10, 'stroke-dasharray': '28 10', fill: 'none' })),
    label(left + 14, 529, '血液 →', { size: 24, weight: 800, fill: COLOR.a }),
    label(left + 14, 625, '← 透析液', { size: 24, weight: 800, fill: '#0a7d70' }),
    label(left + 14, 660, '半透膜の孔を通る', { size: 20, fill: COLOR.sub }),
    el('text', { x: right - 14, y: 660, 'font-size': 20, 'font-weight': 700, 'text-anchor': 'end', fill: COLOR.sub, 'data-hd-inset-caption': '' }, '')));
}

function legendBox() {
  const row = (y, color, tint, text) => el('g', {},
    el('path', { d: `M186 ${y} H236`, stroke: tint, 'stroke-width': 14, 'stroke-linecap': 'round' }),
    el('path', { d: `M186 ${y} H236`, stroke: color, 'stroke-width': 7, 'stroke-linecap': 'round', 'stroke-dasharray': '1 13' }),
    label(252, y + 8, text, { size: 21, weight: 600, fill: COLOR.sub }));
  return el('g', {},
    row(370, COLOR.a, COLOR.aTint, '動脈側の血液'), row(402, COLOR.v, COLOR.vTint, '静脈側の血液'),
    row(434, COLOR.fresh, COLOR.freshTint, '新しい透析液'), row(466, COLOR.used, COLOR.usedTint, '使用済み透析液'),
    label(150, 508, '※模式図。構成は施設・装置により異なります', { size: 19, fill: COLOR.sub }));
}

export const hasHdCircuit = slide => !!slide.hdCircuit;
const cueAt = (slide, id) => slide.cues?.find(cue => cue.target === id)?.at;

export function validateHdCircuit(slide) {
  const config = slide.hdCircuit;
  if (config === undefined) return [];
  const fail = [`hdCircuit は statement に model "${MODEL}" と、説明順の本文ID 5つ（targets）を指定します`];
  if (!config || slide.layout !== 'statement' || config.model !== MODEL || Object.keys(config).some(key => !['model', 'targets'].includes(key))
    || !Array.isArray(config.targets) || config.targets.length !== 5 || new Set(config.targets).size !== 5 || slide.image) return fail;
  let previous = -1;
  for (const [i, id] of config.targets.entries()) {
    const at = cueAt(slide, id);
    if (!slide.blocks?.some(block => block.id === id) || !Number.isFinite(at) || at < previous || at + HD_SECONDS[i] > slide.plannedSeconds - .2) return fail;
    previous = at + HD_SECONDS[i];
  }
  return [];
}

export function hdCircuitPlan(slide, duration) {
  if (!hasHdCircuit(slide) || slide.animation?.type === 'none') return [];
  const end = Math.max(0, duration - .2);
  // 流れは全体で続く。cue: -1 は「手動送りの到達点」を流れの終わりまで延ばさないため。
  return [{ kind: 'hd-flow', target: 'flow', cue: -1, start: 0, end, short: false },
    ...slide.hdCircuit.targets.map((target, i) => { const cue = cueAt(slide, target); return { kind: 'hd-stage', target, cue, start: cue, end: Math.min(cue + HD_SECONDS[i], end), short: cue + HD_SECONDS[i] > end }; })];
}

export function hdCircuitState(slide, time) {
  const still = slide.animation?.type === 'none';
  const progress = slide.hdCircuit.targets.map((target, i) => { const at = cueAt(slide, target); return still ? Number(time >= at) : clamp((time - at) / HD_SECONDS[i]); });
  let current = -1;
  for (const [i, target] of slide.hdCircuit.targets.entries()) if (time >= cueAt(slide, target)) current = i;
  return { progress, current, clock: still ? 0 : Math.max(0, time) };
}

// 気泡を検知している間は血流だけが止まる（透析液は流れ続ける）。止まった時間を血液の時計から引く。
export function hdBloodClock(slide, time) {
  const at = cueAt(slide, slide.hdCircuit.targets[4]);
  const from = at + ALARM.stop, to = at + ALARM.resume;
  return Math.max(0, time) - clamp((time - from) / (to - from)) * (to - from);
}

// 血液はローラーの通過に合わせてわずかに脈打つ（常に前へ進むよう振幅を抑える）。
export const hdFlowOffset = (type, clock) => {
  if (type === 'blood') return 120 * clock + 11 * Math.sin(2 * Math.PI * clock);
  if (type === 'dialysate') return 150 * clock;
  if (type === 'shunt') return 170 * clock;
  return 22 * clock; // 抗凝固薬はゆっくり
};

function molecule(kind, i, n, clock) {
  // 尿素・K・水は血液→透析液、重炭酸は透析液→血液。孔の位置を通るよう x をそろえる。
  const pore = 1173 + 38 * (6 + ((i * 7) % 12));
  const period = kind === 'water' ? 3.4 : 5;
  const u = (clock / period + i / n) % 1;
  const jitter = ((i * 13) % 5) * 7;
  const blood = 492 + jitter * 1.6, dial = 594 + jitter * 1.4;
  let x, y;
  if (kind === 'bicarb') {
    if (u < .42) { x = pore + 170 * (.42 - u) / .42; y = dial; }
    else if (u < .58) { x = pore; y = dial + (blood - dial) * (u - .42) / .16; }
    else { x = pore + 170 * (u - .58) / .42; y = blood; }
  } else if (u < .42) { x = pore - 170 * (.42 - u) / .42; y = blood; }
  else if (u < .58) { x = pore; y = blood + (dial - blood) * (u - .42) / .16; }
  else { x = pore - 170 * (u - .58) / .42; y = dial; }
  return { x, y, opacity: clamp(u / .08) * clamp((1 - u) / .08) };
}

// ambient：再生していない間も流れだけを続けるときの時計（秒）。idle は再生前で、全体を見せる。
function paint(root, slide, time, { ambient = null, idle = false } = {}) {
  const state = hdCircuitState(slide, time);
  const { progress, current } = state;
  const clock = ambient ?? state.clock;
  const bloodClock = ambient ?? (slide.animation?.type === 'none' ? 0 : hdBloodClock(slide, time));
  const offsetOf = type => hdFlowOffset(type, type === 'blood' ? bloodClock : clock);
  const returnAt = cueAt(slide, slide.hdCircuit.targets[4]);
  const stopped = ambient === null && slide.animation?.type !== 'none' && time >= returnAt + ALARM.stop && time < returnAt + ALARM.resume;
  root.closest('#slide-content')?.toggleAttribute('data-hd-idle', idle);
  for (const group of root.querySelectorAll('[data-hd-tube]')) {
    const stage = +group.dataset.stage;
    const p = stage < 0 ? 1 : progress[stage];
    const fill = clamp((p - +group.dataset.from) / Math.max(.001, +group.dataset.to - +group.dataset.from));
    group.querySelector('[data-hd-fill]').setAttribute('stroke-dashoffset', 1 - fill);
    group.querySelector('[data-hd-mask]').setAttribute('stroke-dashoffset', 1 - fill);
    const flowing = group.querySelector('[data-hd-flowing]');
    flowing.setAttribute('opacity', fill > 0 ? 1 : 0);
    if (fill >= 1) flowing.removeAttribute('mask'); else flowing.setAttribute('mask', `url(#${group.querySelector('mask').id})`);
    const head = group.querySelector('[data-hd-head]');
    if (fill > 0 && fill < 1) { const line = group.querySelector('[data-hd-fill]'), point = line.getPointAtLength(line.getTotalLength() * fill); head.setAttribute('cx', point.x); head.setAttribute('cy', point.y); head.setAttribute('opacity', 1); }
    else head.setAttribute('opacity', 0);
    const offset = offsetOf(group.dataset.flow);
    for (const dots of group.querySelectorAll('[data-hd-dots]')) dots.setAttribute('stroke-dashoffset', -(offset + +dots.dataset.hdDots));
  }
  // 段階に入るまでの部品は薄く表示し、全体の形だけ先に見せる。
  for (const item of root.querySelectorAll('[data-hd-part]')) { const stage = +item.dataset.hdPart; item.setAttribute('opacity', stage < 0 || current >= stage ? 1 : .32); }
  // 中空糸：動脈側の血液が 78% 以降で満ちる。
  const fiber = clamp((progress[0] - .78) / .22);
  root.querySelector('[data-hd-fibers]').setAttribute('opacity', fiber > 0 ? 1 : 0);
  for (const dots of root.querySelectorAll('[data-hd-fiber-dots]')) dots.setAttribute('stroke-dashoffset', -(offsetOf('blood') * .55 + +dots.dataset.hdFiberDots * 5));
  root.querySelector('[data-hd-header="a"]').setAttribute('fill', progress[0] > .78 ? COLOR.aTint : COLOR.empty);
  root.querySelector('[data-hd-header="v"]').setAttribute('fill', fiber >= 1 ? COLOR.vTint : COLOR.empty);
  for (const base of root.querySelectorAll('[data-hd-fiber-base]')) base.setAttribute('opacity', .35 + .65 * fiber);
  // 透析液は下の口から入り、外側を上へ。
  const shell = clamp((progress[1] - .56) / .12);
  for (const item of root.querySelectorAll('[data-hd-shell]')) item.setAttribute('opacity', shell);
  for (const dots of root.querySelectorAll('[data-hd-shell-dots]')) dots.setAttribute('stroke-dashoffset', -hdFlowOffset('dialysate', clock) * .7);
  // ポンプと計器。
  const spin = progress[0] > 0 ? bloodClock * 180 : 0;
  root.querySelector('[data-hd-rotor]').setAttribute('transform', `translate(400 150) rotate(${spin % 360})`);
  root.querySelector('[data-hd-uf-rotor]').setAttribute('transform', `translate(1500 95) rotate(${progress[3] > 0 ? (clock * 120) % 360 : 0})`);
  const pressed = 30 * clamp(clock / Math.max(1, slide.plannedSeconds));
  root.querySelector('[data-hd-plunger]').setAttribute('transform', `translate(0 ${-pressed})`);
  const syringe = root.querySelector('[data-hd-syringe]');
  syringe.setAttribute('height', 86 - pressed);
  root.querySelector('[data-hd-piston]').setAttribute('transform', `translate(${progress[1] > .14 ? 40 * Math.sin(clock * 1.6) : 0} 0)`);
  const gauge = root.querySelector('[data-hd-gauge]');
  gauge.setAttribute('transform', `rotate(${progress[4] > .17 ? (stopped ? 34 : 10 + 5 * Math.sin(2 * Math.PI * clock)) : -40} 618 424)`);
  for (const led of root.querySelectorAll('[data-hd-led]')) led.setAttribute('opacity', .55 + .45 * Math.abs(Math.sin(clock * 1.6)));
  // チャンバ：液面と滴下。静脈側は気泡が液面へ上がって抜ける。
  const levels = { a: progress[0] > .5, v: progress[4] > .17 };
  for (const liquid of root.querySelectorAll('[data-hd-liquid]')) liquid.setAttribute('opacity', levels[liquid.dataset.hdLiquid] ? 1 : 0);
  for (const drop of root.querySelectorAll('[data-hd-drop]')) {
    const on = levels[drop.dataset.hdDrop], u = (bloodClock * 1.5 + +drop.dataset.i * .5) % 1, top = +drop.dataset.top, level = +drop.dataset.level;
    drop.setAttribute('cy', top + (level - top) * u * u);
    drop.setAttribute('opacity', on ? 1 : 0);
  }
  for (const bubble of root.querySelectorAll('[data-hd-bubble]')) {
    const u = (clock * .35 + +bubble.dataset.i / 3) % 1, bottom = +bubble.dataset.bottom, level = +bubble.dataset.level;
    bubble.setAttribute('cy', bottom + (level - bottom) * u);
    bubble.setAttribute('opacity', levels.v ? clamp((1 - u) / .15) : 0);
  }
  // 拡大図：血球は膜を通らず流れ、小さな物質だけが孔を通る。水は除水の段階から移る。
  const insetOn = clamp(progress[2] / .25);
  root.querySelector('[data-hd-inset]').setAttribute('opacity', insetOn);
  // 血球は左の「血液 →」の文字に重ならない範囲で流す。
  for (const cell of root.querySelectorAll('[data-hd-rbc]')) { const x = (clock * 70 + +cell.dataset.hdRbc * 112) % 560; cell.setAttribute('cx', 1280 + x); cell.setAttribute('opacity', .85 * clamp(x / 40) * clamp((560 - x) / 40)); }
  for (const dot of root.querySelectorAll('[data-hd-mol]')) {
    const kind = dot.dataset.hdMol, m = molecule(kind, +dot.dataset.i, +dot.dataset.n, clock);
    dot.setAttribute('cx', m.x); dot.setAttribute('cy', m.y);
    dot.setAttribute('opacity', m.opacity * (kind === 'water' ? clamp(progress[3] / .25) : 1));
  }
  root.querySelector('[data-hd-inset-caption]').textContent = progress[3] > 0 ? '拡散＝濃度差 / 除水＝圧力差' : progress[2] > 0 ? '拡散＝濃度差で移動' : '';
  // 拡大図はダイアライザの丸からズームして現れる。
  const zoom = easeOut(clamp((time - cueAt(slide, slide.hdCircuit.targets[2])) / .7));
  const scale = .2 + .8 * zoom;
  const zoomGroup = root.querySelector('[data-hd-zoom]');
  zoomGroup.setAttribute('transform', `translate(930 400) scale(${scale}) translate(-930 -400)`);
  zoomGroup.setAttribute('opacity', zoom);
  for (const guide of root.querySelectorAll('[data-hd-zoom-guide]')) guide.setAttribute('opacity', zoom);
  // 部品に液が届いた瞬間の波紋。
  for (const ring of root.querySelectorAll('[data-hd-ripple]')) {
    const [stage, at, , , radius] = RIPPLES[+ring.dataset.hdRipple];
    const u = ambient !== null ? 1 : (time - cueAt(slide, slide.hdCircuit.targets[stage]) - at * HD_SECONDS[stage]) / 1.1;
    ring.setAttribute('r', radius + 34 * clamp(u));
    ring.setAttribute('opacity', u > 0 && u < 1 ? .8 * (1 - u) : 0);
  }
  // 気泡が検知器に届くと、ランプが赤くなり、クランプが閉じて血流が止まる。
  const bubble = root.querySelector('[data-hd-alarm-bubble]'), since = time - returnAt;
  const moving = ambient === null && since >= ALARM.bubble && since < ALARM.resume;
  bubble.setAttribute('cx', 700 - 107 * clamp((since - ALARM.bubble) / (ALARM.stop - ALARM.bubble)));
  bubble.setAttribute('opacity', moving ? 1 : 0);
  root.querySelector('[data-hd-clamp]').setAttribute('d', stopped ? CLAMP_SHUT : CLAMP_OPEN);
  root.querySelector('[data-hd-alarm-text]').setAttribute('opacity', stopped ? 1 : 0);
  const alarmLed = root.querySelector('[data-hd-alarm-led]');
  alarmLed.setAttribute('fill', stopped ? COLOR.a : COLOR.ok);
  alarmLed.setAttribute('opacity', stopped ? .35 + .65 * Math.abs(Math.sin(clock * 6)) : .55 + .45 * Math.abs(Math.sin(clock * 1.6)));
  // 説明中の本文を示す。
  const content = root.closest('#slide-content');
  for (const [i, target] of slide.hdCircuit.targets.entries()) content?.querySelector(`[data-block="${CSS.escape(target)}"]`)?.classList.toggle('hd-current', i === current);
}

export function decorateHdCircuit(content, slide) {
  delete content.dataset.hdCircuit;
  if (!hasHdCircuit(slide)) return;
  content.dataset.hdCircuit = MODEL;
  const panel = document.createElement('section');
  panel.className = 'hd-circuit-panel';
  const scope = `hd${++uid}-`;
  const svg = el('svg', { viewBox: `0 0 ${WIDTH} ${HEIGHT}`, role: 'img', 'aria-label': '血液透析の回路図。血液は動脈側の針から血液ポンプ、抗凝固薬の注入、動脈側チャンバ、ダイアライザ、静脈側チャンバ、気泡検知器、静脈クランプを通り、静脈側の針から体へ戻る。透析液はダイアライザの中を血液と逆向きに流れ、等量制御と除水ポンプを経て排液される。' },
    arm(), ...bloodCircuit(), pump(), ...monitors(), dialyzer(), console_(), inset(), legendBox());
  RIPPLES.forEach(([stage, , x, y, r], i) => svg.append(el('circle', { cx: x, cy: y, r, fill: 'none', stroke: RIPPLE_COLOR[stage], 'stroke-width': 5, opacity: 0, 'data-hd-ripple': i })));
  // 複数の画面に同じ図があっても、マスクとグラデーションの参照が混ざらないよう id を固有にする。
  for (const node of svg.querySelectorAll('[id]')) {
    const old = node.id, next = scope + old; node.id = next;
    for (const user of svg.querySelectorAll('[mask],[clip-path],[fill],[stroke]')) for (const attr of ['mask', 'clip-path', 'fill', 'stroke']) if (user.getAttribute(attr) === `url(#${old})`) user.setAttribute(attr, `url(#${next})`);
  }
  panel.append(svg);
  content.append(panel);
  // 再生前（一覧の縮小表示・PDF）は全体が流れている状態を見せる。
  paint(svg, slide, slide.plannedSeconds);
}

// 再生していない間（再生前・再生後・全画面の発表中）も、流れだけを続ける。段階の表示は変えない。
export function hdCircuitAmbient(content, slide, seconds, { time = slide.plannedSeconds, idle = false } = {}) {
  const svg = content?.querySelector('.hd-circuit-panel svg');
  if (svg && slide.animation?.type !== 'none') paint(svg, slide, time, { ambient: seconds, idle });
}

export function applyHdCircuit(content, slide, time) {
  if (!content || !hasHdCircuit(slide)) return;
  const svg = content.querySelector('.hd-circuit-panel svg');
  if (svg) paint(svg, slide, time);
}
