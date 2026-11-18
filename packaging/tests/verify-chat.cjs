const {_electron:electron}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const packaged=process.argv.includes('--packaged');
const mockStorage=process.argv.includes('--mock-storage');
const root=path.resolve(__dirname,'..'),output=path.join(root,'test-data',packaged?(mockStorage?'chat-packaged-mock-storage':'chat-packaged'):'chat-dev');fs.mkdirSync(output,{recursive:true});
const profile=fs.mkdtempSync(path.join(output,'profile-'));
const executablePath=packaged?path.join(root,'build/Lanluo-darwin-arm64/Lanluo.app/Contents/MacOS/Lanluo'):path.join(root,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const args=[...(packaged?[]:[path.join(root,'shell')]),...(process.argv.includes('--no-board')?['--no-board']:[]),...(process.env.LANLUO_TEST_NO_SANDBOX==='1'?['--no-sandbox']:[]),`--test-data=${profile}`];
let app;const result={packaged,storageMocked:mockStorage,provider:'mocked; no paid API calls',profile};
async function open(){
 app=await electron.launch({executablePath,args,timeout:30000});
 if(mockStorage)await app.evaluate(({safeStorage})=>{
  // Test-only transport stub. Never used in the application or represented as OS encryption.
  safeStorage.isAsyncEncryptionAvailable=async()=>true;
  safeStorage.encryptStringAsync=async value=>Buffer.from('test-only:'+value);
  safeStorage.decryptStringAsync=async value=>({result:value.toString().slice('test-only:'.length)});
 });
 const pet=await app.firstWindow();await pet.waitForFunction(()=>window.petDiagnostics?.().ready&&window.petDiagnostics().connected);
 await app.evaluate(()=>{
  const original=globalThis.fetch;globalThis.chatTestMode='success';globalThis.chatTestRequests=[];
  globalThis.fetch=async(url,options)=>{
   if(!String(url).startsWith('https://api.deepseek.com/'))return original(url,options);
   globalThis.chatTestRequests.push({url,body:options.body});
   if(String(url).endsWith('/models'))return new Response(JSON.stringify({data:[{id:'deepseek-flash'}]}));
   if(globalThis.chatTestMode==='unauthorized')return new Response('{}',{status:401});
   if(globalThis.chatTestMode==='blank-fallback'){
    const body=JSON.parse(options.body);
    if(body.response_format.type==='json_object')return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'                                 '}}]}));
    await new Promise(r=>setTimeout(r,500));
    return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'完成啦，终于可以松口气了！'}}]}));
   }
   const delay=globalThis.chatTestMode==='slow'?800:100;
   await new Promise(r=>setTimeout(r,delay));
   return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({reply:'辛苦啦，我在这里陪你。想说说今天发生了什么吗？',emotion:'warm',action:'nod',expression:'smile'})}}]}));
  };
 });
 const nextWindow=app.waitForEvent('window',{timeout:15000});
 await pet.locator('[data-native="chat"]').evaluate(el=>el.click());
 const page=await nextWindow;
 await page.waitForURL('**/chat.html');await page.waitForSelector('#api-key',{state:'attached'});
 console.log('Chat window ready');return {pet,chat:page};
}
(async()=>{
 try{
  let {pet,chat}=await open();const errors=[];chat.on('pageerror',e=>errors.push(e.message));pet.on('pageerror',e=>errors.push(e.message));
  await chat.locator('#api-key').fill('sk-local-integration-test-not-real');
  await chat.locator('#save-settings').click();await chat.waitForFunction(()=>document.querySelector('#key-status').textContent==='已加密保存');
  assert(!fs.readFileSync(path.join(profile,'ai-settings.json'),'utf8').includes('sk-local-integration-test-not-real'));result.osEncryptedKey=!mockStorage;
  await chat.locator('#test-key').click();await chat.waitForFunction(()=>document.querySelector('#status').textContent.includes('连接成功'));result.connectionTest=true;
  await chat.locator('#settings-toggle').click();
  await chat.locator('#message-input').fill('今天有点累');await chat.locator('#send-message').click();
  await chat.waitForSelector('.message.assistant');await pet.waitForFunction(()=>window.petDiagnostics().body?.source==='ai');
  assert.equal((await pet.evaluate(()=>window.petDiagnostics())).body.name,'nod');assert.match(await pet.locator('#ai-bubble').textContent(),/辛苦啦/);result.replyAndAction=true;
  await chat.screenshot({path:path.join(output,'conversation.png')});await pet.screenshot({path:path.join(output,'pet-reply.png')});
  await app.evaluate(()=>{globalThis.chatTestMode='blank-fallback';});
  await chat.locator('#message-input').fill('我终于完成了！');await chat.locator('#send-message').click();
  await chat.waitForFunction(()=>document.querySelector('#status').textContent.includes('重新回应'));
  await chat.waitForFunction(()=>document.querySelectorAll('.message.assistant').length===2&&!document.querySelector('#send-message').disabled);
  assert.match(await chat.locator('.message.assistant').last().textContent(),/松口气/);
  assert.match(await pet.locator('#ai-bubble').textContent(),/松口气/);result.emptyJsonRecoversAsText=true;
  await app.evaluate(()=>{globalThis.chatTestMode='unauthorized';});
  await chat.locator('#message-input').fill('再聊一句');await chat.locator('#send-message').click();
  await chat.waitForFunction(()=>document.querySelector('#status').textContent.includes('Key 无效'));
  assert.equal(await chat.locator('#message-input').inputValue(),'再聊一句');result.errorPreservesDraft=true;
  await app.evaluate(()=>{globalThis.chatTestMode='slow';});
  await chat.locator('#send-message').click();await chat.locator('#cancel-request').click();
  await chat.waitForFunction(()=>!document.querySelector('#send-message').disabled);await new Promise(r=>setTimeout(r,1000));
  assert.equal(await chat.locator('.message.assistant').count(),2);result.cancelDropsLateReply=true;
  // Test speech UI and mouth lifecycle deterministically, without speaking aloud.
  result.localChineseVoices=await pet.evaluate(()=>speechSynthesis.getVoices().filter(v=>/^zh/i.test(v.lang)&&v.localService).map(v=>v.name));
  await pet.evaluate(()=>{
   const voices=speechSynthesis.getVoices();const local=voices.find(v=>/^zh/i.test(v.lang)&&v.localService);
   if(!local)return;
   speechSynthesis.speak=line=>{window.testSpeechLine=line;line.onstart();};
   speechSynthesis.cancel=()=>{window.testSpeechLine?.onend();window.testSpeechLine=null;};
  });
  if(result.localChineseVoices.length){
   await chat.locator('.read-button').first().click();await pet.waitForFunction(()=>window.petDiagnostics().expressions.aa>.05);
   await chat.locator('#stop-speech').click();await pet.waitForFunction(()=>window.petDiagnostics().expressions.aa===0);result.speechLifecycle=true;
  }
  await chat.setViewportSize({width:360,height:600});assert(await chat.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));result.narrowLayout=true;
  await chat.screenshot({path:path.join(output,'narrow.png')});
  // Public local token must not authorize the private AI endpoint.
  const denied=await pet.evaluate(async()=>{const c=await(await fetch('/api/config')).json();return(await fetch('/api/ai-reaction',{method:'POST',headers:{'Content-Type':'application/json','X-Pet-Token':c.token},body:JSON.stringify({action:'jump',expression:'smile',revision:0})})).status;});
  assert.equal(denied,403);result.nativeEndpointProtected=true;
  const forbidden=await pet.evaluate(()=>window.lanluoDesktop.chat({type:'configure',data:{key:'sk-injected-key',model:'deepseek-flash',autoSpeak:false}}));assert.equal(forbidden.ok,false);result.petCannotChangeKey=true;
  await app.close();app=null;({pet,chat}=await open());
  await chat.waitForSelector('.message.assistant');assert.equal(await chat.locator('#key-status').textContent(),'已加密保存');result.restartPersistence=true;
  await chat.locator('#clear-history').click();await chat.locator('#clear-dialog button[value="clear"]').click();await chat.waitForFunction(()=>!document.querySelector('.message.assistant'));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(profile,'ai-history.json'),'utf8')),[]);result.clearHistory=true;
  await chat.locator('#settings-toggle').click();await chat.locator('#remove-key').click();await chat.waitForFunction(()=>document.querySelector('#key-status').textContent==='未保存');
  assert.equal(JSON.parse(fs.readFileSync(path.join(profile,'ai-settings.json'),'utf8')).encryptedKey,'');result.removeKey=true;
  assert.deepEqual(errors,[]);result.rendererErrors=errors;
  fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 }finally{if(app){
  if(!result.removeKey){for(const page of app.windows())if(page.url().endsWith('/chat.html')){console.log('Chat failure status:',await page.locator('#status').textContent());await page.screenshot({path:path.join(output,'failure.png')});}}
  await app.close();
 }}
})().catch(error=>{console.error(error);process.exitCode=1;});
