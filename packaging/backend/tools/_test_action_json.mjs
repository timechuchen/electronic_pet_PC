import { chromium } from 'playwright';
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1200},deviceScaleFactor:1});
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
await page.goto('http://127.0.0.1:8788');
await page.waitForFunction(()=>window.petDiagnostics?.().danceDuration,{timeout:60000});
async function cmd(data){return page.evaluate(async data=>{const c=await(await fetch('/api/config')).json();const r=await fetch('/api/command',{method:'POST',headers:{'Content-Type':'application/json','X-Pet-Token':c.token},body:JSON.stringify(data)});return r.json();},data);}
await cmd({type:'settings',auto_blink:false,idle_motion:false,loop:false,speed:1});
await cmd({type:'reset'});
await page.locator('#action-library summary').click();
await page.locator('#action-library-import').setInputFiles('/Users/chuchen/Work/EntrepreneurialProject/CustomElectronicPet/releases/轻舞-动作.json');
await page.waitForFunction(()=>document.querySelector('[data-action="custom_grace"]'),{timeout:15000});
console.log('imported, status:',await page.locator('#action-library-status').textContent());
await page.locator('[data-action="custom_grace"]').click();
await page.waitForFunction(()=>window.petDiagnostics().body?.name==='custom_grace',{timeout:5000});
console.log('body',JSON.stringify(await page.evaluate(()=>window.petDiagnostics().body)));
for(const target of [2.4,9.6,19.2]){
  const actual=await page.evaluate(async t=>{for(;;){const s=window.petDiagnostics();if(s.body&&s.body.time>=t)return s.body.time;await new Promise(r=>setTimeout(r,16));}},target);
  await cmd({type:'pause'});await page.waitForTimeout(120);
  console.log('target',target,'actual',actual.toFixed(2));
  await page.screenshot({path:`/Users/chuchen/Work/EntrepreneurialProject/CustomElectronicPet/project/screenshots/json-grace-${target}.png`});
  await cmd({type:'pause'});
}
console.log('happy',await page.evaluate(()=>window.petDiagnostics().expressions.happy));
console.log('errors',errors);
process.exit(0);
