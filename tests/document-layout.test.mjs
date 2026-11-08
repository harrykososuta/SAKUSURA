import test from 'node:test';
import assert from 'node:assert/strict';
import {validateLecture,withSlideId,slideFilePairs} from '../src/core.js';
import {validateDocument,documentGroupState,documentGroupPlan,documentCueTargets} from '../src/document-layout.js';
import {settleTime,motionSpans} from '../src/motion.js';

const example=()=>({version:1,title:'編集できる講義',targetSeconds:20,rules:'free',slides:[{id:'001',layout:'document',title:'見出し',narration:'原稿',plannedSeconds:20,gapAfter:0,blocks:[{id:'body',text:'本文'},{id:'character',text:'案内役',image:{alt:'案内役',prompt:'既存画像',file:'mascot.png'}}],cues:[{at:0,target:'body'},{at:2,target:'character'}],document:{width:1280,height:720,tree:{tag:'section',children:[{tag:'h1',bind:'title',original:'見出し',children:['見出し']},{tag:'p',bind:'body',original:'本文',children:['本文']},{tag:'img',image:'character'}]}}}]});
test('取り込んだ文字と画像を本文データへ結び付け、編集・配置・複製後も参照を保つ',()=>{
 const lecture=example();assert.deepEqual(validateLecture(lecture),[]);
 const slide=lecture.slides[0];slide.blocks[0].text='変更した本文';slide.placement={'block:character':{x:30,y:20,width:180,height:150}};assert.deepEqual(validateLecture(lecture),[]);
 const copy=withSlideId(slide,'002');assert.deepEqual(validateDocument(copy),[]);assert.equal(copy.document.tree.children[2].image,'character');assert.ok(slideFilePairs(slide,copy).some(([a,b])=>a==='images/mascot.png'&&b==='images/002-character.png'));
});
test('取り込み構造はスクリプト・外部参照・属性・重複や欠落した編集先を拒否する',()=>{
 for(const node of [{tag:'script',children:['alert(1)']},{tag:'iframe'},{tag:'div',onclick:'alert(1)'},{tag:'span',style:'background:url(https://example.com)'},{tag:'img',src:'https://example.com/x.png'}]){
  const slide=example().slides[0];slide.document.tree.children.push(node);assert.ok(validateDocument(slide).length,JSON.stringify(node));
 }
 const missing=example().slides[0];missing.document.tree.children.pop();assert.match(validateDocument(missing).join(),/表示先/);
 const duplicate=example().slides[0];duplicate.document.tree.children.push({tag:'p',bind:'body',original:'本文',children:['本文']});assert.match(validateDocument(duplicate).join(),/対応先/);
});

test('説明のまとまりは1cueで表示し、編集可能な本文と画像を残す',()=>{
 const lecture=example(),s=lecture.slides[0];
 const children=s.document.tree.children.splice(1);s.document.tree.children.push({tag:'div',reveal:'body',children});
 s.cues.forEach(c=>c.at=4);assert.deepEqual(validateLecture(lecture),[]);
 assert.deepEqual(documentCueTargets(s,'character'),['body','character']);
 assert.deepEqual(documentCueTargets(s,'title'),['title']);
 assert.deepEqual(documentCueTargets({layout:'statement'},'body'),['body']);
 s.cues[1].at=7;assert.match(validateDocument(s).join(),/同じcue/);
 s.cues[1].at=4;s.document.tree.children[1].reveal='missing';assert.match(validateDocument(s).join(),/reveal/);
});
test('まとまりの表示は停止・巻き戻し・書き出しで同じ時刻の状態を再現する',()=>{
 const s=example().slides[0];s.document.tree.children[1].reveal='body';s.cues[0].at=4;
 assert.equal(documentGroupState(s,3)[0].opacity,0);
 const middle=documentGroupState(s,4.13)[0];assert.ok(middle.opacity>0&&middle.opacity<1);assert.ok(middle.offset>0&&middle.offset<8);
 assert.equal(documentGroupState(s,5)[0].opacity,1);assert.deepEqual(documentGroupState(s,4.13)[0],middle);
 assert.equal(settleTime({},s,4,20),4.26);assert.deepEqual(motionSpans({},s,20),[[4,4.26]]);
 assert.equal(documentGroupPlan(s,20)[0].end,4.26);
 s.cues[0].at=0;assert.equal(documentGroupState(s,0)[0].opacity,1);
 s.cues[0].at=4;s.animation={type:'none'};assert.equal(documentGroupState(s,4)[0].opacity,1);assert.deepEqual(documentGroupPlan(s,20),[]);
});
