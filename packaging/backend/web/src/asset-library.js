import { Box3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { parseFBX, disposeFBX, suggestMapping, sourceBones, humanoidBones, retargetClip } from './retarget.js';

const $ = id => document.getElementById(id);
let configGetter, getVRM, changed, refresh, revision=-1, fetching=false, pending, busy=false;
let library={selected:'builtin',models:[],motions:[]};
export const motionEntry = id => library.motions.find(item=>item.id===id);
function feedback(text,error=false) {
  const status=$('asset-status');status.textContent=text;status.classList.toggle('error',error);status.setAttribute('role',error?'alert':'status');
}
async function api(body) {
  const r=await fetch('/api/library',{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json','X-Pet-Token':configGetter().token}:{},body:body?JSON.stringify(body):undefined});
  const data=await r.json();if(!r.ok)throw new Error(data.error||'素材库读取失败');return data;
}
function upload(metadata,file) {
  const meta=new TextEncoder().encode(JSON.stringify(metadata));
  const prefix=new Uint8Array(4);new DataView(prefix.buffer).setUint32(0,meta.byteLength,true);
  return new Promise((resolve,reject)=>{
    const xhr=new XMLHttpRequest();xhr.open('POST','/api/library/upload');xhr.setRequestHeader('X-Pet-Token',configGetter().token);xhr.timeout=180000;
    xhr.upload.onprogress=e=>{if(e.lengthComputable)feedback(`正在保存到本机… ${Math.round(e.loaded/e.total*100)}%`);};
    xhr.onload=()=>{try{const data=JSON.parse(xhr.responseText);if(xhr.status!==200)throw new Error(data.error||'导入失败');resolve(data);}catch(error){reject(error);}};
    xhr.onerror=()=>reject(new Error('本机服务连接中断，请重试'));xhr.ontimeout=()=>reject(new Error('素材保存超时，请重试'));
    xhr.send(new Blob([prefix,meta,file]));
  });
}
function setBusy(value) {
  busy=value;$('asset-library').setAttribute('aria-busy',String(value));
  for(const el of $('asset-library').querySelectorAll('button,input,select')) el.disabled=value;
  refresh();
}
function render(data) {
  library=data;revision=data.revision;
  const select=$('model-select');select.replaceChildren(new Option('兰洛（内置）','builtin'));
  for(const model of data.models)select.add(new Option(model.name,model.id));
  select.value=data.selected;$('model-remove').disabled=busy||data.selected==='builtin';
  const list=$('fbx-list');list.replaceChildren();
  for(const motion of data.motions) {
    const row=document.createElement('div');row.className='custom-action-row';
    const play=document.createElement('button');play.type='button';play.className='custom-action-play';play.dataset.action=motion.id;play.setAttribute('aria-pressed','false');
    const title=document.createElement('span');title.textContent=motion.name;
    const detail=document.createElement('small');detail.textContent=`${motion.clipName||'动作片段'} · ${motion.duration.toFixed(1)} 秒`;
    play.append(title,detail);
    const remove=document.createElement('button');remove.type='button';remove.className='custom-action-remove';remove.textContent='移除';remove.setAttribute('aria-label',`移除 FBX ${motion.name}`);
    remove.onclick=()=>run(async()=>{render(await api({operation:'delete',id:motion.id}));feedback('已移除 FBX 动作');});
    row.append(play,remove);list.append(row);
  }
  $('fbx-empty').hidden=!!data.motions.length;
  changed(data);refresh();
}
async function run(task) {
  if(busy)return;setBusy(true);
  try{await task();}catch(error){feedback(error.message,true);}finally{setBusy(false);$('model-remove').disabled=library.selected==='builtin';}
}
function clearPending() {if(pending)disposeFBX(pending.asset);pending=null;$('fbx-import-options').hidden=true;$('fbx-mapping').replaceChildren();}
function mappingFromUI() {
  return Object.fromEntries([...$('fbx-mapping').querySelectorAll('select')].filter(el=>el.value).map(el=>[el.dataset.bone,el.value]));
}
export async function readVRM(buffer) {
  // Prevent a selected file from fetching remote textures or sibling files.
  if(buffer.byteLength<20)throw new Error('VRM 文件不完整');
  const view=new DataView(buffer);
  if(view.getUint32(0,true)!==0x46546c67 || view.getUint32(4,true)!==2 || view.getUint32(8,true)!==buffer.byteLength || view.getUint32(16,true)!==0x4e4f534a)throw new Error('不是有效的 VRM / GLB 文件');
  const length=view.getUint32(12,true);
  if(length>buffer.byteLength-20)throw new Error('VRM 文件不完整');
  const json=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,20,length)));
  if(!json.extensions?.VRM&&!json.extensions?.VRMC_vrm)throw new Error('文件缺少 VRM 人形描述');
  for(const entry of [...(json.buffers||[]),...(json.images||[])])if(entry.uri&&!entry.uri.startsWith('data:'))throw new Error('请导出纹理内嵌的 VRM 文件后重试');
  const loader=new GLTFLoader();loader.register(parser=>new VRMLoaderPlugin(parser));
  let gltf;
  try{gltf=await loader.parseAsync(buffer,'');}catch(error){throw new Error('VRM 加载失败，请检查人形骨骼与纹理是否完整后重新导出。',{cause:error});}
  const model=gltf.userData.vrm;
  if(!model?.humanoid?.getNormalizedBoneNode('hips')){VRMUtils.deepDispose(gltf.scene);throw new Error('模型没有有效的人形骨架');}
  model.update(0);model.scene.updateMatrixWorld(true);
  const bounds=new Box3().setFromObject(model.scene),height=bounds.max.y-bounds.min.y;
  if(!Number.isFinite(height)||height<.01||height>100){VRMUtils.deepDispose(model.scene);throw new Error('模型尺寸异常，请检查导出的单位和网格');}
  return model;
}
export async function initAssetLibrary(config,getModel,onChange,onRefresh) {
  configGetter=config;getVRM=getModel;changed=onChange;refresh=onRefresh;
  $('model-import').onchange=()=>run(async()=>{
    const input=$('model-import'),file=input.files[0];input.value='';if(!file)return;
    if(!/\.vrm$/i.test(file.name)||file.size>128*1024*1024)throw new Error('请选择不超过 128 MB 的 .vrm 文件');
    feedback('正在校验 VRM 模型与内嵌纹理…');
    const model=await readVRM(await file.arrayBuffer());
    VRMUtils.deepDispose(model.scene);
    const data=await upload({kind:'vrm',name:file.name},file);render(data);
    feedback('模型已导入；在模型列表中选择后点击“应用模型”，可设为默认角色。');
  });
  $('model-apply').onclick=()=>run(async()=>{render(await api({operation:'select',id:$('model-select').value}));feedback('正在应用模型，桌宠与设置窗口会同步切换；重启后保留。');});
  $('model-default').onclick=()=>run(async()=>{render(await api({operation:'select',id:'builtin'}));feedback('已恢复内置模型');});
  $('model-remove').onclick=()=>run(async()=>{render(await api({operation:'delete',id:$('model-select').value}));feedback('已移除模型；当前模型被移除时会恢复兰洛。');});
  $('model-select').onchange=()=>{$('model-remove').disabled=$('model-select').value==='builtin';};
  $('fbx-import').onchange=()=>run(async()=>{
    const input=$('fbx-import'),file=input.files[0];input.value='';if(!file)return;
    if(!getVRM())throw new Error('请等待人物加载完成后再导入 FBX');
    if(!/\.fbx$/i.test(file.name)||file.size>128*1024*1024)throw new Error('请选择不超过 128 MB 的 .fbx 文件');
    clearPending();feedback('正在读取 FBX 动画与骨骼…');
    const asset=parseFBX(await file.arrayBuffer());pending={file,asset};
    const clipSelect=$('fbx-clip');clipSelect.replaceChildren();
    asset.animations.forEach((clip,i)=>{
      const option=new Option(`${clip.name||'片段 '+(i+1)} · ${clip.duration.toFixed(1)} 秒`,String(i));
      option.disabled=!Number.isFinite(clip.duration)||clip.duration<.1||clip.duration>3600||!clip.tracks.length;
      if(option.disabled)option.text+='（不可播放）';clipSelect.add(option);
    });
    const firstPlayable=[...clipSelect.options].find(option=>!option.disabled);
    if(!firstPlayable){clearPending();throw new Error('这个 FBX 没有可播放的片段，请导出 0.1–3600 秒的烘焙动画');}
    clipSelect.value=firstPlayable.value;$('fbx-in-place').checked=true;
    const suggested=suggestMapping(asset),bones=sourceBones(asset);
    for(const bone of humanoidBones) {
      const label=document.createElement('label');label.textContent=bone;
      const select=document.createElement('select');select.dataset.bone=bone;select.add(new Option('不映射',''));
      for(const source of bones)select.add(new Option(source,source));select.value=suggested[bone]||'';
      label.append(select);$('fbx-mapping').append(label);
    }
    $('fbx-import-options').hidden=false;
    $('fbx-mapping-details').open=Object.keys(suggested).length<10;
    feedback(`识别到 ${asset.animations.length} 个片段，自动匹配 ${Object.keys(suggested).length} 根骨骼。确认片段与映射后保存。`);
  });
  $('fbx-cancel').onclick=()=>{clearPending();feedback('已取消本次 FBX 导入');};
  $('fbx-save').onclick=()=>run(async()=>{
    if(!pending)return;
    const mapping=mappingFromUI(),clip=Number($('fbx-clip').value);
    feedback('正在校验动作与当前模型的骨骼对应…');
    const inPlace=$('fbx-in-place').checked;
    const result=retargetClip(pending.asset,getVRM(),clip,mapping,{inPlace});
    const data=await upload({kind:'fbx',name:pending.file.name,mapping,clip,inPlace,duration:result.duration,clipName:result.name},pending.file);
    clearPending();render(data);feedback('FBX 动作已保存，点击动作即可播放；支持暂停、速度和循环。');
  });
  try{render(await api());}catch(error){feedback(error.message,true);}
}
export function updateAssetLibrary(state) {
  if(!configGetter||fetching||busy||revision===state.asset_revision)return;
  fetching=true;api().then(render).catch(error=>feedback(error.message,true)).finally(()=>{fetching=false;});
}
