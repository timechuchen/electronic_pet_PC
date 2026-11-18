const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {ChatService,parseReply}=require('../shell/chat-service.cjs');
const storage={isAsyncEncryptionAvailable:async()=>true,encryptStringAsync:async text=>Buffer.from([...text].reverse().join('')),
  decryptStringAsync:async bytes=>({result:[...bytes.toString()].reverse().join('')})};
const payload={reply:'今天真的辛苦了。想说说最让你累的那件事吗？',emotion:'concerned',action:'nod',expression:'neutral'};
const response=(data,status=200)=>({ok:status===200,status,text:async()=>JSON.stringify(data)});
const answer=(value=payload)=>response({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]});
async function setup(t,options={}){
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'lanluo-chat-'));t.after(()=>fs.rmSync(dataDir,{recursive:true,force:true}));
  const service=new ChatService({dataDir,storage,fetchImpl:async()=>answer(),...options});
  await service.configure({key:'sk-fake-unit-test',model:'deepseek-flash',autoSpeak:false});
  return {service,dataDir};
}
test('credential stays encrypted on disk and absent from UI; paired history survives restart',async t=>{
  const outbound=[],reactions=[];const {service,dataDir}=await setup(t,{fetchImpl:async(url,options)=>{outbound.push({url,options});return answer();},capture:async()=>7,react:async r=>reactions.push(r)});
  await service.request('今天好累');
  const all=JSON.stringify(service.snapshot());assert(!all.includes('sk-fake'));assert(!all.includes('encryptedKey'));
  assert(!fs.readFileSync(service.configFile,'utf8').includes('sk-fake-unit-test'));
  assert.equal(outbound[0].url,'https://api.deepseek.com/chat/completions');assert.equal(outbound[0].options.redirect,'error');
  assert.equal(outbound[0].options.headers.Authorization,'Bearer sk-fake-unit-test');
  assert.equal(JSON.parse(outbound[0].options.body).thinking.type,'disabled');
  assert.equal(reactions[0].revision,7);assert.equal(service.history.length,2);
  const reopened=new ChatService({dataDir,storage});assert.equal(reopened.history[1].content,payload.reply);assert.equal(await reopened.key(),'sk-fake-unit-test');
  await reopened.configure({removeKey:true,model:'deepseek-flash',autoSpeak:false});assert.equal(reopened.snapshot().hasKey,false);
});
test('cancel prevents a late provider response from changing history or playing actions',async t=>{
  let resolve,started;const ready=new Promise(r=>started=r);let reactions=0;
  const {service}=await setup(t,{fetchImpl:()=>{started();return new Promise(r=>resolve=r);},react:async()=>reactions++});
  const pending=service.request('你好');await ready;service.cancel();resolve(answer());await pending;
  assert.equal(service.history.length,0);assert.equal(reactions,0);assert.equal(service.pending,null);
});
test('bad key and rate limit give recoverable errors without storing a failed turn',async t=>{
  const {service}=await setup(t,{fetchImpl:async()=>response({},401)});await service.request('你好');assert.match(service.error,/Key 无效/);assert.equal(service.history.length,0);
  service.fetch=async()=>response({},429);await service.request('你好');assert.match(service.error,/过于频繁/);
  service.fetch=async()=>answer();await service.request('你好');assert.equal(service.history.length,2);assert.equal(service.error,'');
});
test('malformed and truncated output never plays an action',async t=>{
  let actions=0;const {service}=await setup(t,{react:async()=>actions++,fetchImpl:async()=>response({choices:[{finish_reason:'stop',message:{content:'{"reply":'}}]})});
  await service.request('你好');assert.match(service.error,/格式不完整/);assert.equal(actions,0);
  service.fetch=async()=>response({choices:[{finish_reason:'length',message:{content:JSON.stringify(payload)}}]});
  await service.request('你好');assert.match(service.error,/未完整/);assert.equal(actions,0);
  assert.equal(parseReply(JSON.stringify({...payload,action:'run_command',expression:'evil'})).action,'none');
  assert.equal(parseReply(JSON.stringify({...payload,action:[],expression:{}})).expression,'neutral');
});
test('timeout and duplicate send are bounded, retry is explicit',async t=>{
  let started;const ready=new Promise(r=>started=r);
  const {service}=await setup(t,{timeout:25,fetchImpl:async(_url,{signal})=>{started();return new Promise((_r,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted'))));}});
  const pending=service.request('你好');await ready;await assert.rejects(service.request('再来'),/正在回应/);await pending;assert.match(service.error,/超时/);assert.equal(service.pending,null);
});
test('context is bounded and no system role can be supplied by the renderer',async t=>{
  let sent;const {service}=await setup(t,{fetchImpl:async(_u,o)=>{sent=JSON.parse(o.body);return answer();}});
  for(let i=0;i<12;i++)await service.request(`第 ${i} 次`);
  assert.equal(sent.messages.length,22);assert.equal(sent.messages[0].role,'system');assert.equal(sent.messages.at(-1).role,'user');
  service.clear();assert.equal(service.history.length,0);assert.deepEqual(JSON.parse(fs.readFileSync(service.historyFile,'utf8')),[]);
});
test('secure storage failure preserves previous settings and never writes plaintext',async t=>{
  const {service}=await setup(t);const before=fs.readFileSync(service.configFile,'utf8');
  service.storage={...storage,isAsyncEncryptionAvailable:async()=>false};
  await assert.rejects(service.configure({key:'sk-new-test-value',model:'deepseek-v4-pro',autoSpeak:true}),/系统安全存储/);
  assert.equal(fs.readFileSync(service.configFile,'utf8'),before);assert.equal(service.config.model,'deepseek-flash');
});
test('connection test uses models endpoint, does not create conversation or actions',async t=>{
  let url;const {service}=await setup(t,{fetchImpl:async u=>{url=u;return response({data:[{id:'deepseek-flash'}]});}});
  await service.request('',true);assert.equal(url,'https://api.deepseek.com/models');assert.equal(service.history.length,0);assert.match(service.notice,/连接成功/);
});
test('blank JSON response falls back once to text, records one turn and skips actions',async t=>{
  const requests=[],updates=[];let actions=0;
  const {service}=await setup(t,{emit:s=>updates.push(JSON.parse(JSON.stringify(s))),react:async()=>actions++,fetchImpl:async(_url,options)=>{
    const body=JSON.parse(options.body);requests.push(body);
    return response({choices:[{finish_reason:'stop',message:{content:requests.length===1?'                                 ':'做完一件拖了很久的事，终于可以松口气啦！'}}]});
  }});
  await service.request('我终于完成了！');
  assert.equal(requests.length,2);assert.equal(requests[0].response_format.type,'json_object');assert.equal(requests[1].response_format.type,'text');
  assert.equal(requests[1].messages.at(-1).content,'我终于完成了！');
  assert.equal(service.error,'');assert.equal(service.history.length,2);assert.equal(actions,0);
  assert(updates.some(s=>s.pending?.recovering));assert.equal(updates.filter(s=>s.completed).length,1);
});
test('repeated empty replies stop after one fallback and preserve history',async t=>{
  let count=0;const {service}=await setup(t,{fetchImpl:async()=>{count++;return response({choices:[{finish_reason:'stop',message:{content:'  \n  '}}]});}});
  await service.request('你好');assert.equal(count,2);assert.match(service.error,/空内容/);assert.equal(service.history.length,0);
});
test('historical assistant text is serialized back into valid protocol JSON',async t=>{
  let sent;const {service}=await setup(t,{fetchImpl:async(_u,o)=>{sent=JSON.parse(o.body);return answer();}});
  service.history=[{id:'old-user',role:'user',content:'你好'},{id:'old-assistant',role:'assistant',content:'很高兴见到你。'}];
  await service.request('你能干啥');
  const prior=JSON.parse(sent.messages[2].content);assert.equal(prior.reply,'很高兴见到你。');assert.equal(prior.action,'none');
  assert.equal(service.history[1].content,'很高兴见到你。');
  assert.equal(parseReply('```json\n'+JSON.stringify(payload)+'\n```').reply,payload.reply);
});
test('cancellation during fallback drops late text and all animations',async t=>{
  let count=0,resolve,started,actions=0;const ready=new Promise(r=>started=r);
  const {service}=await setup(t,{react:async()=>actions++,fetchImpl:async()=>{
    if(++count===1)return response({choices:[{finish_reason:'stop',message:{content:'   '}}]});
    started();return new Promise(r=>resolve=r);
  }});
  const pending=service.request('你好');await ready;service.cancel();resolve(response({choices:[{finish_reason:'stop',message:{content:'迟到的回复'}}]}));await pending;
  assert.equal(service.history.length,0);assert.equal(actions,0);assert.equal(service.pending,null);
});
test('authentication and provider refusals never trigger a fallback',async t=>{
  let count=0;const {service}=await setup(t,{fetchImpl:async()=>{count++;return response({},401);}});
  await service.request('你好');assert.equal(count,1);
  service.fetch=async()=>{count++;return response({choices:[{finish_reason:'content_filter',message:{content:''}}]});};
  await service.request('你好');assert.equal(count,2);assert.equal(service.history.length,0);
});
