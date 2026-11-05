import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from './lib/project.mjs';
import { createDesignStore } from './lib/design-store.mjs';
import { standardDesign } from '../src/design-theme.js';
import { COMPOSITION_SAMPLES, COMPOSITIONS } from '../src/design-compositions.js';

const design=standardDesign();
design.name='SAKUSURA Bracket Studio';
design.description='SAKUSURA Standardの配色に、四隅の『』と余白を組み合わせたデザイン。人物紹介と4種類の図解を、短い出現と線の描画で組み立てます。';
Object.assign(design.settings.typography,{heading:50,body:28,title:78,number:60,message:76});
Object.assign(design.settings.spacing,{left:100,right:100,top:160,bottom:120});
design.css=await readFile(join(ROOT,'designs/grid-studio.css'),'utf8');
design.deck={targetSeconds:600,takehomeCount:4,slides:[
  {layout:'title',purpose:'複雑なことを、ひとつずつ。'},
  {layout:'agenda',purpose:'今日の話を、4つの視点で。'},
  ...Object.entries(COMPOSITIONS).filter(([,item])=>!item.ecg&&!item.anatomy&&!item.illustration).map(([composition,item])=>({layout:item.layout,composition,purpose:COMPOSITION_SAMPLES[composition].title})),
  {layout:'message',purpose:'動きは、**理解の順番**をつくる。'},
  {layout:'compare',purpose:'違いを並べると、判断しやすい',bodySize:48,texts:{'blocks.0.text':'**濃いグレーと太字**で、\n最初に目に入る\nポイントをつくる。'}},
  {layout:'bars',purpose:'大きさの違いを、ひと目で伝える',bodySize:36},
  {layout:'message',purpose:'見せるのは、**いま必要な情報**だけ。'},
  {layout:'takehome',purpose:'Take Home Message',bodySize:36},
]};
design.aiInstructions='配色はSAKUSURA Standardと同じ。無地の背景、四隅の二重かぎ括弧『』、細い進行線と縦の見出しマーカーで統一。方眼紙や閉じた外枠は使わない。人物は左に経歴・右に大きな写真。図解は全体構成、役割別レーン、時間軸、停止と再開の比較を使い分ける。0.25秒の出現、短い移動、矢印描画で発話に沿って組み立てる。チャンネル登録やYouTubeの操作UIは描かない。';
const store=createDesignStore(),existing=(await store.list()).designs.find(item=>[design.name,'SAKUSURA Grid Studio'].includes(item.design.name));
if(existing && !process.argv.includes('--update')) {console.log(JSON.stringify({id:existing.id,existing:true}));process.exit(0);}
const saved=await store.change(existing?{op:'update',id:existing.id,revision:existing.revision,design}:{op:'create',design});
await mkdir(join(ROOT,'reports/grid-studio'),{recursive:true});
await writeFile(join(ROOT,'reports/grid-studio/design-id.txt'),saved.id);
console.log(JSON.stringify({id:saved.id,name:saved.design.name}));
