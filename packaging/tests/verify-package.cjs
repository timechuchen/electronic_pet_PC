const { _electron: electron } = require('playwright');
const fs=require('node:fs');const path=require('node:path');
(async()=>{
 const root=path.resolve(__dirname,'..');
 const sandbox=process.env.LANLUO_TEST_NO_SANDBOX==='1'?['--no-sandbox']:[];
 const application=await electron.launch({executablePath:path.join(root,'build/Lanluo-darwin-arm64/Lanluo.app/Contents/MacOS/Lanluo'),args:[...sandbox,`--test-data=${root}/test-data/integration`],timeout:30000});
 try{
 const pet=await application.firstWindow();await pet.waitForFunction(()=>window.petDiagnostics?.().ready);
 await pet.locator('[data-native="control"]').evaluate(button=>button.click());
 let settings;for(let i=0;i<100;i++){settings=application.windows().find(p=>p!==pet);if(settings)break;await new Promise(r=>setTimeout(r,100));}if(!settings)throw new Error('Settings button did not open a window');
 await settings.waitForFunction(()=>window.petDiagnostics?.().ready);
 await settings.locator('[data-action="wave"]').click();await pet.waitForFunction(()=>window.petDiagnostics().body?.name==='wave');
 const wave=await pet.evaluate(()=>window.petDiagnostics().body.name);
 await settings.locator('[data-action="blink"]').click();await pet.waitForFunction(()=>window.petDiagnostics().face?.name==='blink');
 const blink=await pet.evaluate(()=>window.petDiagnostics().face.name);
 const audio=await pet.evaluate(()=>new Promise((resolve,reject)=>{
  const worker=new Worker('/audio-worker.js');const timeout=setTimeout(()=>{worker.terminate();reject(Error('Audio timed out'));},30000);let index=0;const scores=[];
  function next(){const rate=16000,samples=new Float32Array(rate),beat=60/110,notes=[261.63,329.63,392,523.25,440,392,329.63,293.66];for(let i=0;i<rate;i++){const t=index+i/rate,p=t%beat,f=notes[Math.floor(t/beat)%notes.length],env=(1-Math.exp(-p*90))*Math.exp(-p*5);let piano=0;for(let h=1;h<=5;h++)piano+=Math.sin(2*Math.PI*f*h*t)/h**1.6;samples[i]=.35*piano*env+.16*Math.sin(2*Math.PI*130.81*t)*Math.exp(-p*4)+.22*Math.sin(2*Math.PI*(55*p+2*(1-Math.exp(-p*40))))*Math.exp(-p*24);}worker.postMessage({type:'samples',samples,rate},[samples.buffer]);}
  worker.onerror=e=>{clearTimeout(timeout);reject(Error(e.message));worker.terminate();};
  worker.onmessage=({data})=>{if(data.type==='ready')next();else if(data.type==='error'){clearTimeout(timeout);worker.terminate();reject(Error(data.message));}else{scores.push(data.score);if(++index<6)next();else{clearTimeout(timeout);worker.terminate();resolve({scores,maximum:Math.max(...scores)});}}};worker.postMessage({type:'init'});
 }));
 if(audio.maximum<.65)throw new Error(`Synthetic music was not recognized: ${JSON.stringify(audio)}`);
 const result={wave,blink,audio,cameraModelFiles:await pet.evaluate(async()=>{const paths=['/tracking/pose_landmarker_lite.task','/tracking/face_landmarker.task'];return Promise.all(paths.map(async p=>({path:p,status:(await fetch(p)).status})));})};
 if(result.cameraModelFiles.some(f=>f.status!==200))throw new Error('Camera models missing from package');
 fs.writeFileSync(path.join(root,'test-data/integration-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await application.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
