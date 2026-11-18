// Integration test against a running `python3 app.py --no-browser`.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import fs from 'node:fs';
fs.mkdirSync('screenshots',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1100},deviceScaleFactor:1});
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const external=[];page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:8765')&&!r.url().startsWith('data:')&&!r.url().startsWith('blob:'))external.push(r.url());});
async function cmd(data){return page.evaluate(async data=>{const c=await(await fetch('/api/config')).json();const r=await fetch('/api/command',{method:'POST',headers:{'Content-Type':'application/json','X-Pet-Token':c.token},body:JSON.stringify(data)});if(!r.ok)throw new Error(await r.text());return r.json();},data);}
const diag=()=>page.evaluate(()=>window.petDiagnostics());
const distance=(a,b)=>Math.sqrt(a.reduce((sum,v,i)=>sum+(v-b[i])**2,0));
try {
  await page.goto('http://127.0.0.1:8765');
  await page.waitForFunction(()=>window.petDiagnostics?.().danceDuration,{timeout:60000});
  await cmd({type:'settings',auto_blink:false,idle_motion:false,loop:false,speed:1});
  await cmd({type:'reset'});await page.waitForTimeout(300);
  const idle=await diag();assert.ok(idle.height>1&&idle.height<3);assert.ok(idle.danceTracks>20);
  await page.screenshot({path:'screenshots/idle.png',fullPage:true});
  await page.locator('[data-action=wave]').click();await page.waitForTimeout(1000);
  const wave=await diag();assert.equal(wave.body.name,'wave');assert.ok(distance(wave.bones.rightUpperArm,idle.bones.rightUpperArm)>.4);
  await page.screenshot({path:'screenshots/wave.png',fullPage:true});
  await page.locator('[data-action=smile]').click();await page.waitForTimeout(600);
  const smile=await diag();assert.equal(smile.body.name,'wave');assert.ok(smile.expressions.happy>.9);
  await page.locator('#pause').click();await page.waitForTimeout(200);const paused=await diag();
  await page.waitForTimeout(400);assert.equal((await diag()).body.time,paused.body.time);
  await page.locator('#reset').click();await page.waitForTimeout(200);assert.equal((await diag()).body,null);assert.equal((await diag()).paused,false);
  await page.locator('#view-face').click();await cmd({type:'settings',speed:.25});
  await page.locator('[data-action=blink]').click();
  await page.waitForFunction(()=>window.petDiagnostics().expressions.blink>.95);
  await page.locator('#pause').click();await page.waitForTimeout(150);
  assert.ok((await diag()).expressions.blink>.85);await page.screenshot({path:'screenshots/blink.png',fullPage:true});
  await cmd({type:'reset'});await cmd({type:'settings',speed:1});
  await page.locator('[data-action=wink]').click();await page.waitForTimeout(400);assert.ok((await diag()).expressions.blinkLeft>.9);
  await page.screenshot({path:'screenshots/wink.png',fullPage:true});
  await page.locator('#view-full').click();
  for(const name of ['nod','shake']) {
    await page.locator(`[data-action=${name}]`).click();await page.waitForTimeout(650);
    assert.equal((await diag()).body.name,name);assert.ok(distance((await diag()).bones.head,idle.bones.head)>.04);
  }
  await page.locator('[data-action=dance]').click();await page.waitForTimeout(1100);
  assert.equal((await diag()).body.name,'dance');
  await page.screenshot({path:'screenshots/dance.png',fullPage:true});
  const danceA=await diag();await page.waitForTimeout(450);const danceB=await diag();assert.ok(distance(danceA.bones.rightUpperArm,danceB.bones.rightUpperArm)>.01);
  await page.locator('#loop').check();await cmd({type:'settings',speed:2});
  await page.waitForTimeout(2500);assert.equal((await diag()).body.name,'dance');
  await page.locator('#reset').click();await cmd({type:'settings',loop:false,speed:1});
  await page.locator('[data-action=grace]').click();
  await page.waitForFunction(()=>window.petDiagnostics().body?.name==='grace');
  await page.waitForTimeout(800);const graceA=await diag();
  await page.waitForTimeout(800);const graceB=await diag();
  assert.equal(graceB.body.name,'grace');
  assert.ok(distance(graceA.bones.rightUpperArm,graceB.bones.rightUpperArm)>.02);
  assert.ok(graceB.expressions.happy>.4);
  await page.screenshot({path:'screenshots/grace.png',fullPage:true});
  await page.locator('#reset').click();await page.waitForTimeout(200);
  await page.locator('[data-action=blink]').click();await page.waitForTimeout(700);assert.equal((await diag()).face,null);assert.equal((await diag()).expressions.blink,0);
  // Native buttons must remain keyboard-operable (Space not stolen globally).
  await page.locator('[data-action=wave]').focus();await page.keyboard.press('Space');await page.waitForTimeout(100);assert.equal((await diag()).body.name,'wave');
  await cmd({type:'reset'});
  await page.setViewportSize({width:390,height:844});await page.locator('#view-full').click();await page.waitForTimeout(400);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:'screenshots/mobile.png',fullPage:true});
  assert.deepEqual(external,[],'Runtime must be offline');assert.deepEqual(errors,[],'No browser errors');
  await cmd({type:'settings',auto_blink:true,idle_motion:true});
  console.log('PASS: model, 8 actions, layered expressions, pause, reset, speed, loop, completion, keyboard, mobile, offline; no browser errors.');
} finally {await browser.close();}
