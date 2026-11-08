import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile, rm, access } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { createLibraryStore } from '../tools/lib/library-store.mjs';
import { createStudioServer } from '../tools/server.mjs';

const lectures = [
  { name:'va-test',title:'血管解剖',category:'cat-a',slides:12,updatedAt:1000 },
  { name:'va-test-2',title:'穿刺の基本',category:'cat-a',slides:12,updatedAt:1001 },
  { name:'ai-test',title:'AI講義',category:'ai',slides:12,updatedAt:1002 },
];
// カテゴリは designs/category-presets.json に依存させない（配布版はカテゴリなしで始まる）。
const getCategories = async () => [{ id:'cat-a',name:'カテゴリA',color:'#1e2a47' },{ id:'ai',name:'カテゴリD',color:'#2a2156' },{ id:'other',name:'カテゴリ未設定',color:'#738097' }];
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(),'sakusura-library-test-'));
  try { await run({root,store:createLibraryStore({directory:root,getCategories,getLectures:async()=>structuredClone(lectures)})}); }
  finally { assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep)&&root.includes('sakusura-library-test-'));await rm(root,{recursive:true,force:true}); }
}

test('フォルダーの作成・入れ子・名前変更・一括分類を保存し、読み直して復元する',()=>fixture(async({root,store})=>{
  let view=await store.snapshot();assert.equal(view.folders.length,0);assert.equal(view.lectures[0].folderId,null);
  await assert.rejects(access(join(root,'index.json')));
  view=await store.change({revision:view.revision,op:'create',name:'血管解剖',category:'cat-a'});
  const parent=view.createdId;
  view=await store.change({revision:view.revision,op:'create',name:'基礎編',category:'cat-a',parentId:parent});
  const child=view.createdId;
  view=await store.change({revision:view.revision,op:'assign',lectures:['va-test','va-test-2'],folderId:child});
  assert.equal(view.lectures[0].folderPath,'血管解剖 / 基礎編');
  await assert.rejects(store.change({revision:view.revision,op:'delete',id:parent}),/空のフォルダー/);
  await assert.rejects(store.change({revision:view.revision,op:'delete',id:child}),/空のフォルダー/);
  view=await store.change({revision:view.revision,op:'rename',id:parent,name:'VAの解剖'});
  assert.equal(view.lectures[0].folderPath,'VAの解剖 / 基礎編');
  const second=createLibraryStore({directory:root,getCategories,getLectures:async()=>structuredClone(lectures)});
  assert.deepEqual((await second.snapshot()).lectures,view.lectures);
  const backups=await readdir(join(root,'backups'));assert.equal(backups.length,3);
  const previous=JSON.parse(await readFile(join(root,'backups',backups.at(-1)),'utf8'));
  assert.equal(previous.version,1);
  view=await store.change({revision:view.revision,op:'assign',lectures:['va-test'],folderId:null});
  assert.equal(view.lectures[0].folderId,null);assert.equal(view.lectures[1].folderId,child);
  view=await store.change({revision:view.revision,op:'assign',lectures:['va-test-2'],folderId:null});
  view=await store.change({revision:view.revision,op:'delete',id:child});
  assert.equal(view.folders.length,1);assert.equal(view.lectures.length,3);
}));

test('競合・重複名・不正なパス・存在しない講義・カテゴリ違いの移動を拒否する',()=>fixture(async({store})=>{
  const initial=await store.snapshot();
  const results=await Promise.allSettled([store.change({revision:initial.revision,op:'create',name:'基礎編',category:'cat-a'}),store.change({revision:initial.revision,op:'create',name:'別フォルダー',category:'cat-a'})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
  const view=await store.snapshot(),folder=view.folders[0].id;
  for(const name of ['../input','..','<script>','', 'a'.repeat(61)]) await assert.rejects(store.change({revision:view.revision,op:'create',name,category:'cat-a'}),{status:422});
  await assert.rejects(store.change({revision:view.revision,op:'create',name:'基礎編',category:'cat-a'}),/同名/);
  await assert.rejects(store.change({revision:view.revision,op:'assign',lectures:['va-test','ai-test'],folderId:folder}),/同じカテゴリ/);
  assert.equal((await store.snapshot()).lectures[0].folderId,null);
  await assert.rejects(store.change({revision:view.revision,op:'assign',lectures:['missing'],folderId:folder}),{status:404});
  await assert.rejects(store.change({revision:view.revision,op:'create',name:'子',category:'ai',parentId:folder}),{status:422});
  assert.equal((await store.snapshot()).revision,view.revision);
}));

test('壊れた分類ファイルは上書きせず、カテゴリ変更後の講義も一覧から消さない',()=>fixture(async({root,store})=>{
  let view=await store.snapshot();view=await store.change({revision:view.revision,op:'create',name:'解剖',category:'cat-a'});
  view=await store.change({revision:view.revision,op:'assign',lectures:['va-test'],folderId:view.createdId});
  const changed=createLibraryStore({directory:root,getCategories,getLectures:async()=>lectures.map(item=>item.name==='va-test'?{...item,category:'ai'}:item)});
  assert.equal((await changed.snapshot()).lectures[0].folderId,null);
  await writeFile(join(root,'index.json'),'broken');
  await assert.rejects(store.snapshot(),{status:503});
  await assert.rejects(store.change({revision:view.revision,op:'rename',id:view.folders[0].id,name:'更新'}),{status:503});
  assert.equal(await readFile(join(root,'index.json'),'utf8'),'broken');
}));

test('フォルダーを子孫ごと移動し、自己の内側・同名・カテゴリ違いへの移動を拒否する',()=>fixture(async({store})=>{
  let view=await store.snapshot();
  view=await store.change({revision:view.revision,op:'create',name:'親',category:'cat-a'});const parent=view.createdId;
  view=await store.change({revision:view.revision,op:'create',name:'子',category:'cat-a',parentId:parent});const child=view.createdId;
  view=await store.change({revision:view.revision,op:'assign',lectures:['va-test'],folderId:child});
  await assert.rejects(store.change({revision:view.revision,op:'move',folders:[parent],lectures:[],folderId:child,category:'cat-a'}),/内側/);
  await assert.rejects(store.change({revision:view.revision,op:'move',folders:[child],lectures:[],folderId:null,category:'ai'}),/同じカテゴリ/);
  assert.equal((await store.snapshot()).revision,view.revision);
  view=await store.change({revision:view.revision,op:'move',folders:[child],lectures:[],folderId:null,category:'cat-a'});
  assert.equal(view.lectures[0].folderPath,'子');
  view=await store.change({revision:view.revision,op:'move',folders:[child],lectures:['va-test-2'],folderId:parent,category:'cat-a'});
  assert.equal(view.lectures[0].folderPath,'親 / 子');assert.equal(view.lectures[1].folderPath,'親');
  view=await store.change({revision:view.revision,op:'create',name:'子',category:'cat-a'});
  await assert.rejects(store.change({revision:view.revision,op:'move',folders:[child],lectures:[],folderId:null,category:'cat-a'}),/同名/);
}));

test('講義とフォルダーをまとめてごみ箱へ移し、入れ子・分類先も復元する',()=>fixture(async({store,root})=>{
  let view=await store.snapshot();
  view=await store.change({revision:view.revision,op:'create',name:'解剖',category:'cat-a'});const parent=view.createdId;
  view=await store.change({revision:view.revision,op:'create',name:'基礎',category:'cat-a',parentId:parent});const child=view.createdId;
  view=await store.change({revision:view.revision,op:'assign',lectures:['va-test','va-test-2'],folderId:child});
  view=await store.change({revision:view.revision,op:'trash',folders:[parent,child],lectures:['va-test']});
  assert.equal(view.folders.length,0);assert.deepEqual(view.lectures.map(item=>item.name),['ai-test']);
  assert.equal(view.trash[0].lectureCount,2);assert.equal(view.trash[0].folderCount,2);assert.equal(await store.isTrashed('va-test'),true);
  const fresh=createLibraryStore({directory:root,getCategories,getLectures:async()=>structuredClone(lectures)});
  assert.equal((await fresh.snapshot()).trash.length,1);
  const revision=view.revision;
  await assert.rejects(store.change({revision,op:'assign',lectures:['va-test'],folderId:null}),{status:404});
  view=await store.change({revision,op:'restore',ids:[view.trash[0].id]});
  assert.equal(view.trash.length,0);assert.equal(view.lectures.length,3);assert.equal(view.lectures[0].folderPath,'解剖 / 基礎');
  assert.equal(await store.isTrashed('va-test'),false);
}));

test('復元先の同名フォルダーを上書きせず、親がない場合はカテゴリ直下へ復元する',()=>fixture(async({store})=>{
  let view=await store.snapshot();
  view=await store.change({revision:view.revision,op:'create',name:'親',category:'cat-a'});const parent=view.createdId;
  view=await store.change({revision:view.revision,op:'create',name:'子',category:'cat-a',parentId:parent});const child=view.createdId;
  view=await store.change({revision:view.revision,op:'trash',folders:[child],lectures:[]});const childBatch=view.trash[0].id;
  view=await store.change({revision:view.revision,op:'trash',folders:[parent],lectures:[]});
  view=await store.change({revision:view.revision,op:'create',name:'子',category:'cat-a'});const conflicting=view.createdId;
  await assert.rejects(store.change({revision:view.revision,op:'restore',ids:[childBatch]}),/同名/);
  assert.equal((await store.snapshot()).trash.length,2);
  view=await store.change({revision:view.revision,op:'rename',id:conflicting,name:'別の子'});
  view=await store.change({revision:view.revision,op:'restore',ids:[childBatch]});
  assert.equal(view.folders.find(item=>item.id===child).parentId,null);
}));

test('ライブラリの書き込みは同一Originからのみ受け付け、分類ファイルやバックアップを直接配信しない',()=>fixture(async({store})=>{
  const server=await createStudioServer({port:0,libraryStore:store});const base=`http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base+'/library')).status,200);
    const view=await(await fetch(base+'/api/library')).json();
    const body=JSON.stringify({revision:view.revision,op:'create',name:'解剖',category:'cat-a'});
    assert.equal((await fetch(base+'/api/library',{method:'POST',headers:{'Content-Type':'application/json'},body})).status,403);
    const response=await fetch(base+'/api/library',{method:'POST',headers:{Origin:base,'Content-Type':'application/json','X-Studio-Editor':'1'},body});
    assert.equal(response.status,200);assert.equal((await response.json()).folders.length,1);
    for(const path of ['/library/index.json','/library/backups/index.json','/.env'])assert.equal((await fetch(base+path)).status,404);
    assert.equal((await(await fetch(base+'/api/lectures')).json()).some(item=>item.category==='cat-a'),true);
  }finally{await new Promise(resolve=>server.close(resolve));}
}));

test('ごみ箱の講義は選択・表示・生成・保存から除外し、復元後は再び開ける',()=>fixture(async({root})=>{
  const store=createLibraryStore({directory:root,getCategories,getLectures:async()=>[{name:'demo',title:'デモ',category:'other',slides:3,updatedAt:1}]});
  const server=await createStudioServer({port:0,libraryStore:store});const base=`http://127.0.0.1:${server.address().port}`;
  try{
    let view=await store.snapshot();view=await store.change({revision:view.revision,op:'trash',folders:[],lectures:['demo']});
    assert.deepEqual(await(await fetch(base+'/api/lectures')).json(),[]);
    assert.equal((await fetch(base+'/api/lecture?name=demo')).status,410);
    for(const path of ['/api/tts/plan?name=demo','/api/render/start?name=demo']){
      const response=await fetch(base+path,{method:'POST',headers:{Origin:base,'Content-Type':'application/json','X-Studio-Editor':'1'},body:'{}'});assert.equal(response.status,410);
    }
    view=await store.change({revision:view.revision,op:'restore',ids:[view.trash[0].id]});
    assert.equal((await fetch(base+'/api/lecture?name=demo')).status,200);
    assert.equal((await(await fetch(base+'/api/lectures')).json()).length,1);
  }finally{await new Promise(resolve=>server.close(resolve));}
}));
