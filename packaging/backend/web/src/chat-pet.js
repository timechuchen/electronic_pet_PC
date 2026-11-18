// Only the pet window speaks, preventing duplicate audio in other windows.
let talking=false, utterance=null, speakingSince=0, bubbleTimer, watchdog, lastCompleted='';
const bridge=window.lanluoDesktop;
const synth=window.speechSynthesis;
const boardMode=new URLSearchParams(location.search).get('board')==='1';
let speechGeneration=0;
function voiceStatus(status){bridge?.chat({type:'voice-status',status}).catch(()=>{});}
function bubble(text,busy=false){
  const element=document.getElementById('ai-bubble');if(!element)return;
  clearTimeout(bubbleTimer);element.textContent=text;element.hidden=!text;element.classList.toggle('waiting',busy);
  if(text&&!busy)bubbleTimer=setTimeout(()=>{if(!talking)element.hidden=true;},20000);
}
function stop(){
  speechGeneration++;clearTimeout(watchdog);talking=false;utterance=null;synth?.cancel();voiceStatus('');
}
async function speak(text){
  stop();bubble(text);
  if(boardMode)return;
  const generation=speechGeneration;
  if(bridge?.chat){
    try{const result=await bridge.chat({type:'board-speak',text});if(generation!==speechGeneration||result.handled)return;}catch{}
    if(generation!==speechGeneration)return;
  }
  if(!synth||!window.SpeechSynthesisUtterance){voiceStatus('这台设备暂不支持朗读，文字聊天正常可用。');return;}
  const voices=synth.getVoices();
  const voice=voices.find(v=>/^zh[-_]CN$/i.test(v.lang)&&v.localService)||voices.find(v=>/^zh/i.test(v.lang)&&v.localService);
  if(!voice){voiceStatus('未找到系统中文声音，请在系统设置中安装中文语音后重试。');return;}
  const line=new SpeechSynthesisUtterance(text);utterance=line;line.voice=voice;line.lang=voice.lang;line.rate=.95;
  line.onstart=()=>{if(utterance!==line)return;talking=true;speakingSince=performance.now();voiceStatus('兰洛正在朗读…');};
  const finish=()=>{if(utterance!==line)return;talking=false;utterance=null;clearTimeout(watchdog);voiceStatus('');bubbleTimer=setTimeout(()=>bubble(''),8000);};
  line.onend=finish;
  line.onerror=event=>{if(utterance!==line)return;finish();if(!['canceled','interrupted'].includes(event.error))voiceStatus('朗读未完成，可点击“朗读这条”重试。');};
  synth.speak(line);
  watchdog=setTimeout(()=>{if(utterance===line){stop();voiceStatus('朗读已停止，可重新播放。');}},120000);
}
export function speechMouth(now){return talking?.12+.22*Math.abs(Math.sin((now-speakingSince)*.014)):0;}
export function initChatPet(){
  if(!bridge?.chat)return;
  const el=document.createElement('button');el.id='ai-bubble';el.className='ai-bubble';el.hidden=true;el.title='打开聊天';el.onclick=()=>bridge.chat({type:'open'});document.body.append(el);
  bridge.onSpeak(message=>{if(typeof message.boardTalking==='boolean'){talking=message.boardTalking;speakingSince=performance.now();if(!boardMode)voiceStatus(talking?'兰洛正在开发板上朗读…':'');return;}if(message.stop){stop();return;}if(message.text)speak(message.text);});
  bridge.onChat(state=>{
    if(state.pending?.kind==='chat'&&!state.completed){bubble('我在认真听，等我一下…',true);return;}
    if(state.completed&&state.completed!==lastCompleted){
      lastCompleted=state.completed;const message=state.history.find(m=>m.id===state.completed);
      if(message){bubble(message.content);if(state.autoSpeak)speak(message.content);}return;
    }
    if(!state.pending&&el.classList.contains('waiting'))bubble(state.error?'这次没能连上，打开聊天看看吧。':'');
    if(!state.history.length&&!state.pending){bubble('');stop();}
  });
  // Populate the OS voice list before the first user-triggered utterance.
  synth?.getVoices();
  window.addEventListener('beforeunload',stop);
}
