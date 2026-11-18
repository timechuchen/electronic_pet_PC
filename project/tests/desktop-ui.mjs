import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:360,height:470}});
const source='desktop-relay-test';
async function relay(body){return page.evaluate(async body=>{const config=await(await fetch('/api/config')).json();const r=await fetch('/api/tracking',{method:'POST',headers:{'Content-Type':'application/json','X-Pet-Token':config.token},body:JSON.stringify(body)});return r.status;},body);}
try{
 await page.goto('http://127.0.0.1:8765/?desktop=1');await page.waitForFunction(()=>window.petDiagnostics?.().danceDuration);
 assert.equal(await page.locator('.control-panel').isVisible(),false);
 assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgba(0, 0, 0, 0)');
 assert.equal(await relay({source,sequence:1,active:true,bones:{rightUpperArm:[0,0,0,1]},expressions:{happy:.7}}),200);
 await page.waitForFunction(()=>Math.abs(window.petDiagnostics().bones.rightUpperArm[2])<.05);
 assert.ok((await page.evaluate(()=>window.petDiagnostics())).expressions.happy>.6);
 await page.screenshot({path:'screenshots/desktop-relay.png',omitBackground:true});
 await relay({source,sequence:2,active:false});await page.waitForTimeout(600);
 assert.ok(Math.abs((await page.evaluate(()=>window.petDiagnostics())).bones.rightUpperArm[2])>.4);
 console.log('PASS: pet-only transparent page, local camera pose relay to desktop rendering, stop restores idle.');
}finally{await relay({source,sequence:3,active:false}).catch(()=>{});await browser.close();}
