import test from 'node:test';
import assert from 'node:assert/strict';
import { withoutSlideElement } from '../src/editor-elements.js';
import { validateDocument } from '../src/document-layout.js';
import { validateAnimation } from '../src/animation.js';

function documentSlide() {
  return {layout:'document',title:'Title',blocks:[{id:'a',text:'A'},{id:'b',text:'B'},{id:'c',text:'C'}],cues:[{target:'a',at:2},{target:'b',at:2},{target:'c',at:5}],placement:{'block:a':{x:8},'block:c':{y:16}},document:{width:1280,height:720,tree:{tag:'section',children:[
    {tag:'h1',bind:'title',original:'Title',children:['Title']},
    {tag:'div',reveal:'a',children:[{tag:'h3',bind:'a',original:'A',children:['A']},{tag:'p',bind:'b',original:'B',children:['B']}]},
    {tag:'p',bind:'c',original:'C',children:['C']}
  ]}}};
}
test('deleting a document heading retains its paragraph, group timing and unrelated placement',()=>{
  const source=documentSlide(),before=JSON.stringify(source),result=withoutSlideElement(source,'block:a');
  assert.deepEqual(validateDocument(result),[]);
  assert.deepEqual(result.blocks.map(b=>b.id),['b','c']);
  assert.equal(result.document.tree.children[1].reveal,'b');
  assert.deepEqual(result.cues,[{target:'b',at:2},{target:'c',at:5}]);
  assert.deepEqual(result.placement,{'block:c':{y:16}});
  assert.equal(JSON.stringify(source),before);
});
test('deleting the final member removes its empty reveal frame',()=>{
  const result=withoutSlideElement(withoutSlideElement(documentSlide(),'block:a'),'block:b');
  assert.deepEqual(validateDocument(result),[]);
  assert.equal(result.document.tree.children.length,2);
  assert.deepEqual(result.blocks.map(b=>b.id),['c']);
});
test('deleting a bound subtree also removes descendant bindings and their cues',()=>{
  const s=documentSlide();
  s.document.tree.children[1]={tag:'div',bind:'a',original:'A',children:[{tag:'p',bind:'b',original:'B',children:['B']}]};
  const result=withoutSlideElement(s,'block:a');
  assert.deepEqual(validateDocument(result),[]);
  assert.deepEqual(result.blocks.map(b=>b.id),['c']);
  assert.deepEqual(result.cues,[{target:'c',at:5}]);
});
test('flow deletion removes dangling verdicts and incoming link settings',()=>{
  const s={layout:'flow',blocks:[{id:'a'},{id:'b'},{id:'c'}],cues:[{target:'a',at:0},{target:'b',at:2},{target:'c',at:4}],animation:{type:'flow',targets:['a','b','c'],verdicts:[{target:'a',result:'pass'}],links:[{target:'b',style:'dashed'},{target:'c',style:'solid'}]}};
  const result=withoutSlideElement(s,'block:a');
  assert.deepEqual(validateAnimation(result),[]);
  assert.deepEqual(result.animation.targets,['b','c']);
  assert.deepEqual(result.animation.links,[{target:'c',style:'solid'}]);
  assert.deepEqual(result.animation.verdicts,[]);
});
test('deleting shapes, a note or an image removes only that selection and its references',()=>{
  const s={blocks:[{id:'a'}],shapes:[{id:'x'}],note:'Summary',image:{alt:'Image'},cues:[{target:'a',at:0},{target:'x',at:1},{target:'note',at:2}],placement:{note:{y:8},image:{width:500}}};
  const shape=withoutSlideElement(s,'shape:x');assert.equal(shape.shapes,undefined);assert.equal(shape.cues.some(c=>c.target==='x'),false);assert.equal(shape.note,'Summary');
  const note=withoutSlideElement(s,'note');assert.equal(note.note,undefined);assert.equal(note.placement.note,undefined);assert.equal(note.cues.some(c=>c.target==='note'),false);
  const image=withoutSlideElement(s,'image');assert.equal(image.image,undefined);assert.equal(image.placement.image,undefined);assert.deepEqual(image.blocks,s.blocks);
  assert.equal(withoutSlideElement(s,'title'),null);assert.equal(withoutSlideElement(s,'block:missing'),null);
});
