'use strict';
const {app,BrowserWindow,ipcMain,Menu,Tray,nativeImage,session,desktopCapturer,dialog,systemPreferences,safeStorage}=require('electron');
const {ChatService}=require('./chat-service.cjs');
const {BoardBridge}=require('./board-bridge.cjs');
const {spawn}=require('node:child_process');
const fs=require('node:fs');const path=require('node:path');
const testData=process.argv.find(x=>x.startsWith('--test-data='))?.slice(12);
app.setName('兰洛桌宠');
app.setPath('userData',testData?path.resolve(testData):path.join(app.getPath('appData'),'LanluoDesktop-v1.1'));
const smoke=process.argv.includes('--smoke-test');
const root=app.isPackaged?process.resourcesPath:path.resolve(__dirname,'..');
const backend=path.join(root,'backend');
let python,pet,settings,tray,audioWindow,audioHelper,baseURL,nativeToken,pollTimer,quitting=false,lastShow=-1,audioStarting=false;
let dragOrigin=null,audioDesired=false,audioReady=false,serverLog,bridgeSession,serverExit=false;
let chatWindow,chatService,boardWindow,boardBridge;
let boardConnection={connected:false,message:'正在查找开发板…'};
const lock=app.requestSingleInstanceLock();
if(!lock){app.quit();}else{
 app.on('second-instance',()=>{if(pet){pet.show();pet.focus();}});
 app.whenReady().then(start).catch(error=>{console.error('START_FAILED',error.stack);dialog.showErrorBox('兰洛启动失败',error.message);app.quit();});
}
function localURL(url){try{return new URL(url).origin===baseURL;}catch{return false;}}
function trusted(event,window){return !!window&&!window.isDestroyed()&&event.sender===window.webContents&&event.senderFrame===window.webContents.mainFrame&&localURL(event.senderFrame.url);}
async function api(route,body){const response=await fetch(baseURL+route,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json','X-Pet-Token':nativeToken}:{'X-Pet-Token':nativeToken},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(5000)});if(!response.ok)throw new Error(`本机服务返回 ${response.status}`);return response.json();}
function preferences(){try{return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'window.json'),'utf8'));}catch{return {};}}
function saveWindow(){if(!pet||pet.isDestroyed())return;fs.writeFileSync(path.join(app.getPath('userData'),'window.json'),JSON.stringify({...preferences(),bounds:pet.getBounds(),top:pet.isAlwaysOnTop()}));}
function windowOptions(extra={}){return{show:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false,session:bridgeSession},...extra};}
function secure(window){window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',(event,url)=>{if(!localURL(url))event.preventDefault();});}
function openSettings(){
 if(settings&&!settings.isDestroyed()){settings.show();settings.focus();return;}
 settings=new BrowserWindow(windowOptions({width:1280,height:930,minWidth:760,minHeight:600,title:'兰洛设置',backgroundColor:'#f6f7f2'}));
 settings.setMenuBarVisibility(false);secure(settings);settings.loadURL(baseURL);
 settings.once('ready-to-show',()=>settings.show());settings.on('closed',()=>{settings=null;});
}
function openChat(){
 if(chatWindow&&!chatWindow.isDestroyed()){chatWindow.show();chatWindow.focus();return;}
 chatWindow=new BrowserWindow(windowOptions({width:440,height:720,minWidth:360,minHeight:520,title:'和兰洛聊聊',backgroundColor:'#f6f7f2'}));
 chatWindow.setMenuBarVisibility(false);secure(chatWindow);chatWindow.loadURL(baseURL+'/chat.html');
 chatWindow.once('ready-to-show',()=>chatWindow.show());chatWindow.on('closed',()=>{chatWindow=null;});
}
function publishChat(state){for(const win of [pet,chatWindow,boardWindow])if(win&&!win.isDestroyed())win.webContents.send('chat-state',state);}
function stopSpeech(){boardBridge?.cancelSpeech();for(const win of [pet,boardWindow])if(win&&!win.isDestroyed())win.webContents.send('chat-speak',{stop:true});}
ipcMain.handle('pet-chat',async(event,request)=>{
 if(!chatService||!request||(!trusted(event,chatWindow)&&!trusted(event,pet)&&!trusted(event,settings)&&!trusted(event,boardWindow)))return {ok:false,error:'此窗口不能访问聊天。'};
 try{
  const type=request.type;
  if(type==='board-speak'&&trusted(event,pet)){if(!boardBridge?.connected)return {ok:true,handled:false};await boardBridge.speak(String(request.text||''));return {ok:true,handled:true};}
  if(type==='snapshot')return {ok:true,state:chatService.snapshot()};
  if(type==='open'){openChat();return {ok:true};}
  if(type==='voice-status'&&trusted(event,pet)){if(chatWindow&&!chatWindow.isDestroyed())chatWindow.webContents.send('chat-speak',{status:String(request.status||'').slice(0,100)});return {ok:true};}
  if(!trusted(event,chatWindow))throw new Error('请在聊天窗口操作。');
  if(type==='configure'){await chatService.configure(request.data);if(!chatService.config.autoSpeak)stopSpeech();}
  else if(type==='send'){stopSpeech();await chatService.request(request.text);}
  else if(type==='test')await chatService.request('',true);
  else if(type==='cancel'){chatService.cancel();stopSpeech();}
  else if(type==='clear'){chatService.clear();stopSpeech();}
  else if(type==='stop-speech')stopSpeech();
  else if(type==='speak'){
   const message=chatService.history.find(m=>m.id===request.id&&m.role==='assistant');
   if(message&&pet&&!pet.isDestroyed())pet.webContents.send('chat-speak',{text:message.content});
  }else throw new Error('未知聊天操作。');
  return {ok:true,state:chatService.snapshot()};
 }catch(error){return {ok:false,error:error.code?'本机配置无法保存，请检查用户目录权限。':error.message};}
});
function petMenu(){return Menu.buildFromTemplate([
 {label:boardConnection.connected?'开发板已连接 · '+boardConnection.port:(boardConnection.message||'等待 USB 开发板'),enabled:false},
 {label:'自动连接开发板',type:'checkbox',checked:boardBridge?.enabled??preferences().boardEnabled!==false,click:item=>{const pref=preferences();pref.boardEnabled=item.checked;fs.writeFileSync(path.join(app.getPath('userData'),'window.json'),JSON.stringify(pref));boardBridge?.setEnabled(item.checked);}},
 {label:'测试开发板语音',enabled:!!boardConnection.connected,click:()=>boardBridge?.speak('你好，我是兰洛，很高兴在这里陪你。').catch(e=>dialog.showErrorBox('语音提示',e.message))},
 {label:'查看开发板预览',click:()=>boardWindow?.show()},
 {label:'和兰洛聊聊…',click:openChat},
 {label:'设置…',click:openSettings},{label:'显示桌宠',click:()=>{pet.show();pet.focus();}},
 {label:'始终置顶',type:'checkbox',checked:pet.isAlwaysOnTop(),click:item=>{pet.setAlwaysOnTop(item.checked);saveWindow();}},
 {label:'鼠标穿透（从此菜单恢复）',type:'checkbox',checked:!!pet.clickThrough,click:item=>{pet.clickThrough=item.checked;pet.setIgnoreMouseEvents(item.checked,{forward:true});}},
 {type:'separator'},{label:'退出桌宠',click:()=>app.quit()},
]);}
async function start(){
 console.log('APP_START');
 fs.mkdirSync(app.getPath('userData'),{recursive:true});
 serverLog=fs.openSync(path.join(app.getPath('userData'),'backend.log'),'a');
 const runtime=process.platform==='win32'?path.join(root,'python','python.exe'):path.join(root,'python','bin','python3');
 if(!fs.existsSync(runtime))throw new Error('程序运行环境不完整，请完整解压运行包，不要只移动可执行文件。');
 const script=path.join(backend,'app.py');
 const bootstrap='import sys,runpy;sys.path.insert(0,sys.argv[1]);p=sys.argv.pop(1);sys.argv[0]=p+"/app.py";runpy.run_path(sys.argv[0],run_name="__main__")';
 python=spawn(runtime,['-I','-B','-X','utf8','-u','-c',bootstrap,backend,'--hosted','--no-browser','--port','0','--data-dir',app.getPath('userData')],{cwd:backend,windowsHide:true,stdio:['pipe','pipe','pipe']});
 python.stderr.on('data',data=>{if(serverLog!==null&&serverLog!==undefined)fs.writeSync(serverLog,data);});
 python.on('exit',()=>{serverExit=true;if(!quitting){dialog.showErrorBox('兰洛服务已停止','请重新打开应用。详细信息在用户配置目录的 backend.log 中。');app.quit();}});
 const ready=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(new Error('本机服务启动超时，请查看 backend.log。')),20000);python.on('error',reject);python.stdout.on('data',chunk=>{text+=chunk;for(;;){const newline=text.indexOf('\n');if(newline<0)break;const line=text.slice(0,newline);text=text.slice(newline+1);if(line.startsWith('LANLUO_READY ')){clearTimeout(timer);try{resolve(JSON.parse(line.slice(13)));}catch(error){reject(error);}}}});});
 baseURL=ready.url;nativeToken=ready.nativeToken;
 console.log('BACKEND_READY');
 chatService=new ChatService({dataDir:app.getPath('userData'),storage:safeStorage,emit:publishChat,
   capture:async()=>(await api('/api/native')).interaction_revision,react:({action,expression,revision})=>api('/api/ai-reaction',{action,expression,revision})});
 bridgeSession=session.fromPartition('lanluo-local');
 bridgeSession.setPermissionRequestHandler(async(webContents,permission,callback,details)=>{
   if(!localURL(webContents.getURL()))return callback(false);
   if(permission==='media'&&settings&&webContents===settings.webContents&&!(details.mediaTypes||[]).includes('audio')){
     if(process.platform==='darwin')return callback(await systemPreferences.askForMediaAccess('camera'));
     return callback(true);
   }
   callback(!!(permission==='display-capture'&&audioWindow&&webContents===audioWindow.webContents&&audioDesired));
 });
 bridgeSession.setPermissionCheckHandler((webContents,permission)=>!!(webContents&&localURL(webContents.getURL())&&((permission==='media'&&settings&&webContents===settings.webContents)||(permission==='display-capture'&&audioWindow&&webContents===audioWindow.webContents&&audioDesired))));
 bridgeSession.setDisplayMediaRequestHandler(async(request,callback)=>{
   if(process.platform!=='win32'||!audioDesired||!audioWindow||request.frame!==audioWindow.webContents.mainFrame)return callback({});
   try{const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:0,height:0}});if(!sources.length)throw new Error('没有可用的音频输出');callback({video:sources[0],audio:'loopback'});}catch(error){callback({});reportError(error.message);}
 });
 const pref=preferences();const bounds=pref.bounds||{width:360,height:470};
 pet=new BrowserWindow(windowOptions({...bounds,minWidth:220,minHeight:300,frame:false,transparent:true,backgroundColor:'#00000000',hasShadow:false,resizable:true,alwaysOnTop:pref.top!==false,skipTaskbar:true,title:'兰洛桌宠'}));
 pet.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true});secure(pet);
 pet.webContents.on('context-menu',()=>petMenu().popup({window:pet}));
 pet.on('moved',saveWindow);pet.on('resized',saveWindow);pet.on('closed',()=>app.quit());
 await pet.loadURL(baseURL+'/?desktop=1');
 console.log('PET_WINDOW_READY');
 if(!pref.bounds){const {screen}=require('electron');const area=screen.getPrimaryDisplay().workArea;pet.setPosition(area.x+area.width-390,area.y+area.height-490);}
 pet.show();
 const traySource=nativeImage.createFromPath(path.join(__dirname,'tray.png'));
 const trayImage=process.platform==='darwin'?traySource.resize({width:18,height:18,quality:'best'}):traySource;
 if(process.platform==='darwin'){
  trayImage.addRepresentation({scaleFactor:2,buffer:traySource.resize({width:36,height:36,quality:'best'}).toPNG()});
  trayImage.setTemplateImage(true);
 }
 tray=new Tray(trayImage);tray.setToolTip('兰洛桌宠');tray.setContextMenu(petMenu());tray.on('click',()=>{pet.show();pet.focus();});tray.on('right-click',()=>tray.setContextMenu(petMenu()));
 Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'兰洛桌宠',submenu:[{label:'和兰洛聊聊…',accelerator:'CmdOrCtrl+J',click:openChat},{label:'设置…',accelerator:'CmdOrCtrl+,',click:openSettings},{type:'separator'},{role:'quit'}]},{role:'editMenu'}]));
 pollTimer=setInterval(poll,600);
 if(!process.argv.includes('--no-board'))await startBoard().catch(error=>{boardConnection={connected:false,message:'开发板组件未启动：'+error.message};console.error('BOARD_START',error.message);});
 if(process.argv.includes('--board-smoke'))void boardSmoke();
 if(smoke)runSmoke();
}
async function poll(){
 if(quitting||!baseURL)return;
 try{const state=await api('/api/native');if(state.show!==lastShow){lastShow=state.show;pet.show();}
 const enabled=!!state.audio_requested;if(enabled!==audioDesired){audioDesired=enabled;if(enabled)startAudio();else stopAudio();}
 }catch{}
}
function reportError(message){api('/api/audio',{status:'error',message:String(message).slice(0,230),score:0,level:0}).catch(()=>{});}
function startAudio(){
 if(audioStarting)return;audioStarting=true;
 if(process.platform==='darwin'){
   const executable=path.join(backend,'native','兰洛桌宠.app','Contents','MacOS','Lanluo');
   audioHelper=spawn(executable,['--audio-only','--url',baseURL,'--native-token',nativeToken],{stdio:['ignore','ignore',serverLog]});
   audioHelper.once('error',error=>{audioStarting=false;reportError(error.message);});
   audioHelper.once('exit',()=>{audioHelper=null;audioStarting=false;if(audioDesired&&!quitting)reportError('系统音频组件已退出，请重新开启。');});
 }else{
   audioWindow=new BrowserWindow(windowOptions({show:false,width:200,height:120}));secure(audioWindow);audioReady=false;
   audioWindow.webContents.on('render-process-gone',()=>reportError('音乐识别组件意外退出，请重新开启。'));
   audioWindow.loadURL(baseURL+'/audio.html').catch(error=>reportError(error.message));
 }
}
function stopAudio(){
 if(audioHelper){const old=audioHelper;audioHelper=null;old.kill();}
 if(audioWindow&&!audioWindow.isDestroyed()){audioWindow.webContents.send('audio-command','stop');const old=audioWindow;audioWindow=null;setTimeout(()=>{if(!old.isDestroyed())old.destroy();},200);}
 audioStarting=false;audioReady=false;
}
ipcMain.on('audio-ready',event=>{if(trusted(event,audioWindow)&&audioDesired){audioReady=true;audioWindow.webContents.executeJavaScript('window.startSystemAudio()',true).catch(error=>reportError(error.message));}});
ipcMain.on('audio-sample',(event,data)=>{if(!trusted(event,audioWindow)||!audioDesired||!data||!['listening','error','starting'].includes(data.status))return;api('/api/audio',data).catch(()=>{});});
ipcMain.on('pet-action',(event,message)=>{
 if(!trusted(event,pet)||!message)return;
 switch(message.type){
 case 'chat':openChat();break;
 case 'control':openSettings();break;
 case 'close':app.quit();break;
 case 'top':pet.setAlwaysOnTop(!pet.isAlwaysOnTop());saveWindow();break;
 case 'clickThrough':pet.clickThrough=!pet.clickThrough;pet.setIgnoreMouseEvents(pet.clickThrough,{forward:true});break;
 case 'dragStart':dragOrigin=pet.getPosition();break;
 case 'drag':if(dragOrigin&&Number.isFinite(message.dx)&&Number.isFinite(message.dy))pet.setPosition(Math.round(dragOrigin[0]+message.dx),Math.round(dragOrigin[1]+message.dy));break;
 }
 if(tray&&!tray.isDestroyed())tray.setContextMenu(petMenu());
});
async function runSmoke(){
 const started=Date.now();const timer=setInterval(async()=>{
   if(Date.now()-started>25000){clearInterval(timer);console.error('SMOKE_TIMEOUT');app.exit(1);return;}
   try{const diag=await pet.webContents.executeJavaScript('window.petDiagnostics?.()');if(!diag?.ready||!diag.danceDuration)return;clearInterval(timer);
   const initiallyHidden=!settings;
   await pet.webContents.executeJavaScript('window.lanluoDesktop.send({type:"control"})');
   while(!settings)await new Promise(resolve=>setTimeout(resolve,25));
   if(settings.webContents.isLoading())await new Promise(resolve=>settings.webContents.once('did-finish-load',resolve));
   const settingsReady=await settings.webContents.executeJavaScript('document.querySelector("#preset-name")!==null');
   const audioModel=await pet.webContents.executeJavaScript(`new Promise((resolve,reject)=>{
     const worker=new Worker('/audio-worker.js');const timeout=setTimeout(()=>{worker.terminate();reject(new Error('Audio worker timeout'));},30000);
     worker.onerror=e=>{clearTimeout(timeout);worker.terminate();reject(new Error(e.message));};
     worker.onmessage=({data})=>{if(data.type==='ready')worker.postMessage({type:'samples',samples:new Float32Array(16000),rate:16000});else{clearTimeout(timeout);worker.terminate();if(data.type==='error')reject(new Error(data.message));else resolve(data);}};worker.postMessage({type:'init'});
   })`);
   const image=await pet.webContents.capturePage();fs.writeFileSync(path.join(app.getPath('userData'),'smoke-pet.png'),image.toPNG());
   settings.close();
   const result={packaged:app.isPackaged,platform:process.platform,arch:process.arch,ready:diag.ready,dance:diag.danceDuration,settingsInitiallyHidden:initiallyHidden,settingsOpened:settingsReady,petSurvivesSettingsClose:!pet.isDestroyed(),transparent:pet.getBackgroundColor(),pythonBundled:true,audioModel};
   console.log(JSON.stringify(result));fs.writeFileSync(path.join(app.getPath('userData'),'smoke-result.json'),JSON.stringify(result,null,2));
   if(!initiallyHidden||!settingsReady||audioModel.score>0.1)process.exitCode=1;app.quit();
   }catch(error){console.error(error.stack);process.exitCode=1;app.quit();}
 },350);
}
app.on('window-all-closed',()=>{if(!quitting)app.quit();});
app.on('before-quit',()=>{quitting=true;boardBridge?.close();chatService?.cancel();clearInterval(pollTimer);audioDesired=false;stopAudio();if(python&&!serverExit){python.stdin.end();python.kill();}if(serverLog){try{fs.closeSync(serverLog);}catch{}serverLog=null;}});
app.on('activate',()=>{if(pet){pet.show();pet.focus();}});

async function boardCommand(data){
 const config=await (await fetch(baseURL+'/api/config')).json();
 const r=await fetch(baseURL+'/api/command',{method:'POST',headers:{'Content-Type':'application/json','X-Pet-Token':config.token},body:JSON.stringify(data)});
 if(!r.ok)throw new Error('动作未能同步');return r.json();
}
async function startBoard(){
 boardWindow=new BrowserWindow(windowOptions({show:false,width:320,height:320,useContentSize:true,resizable:false,frame:false,backgroundColor:'#08141b',title:'开发板实时画面'}));
 secure(boardWindow);
 boardWindow.on('close',event=>{if(!quitting){event.preventDefault();boardWindow.hide();}});
 await boardWindow.loadURL(baseURL+'/?desktop=1&board=1');
 boardBridge=new BoardBridge({root,enabled:preferences().boardEnabled!==false,onAction:async action=>{
   try{
    if(action==='chat'){openChat();return;}
    if(['pause','reset'].includes(action))await boardCommand({type:action});
    else if(['wave','blink','wink','smile','nod','shake','dance','jump','grace'].includes(action))await boardCommand({type:'action',name:action});
   }catch(e){console.error('BOARD_ACTION',e.message);}
 },onConnection:state=>{boardConnection=state;console.log('BOARD_CONNECTION',JSON.stringify(state));if(tray&&!tray.isDestroyed())tray.setContextMenu(petMenu());},
 onVoice:talking=>{for(const win of [pet,boardWindow])if(win&&!win.isDestroyed())win.webContents.send('chat-speak',{boardTalking:talking});}});
 if(boardBridge.enabled)boardBridge.start();else boardConnection={connected:false,message:'已暂停开发板连接'};
 void boardBridge.stream(boardWindow);
}
async function boardSmoke(){
 const folder=path.join(app.getPath('userData'),'board-test');fs.mkdirSync(folder,{recursive:true});
 const result={};
 try{
  const until=Date.now()+60000;while(boardBridge.frames<10&&Date.now()<until)await new Promise(r=>setTimeout(r,200));
  if(boardBridge.frames<10)throw new Error('No board frames acknowledged');
  const frameStart=boardBridge.frames,timeStart=Date.now();
  await new Promise(r=>setTimeout(r,5000));
  result.measuredFPS=Number(((boardBridge.frames-frameStart)*1000/(Date.now()-timeStart)).toFixed(1));
  await boardCommand({type:'reset'});await new Promise(r=>setTimeout(r,500));
  const first=await boardWindow.webContents.capturePage();fs.writeFileSync(path.join(folder,'live-idle.png'),first.toPNG());
  await boardCommand({type:'action',name:'wave'});await new Promise(r=>setTimeout(r,900));
  const second=await boardWindow.webContents.capturePage();fs.writeFileSync(path.join(folder,'live-wave.png'),second.toPNG());
  result.waveChanged=!first.toPNG().equals(second.toPNG());
  await boardBridge.send(3,Buffer.from('nod'));await new Promise(r=>setTimeout(r,200));
  const state=await (await fetch(baseURL+'/api/state')).json();result.reverseTouchProtocol=state.body?.name==='nod';
  await boardCommand({type:'pause'});await new Promise(r=>setTimeout(r,150));
  result.paused=(await (await fetch(baseURL+'/api/state')).json()).paused;
  await boardCommand({type:'reset'});
  const revision=(await api('/api/native')).interaction_revision;
  await api('/api/ai-reaction',{action:'wave',expression:'smile',revision});
  publishChat({history:[{id:'board-test',role:'assistant',content:'你好呀，我是兰洛。现在我也可以在小屏幕里陪你了。'}],completed:'board-test',pending:null,autoSpeak:false});
  await new Promise(r=>setTimeout(r,600));
  fs.writeFileSync(path.join(folder,'live-dialogue.png'),(await boardWindow.webContents.capturePage()).toPNG());
  result.dialogueRendered=await boardWindow.webContents.executeJavaScript('document.querySelector("#ai-bubble")?.textContent.includes("你好呀")');
  const resumed=async baseline=>{const until=Date.now()+30000;while((!boardBridge.connected||boardBridge.frames<baseline+10)&&Date.now()<until)await new Promise(r=>setTimeout(r,200));if(!boardBridge.connected||boardBridge.frames<baseline+10)throw Error('USB reconnect did not recover frames');};
  let baseline=boardBridge.frames;boardBridge.worker.kill();await new Promise(r=>setTimeout(r,700));await resumed(baseline);result.workerRestartRecovered=true;
  boardBridge.setEnabled(false);await new Promise(r=>setTimeout(r,800));result.pauseReleasedWorker=!boardBridge.worker&&!boardBridge.connected;
  result.desktopStillReady=await pet.webContents.executeJavaScript('!!window.petDiagnostics?.().ready');
  baseline=boardBridge.frames;boardBridge.setEnabled(true);await resumed(baseline);result.resumeRecovered=true;
  await boardBridge.speak('你好，我是兰洛。很高兴在这里陪你。');result.audioTransferred=true;
  await boardBridge.send(3,Buffer.from('status'));result.frames=boardBridge.frames;result.device=boardBridge.device;
  result.aiTest='synthetic reply; no paid API request';
  if(!result.waveChanged||!result.reverseTouchProtocol||!result.paused||!result.dialogueRendered||!result.pauseReleasedWorker||!result.desktopStillReady)throw Error('Interaction check failed');
  fs.writeFileSync(path.join(folder,'board-smoke.json'),JSON.stringify(result,null,2));console.log('BOARD_SMOKE_PASS',JSON.stringify(result));
 }catch(e){fs.writeFileSync(path.join(folder,'board-smoke-error.txt'),e.stack);console.error('BOARD_SMOKE_FAIL',e.stack);process.exitCode=1;}
 finally{await boardCommand({type:'reset'}).catch(()=>{});app.quit();}
}
