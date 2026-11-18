const $=id=>document.getElementById(id);
let configGetter,notify,documentData,current,dirty=false,lastProfile='';
async function api(path,body){
  const response=await fetch(path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json','X-Pet-Token':configGetter().token}:{},body:body?JSON.stringify(body):undefined});
  const result=await response.json();if(!response.ok)throw new Error(result.error||'操作失败');return result;
}
function showDocument(doc){
  documentData=doc;$('preset-select').replaceChildren(...doc.presets.map(p=>new Option(p.name,p.id)));
  $('preset-select').value=doc.selected;showPreset(doc.presets.find(p=>p.id===doc.selected));
}
function showPreset(p){
  if(!p)return;current=p;dirty=false;lastProfile=JSON.stringify(p);
  $('preset-current').textContent=p.name;$('preset-name').value=p.name;
  $('preset-idle').value=p.idle_action;$('preset-expression').value=p.expression;
  $('preset-speed').value=p.speed;$('preset-music').value=p.music_action;
  $('preset-threshold').value=p.music_threshold;$('preset-blink').checked=p.auto_blink;
}
async function act(callback){try{await callback();}catch(error){$('preset-feedback').textContent=error.message;notify(error.message);}}
export async function initCompanion(getConfig,toast){
  configGetter=getConfig;notify=toast;
  const supported=!!getConfig().features?.desktop;
  $('desktop-open').disabled=$('music-toggle').disabled=!supported;
  if(!supported)$('music-status').textContent='系统音频与独立桌宠需要 macOS；动作预设可正常使用。';
  await act(async()=>showDocument(await api('/api/presets')));
  $('preset-details').addEventListener('input',()=>{dirty=true;});
  $('preset-select').addEventListener('change',()=>act(async()=>{showDocument(await api('/api/presets',{operation:'select',id:$('preset-select').value}));$('preset-feedback').textContent='已应用预设';}));
  async function save(copy){const preset={...current,id:copy?`custom_${crypto.randomUUID().slice(0,8)}`:current.id,name:$('preset-name').value,idle_action:$('preset-idle').value,expression:$('preset-expression').value,speed:Number($('preset-speed').value),music_action:$('preset-music').value,music_threshold:Number($('preset-threshold').value),auto_blink:$('preset-blink').checked};showDocument(await api('/api/presets',{operation:'save',preset}));$('preset-feedback').textContent='已保存，重启后仍会保留';}
  $('preset-save').addEventListener('click',()=>act(()=>save(false)));
  $('preset-copy').addEventListener('click',()=>act(()=>save(true)));
  $('preset-export').addEventListener('click',()=>act(async()=>{const doc=await api('/api/presets');const url=URL.createObjectURL(new Blob([JSON.stringify(doc,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='lanluo-presets.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}));
  $('preset-import').addEventListener('change',()=>act(async()=>{try{const file=$('preset-import').files[0];if(!file)return;if(file.size>65536)throw new Error('预设文件不能超过 64 KB');const document=JSON.parse(await file.text());showDocument(await api('/api/presets',{operation:'import',document}));$('preset-feedback').textContent='已导入并应用';}finally{$('preset-import').value='';}}));
  $('desktop-open').addEventListener('click',()=>act(async()=>{const b=$('desktop-open');b.disabled=true;try{await api('/api/desktop',{});notify('桌宠已启动；菜单栏“兰”可打开设置或退出。');}finally{b.disabled=false;}}));
  $('music-toggle').addEventListener('click',()=>act(async()=>{const b=$('music-toggle');b.disabled=true;try{await api('/api/music',{enabled:b.getAttribute('aria-pressed')!=='true'});}finally{b.disabled=false;}}));
}
export function updateCompanion(state){
  if(!configGetter)return;
  const p=state.profile;
  if(p){$('preset-current').textContent=p.name;if(!dirty&&JSON.stringify(p)!==lastProfile)showPreset(p);}
  const music=state.music;
  if(music){$('music-toggle').setAttribute('aria-pressed',String(music.enabled));$('music-toggle').textContent=music.enabled?'停止音乐跟随':'开启音乐跟随';const label=music.active?`检测到音乐 · ${Math.round(music.score*100)}% · 正在${p.music_action==='dance'?'跳舞':p.music_action==='jump'?'跳跃':'跟随'}`:music.enabled&&music.status==='listening'?`正在听系统声音 · 音乐置信度 ${Math.round(music.score*100)}%`:music.message;if($('music-status').textContent!==label)$('music-status').textContent=label;}
}
export function initDesktop(){
  const native=body=>window.lanluoDesktop ? window.lanluoDesktop.send(body) : window.webkit?.messageHandlers?.desktop?.postMessage(body);
  document.querySelectorAll('[data-native]').forEach(button=>button.addEventListener('click',()=>native({type:button.dataset.native})));
  const grip=$('desktop-drag');let start;
  grip.addEventListener('pointerdown',event=>{start=[event.screenX,event.screenY];grip.setPointerCapture(event.pointerId);native({type:'dragStart'});});
  grip.addEventListener('pointermove',event=>{if(start)native({type:'drag',dx:event.screenX-start[0],dy:event.screenY-start[1]});});
  grip.addEventListener('pointerup',()=>{start=null;});grip.addEventListener('pointercancel',()=>{start=null;});
}
