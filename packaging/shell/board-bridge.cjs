'use strict';
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {pcmFromWave,windowsSpeechCommand}=require('./board-audio.cjs');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function pythonPath(root,platform=process.platform){return platform==='win32'?path.join(root,'python','python.exe'):path.join(root,'python','bin','python3');}
class BoardBridge {
 constructor({root,onAction,onConnection,onVoice,enabled=true}){
  Object.assign(this,{root,onAction,onConnection,onVoice,enabled});
  this.sequence=0;this.pending=new Map();this.frames=0;this.connected=false;
  this.closed=false;this.speechGeneration=0;this.voiceChild=null;this.worker=null;
 }
 connection(state){this.connected=!!state.connected;this.onConnection?.(state);}
 start(){
  if(this.closed||!this.enabled||this.worker)return;
  const bootstrap='import sys,runpy;sys.path.insert(0,sys.argv[1]);p=sys.argv.pop(1);sys.argv[0]=p+"/serial_worker.py";runpy.run_path(sys.argv[0],run_name="__main__")';
  const worker=spawn(pythonPath(this.root),['-I','-B','-u','-c',bootstrap,path.join(this.root,'board_runtime')],{stdio:['pipe','pipe','pipe'],windowsHide:true});
  this.worker=worker;let buffer='';
  this.connection({connected:false,message:'正在查找开发板…'});
  worker.stdout.on('data',chunk=>{
   if(this.worker!==worker)return;
   buffer+=chunk;for(;;){const at=buffer.indexOf('\n');if(at<0)break;const line=buffer.slice(0,at);buffer=buffer.slice(at+1);
    let event;try{event=JSON.parse(line);}catch{continue;}
    if(event.type==='result'){const request=this.pending.get(event.id);if(request){clearTimeout(request.timer);this.pending.delete(event.id);request.resolve(event);}}
    else if(event.type==='event')this.onAction?.(event.action);
    else if(event.type==='connection')this.connection(event);
    else if(event.type==='device')this.device=event;
   }
   if(buffer.length>65536)buffer='';
  });
  worker.stderr.on('data',chunk=>console.error('BOARD_WORKER',String(chunk).slice(0,500)));
  worker.stdin.on('error',()=>{});
  const ended=message=>{
   if(this.worker!==worker)return;this.worker=null;this.resolvePending();
   this.connection({connected:false,message});
   if(!this.closed&&this.enabled)this.retryTimer=setTimeout(()=>this.start(),3000);
  };
  worker.on('error',error=>ended('USB 组件无法启动：'+error.message));
  worker.on('exit',()=>ended('USB 组件已退出，正在重连…'));
 }
 resolvePending(){for(const req of this.pending.values()){clearTimeout(req.timer);req.resolve({ok:false,error:'USB disconnected'});}this.pending.clear();}
 stopWorker(){clearTimeout(this.retryTimer);const worker=this.worker;this.worker=null;this.resolvePending();if(worker){worker.stdin.end();const timer=setTimeout(()=>worker.kill(),500);worker.once('exit',()=>clearTimeout(timer));}}
 setEnabled(enabled){
  this.enabled=!!enabled;
  if(this.enabled)this.start();
  else{this.cancelSpeech();this.stopWorker();this.connection({connected:false,message:'已暂停开发板连接'});}
 }
 send(kind,data=Buffer.alloc(0)){
  if(this.closed||!this.enabled||!this.worker||this.worker.stdin.destroyed)return Promise.resolve({ok:false});
  if(this.pending.size>=8)return Promise.resolve({ok:false,error:'USB queue full'});
  const id=++this.sequence;
  return new Promise(resolve=>{
   const timer=setTimeout(()=>{this.pending.delete(id);resolve({ok:false,error:'USB timeout'});},15000);
   this.pending.set(id,{resolve,timer});
   this.worker.stdin.write(JSON.stringify({id,kind,data:Buffer.from(data).toString('base64')})+'\n',error=>{if(error){clearTimeout(timer);this.pending.delete(id);resolve({ok:false});}});
  });
 }
 async stream(window){
  this.window=window;
  while(!this.closed&&!window.isDestroyed()){
   const started=Date.now();
   if(!this.enabled||!this.worker){await sleep(400);continue;}
   try{
    const ready=await window.webContents.executeJavaScript('!!window.petDiagnostics?.().ready');
    if(ready){
     const picture=await window.webContents.capturePage();
     const jpeg=picture.resize({width:320,height:320,quality:'good'}).toJPEG(76);
     const result=await this.send(1,jpeg);
     if(result.ok)this.frames++;
    }
   }catch(error){if(!this.closed)console.error('BOARD_FRAME',error.message);}
   await sleep(Math.max(20,100-(Date.now()-started)));
  }
 }
 cancelSpeech(){this.speechGeneration++;this.voiceChild?.kill();this.voiceChild=null;this.onVoice?.(false);if(this.connected)void this.send(3,Buffer.from('stop_audio'));}
 run(file,args,env=process.env){return new Promise((resolve,reject)=>{
  const child=spawn(file,args,{stdio:['ignore','ignore','pipe'],windowsHide:true,env});this.voiceChild=child;let message='';
  const timeout=setTimeout(()=>child.kill(),90000);
  child.stderr.on('data',data=>{message=(message+data).slice(-1000);});
  child.on('error',error=>{clearTimeout(timeout);if(this.voiceChild===child)this.voiceChild=null;reject(error);});
  child.on('exit',code=>{clearTimeout(timeout);if(this.voiceChild===child)this.voiceChild=null;code===0?resolve():reject(new Error(message.slice(0,250)||'Speech cancelled'));});
 });}
 async speak(text){
  this.cancelSpeech();const generation=this.speechGeneration;
  if(!this.connected)throw new Error('请连接开发板后再朗读。');
  if(typeof text!=='string'||!text.trim()||text.length>1600)throw new Error('朗读文字为空或过长。');
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'lanluo-board-'));
  try{
   await fs.writeFile(path.join(temp,'text.txt'),text,'utf8');
   if(process.platform==='win32'){
    const command=windowsSpeechCommand(temp);await this.run(command.file,command.args,command.env);
   }else if(process.platform==='darwin'){
    await this.run('/usr/bin/say',['-v','Tingting','-r','165','-f',path.join(temp,'text.txt'),'-o',path.join(temp,'voice.aiff')]);
    if(generation!==this.speechGeneration)return;
    await this.run('/usr/bin/afconvert',['-f','WAVE','-d','LEI16@16000','-c','1',path.join(temp,'voice.aiff'),path.join(temp,'voice.wav')]);
   }else throw Error('此平台暂不支持开发板语音');
   if(generation!==this.speechGeneration)return;
   const pcm=pcmFromWave(await fs.readFile(path.join(temp,'voice.wav')));
   this.onVoice?.(true);
   for(let at=0;at<pcm.length;at+=6400){
    if(generation!==this.speechGeneration)return;
    const result=await this.send(2,pcm.subarray(at,at+6400));
    if(!result.ok)throw new Error('开发板音频连接中断。');
   }
   if(generation!==this.speechGeneration)return;
   const end=await this.send(4);if(!end.ok)throw Error('开发板音频结束确认失败');
   await sleep(1800);
  }catch(error){if(generation===this.speechGeneration)throw error;}
  finally{
   if(generation===this.speechGeneration)this.onVoice?.(false);
   await fs.rm(temp,{recursive:true,force:true});
  }
 }
 close(){this.cancelSpeech();this.closed=true;this.stopWorker();}
}
module.exports={BoardBridge,pythonPath};
