// Editable structure imported from an HTML slide. Only these passive elements
// are created; scripts, HTML strings, external URLs and event handlers are absent.
const TAGS = new Set(['section','div','header','footer','h1','h2','h3','h4','p','ul','ol','li','span','b','strong','small','br','table','thead','tbody','tr','th','td','figure','figcaption','img','hr','native-text']);
const KEYS = new Set(['tag','class','style','children','bind','original','image','colspan','rowspan','page','reveal']);
export function validateDocument(slide) {
  if (slide.document === undefined) return slide.layout === 'document' ? ['document の構造が必要です'] : [];
  if (slide.layout !== 'document') return ['document は自由レイアウトだけで使えます'];
  const doc=slide.document, errors=[], bindings=new Set(), ids=new Set((slide.blocks??[]).map(b=>b.id));let count=0;
  if (!doc || typeof doc!=='object' || Object.keys(doc).some(k=>!['width','height','tree'].includes(k)) || !Number.isFinite(doc.width) || doc.width<320 || doc.width>3840 || !Number.isFinite(doc.height) || Math.abs(doc.width/doc.height-16/9)>.001) return ['document の大きさは16:9です'];
  function walk(node,depth=0) {
    if (++count>3000 || depth>30) {errors.push('document の要素数・階層が上限を超えています');return;}
    if (typeof node==='string') {if(node.length>20000)errors.push('document の文字列が長すぎます');return;}
    if (!node || typeof node!=='object' || Array.isArray(node) || !TAGS.has(node.tag) || Object.keys(node).some(k=>!KEYS.has(k))) {errors.push('document に使えない要素があります');return;}
    if (node.class!==undefined && (typeof node.class!=='string' || !/^[\w -]{0,500}$/.test(node.class)))errors.push('document のクラス名が不正です');
    if (node.style!==undefined && (typeof node.style!=='string' || node.style.length>4000 || /[{}<>@]|url\s*\(|expression\s*\(|javascript:|behavior\s*:/i.test(node.style)))errors.push('document のスタイルが不正です');
    for(const k of ['colspan','rowspan'])if(node[k]!==undefined&&(!Number.isInteger(node[k])||node[k]<1||node[k]>20))errors.push('document の表の結合数が不正です');
    if(node.page!==undefined&&(!Number.isInteger(node.page)||node.page<1||node.page>2000))errors.push('document のページ番号が不正です');
    if(node.bind!==undefined) {
      if(typeof node.bind!=='string'||node.bind!=='title'&&!ids.has(node.bind)||bindings.has(node.bind))errors.push('document の文字の対応先が不正です');
      bindings.add(node.bind);
      if(typeof node.original!=='string')errors.push('document の元の文字が必要です');
    }
    if(node.image!==undefined) {
      if(node.tag!=='img'||typeof node.image!=='string'||!ids.has(node.image)||bindings.has(node.image)||!(slide.blocks??[]).find(b=>b.id===node.image)?.image)errors.push('document の画像の対応先が不正です');
      bindings.add(node.image);
    }else if(node.tag==='img')errors.push('document の画像データが必要です');
    if(node.children!==undefined) {
      if(!Array.isArray(node.children))errors.push('document.children は配列です');
      else node.children.forEach(child=>walk(child,depth+1));
    }
  }
  walk(doc.tree);
  const cueAt=new Map((slide.cues??[]).map(c=>[c.target,c.at])), groupTargets=new Set();
  function groups(node,nested=false){
    if(typeof node==='string'||!node||typeof node!=='object')return;
    if(node.reveal!==undefined){
      const members=[];const collect=n=>{if(typeof n==='string'||!n)return;if(n.bind&&n.bind!=='title')members.push(n.bind);if(n.image)members.push(n.image);(n.children??[]).forEach(collect);};collect(node);
      if(nested||typeof node.reveal!=='string'||!ids.has(node.reveal)||!members.includes(node.reveal)||groupTargets.has(node.reveal))errors.push('document.reveal は重複・入れ子のない、同じブロック内の本文IDです');
      if(members.some(id=>cueAt.get(id)!==cueAt.get(node.reveal)))errors.push('document.reveal 内の本文・画像は同じcue時刻で表示します');
      groupTargets.add(node.reveal);
    }
    (node.children??[]).forEach(child=>groups(child,nested||node.reveal!==undefined));
  }
  groups(doc.tree);
  for(const id of ['title',...ids])if(!bindings.has(id))errors.push(`document: ${id} の表示先がありません`);
  return [...new Set(errors)];
}

export function renderDocument(content,slide,images,rich) {
  const byId=new Map(slide.blocks.map(b=>[b.id,b]));
  const wrapper=document.createElement('div');wrapper.className='native-document';
  wrapper.style.width=slide.document.width+'px';wrapper.style.height=slide.document.height+'px';
  wrapper.style.transform=`scale(${1920/slide.document.width})`;
  function create(node) {
    if(typeof node==='string')return document.createTextNode(node);
    const picture=node.image?byId.get(node.image):null;
    const crop=picture?.image.crop;
    const cropped=crop&&(crop.x!==0||crop.y!==0||crop.width!==1||crop.height!==1);
    const el=document.createElement(cropped?'span':node.tag);
    if(node.class)el.className=node.class;
    if(node.style)el.style.cssText=node.style;
    if(node.reveal){el.dataset.documentReveal=node.reveal;el.classList.add('document-reveal-group');}
    if(node.page)el.dataset.page=node.page;
    for(const key of ['colspan','rowspan'])if(node[key])el.setAttribute(key,node[key]);
    if(node.image) {
      const block=byId.get(node.image), entry=images[`${slide.id}:${node.image}`];
      if(cropped){
        el.style.position=el.style.position||'relative';el.style.overflow='hidden';
        el.setAttribute('role','img');el.setAttribute('aria-label',block.image.alt);
        const frame=document.createElement('span'), img=document.createElement('img');
        Object.assign(frame.style,{position:'absolute',left:'50%',top:'50%',translate:'-50% -50%',overflow:'hidden'});
        Object.assign(img.style,{position:'absolute',maxWidth:'none',width:100/crop.width+'%',height:100/crop.height+'%',left:-100*crop.x/crop.width+'%',top:-100*crop.y/crop.height+'%'});
        img.alt=block.image.alt;frame.append(img);el.append(frame);
        el._fitDocumentImage=()=>{if(!img.naturalWidth)return;const w=img.naturalWidth*crop.width,h=img.naturalHeight*crop.height;if(!el.style.height||el.style.height==='auto')el.style.aspectRatio=String(w/h);const scale=Math.min(el.clientWidth/w,el.clientHeight/h);frame.style.width=w*scale+'px';frame.style.height=h*scale+'px';};
        img.addEventListener('load',el._fitDocumentImage);img.src=entry?.ready?entry.url:'';
      }else {el.alt=block.image.alt;el.src=entry?.ready?entry.url:'';}
      el.dataset.product=(block.image.file??'').split('-')[0];
      el.dataset.element=`block:${node.image}`;el.dataset.block=node.image;el.classList.add('reveal');
    }else if(node.bind) {
      const title=node.bind==='title', value=title?slide.title:byId.get(node.bind).text;
      el.dataset.element=title?'title':`block:${node.bind}`;
      if(!title){el.dataset.block=node.bind;el.classList.add('reveal');}
      const text=rich('native-text',title?'heading-text':'block-text',value);
      if(value===node.original)text.replaceChildren(...(node.children??[]).map(create));
      else text.style.whiteSpace='pre-wrap';
      el.append(text);
    }else el.append(...(node.children??[]).map(create));
    // applyPlacement must retain the source's inline dimensions at reset.
    if(el.dataset.element)el._documentGeometry={width:el.style.width,height:el.style.height,widthPriority:el.style.getPropertyPriority('width'),heightPriority:el.style.getPropertyPriority('height'),display:el.style.display};
    return el;
  }
  wrapper.append(create(slide.document.tree));content.append(wrapper);
}

// Whole document sections share one cue, while their text/image bindings remain editable.
export const DOCUMENT_GROUP_SECONDS=.26;
export function documentGroups(slide){
  if(slide.layout!=='document'||!slide.document?.tree)return [];
  const at=new Map((slide.cues??[]).map(c=>[c.target,c.at])), result=[];
  function visit(node){if(typeof node==='string'||!node)return;if(node.reveal)result.push({target:node.reveal,at:at.get(node.reveal)??0});(node.children??[]).forEach(visit);}
  visit(slide.document.tree);return result;
}
export const hasDocumentGroups=slide=>documentGroups(slide).length>0;
export function documentCueTargets(slide,target){
  let found;
  function visit(node){if(typeof node==='string'||!node)return;
    if(node.reveal){const members=[];const collect=n=>{if(typeof n==='string'||!n)return;if(n.bind&&n.bind!=='title')members.push(n.bind);if(n.image)members.push(n.image);(n.children??[]).forEach(collect);};collect(node);if(members.includes(target))found=members;}
    (node.children??[]).forEach(visit);
  }
  if(slide.layout==='document')visit(slide.document?.tree);
  return found??[target];
}
export function documentGroupPlan(slide,duration){
  if(slide.animation?.type==='none')return [];
  return documentGroups(slide).filter(g=>g.at>0).map(g=>({kind:'document-group',target:g.target,cue:g.at,start:g.at,end:Math.min(duration,g.at+DOCUMENT_GROUP_SECONDS),short:g.at+DOCUMENT_GROUP_SECONDS>duration}));
}
export function documentGroupState(slide,time){
  return documentGroups(slide).map(g=>{
    const p=time<g.at?0:g.at===0||slide.animation?.type==='none'?1:Math.max(0,Math.min(1,(time-g.at)/DOCUMENT_GROUP_SECONDS));
    const eased=1-(1-p)**3;
    return {...g,opacity:eased,offset:8*(1-eased)};
  });
}
export function applyDocumentGroups(content,slide,time){
  if(!content)return;
  const state=new Map(documentGroupState(slide,time).map(g=>[g.target,g]));
  for(const el of content.querySelectorAll('[data-block]')){el.style.transition='none';el.style.opacity=el.classList.contains('visible')?'1':'0';el.style.transform='none';}
  for(const el of content.querySelectorAll('[data-document-reveal]')){
    const value=state.get(el.dataset.documentReveal);if(!value)continue;
    el.style.transition='none';el.style.opacity=String(value.opacity);el.style.transform=`translateY(${value.offset.toFixed(3)}px)`;
  }
}
