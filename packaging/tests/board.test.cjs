const {test}=require('node:test');
const assert=require('node:assert/strict');
const {pcmFromWave,windowsSpeechCommand}=require('../shell/board-audio.cjs');
const {BoardBridge,pythonPath}=require('../shell/board-bridge.cjs');
function wav({rate=16000,bits=16,channels=1}={}){
 const fmt=Buffer.alloc(24);fmt.write('fmt ');fmt.writeUInt32LE(16,4);fmt.writeUInt16LE(1,8);fmt.writeUInt16LE(channels,10);fmt.writeUInt32LE(rate,12);fmt.writeUInt32LE(rate*channels*bits/8,16);fmt.writeUInt16LE(channels*bits/8,20);fmt.writeUInt16LE(bits,22);
 const junk=Buffer.from([74,85,78,75,1,0,0,0,99,0]);
 const data=Buffer.from([100,97,116,97,4,0,0,0,1,0,2,0]);const head=Buffer.alloc(12);head.write('RIFF');head.writeUInt32LE(4+fmt.length+junk.length+data.length,4);head.write('WAVE',8);
 return Buffer.concat([head,fmt,junk,data]);
}
test('WAV metadata and odd padded chunks do not become PCM',()=>assert.deepEqual(pcmFromWave(wav()),Buffer.from([1,0,2,0])));
test('invalid, truncated and wrong-format audio is rejected',()=>{
 for(const bytes of [Buffer.from('bad'),wav().subarray(0,40),wav({rate:44100}),wav({channels:2}),wav({bits:8})])assert.throws(()=>pcmFromWave(bytes));
});
test('Windows voice command keeps paths and input text out of executable code',()=>{
 const command=windowsSpeechCommand('/tmp/a 中文 & quote', {SystemRoot:'C:\\Windows'});
 assert.equal(command.file,'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
 const script=Buffer.from(command.args.at(-1),'base64').toString('utf16le');
 assert(!script.includes('/tmp/a'));assert(script.includes('[IO.File]::ReadAllText'));assert(script.includes('16000'));
 assert(command.env.LANLUO_TTS_TEXT.endsWith('text.txt'));assert(!command.args.includes('-ExecutionPolicy'));
});
test('embedded Python path is selected by platform',()=>{
 assert(pythonPath('/app','win32').endsWith('/python/python.exe'));assert(pythonPath('/app','darwin').endsWith('/python/bin/python3'));
});
test('disabled/disconnected bridge rejects transport and board voice without side effects',async()=>{
 const bridge=new BoardBridge({root:'/missing',enabled:false});bridge.start();assert.equal(bridge.worker,null);
 assert.equal((await bridge.send(1,Buffer.from('image'))).ok,false);await assert.rejects(bridge.speak('你好'),/连接/);bridge.close();
});
test('cancelled synthesis cannot enqueue audio or restore talking state',async()=>{
 const bridge=new BoardBridge({root:'/missing'});bridge.connected=true;
 let unblock,started;const ready=new Promise(r=>started=r),pending=new Promise(r=>unblock=r);const sends=[];
 bridge.send=async(kind)=>{sends.push(kind);return {ok:true};};bridge.run=async()=>{started();await pending;};
 const speaking=bridge.speak('你好');await ready;bridge.cancelSpeech();unblock();await speaking;
 assert(!sends.includes(2));assert(!sends.includes(4));bridge.close();
});
