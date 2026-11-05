// Design-only preview controls. Actual slides use the shared player and audio time.
export function wireDesignMotionControls(frame) {
  const host=frame.closest('.theme-preview-panel,.preview-panel');if(!host)return;
  const bar=document.createElement('div');bar.className='design-motion-controls';bar.hidden=true;
  const play=document.createElement('button');play.type='button';play.textContent='動きを見る';play.className='preset-small-button';
  const all=document.createElement('button');all.type='button';all.textContent='全体を表示';all.className='preset-small-button';
  const slider=document.createElement('input');slider.type='range';slider.min=0;slider.max=10;slider.step=.01;slider.value=0;slider.setAttribute('aria-label','デザインのアニメーション再生位置');
  const time=document.createElement('span');time.textContent='0.0秒';
  bar.append(play,all,slider,time);
  const caption=host.querySelector('.preview-caption');if(caption)caption.after(bar);else frame.parentElement.after(bar);
  const send=(action,value)=>frame.contentWindow?.postMessage({type:'sakusura:design-motion',action,value},location.origin);
  play.addEventListener('click',()=>send(play.dataset.playing==='true'?'pause':'play'));
  all.addEventListener('click',()=>send('all'));
  slider.addEventListener('input',()=>send('seek',Number(slider.value)));
  frame.addEventListener('load',()=>{bar.hidden=true;});
  window.addEventListener('message',event=>{
    if(event.origin!==location.origin||event.source!==frame.contentWindow||event.data?.type!=='sakusura:design-motion-state')return;
    const s=event.data;bar.hidden=!s.supported;slider.max=s.duration;slider.value=Math.min(s.time,s.duration);time.textContent=`${Math.min(s.time,s.duration).toFixed(1)} / ${s.duration.toFixed(1)}秒`;
    play.dataset.playing=String(s.playing);play.textContent=s.playing?'一時停止':'動きを見る';
  });
}
