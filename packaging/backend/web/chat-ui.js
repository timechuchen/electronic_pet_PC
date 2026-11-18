const $=id=>document.getElementById(id);
const bridge=window.lanluoDesktop;
let state, rendered='', submitting=false, formDirty=false;
async function call(request){
  const response=await bridge.chat(request);
  if(!response.ok)throw new Error(response.error||'操作未完成，请重试。');
  return response.state;
}
function report(error){$('status').textContent=error.message;$('status').classList.add('error');}
function settingsOpen(open){$('connection-panel').hidden=!open;$('settings-toggle').setAttribute('aria-expanded',String(open));}
function message(role,text,id,pending=false){
  const row=document.createElement('article');row.className=`message ${role}${pending?' pending':''}`;
  const who=document.createElement('span');who.className='who';who.textContent=role==='user'?'你':'兰洛';
  const bubble=document.createElement('div');bubble.className='bubble';bubble.textContent=text;row.append(who,bubble);
  if(role==='assistant'&&id){const read=document.createElement('button');read.className='read-button';read.textContent='朗读这条';read.setAttribute('aria-label','朗读兰洛的这条回复');read.onclick=()=>call({type:'speak',id}).catch(report);row.append(read);}
  return row;
}
function render(next){
  if(!next)return;state=next;
  const list=$('messages'),signature=JSON.stringify([next.history,next.pending,next.hasKey]);
  if(signature!==rendered){
    const nearBottom=list.scrollHeight-list.scrollTop-list.clientHeight<90;rendered=signature;
    list.replaceChildren();
    if(!next.history.length&&!next.pending?.text){
      const empty=document.createElement('div');empty.className='empty';
      const title=document.createElement('p');title.className='welcome';title.textContent='我在这里，听你说。';
      const hint=document.createElement('p');hint.textContent=next.hasKey?'一件小事，一点烦恼，或只是打个招呼。':'先在连接设置中保存 DeepSeek Key，就可以开始和兰洛聊天。';empty.append(title,hint);
      const suggestions=document.createElement('div');suggestions.className='suggestions';
      for(const text of ['今天有点累，想和你聊聊。','我完成了一件很棒的事！','你好呀，兰洛。']){const b=document.createElement('button');b.textContent=text;b.onclick=()=>{$('message-input').value=text;if(!state.hasKey)settingsOpen(true);else $('message-input').focus();};suggestions.append(b);}
      empty.append(suggestions);list.append(empty);
    }
    for(const m of next.history)list.append(message(m.role,m.content,m.id));
    if(next.pending?.text)list.append(message('user',next.pending.text,null,true));
    if(nearBottom||next.pending)list.scrollTop=list.scrollHeight;
  }
  const busy=!!next.pending;
  $('messages').setAttribute('aria-busy',String(busy));
  $('message-input').disabled=!next.hasKey||busy;
  $('send-message').disabled=!next.hasKey||busy;
  $('cancel-request').hidden=!busy;
  $('send-message').hidden=busy;
  for(const id of ['save-settings','test-key','remove-key','api-key','model','auto-speak'])$(id).disabled=busy;
  $('test-key').disabled=busy||!next.hasKey;$('remove-key').disabled=busy||!next.hasKey;
  $('key-status').textContent=next.hasKey?'已加密保存':'未保存';
  $('api-key').placeholder=next.hasKey?'留空保留现有 Key':'粘贴你的 API Key';
  if(!formDirty){$('model').value=next.model;$('auto-speak').checked=next.autoSpeak;}
  $('status').classList.toggle('error',!!next.error);
  $('status').textContent=next.error||(busy?(next.pending.kind==='test'?'正在验证连接…':next.pending.recovering?'刚才的回复没有传完整，兰洛正在重新回应…':'兰洛正在想怎么回应你…'):next.notice)||(!next.hasKey?'先保存 Key，再开始聊天。':'');
}
$('settings-toggle').onclick=()=>settingsOpen($('connection-panel').hidden);
$('settings-form').oninput=()=>{formDirty=true;};
$('settings-form').onsubmit=async event=>{
  event.preventDefault();$('save-settings').disabled=true;
  try{const next=await call({type:'configure',data:{key:$('api-key').value,model:$('model').value,autoSpeak:$('auto-speak').checked}});$('api-key').value='';formDirty=false;render(next);if(next.hasKey)$('message-input').focus();}catch(error){report(error);$('save-settings').disabled=false;}
};
$('test-key').onclick=()=>call({type:'test'}).then(render).catch(report);
$('remove-key').onclick=()=>call({type:'configure',data:{removeKey:true,model:state.model,autoSpeak:state.autoSpeak}}).then(next=>{$('api-key').value='';formDirty=false;render(next);}).catch(report);
$('chat-form').onsubmit=async event=>{
  event.preventDefault();if(submitting||state?.pending)return;
  const text=$('message-input').value.trim();if(!text)return;
  submitting=true;
  try{const next=await call({type:'send',text});render(next);if(!next.error&&next.history.at(-2)?.content===text)$('message-input').value='';}catch(error){report(error);}finally{submitting=false;$('message-input').focus();}
};
$('message-input').onkeydown=event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();$('chat-form').requestSubmit();}};
$('cancel-request').onclick=()=>call({type:'cancel'}).then(render).catch(report);
$('stop-speech').onclick=()=>call({type:'stop-speech'}).catch(report);
$('clear-history').onclick=()=>$('clear-dialog').showModal();
$('clear-dialog').onclose=()=>{if($('clear-dialog').returnValue==='clear')call({type:'clear'}).then(render).catch(report);};
if(bridge?.chat){
  bridge.onChat(render);
  bridge.onSpeak(message=>{if(message.status!==undefined)$('voice-status').textContent=message.status;});
  call({type:'snapshot'}).then(next=>{render(next);if(!next.hasKey)settingsOpen(true);else $('message-input').focus();}).catch(report);
}else{report(new Error('请从独立桌宠的“聊天”入口打开，浏览器预览不支持安全保存 Key。'));for(const el of document.querySelectorAll('button,input,select,textarea'))el.disabled=true;}
