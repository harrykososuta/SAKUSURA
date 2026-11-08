import { DESIGN_SAMPLES } from './design-catalog.js';
import { applyDesignTexts } from './design-text.js';
import { COMPOSITIONS, COMPOSITION_SAMPLES } from './design-compositions.js';
import { demoWaveform } from './extension-stubs.js';

export function makeDesignSample(design, layout, slot = null, takehomeCount = 4, custom = true) {
  const slide = structuredClone(DESIGN_SAMPLES.find(item => item.layout === layout));
  if (slot?.composition && COMPOSITIONS[slot.composition]?.layout === layout) {
    Object.assign(slide, structuredClone(COMPOSITION_SAMPLES[slot.composition]), { composition: slot.composition });
    slide.cues = slide.blocks.map((b,i) => ({ target:b.id, at:i*1.2 }));
    if (layout === 'flow') slide.animation = { type:'subtle' };
    if (slot.composition === 'profile') { slide.id='design-profile'; slide.image={alt:'人物写真の差し替え用シルエット'}; }
    if (COMPOSITIONS[slot.composition].illustration) {
      slide.id=`design-${slot.composition}`;
      slide.image={alt:slot.composition==='image-notes-2'?'厚い本と付箋のある開いた本。要点から学ぶイメージ':'学習の要点を伝える架空の講師。実在人物の似顔絵ではない'};
      delete slide.note;
      slide.animation={type:'subtle'};
    }
    if (slot.composition === 'recovery') slide.animation.verdicts=[{target:'b3',result:'fail'},{target:'b5',result:'pass'},{target:'b6',result:'pass'},{target:'b7',result:'fail'}];
    if (COMPOSITIONS[slot.composition].ecg) {
      delete slide.image;
      slide.waveform=demoWaveform(slot.composition);
      slide.cues=slide.blocks.map((b,i)=>({target:b.id,at:i*3}));
      slide.animation={type:'subtle'};
    }
    if(slot.composition==='anatomy-focus') {
      slide.image={alt:'解剖図用の配置と動きの抽象的な見本。実際の解剖図ではない',prompt:'配置確認用の抽象図',labels:['構造A','構造B','構造C'],labelPositions:[{text:'構造A',x:425/900,y:.5,side:'left'},{text:'構造B',x:680/900,y:110/600,side:'right'},{text:'構造C',x:680/900,y:490/600,side:'right'}],focus:[{label:'構造A',target:'b1',rx:.10,ry:.15},{label:'構造B',target:'b2',rx:.06,ry:.09},{label:'構造C',target:'b3',rx:.06,ry:.09}]};
      slide.cues=slide.blocks.map((b,i)=>({target:b.id,at:i*3}));slide.animation={type:'subtle'};
    }
  }
  if (custom && layout === 'title') slide.blocks[0].label = design.name;
  if (layout === 'takehome') slide.blocks = Array.from({ length: takehomeCount }, (_, i) => ({ ...slide.blocks[i % slide.blocks.length], id: `b${i + 1}` }));
  if (layout==='takehome'&&design.css?.includes('--ecg-template')) slide.blocks.forEach((b,i)=>{b.icon=['play','book','join','target'][i%4];});
  applyDesignTexts(slide, design.layoutTexts?.[layout]);
  if (slot?.purpose) slide.title = slot.purpose;
  applyDesignTexts(slide, slot?.texts);
  if(design.css?.includes('--ecg-template')&&!slide.animation)slide.animation={type:layout==='flow'?'flow':'subtle',...(layout==='flow'?{targets:slide.blocks.map(b=>b.id)}:{})};
  return slide;
}
