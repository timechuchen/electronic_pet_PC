import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRMUtils } from '@pixiv/three-vrm';
import { loadDance, parseFBX, disposeFBX, retargetClip } from './retarget.js';
import { initAssetLibrary, updateAssetLibrary, motionEntry, readVRM } from './asset-library.js';
import { initCompanion, updateCompanion, initDesktop } from './companion.js';
import { CameraCapture } from './capture.js';
import { PoseRig, faceExpressions } from './pose-rig.js';
import { initActionLibrary, updateActionLibrary } from './custom-actions.js';
import {initChatPet, speechMouth} from './chat-pet.js';

const $ = id => document.getElementById(id);
const boardMode=new URLSearchParams(location.search).get('board')==='1';
if(boardMode)document.body.classList.add('board-mode');
const desktopMode=new URLSearchParams(location.search).get('desktop')==='1';
if(desktopMode){document.body.classList.add('desktop-mode');initDesktop();initChatPet();}
document.getElementById('chat-open').addEventListener('click',()=>window.lanluoDesktop?.chat({type:'open'}));
document.getElementById('chat-open').hidden=!window.lanluoDesktop?.chat;
const icons = {
  wave:'M8 13V5a1.5 1.5 0 0 1 3 0v6m0-1V3a1.5 1.5 0 0 1 3 0v8m0-1V5a1.5 1.5 0 0 1 3 0v8m0-2V9a1.5 1.5 0 0 1 3 0v7a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-3L4 13a1.5 1.5 0 0 1 2.5-1.5L8 13M3 4 1 2m3 5H1m21-3 1-2',
  eye:'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  wink:'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM6 10h4m5-1v2M8 15s4 4 8 0',
  smile:'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM8 9v2m8-2v2M7 14s5 7 10 0',
  nod:'M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0ZM8 10h.1m6 0h.1M9 14h4m8-10v14m-3-3 3 3 3-3',
  shake:'M18 12a6 6 0 1 1-12 0 6 6 0 0 1 12 0ZM9 11h.1m6 0h.1M10 15h4M2 5l-2 3 2 3m20-6 2 3-2 3M7 2h10',
  music:'M9 18V5l12-3v14M9 18a3 3 0 1 1-3-3c1.7 0 3 1.3 3 3Zm12-2a3 3 0 1 1-3-3c1.7 0 3 1.3 3 3ZM9 9l12-3',
  jump:'M12 18V3m-5 5 5-5 5 5M4 17v4h16v-4',
  feather:'M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5zM16 8 2 22M17.5 15H9',
  pause:'M8 5v14m8-14v14', reset:'M3 9a9 9 0 1 1 1 9M3 3v6h6',
};
document.querySelectorAll('[data-icon]').forEach(el => {
  el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${icons[el.dataset.icon]}"></path></svg>`;
});
const names = {wave:'挥手',blink:'眨眼',wink:'单眼眨眼',smile:'微笑',nod:'点头',shake:'摇头',dance:'街舞',jump:'跳跃',grace:'轻舞'};
const messages = {wave:'嗨！今天过得怎么样？',blink:'眨眨眼，把疲惫都赶走。',wink:'这是只属于我们的小默契。',smile:'见到你，就有好心情。',nod:'嗯嗯，我在认真听呢。',shake:'唔，让我再想一想。',dance:'跟着节奏，一起放松一下吧！',grace:'这支舞，只为你一个人跳。'};
let config, state, vrm, danceSamplers, danceClip, renderer, scene, camera, controls;
let ready = false, connected = false, danceError = false, toastTimer, speechTimer, height=1.6;
let events, lastFrame = performance.now(), capture, poseRig;
let characterBaseY=0, loadedModelId=null, requestedModelId=null, modelSequence=0;
const fbxClips=new Map(), fbxPending=new Map(), fbxErrors=new Set();
const samplers=clip=>clip.tracks.map(track=>{const dot=track.name.lastIndexOf('.');return {node:vrm.scene.getObjectByName(track.name.slice(0,dot)),property:track.name.slice(dot+1),sample:track.createInterpolant()};}).filter(t=>t.node);
async function ensureMotion(id) {
  if(fbxClips.has(id))return fbxClips.get(id);
  if(fbxPending.has(id))return fbxPending.get(id);
  const entry=motionEntry(id),model=vrm;
  if(!entry||!model||fbxErrors.has(id))return null;
  const task=(async()=>{
    let asset;
    try{
      const response=await fetch(entry.url);if(!response.ok)throw new Error('动作文件不存在');
      asset=parseFBX(await response.arrayBuffer());
      const clip=retargetClip(asset,model,entry.clip,entry.mapping,{inPlace:entry.inPlace!==false});
      if(model!==vrm||!motionEntry(id))return null;
      const result={clip,samplers:samplers(clip)};fbxClips.set(id,result);return result;
    }catch(error){if(model===vrm){fbxErrors.add(id);toast(`FBX 动作加载失败：${error.message}`);}return null;}
    finally{disposeFBX(asset);if(fbxPending.get(id)===task)fbxPending.delete(id);refreshEnabled();}
  })();
  fbxPending.set(id,task);return task;
}
function assetsChanged(document) {
  for(const id of fbxClips.keys())if(!document.motions.some(a=>a.id===id))fbxClips.delete(id);
  const model=document.models.find(m=>m.id===document.selected);
  if(scene&&requestedModelId!==document.selected) switchCharacter(model?.url||'/assets/兰洛.vrm',document.selected);
}
async function switchCharacter(url,id) {
  requestedModelId=id;
  if(trackingBusy())capture.stop();
  try{await loadCharacter(url,id);}catch(error){
    if(requestedModelId!==id)return;
    requestedModelId=null;
    ready=!!vrm;$('loading').hidden=!!vrm;refreshEnabled();
    toast(`模型加载失败，${vrm?'保留当前角色':'可在素材库恢复兰洛'}：${error.message}`);
    if(!vrm){$('loading-title').textContent='模型加载失败';$('loading-detail').textContent=error.message;$('retry').hidden=false;}
  }
}
const trackingSource=crypto.randomUUID();let relaySequence=0,relayAt=0,relayInFlight=false;
function relayPose(active,bones={},expressions={}){if(!config)return;fetch('/api/tracking',{method:'POST',headers:{'Content-Type':'application/json','X-Pet-Token':config.token},body:JSON.stringify({source:trackingSource,sequence:++relaySequence,active,bones,expressions}),keepalive:!active}).catch(()=>{}).finally(()=>{relayInFlight=false;});}
const trackingBusy=()=>capture && ['loading','active'].includes(capture.phase);
const targets = new Map(), expressionValues = {}, euler = new THREE.Euler();
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function toast(message) { $('toast').textContent=message; $('toast').hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('toast').hidden=true,5000); }
function refreshEnabled() {
  document.querySelectorAll('[data-action]').forEach(b => b.disabled = trackingBusy() || !ready || !connected || (b.dataset.action === 'dance' && (!danceClip || danceError)) || fbxErrors.has(b.dataset.action) || (b.closest('#asset-library')?.getAttribute('aria-busy')==='true'));
  $('pause').disabled=!ready || !connected || trackingBusy();
  $('reset').disabled=!ready || !connected;
  $('camera-toggle').disabled=!ready || !connected;
  $('camera-device').disabled=trackingBusy();
  for (const id of ['speed','loop','auto-blink','idle-motion']) $(id).disabled=!connected || trackingBusy();
}
async function command(payload) {
  try {
    const response = await fetch('/api/command', {method:'POST',headers:{'Content-Type':'application/json','X-Pet-Token':config.token},body:JSON.stringify(payload)});
    const result=await response.json();
    if (!response.ok) throw new Error(result.error || '操作失败');
    state=result; updateStatus(); return true;
  } catch(error) { toast(`操作未完成：${error.message}`); return false; }
}
async function trigger(name) {
  if (trackingBusy() || !ready || !connected || (name==='dance' && !danceClip)) return;
  if(name.startsWith('fbx_')){const model=vrm;if(!await ensureMotion(name)||model!==vrm||!ready||trackingBusy())return;}
  const payload={type:'action',name};
  if(name==='dance') payload.duration=danceClip.duration;
  if(await command(payload)) {
    $('speech').textContent=name==='jump'?'跳一下，让好心情也升起来。':messages[name]||'看，我学会了一个新动作。'; clearTimeout(speechTimer);
    speechTimer=setTimeout(()=>$('speech').textContent='我就在这里，随时陪你。',['dance','grace'].includes(name)?9000:4200);
  }
}
function updateStatus() {
  if (!state) return;
  updateCompanion(state);
  updateActionLibrary(state);
  updateAssetLibrary(state);
  const actions=[state.body,state.face].filter(Boolean);
  $('action-status').textContent=(trackingBusy()||state.tracking)?'摄像头跟随中':state.paused?'已暂停':actions.length?actions.map(a=>(a.source==='music'?'音乐 · ':a.source==='idle'?'待机 · ':'')+(a.label||names[a.name]||a.name)).join(' + '):'自在待机';
  $('pause-label').textContent=state.paused?'继续':'暂停';
  $('pause').setAttribute('aria-label',state.paused?'继续播放':'暂停播放');
  const active=state.body || state.face;
  $('action-time').textContent=trackingBusy()?'实时模仿':active?`${active.time.toFixed(1)} / ${active.duration.toFixed(1)} s`:'随时可以互动';
  $('progress').style.width=active?`${Math.min(100,active.time/active.duration*100)}%`:'0%';
  for(const b of document.querySelectorAll('[data-action]')) { const selected=actions.some(a=>a.name===b.dataset.action); b.classList.toggle('active',selected); b.setAttribute('aria-pressed',String(selected)); }
  for(const [id,key] of [['loop','loop'],['auto-blink','auto_blink'],['idle-motion','idle_motion']]) $(id).checked=state[key];
  if (document.activeElement !== $('speed')) $('speed').value=state.speed;
  $('speed-value').textContent=`${Number(state.speed).toFixed(2).replace(/0$/,'')}×`;
}
function cameraView(close=false) {
  if (!camera) return;
  const aspect=$('viewport').clientWidth/$('viewport').clientHeight;
  const framing=Math.max(1,0.83/aspect);
  controls.target.set(0,height*(close?.80:.49),0);
  camera.position.set(0,height*(close?.84:.54),height*(close?.90:2.55)*framing);
  controls.update();
  $('view-tag').textContent=close?'表情特写':'全身视角';
  $('view-full').classList.toggle('selected',!close);$('view-face').classList.toggle('selected',close);
  $('view-full').setAttribute('aria-pressed',String(!close));$('view-face').setAttribute('aria-pressed',String(close));
}
function createScene() {
  const host=$('viewport');
  renderer=new THREE.WebGLRenderer({antialias:true,alpha:!boardMode,preserveDrawingBuffer:boardMode,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.35;
  if(boardMode)renderer.setClearColor(0x000000,1);
  host.appendChild(renderer.domElement);
  if(boardMode)window.boardJPEG=()=>{renderer.render(scene,camera);return renderer.domElement.toDataURL('image/jpeg',0.78).split(',')[1];};
  renderer.domElement.setAttribute('role','img');renderer.domElement.setAttribute('aria-label','兰洛的实时三维人物');
  scene=new THREE.Scene();
  camera=new THREE.PerspectiveCamera(32,1,0.05,100);
  controls=new OrbitControls(camera,renderer.domElement);
  controls.enableDamping=true;controls.dampingFactor=.08;controls.enablePan=false;
  controls.minDistance=.4;controls.maxDistance=8;controls.maxPolarAngle=Math.PI*.57;
  scene.add(new THREE.HemisphereLight(0xfffaf0,0xb4c8c0,2.3));
  const key=new THREE.DirectionalLight(0xfff9ed,2.2);key.position.set(2,4,4);scene.add(key);
  const fill=new THREE.DirectionalLight(0xd5e7ff,1);fill.position.set(-3,2,-2);scene.add(fill);
  // A soft contact shadow: generated canvas texture, no external image assets.
  const shadowCanvas=document.createElement('canvas');shadowCanvas.width=shadowCanvas.height=128;
  const ctx=shadowCanvas.getContext('2d');const gradient=ctx.createRadialGradient(64,64,0,64,64,64);
  gradient.addColorStop(0,'rgba(61,89,66,0.20)');gradient.addColorStop(.45,'rgba(61,89,66,0.10)');gradient.addColorStop(1,'rgba(61,89,66,0)');ctx.fillStyle=gradient;ctx.fillRect(0,0,128,128);
  const shadow=new THREE.Mesh(new THREE.PlaneGeometry(1.2,.8),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(shadowCanvas),transparent:true,depthWrite:false}));
  shadow.rotation.x=-Math.PI/2;shadow.position.y=.005;if(!desktopMode)scene.add(shadow);
  const resize=new ResizeObserver(()=>{const w=host.clientWidth,h=host.clientHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();});resize.observe(host);
  renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();ready=false;refreshEnabled();toast('图形上下文已中断，请刷新页面恢复。');});
  cameraView();
}
async function loadCharacter(url=config.model,id=config.model_id) {
  const sequence=++modelSequence;
  ready=false;refreshEnabled();$('render-status').textContent='正在加载模型…';
  const response=await fetch(url);if(!response.ok)throw new Error('模型文件读取失败');
  const next=await readVRM(await response.arrayBuffer());
  if(sequence!==modelSequence){VRMUtils.deepDispose(next.scene);return;}
  VRMUtils.rotateVRM0(next);
  next.scene.traverse(object=>{object.frustumCulled=false;});
  next.update(0);next.scene.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(next.scene);
  const size=bounds.getSize(new THREE.Vector3());
  if(!Number.isFinite(size.y)||size.y<.01||size.y>100){VRMUtils.deepDispose(next.scene);throw new Error('模型尺寸异常');}
  const nextRig=new PoseRig(next);
  if(vrm){scene.remove(vrm.scene);VRMUtils.deepDispose(vrm.scene);}
  vrm=next;height=size.y;loadedModelId=id;
  // Place arbitrary exported origins on the floor and center the character.
  vrm.scene.position.x-=(bounds.min.x+bounds.max.x)/2;
  vrm.scene.position.z-=(bounds.min.z+bounds.max.z)/2;
  vrm.scene.position.y-=bounds.min.y;
  characterBaseY=vrm.scene.position.y;
  scene.add(vrm.scene);targets.clear();
  for(const key of Object.keys(expressionValues))delete expressionValues[key];
  fbxClips.clear();fbxPending.clear();fbxErrors.clear();danceClip=null;danceSamplers=null;danceError=false;
  for(const [name,bone] of Object.entries(vrm.humanoid.normalizedHumanBones))targets.set(name,{node:bone.node,current:bone.node.quaternion.clone()});
  poseRig=nextRig;
  camera.near=Math.max(.001,height/100);camera.far=Math.max(100,height*20);camera.updateProjectionMatrix();
  controls.minDistance=height*.2;controls.maxDistance=height*6;
  cameraView(false);ready=true;$('loading').hidden=true;$('render-status').textContent='已就绪 · 3D';refreshEnabled();
  window.petDiagnostics=()=>({ready,connected,modelId:loadedModelId,fbxLoaded:[...fbxClips.keys()],height,rootY:vrm.scene.position.y-characterBaseY,rootTarget:state?.root_y,tracking:{phase:capture?.phase,hasBody:!!capture?.result?.world,hasFace:!!capture?.result?.matrix,resultAt:capture?.resultAt,streamActive:!!capture?.stream?.active},danceDuration:danceClip?.duration,danceTracks:danceClip?.tracks.length,body:state?.body,face:state?.face,paused:state?.paused,expressions:Object.fromEntries(['blink','blinkLeft','blinkRight','happy','aa'].map(k=>[k,vrm.expressionManager?.getValue(k)])),bones:Object.fromEntries(['head','rightUpperArm','rightLowerArm','rightHand','leftUpperArm','leftUpperLeg','rightUpperLeg','leftLowerLeg','rightLowerLeg'].map(k=>[k,vrm.humanoid.getNormalizedBoneNode(k)?.quaternion.toArray()]))});
  try {
    const clip=await loadDance(config.dance,next);
    if(sequence!==modelSequence)return;
    danceClip=clip;danceSamplers=samplers(clip);
    $('dance-detail').textContent=`律动 · ${Math.round(danceClip.duration)} 秒`;refreshEnabled();
  } catch(error) { if(sequence!==modelSequence)return;danceError=true;$('dance-detail').textContent='素材未加载';toast(`舞蹈素材未能加载：${error.message}`);refreshEnabled(); }
}
const smooth=x=>{x=THREE.MathUtils.clamp(x,0,1);return x*x*(3-2*x);};
function animate(now) {
  requestAnimationFrame(animate);
  const dt=Math.min((now-lastFrame)/1000,.1);lastFrame=now;
  if (!renderer) return;
  if (vrm && state) {
    vrm.humanoid.resetNormalizedPose();
    const bones=trackingBusy()?{leftUpperArm:[0,0,1.22],rightUpperArm:[0,0,-1.22]}:state.bones;
    for(const [bone,rotation] of Object.entries(bones)) {
      const target=targets.get(bone);if(target)target.node.quaternion.setFromEuler(vrm.meta.metaVersion==='0'?euler.set(...rotation):euler.set(-rotation[0],rotation[1],-rotation[2]));
    }
    const dance=!trackingBusy()&&!state.tracking&&(state.body?.name==='dance'||state.body?.name.startsWith('fbx_'))?state.body:null;
    const activeSamplers=dance?.name==='dance'?danceSamplers:fbxClips.get(dance?.name)?.samplers;
    if(dance?.name.startsWith('fbx_')&&!activeSamplers&&ready)void ensureMotion(dance.name);
    if(dance && activeSamplers) {
      const base=new Map([...targets].map(([name,b])=>[name,{q:b.node.quaternion.clone(),p:b.node.position.clone()}]));
      // Sample every property explicitly. Mixer caching would skip unchanged values
      // after resetNormalizedPose and cause intermittent rest-pose frames.
      for(const track of activeSamplers)track.node[track.property].fromArray(track.sample.evaluate(dance.time));
      const blend=smooth(dance.time/.35)*smooth((dance.duration-dance.time)/.35);
      for(const [name,bone] of targets){const rest=base.get(name);bone.node.quaternion.slerp(rest.q,1-blend);bone.node.position.lerpVectors(rest.p,bone.node.position,blend);}
    }
    vrm.scene.position.y=characterBaseY+(!trackingBusy()&&!state.tracking?(state.root_y||0)*height:0);
    const tracking=capture?.phase==='active';
    const remote=!trackingBusy()&&state.tracking?.source!==trackingSource?state.tracking:null;
    const age=performance.now()-(capture?.resultAt||0);
    const trackingWeight=tracking?THREE.MathUtils.clamp(1-(age-250)/650,0,1):0;
    if(trackingWeight>0)poseRig.apply(capture.result,{mirror:$('camera-mirror').checked,legs:$('camera-legs').checked,weight:trackingWeight});
    if(remote)for(const [name,q] of Object.entries(remote.bones)){const bone=targets.get(name);if(bone)bone.node.quaternion.fromArray(q);}
    const follow=1-Math.exp(-dt*(tracking||remote?14:24));
    for(const bone of targets.values()){bone.current.slerp(bone.node.quaternion,follow);bone.node.quaternion.copy(bone.current);}
    const expressions={blinkRight:0,aa:0,...state.expressions,...(remote?.expressions||{})};
    if(desktopMode&&!remote&&!tracking&&!state.paused)expressions.aa=Math.max(expressions.aa||0,speechMouth(now));
    const facial=trackingWeight>0?faceExpressions(capture.result?.blends,$('camera-mirror').checked):null;
    if(facial)for(const [name,value] of Object.entries(facial))expressions[name]=THREE.MathUtils.lerp(expressions[name]||0,value,trackingWeight);
    for(const [name,value] of Object.entries(expressions)){expressionValues[name]=tracking?THREE.MathUtils.lerp(expressionValues[name]||0,value,1-Math.exp(-dt*24)):value;vrm.expressionManager?.setValue(name,expressionValues[name]);}
    if(tracking&&!relayInFlight&&now-relayAt>80){relayAt=now;relayInFlight=true;relayPose(true,Object.fromEntries([...targets].map(([name,bone])=>[name,bone.node.quaternion.toArray()])),expressions);}
    vrm.update((state.paused&&!remote&&!tracking)||!connected?0:dt*state.speed);
  }
  controls.update();renderer.render(scene,camera);
}
async function start() {
  refreshEnabled();
  try {
    const response=await fetch('/api/config');if(!response.ok)throw new Error('无法连接 Python 服务');config=await response.json();
    createScene();requestAnimationFrame(animate);
    await initCompanion(()=>config,toast);
    await initActionLibrary(()=>config,refreshEnabled);
    events=new EventSource('/api/events');
    events.onopen=async()=>{try{const r=await fetch('/api/config');if(r.ok)config=await r.json();}catch{ /* EventSource handles retry. */ }};
    events.onmessage=event=>{state=JSON.parse(event.data);connected=true;$('connection').textContent='已连接';$('connection').classList.remove('disconnected');refreshEnabled();updateStatus();};
    events.onerror=()=>{connected=false;if(trackingBusy())capture.stop();$('connection').textContent='连接已断开';$('connection').classList.add('disconnected');$('action-status').textContent='等待 Python 服务重新连接';refreshEnabled();};
    if(reducedMotion)await command({type:'settings',idle_motion:false,auto_blink:false});
    await switchCharacter(config.model,config.model_id);
    await initAssetLibrary(()=>config,()=>vrm,assetsChanged,refreshEnabled);
  } catch(error) {
    console.error(error);$('loading-title').textContent='暂时没能见到兰洛';$('loading-detail').textContent=error.message;$('loading').querySelector('.spinner').hidden=true;$('retry').hidden=false;
  }
}
document.querySelector('.control-panel').addEventListener('click',event=>{const button=event.target.closest('button[data-action]');if(button&&!button.disabled)trigger(button.dataset.action);});
$('pause').addEventListener('click',()=>command({type:'pause'}));
$('reset').addEventListener('click',async()=>{if(trackingBusy())capture.stop();if(await command({type:'reset'})){$('speech').textContent='好啦，回到最放松的状态。';clearTimeout(speechTimer);}});
$('speed').addEventListener('input',()=>{$('speed-value').textContent=`${Number($('speed').value).toFixed(2)}×`;});
$('speed').addEventListener('change',()=>command({type:'settings',speed:Number($('speed').value)}));
for(const [id,key] of [['loop','loop'],['auto-blink','auto_blink'],['idle-motion','idle_motion']])$(id).addEventListener('change',()=>command({type:'settings',[key]:$(id).checked}));
$('view-full').addEventListener('click',()=>cameraView(false));$('view-face').addEventListener('click',()=>cameraView(true));$('view-reset').addEventListener('click',()=>cameraView($('view-face').classList.contains('selected')));
$('retry').addEventListener('click',()=>location.reload());
document.addEventListener('keydown',event=>{
  if(event.repeat||event.ctrlKey||event.metaKey||event.altKey||['INPUT','TEXTAREA','SELECT','BUTTON','A'].includes(event.target.tagName))return;
  const actions=['wave','blink','wink','smile','nod','shake','dance','jump','grace'];
  if(/^[1-9]$/.test(event.key)){event.preventDefault();trigger(actions[Number(event.key)-1]);}
  else if(event.code==='Space'&&ready&&connected&&!trackingBusy()){event.preventDefault();command({type:'pause'});}
  else if(event.key==='Escape'&&ready&&connected){if(trackingBusy())capture.stop();command({type:'reset'});}
});
const connections=[[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28]];
function cameraStatus(phase,message){
  $('camera-status').textContent=message;
  const busy=['loading','active'].includes(phase);
  $('camera-toggle').textContent=busy?(phase==='loading'?'取消开启':'停止跟随'):'开启摄像头跟随';
  $('camera-toggle').classList.toggle('running',busy);
  $('camera-toggle').setAttribute('aria-pressed',String(busy));
  $('camera-preview').hidden=!busy;$('capture-options').hidden=!busy&&phase!=='error'&&$('camera-device').options.length<2;$('capture-help').hidden=!busy;
  $('camera-calibrate').disabled=phase!=='active';
  document.querySelector('.capture-toolbar').classList.toggle('error',phase==='error');
  document.body.classList.toggle('tracking-mode',busy);
  if(phase==='active'){$('speech').textContent='我会跟着你一起动。';clearTimeout(speechTimer);}
  if(!busy){relayPose(false);$('camera-metrics').textContent='等待识别';$('tracking-quality').textContent='等待识别';if(poseRig)poseRig.resetCalibration();}
  refreshEnabled();updateStatus();
}
capture=new CameraCapture($('camera-video'),{status:cameraStatus,result:result=>{
  const body=result.landmarks?.some(p=>(p.visibility??0)>.6),face=!!result.matrix;
  const status=body&&face?'动作与表情已识别':body?'身体已识别':face?'表情已识别':'请让人物进入画面';
  if($('camera-status').textContent!==status)$('camera-status').textContent=status;
  $('camera-metrics').textContent=`识别耗时 ${Math.round(result.ms)} ms`;
  $('tracking-quality').textContent=body?'已识别':'寻找人物';
  const canvas=$('camera-overlay'),video=$('camera-video');
  canvas.width=video.videoWidth||640;canvas.height=video.videoHeight||480;
  document.querySelector('.camera-image').style.aspectRatio=`${canvas.width}/${canvas.height}`;
  const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);
  if(result.landmarks){const points=result.landmarks;ctx.strokeStyle='#a3ffd0';ctx.fillStyle='#ffffff';ctx.lineWidth=3;
    for(const [a,b] of connections)if(points[a].visibility>.55&&points[b].visibility>.55){ctx.beginPath();ctx.moveTo(points[a].x*canvas.width,points[a].y*canvas.height);ctx.lineTo(points[b].x*canvas.width,points[b].y*canvas.height);ctx.stroke();}
    for(const p of points)if(p.visibility>.55){ctx.beginPath();ctx.arc(p.x*canvas.width,p.y*canvas.height,3,0,Math.PI*2);ctx.fill();}
  }
},devices:devices=>{
  const selected=$('camera-device').value;$('camera-device').replaceChildren(new Option('默认摄像头',''));
  for(const [i,device] of devices.entries())$('camera-device').add(new Option(device.label||`摄像头 ${i+1}`,device.deviceId));
  $('camera-device').value=selected;
}});
$('camera-toggle').addEventListener('click',async()=>{
  if(trackingBusy()){capture.stop();return;}
  if(!ready||!connected)return;
  if(await command({type:'reset'})){poseRig.resetCalibration();capture.start($('camera-device').value);}
});
$('camera-calibrate').addEventListener('click',()=>{const fresh=capture.result&&performance.now()-capture.resultAt<600&&(capture.result.matrix||capture.result.world);toast(fresh&&poseRig.calibrate()?'已设为正面姿态。':'请先让头部与肩膀进入镜头。');});
$('camera-mirror').addEventListener('change',()=>{poseRig?.resetCalibration();document.querySelector('.camera-image').classList.toggle('mirrored',$('camera-mirror').checked);});
document.querySelector('.camera-image').classList.add('mirrored');
window.addEventListener('beforeunload',()=>{events?.close();capture.dispose();});
start();
