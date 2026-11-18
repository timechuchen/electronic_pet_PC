const {_electron:electron}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const packaged=process.argv.includes('--packaged');
const root=path.resolve(__dirname,'..'),output=path.join(root,packaged?'test-data/assets-packaged':'test-data/assets-dev');fs.mkdirSync(output,{recursive:true});
const data=fs.mkdtempSync(path.join(output,'profile-'));
const fixture=path.join(output,'test-vrm1.vrm');execFileSync('python3',[path.join(__dirname,'vrm-fixture.py'),fixture]);
const errors=[],external=[];let app;
async function open(){
 app=await electron.launch({executablePath:packaged?path.join(root,'build/Lanluo-darwin-arm64/Lanluo.app/Contents/MacOS/Lanluo'):path.join(root,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),args:[...(packaged?[]:[path.join(root,'shell')]),`--test-data=${data}`],timeout:30000});
 const pet=await app.firstWindow();await pet.waitForFunction(()=>window.petDiagnostics?.().ready&&window.petDiagnostics().connected);
 await pet.locator('[data-native="control"]').evaluate(el=>el.click());
 let settings;for(let i=0;i<100;i++){settings=app.windows().find(p=>p!==pet);if(settings)break;await new Promise(r=>setTimeout(r,100));}
 assert(settings);for(const page of [settings,pet]){page.on('pageerror',error=>errors.push(error.message));page.on('request',req=>{if(/^https?:/.test(req.url())&&!req.url().startsWith('http://127.0.0.1:'))external.push(req.url());});}
 await settings.waitForFunction(()=>window.petDiagnostics?.().ready&&window.petDiagnostics().connected);
 await settings.locator('#asset-library summary').first().click();return {pet,settings};
}
async function api(page,route,body){return page.evaluate(async({route,body})=>{const cfg=await (await fetch('/api/config')).json();const r=await fetch(route,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json','X-Pet-Token':cfg.token}:{},body:body?JSON.stringify(body):undefined});if(!r.ok)throw new Error(await r.text());return r.json();},{route,body});}
async function idle(page){await page.waitForFunction(()=>document.querySelector('#asset-library').getAttribute('aria-busy')!=='true');}
(async()=>{const result={packaged};try{
 let {pet,settings}=await open();
 await settings.locator('#model-import').setInputFiles(path.join(root,'backend/Material/兰洛.vrm'));
 await settings.waitForFunction(()=>document.querySelector('#model-select').options.length===2);await idle(settings);
 let library=await api(settings,'/api/library');const vrm0=library.models[0].id;
 await settings.locator('#model-select').selectOption(vrm0);await settings.locator('#model-apply').click();
 for(const p of [settings,pet])await p.waitForFunction(id=>window.petDiagnostics().modelId===id&&window.petDiagnostics().ready,vrm0);
 result.vrm0ImportedAndSynced=true;
 await settings.locator('#fbx-import').setInputFiles(path.join(root,'backend/Material/Hip Hop Dancing.fbx'));
 await settings.locator('#fbx-save').waitFor();await idle(settings);
 assert((await settings.locator('#fbx-clip option').count())>=1);
 assert(await settings.locator('#fbx-clip option:disabled').count()>=1);
 assert(await settings.locator('#fbx-mapping select').evaluateAll(els=>els.filter(el=>el.value).length)>15);
 await settings.locator('#fbx-save').click();await settings.locator('#fbx-list [data-action]').waitFor();await idle(settings);
 library=await api(settings,'/api/library');const motion=library.motions[0];assert(motion.duration>4);
 await api(settings,'/api/command',{type:'settings',loop:true});
 await settings.locator(`#fbx-list [data-action="${motion.id}"]`).click();
 for(const p of [settings,pet])await p.waitForFunction(id=>window.petDiagnostics().body?.name===id&&window.petDiagnostics().fbxLoaded.includes(id),motion.id);
 const a=await pet.evaluate(()=>window.petDiagnostics());
 await pet.waitForFunction(before=>JSON.stringify(window.petDiagnostics().bones.rightUpperArm)!==JSON.stringify(before),a.bones.rightUpperArm);
 await api(settings,'/api/command',{type:'pause'});await pet.waitForFunction(()=>window.petDiagnostics().paused);
 const paused=await pet.evaluate(()=>window.petDiagnostics().body.time);await new Promise(r=>setTimeout(r,250));assert.equal(await pet.evaluate(()=>window.petDiagnostics().body.time),paused);
 result.fbxPlaybackAndPause=true;
 // Rename the source skeleton without changing binary FBX string lengths.
 const customFBX=Buffer.from(fs.readFileSync(path.join(root,'backend/Material/Hip Hop Dancing.fbx')).toString('latin1').replaceAll('mixamorig','customRig'),'latin1');
 await settings.locator('#fbx-import').setInputFiles({name:'custom-rig.fbx',mimeType:'application/octet-stream',buffer:customFBX});
 await settings.locator('#fbx-save').waitFor();await idle(settings);
 const headSelect=settings.locator('#fbx-mapping select[data-bone="head"]');
 const headName=await headSelect.locator('option').evaluateAll(els=>els.find(el=>el.value.endsWith('Head')&&el.value.includes('customRig'))?.value);
 assert(headName);await headSelect.selectOption(headName);
 await settings.locator('#fbx-save').click();await settings.waitForFunction(()=>document.querySelectorAll('#fbx-list [data-action]').length===2);await idle(settings);
 const manual=(await api(settings,'/api/library')).motions.find(a=>a.name==='custom-rig.fbx');
 await settings.locator(`[data-action="${manual.id}"]`).click();await pet.waitForFunction(id=>window.petDiagnostics().fbxLoaded.includes(id),manual.id);
 await settings.getByRole('button',{name:'移除 FBX custom-rig.fbx',exact:true}).click();await idle(settings);
 result.manualMappingOfUnknownRig=true;

 await settings.locator('#model-import').setInputFiles(fixture);
 await settings.waitForFunction(()=>document.querySelector('#model-select').options.length===3);await idle(settings);
 library=await api(settings,'/api/library');const vrm1=library.models[1].id;
 await settings.locator('#model-select').selectOption(vrm1);await settings.locator('#model-apply').click();
 for(const p of [settings,pet])await p.waitForFunction(id=>window.petDiagnostics().modelId===id&&window.petDiagnostics().ready,vrm1);
 await settings.locator(`#fbx-list [data-action="${motion.id}"]`).click();
 for(const p of [settings,pet])await p.waitForFunction(id=>window.petDiagnostics().fbxLoaded.includes(id)&&window.petDiagnostics().body?.name===id,motion.id);
 result.vrm1AndMotionRetarget=true;
 await settings.locator('#model-import').setInputFiles({name:'broken.vrm',mimeType:'application/octet-stream',buffer:Buffer.from('broken')});
 await settings.waitForFunction(()=>document.querySelector('#asset-status').classList.contains('error'));await idle(settings);
 assert.equal((await api(settings,'/api/library')).models.length,2);assert.equal(await pet.evaluate(()=>window.petDiagnostics().modelId),vrm1);
 await settings.locator('#fbx-import').setInputFiles({name:'broken.fbx',mimeType:'application/octet-stream',buffer:Buffer.from('broken')});
 await idle(settings);assert.equal((await api(settings,'/api/library')).motions.length,1);result.invalidFilesPreserveState=true;
 await settings.locator('#asset-library').scrollIntoViewIfNeeded();await settings.locator('#asset-library').screenshot({path:path.join(output,'library.png')});
 await settings.setViewportSize({width:760,height:700});assert(await settings.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 result.narrowLayout=true;
 await settings.setViewportSize({width:375,height:812});await settings.emulateMedia({reducedMotion:'reduce'});
 assert(await settings.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await settings.locator('#asset-library').screenshot({path:path.join(output,'library-mobile.png')});
 result.mobileAndReducedMotion=true;

 await app.close();app=null;
 ({pet,settings}=await open());
 assert.equal(await pet.evaluate(()=>window.petDiagnostics().modelId),vrm1);await settings.locator(`#fbx-list [data-action="${motion.id}"]`).waitFor();result.persistedAfterRestart=true;
 await settings.locator('#model-default').click();for(const p of [settings,pet])await p.waitForFunction(()=>window.petDiagnostics().modelId==='builtin'&&window.petDiagnostics().ready);
 await settings.locator(`#fbx-list [data-action="${motion.id}"]`).click();await pet.waitForFunction(id=>window.petDiagnostics().body?.name===id,motion.id);
 await settings.getByRole('button',{name:`移除 FBX ${motion.name}`,exact:true}).click();await pet.waitForFunction(()=>!window.petDiagnostics().body);
 assert.equal((await api(settings,'/api/library')).motions.length,0);result.activeRemovalAndRestore=true;
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);result.noRuntimeErrorsOrExternalRequests=true;
 fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{if(app)await app.close();}})().catch(error=>{console.error(error);console.error({errors,external});process.exitCode=1;});
