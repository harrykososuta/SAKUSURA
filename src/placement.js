// 位置は1920×1080の標準レイアウトからの差分。未指定なら従来のCSSをそのまま使う。
export function validatePlacement(slide) {
  if (slide.placement === undefined) return [];
  const errors = [];
  const allowed = new Set(['title', ...(slide.image ? ['image'] : []), ...(slide.note ? ['note'] : []), ...(Array.isArray(slide.blocks) ? slide.blocks : []).filter(Boolean).map(b => `block:${b.id}`)]);
  if (!slide.placement || typeof slide.placement !== 'object' || Array.isArray(slide.placement)) return ['placement は配置情報のオブジェクトです'];
  for (const [key, value] of Object.entries(slide.placement)) {
    if (!allowed.has(key) || !value || typeof value !== 'object' || Array.isArray(value)) { errors.push(`placement: 不明な要素 ${key}`); continue; }
    for (const [field, number] of Object.entries(value)) {
      const ranges = { x: [-1920, 1920], y: [-1080, 1080], width: [slide.layout==='document'?4:64, 1920], ...(key === 'image' || slide.layout==='document'&&key.startsWith('block:')&&slide.blocks.find(b=>`block:${b.id}`===key)?.image ? { height: [slide.layout==='document'?4:64, 1080] } : {}) };
      const range = ranges[field];
      if (!range || !Number.isFinite(number) || number < range[0] || number > range[1]) errors.push(`placement: ${key}.${field} の値が範囲外です`);
    }
  }
  return errors;
}

export function applyPlacement(stage, slide) {
  for (const element of stage.querySelectorAll('[data-element]')) {
    const value = slide.placement?.[element.dataset.element] ?? {};
    const base=element._documentGeometry, unit=base?1920/slide.document.width:1;
    element.style.translate = value.x || value.y ? `${(value.x ?? 0)/unit}px ${(value.y ?? 0)/unit}px` : '';
    if(base){element.style.setProperty('width',value.width?`${value.width/unit}px`:base.width,value.width?'important':base.widthPriority);element.style.setProperty('height',value.height?`${value.height/unit}px`:base.height,value.height?'important':base.heightPriority);}
    else {element.style.width=value.width?`${value.width}px`:'';element.style.height=value.height?`${value.height}px`:'';}
    if(base)element.style.display=(value.x||value.y||value.width)&&getComputedStyle(element).display==='inline'?'inline-block':base.display;
    if (value.width) { element.style.maxWidth = 'none'; element.style.flex = '0 0 auto'; }
    else { element.style.removeProperty('max-width'); element.style.removeProperty('flex'); }
    if (element.dataset.element === 'image') fitImage(element);
    element._fitDocumentImage?.();
  }
}

export function fitImage(figure) {
  const img = figure.querySelector('img'), frame = figure.querySelector('.image-frame');
  if (!img?.naturalWidth || !frame) return;
  const crop = figure._crop ?? { x: 0, y: 0, width: 1, height: 1 };
  const width = img.naturalWidth * crop.width, height = img.naturalHeight * crop.height;
  const scale = Math.min(figure.clientWidth / width, figure.clientHeight / height);
  frame.style.width = `${width * scale}px`; frame.style.height = `${height * scale}px`;
}
