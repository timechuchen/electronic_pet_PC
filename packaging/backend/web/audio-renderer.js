let stream,context,worker,source,processor,ready=false,busy=false,stopped=true,timer,lastResult=0;
const bridge=window.lanluoDesktop;
function report(status,message,score=0,level=0){bridge?.reportAudio({status,message,score,level});}
async function stop(){stopped=true;clearInterval(timer);stream?.getTracks().forEach(t=>t.stop());stream=null;processor?.disconnect();source?.disconnect();await context?.close().catch(()=>{});context=null;worker?.terminate();worker=null;ready=busy=false;}
async function start(capture){
 try{
  await stop();stopped=false;report('starting','正在启动本机系统音乐识别…');
  const pending=new Worker('/audio-worker.js');worker=pending;
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('音乐模型加载超时')),30000);pending.onmessage=({data})=>{if(data.type==='ready'){clearTimeout(timeout);resolve();}else if(data.type==='error'){clearTimeout(timeout);reject(new Error(data.message));}};pending.onerror=()=>{clearTimeout(timeout);reject(new Error('音乐识别引擎加载失败'));};pending.postMessage({type:'init'});});
  if(stopped)return;
  // Electron's trusted display-media handler supplies Windows WASAPI loopback.
  const media=await capture;
  if(stopped){media.getTracks().forEach(t=>t.stop());return;}
  stream=media;stream.getVideoTracks().forEach(track=>track.stop());
  if(!stream.getAudioTracks().length)throw new Error('当前系统没有提供回环音频。请检查默认播放设备。');
  stream.getAudioTracks()[0].addEventListener('ended',()=>{if(!stopped){report('error','系统音频已停止，请重新开启。');stop();}});
  context=new AudioContext({sampleRate:16000});await context.audioWorklet.addModule('/audio-worklet.js');
  source=context.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));processor=new AudioWorkletNode(context,'local-samples');
  source.connect(processor);processor.connect(context.destination);
  worker.onmessage=({data})=>{busy=false;lastResult=performance.now();if(data.type==='result')report('listening','正在识别系统音频',data.score,data.level);else if(data.type==='error'){report('error',data.message);stop();}};
  processor.port.onmessage=({data})=>{if(!stopped&&!busy){busy=true;worker.postMessage({type:'samples',samples:data,rate:16000},[data.buffer]);}};
  await context.resume();lastResult=performance.now();
  timer=setInterval(()=>{const elapsed=performance.now()-lastResult;if(elapsed>15000&&busy){report('error','音乐识别响应超时，请重新开启。');stop();}else if(elapsed>3500){report('listening','暂未检测到系统声音');}},1000);
  report('listening','正在识别系统音频');
 }catch(error){capture.then(media=>media.getTracks().forEach(t=>t.stop()),()=>{});await stop();report('error',`无法监听系统音频：${error.message}`);}
}
window.startSystemAudio=()=>{const capture=navigator.mediaDevices.getDisplayMedia({video:true,audio:true});capture.catch(()=>{});return start(capture);};
bridge?.onAudioCommand(command=>{if(command==='stop')stop();});
bridge?.audioReady();
window.addEventListener('beforeunload',()=>stop());
