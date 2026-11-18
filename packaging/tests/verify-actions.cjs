const {_electron:electron}=require('playwright');
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');const packaged=process.argv.includes('--packaged');
const output=path.join(root,'test-data',packaged?'actions-packaged':'actions-dev');fs.mkdirSync(output,{recursive:true});
const data=fs.mkdtempSync(path.join(output,'profile-'));
const executablePath=packaged?path.join(root,'build/Lanluo-darwin-arm64/Lanluo.app/Contents/MacOS/Lanluo'):path.join(root,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const sandbox=process.env.LANLUO_TEST_NO_SANDBOX==='1'?['--no-sandbox']:[];
const args=[...(packaged?[]:[path.join(root,'shell')]),...sandbox,`--test-data=${data}`];
async function open(){
 const app=await electron.launch({executablePath,args,timeout:30000});const pet=await app.firstWindow();await pet.waitForFunction(()=>window.petDiagnostics?.().ready&&window.petDiagnostics().connected);
 await pet.locator('[data-native="control"]').evaluate(el=>el.click());
 let settings;for(let i=0;i<100;i++){settings=app.windows().find(p=>p!==pet);if(settings)break;await new Promise(r=>setTimeout(r,100));}
 assert(settings);await settings.waitForFunction(()=>window.petDiagnostics?.().ready&&window.petDiagnostics().connected);
 return {app,pet,settings};
}
async function api(page,route,body){return page.evaluate(async({route,body})=>{const cfg=await (await fetch('/api/config')).json();const r=await fetch(route,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json','X-Pet-Token':cfg.token}:{},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};},{route,body});}
async function saveDownload(app,page,selector,file){
 await app.evaluate(({session},file)=>{globalThis.actionTestSave='pending';session.fromPartition('lanluo-local').once('will-download',(_event,item)=>{item.setSavePath(file);item.once('done',(_event,state)=>{globalThis.actionTestSave=state;});});},file);
 await page.locator(selector).click();
 for(let i=0;i<100;i++){const state=await app.evaluate(()=>globalThis.actionTestSave);if(state!=='pending'){assert.equal(state,'completed');return;}await new Promise(r=>setTimeout(r,100));}
 throw new Error('Electron download did not complete');
}
(async()=>{
 let app;const result={packaged};
 try{
 let session=await open();({app}=session);let {pet,settings}=session;
 await settings.locator('[data-action="jump"]').click();
 await pet.waitForFunction(()=>window.petDiagnostics().rootTarget>.13);
 await api(settings,'/api/command',{type:'pause'});
 await pet.waitForFunction(()=>window.petDiagnostics().paused);
 const before=await pet.evaluate(()=>window.petDiagnostics());assert(before.rootY>before.height*.1);assert.equal(before.body.name,'jump');
 await pet.screenshot({path:path.join(output,'jump.png')});
 const paused=await pet.evaluate(()=>new Promise(resolve=>setTimeout(()=>resolve(window.petDiagnostics()),250)));
 assert.equal(paused.rootTarget,before.rootTarget);result.jumpLift=before.rootTarget;result.pause=true;
 await api(settings,'/api/tracking',{source:'action-test',sequence:1,active:true,bones:{head:[0,0,0,1]},expressions:{}});await pet.waitForFunction(()=>window.petDiagnostics().rootY===0);
 await api(settings,'/api/tracking',{source:'action-test',sequence:2,active:false});await pet.waitForFunction(()=>window.petDiagnostics().rootY>0);result.trackingOverridesLift=true;
 await settings.locator('#reset').click();await pet.waitForFunction(()=>window.petDiagnostics().rootY===0);result.reset=true;
 await api(settings,'/api/command',{type:'settings',speed:2,loop:true});
 await settings.locator('[data-action="jump"]').click();
 const loop=await pet.evaluate(()=>new Promise(resolve=>setTimeout(()=>resolve(window.petDiagnostics()),1100)));
 assert.equal(loop.body.name,'jump');assert(loop.body.time<1.8);result.loop=true;
 await settings.locator('#reset').click();await api(settings,'/api/command',{type:'settings',speed:1,loop:false});
 await settings.locator('[data-action="jump"]').click();await pet.waitForFunction(()=>window.petDiagnostics().body?.name==='jump');await pet.waitForFunction(()=>!window.petDiagnostics().body&&window.petDiagnostics().rootY===0);result.landed=true;
 await settings.locator('#action-library summary').click();
 const templatePath=path.join(output,'downloaded-example.json');
 await saveDownload(app,settings,'#action-library-template',templatePath);
 assert.equal(JSON.parse(fs.readFileSync(templatePath,'utf8')).actions[0].id,'custom_hop');result.exampleDownloaded=true;
 await settings.locator('#action-library-import').setInputFiles(templatePath);
 await settings.locator('[data-action="custom_hop"]').waitFor();
 await settings.locator('[data-action="custom_hop"]').click();await pet.waitForFunction(()=>window.petDiagnostics().body?.name==='custom_hop'&&window.petDiagnostics().rootY>0);
 result.imported=true;
 const exportPath=path.join(output,'exported-library.json');
 await saveDownload(app,settings,'#action-library-export',exportPath);
 assert.equal(JSON.parse(fs.readFileSync(exportPath,'utf8')).actions[0].id,'custom_hop');result.libraryExported=true;

 await settings.locator('#reset').click();
 const malformed={name:'invalid.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({version:1,actions:[{id:'jump'}]}))};
 await settings.locator('#action-library-import').setInputFiles(malformed);await settings.waitForFunction(()=>document.querySelector('#action-library-status').classList.contains('error'));
 assert.equal((await api(settings,'/api/actions')).data.actions.length,1);result.rejectedImportPreservedLibrary=true;
 const denied=await settings.evaluate(async()=>{const r=await fetch('/api/actions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'delete',id:'custom_hop'})});return r.status;});assert.equal(denied,403);result.tokenRequired=true;
 await settings.locator('#preset-details summary').click();await settings.locator('#preset-idle').selectOption('jump');await settings.locator('#preset-save').click();
 await pet.waitForFunction(()=>window.petDiagnostics().body?.name==='jump'&&window.petDiagnostics().body?.source==='idle');result.idlePreset=true;
 const idleStart=await pet.evaluate(()=>window.petDiagnostics());assert(idleStart.body.time<.4);assert(idleStart.rootY<=.02);
 await pet.waitForFunction(()=>window.petDiagnostics().rootTarget>.13);
 await settings.locator('[data-action="wave"]').click();await pet.waitForFunction(()=>window.petDiagnostics().body?.name==='wave');
 await pet.waitForFunction(()=>{const d=window.petDiagnostics();return d.body?.name==='jump'&&d.body?.source==='idle'&&d.body.time<.5&&d.rootY<=.03;});
 await pet.waitForFunction(()=>window.petDiagnostics().rootTarget>.13);result.idleJumpChaining=true;
 await settings.locator('#preset-idle').selectOption('breath');await settings.locator('#preset-save').click();
 await settings.locator('#action-library').scrollIntoViewIfNeeded();await settings.screenshot({path:path.join(output,'settings.png'),fullPage:true});
 await settings.setViewportSize({width:760,height:700});assert(await settings.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));result.narrowLayout=true;
 await app.close();app=null;
 session=await open();({app,pet,settings}=session);
 await settings.locator('#action-library summary').click();await settings.locator('[data-action="custom_hop"]').waitFor();result.persistedAfterRestart=true;
 settings.on('dialog',dialog=>dialog.accept());await settings.getByRole('button',{name:'移除动作“轻轻一跳”',exact:true}).click();
 await settings.waitForFunction(()=>!document.querySelector('[data-action="custom_hop"]'));assert.equal((await api(settings,'/api/actions')).data.actions.length,0);result.removed=true;
 fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{if(app)await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
