import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1100}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
let original;
async function post(path,body){return page.evaluate(async({path,body})=>{const c=await(await fetch('/api/config')).json();const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-Pet-Token':c.token},body:JSON.stringify(body)});return{status:r.status,data:await r.json()};},{path,body});}
try{
 await page.goto('http://127.0.0.1:8765');await page.waitForFunction(()=>window.petDiagnostics?.().danceDuration);
 original=await page.evaluate(()=>fetch('/api/presets').then(r=>r.json()));
 await page.locator('#preset-details summary').click();
 await page.locator('#preset-select').selectOption('cheerful');
 await page.waitForFunction(()=>document.getElementById('preset-current').textContent==='轻松摇摆');
 await page.locator('#preset-name').fill('测试挥手待机');await page.locator('#preset-idle').selectOption('wave');
 await page.locator('#preset-copy').click();await page.waitForFunction(()=>window.petDiagnostics().body?.source==='idle');
 assert.equal((await page.evaluate(()=>window.petDiagnostics())).body.name,'wave');
 await page.locator('[data-action=nod]').click();await page.waitForFunction(()=>window.petDiagnostics().body?.name==='nod');
 await page.waitForFunction(()=>window.petDiagnostics().body?.source==='idle');
 const download=page.waitForEvent('download');await page.locator('#preset-export').click();assert.equal((await download).suggestedFilename(),'lanluo-presets.json');
 const bad=structuredClone(original);bad.presets[0].speed=100;
 assert.equal((await post('/api/presets',{operation:'import',document:bad})).status,400);
 assert.equal((await post('/api/audio',{status:'listening',score:1,level:1})).status,403,'Web token cannot spoof native music classifier');
 await page.screenshot({path:'screenshots/presets.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.deepEqual(errors,[]);
 console.log('PASS: preset selection, save, default idle, manual override/return, export, invalid import, native token separation, mobile.');
}finally{if(original)await post('/api/presets',{operation:'import',document:original});await browser.close();}
