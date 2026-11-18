const $=id=>document.getElementById(id);
let getConfig,onChange,seenRevision=-1,loading=false,documentData={version:1,actions:[]};
function feedback(message,error=false){const el=$('action-library-status');el.textContent=message;el.classList.toggle('error',error);el.setAttribute('role',error?'alert':'status');}
async function api(body){
 const response=await fetch('/api/actions',{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json','X-Pet-Token':getConfig().token}:{},body:body?JSON.stringify(body):undefined});
 const result=await response.json();if(!response.ok)throw new Error(result.error||'动作库读取失败');return result;
}
function download(payload,name){const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function render(document){
 documentData=document;const list=$('custom-action-list');list.replaceChildren();
 $('custom-action-count').textContent=`${document.actions.length} / 32`;
 $('action-library-export').disabled=!document.actions.length;
 for(const action of document.actions){
  const row=window.document.createElement('div');row.className='custom-action-row';
  const play=window.document.createElement('button');play.type='button';play.dataset.action=action.id;play.className='custom-action-play';
  const title=window.document.createElement('span');title.textContent=action.name;
  const duration=window.document.createElement('small');duration.textContent=`${action.duration} 秒 · 点击播放`;
  play.append(title,duration);play.setAttribute('aria-pressed','false');
  const remove=window.document.createElement('button');remove.type='button';remove.textContent='移除';remove.className='custom-action-remove';remove.setAttribute('aria-label',`移除动作“${action.name}”`);
  remove.addEventListener('click',async()=>{
   if(!window.confirm(`移除“${action.name}”？可先导出动作库保留副本。`))return;
   remove.disabled=true;
   try{render(await api({operation:'delete',id:action.id}));feedback(`已移除“${action.name}”`);}catch(error){feedback(error.message,true);remove.disabled=false;}
  });
  row.append(play,remove);list.append(row);
 }
 $('custom-action-empty').hidden=document.actions.length>0;onChange();
}
export async function initActionLibrary(configGetter,refresh){
 getConfig=configGetter;onChange=refresh;
 $('action-library-import').addEventListener('change',async()=>{
  const input=$('action-library-import'),file=input.files[0];if(!file)return;input.disabled=true;feedback('正在校验动作…');
  try{
   if(file.size>1000000)throw new Error('动作文件不能超过 1 MB');
   let document;try{document=JSON.parse(await file.text());}catch{throw new Error('JSON 格式不正确，请检查逗号、引号和括号');}
   const updated=await api({operation:'import',document});render(updated);feedback('导入成功，点击动作即可播放；重启后仍会保留。');
  }catch(error){feedback(error.message,true);}finally{input.disabled=false;input.value='';}
 });
 $('action-library-template').addEventListener('click',async()=>{
  try{const response=await fetch('/actions.example.json');if(!response.ok)throw new Error('示例读取失败');download(await response.json(),'lanluo-action-example.json');feedback('已导出跳跃示例，可修改名称、时长和关键帧后导入。');}catch(error){feedback(error.message,true);}
 });
 $('action-library-export').addEventListener('click',()=>download(documentData,'lanluo-actions.json'));
 try{render(await api());}catch(error){feedback(error.message,true);}
}
export function updateActionLibrary(state){
 if(!getConfig||loading||state.action_revision===seenRevision)return;
 loading=true;const revision=state.action_revision;
 api().then(document=>{render(document);seenRevision=revision;}).catch(error=>{feedback(error.message,true);seenRevision=revision;}).finally(()=>{loading=false;});
}
