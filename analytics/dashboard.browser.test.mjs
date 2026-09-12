// Isolated UI regression: synthetic summaries, a strict CSP and no real analytics.
// CHROME_BIN must name an installed trusted Chromium executable. Never uses an existing profile.
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';

if(!process.env.CHROME_BIN) throw Error('Set CHROME_BIN to an installed trusted Chromium executable');
const profile=await mkdtemp(join(tmpdir(),'zcl-analytics-check-'));
const debugPort=Number(process.env.CHROME_DEBUG_PORT||9419);
let mode='normal';const apiCalls=[];
function summary(days){
  const daily=Array.from({length:days},(_,i)=>({date:new Date(Date.UTC(2026,8,13-days+i)).toISOString().slice(0,10),visitors:4+i,visits:8+i,pageviews:12+i,referralClicks:i%3}));
  return {recordingStarted:'2026-09-01T12:30:00Z',generatedAt:new Date().toISOString(),days,from:daily[0].date,to:daily.at(-1).date,
    totals:{visitors:123,visits:456,pageviews:789,referralClicks:34,clickingVisits:20,clickRate:4.39},daily,
    pages:[{path:'/',pageviews:450,referralClicks:20},{path:'/es/',pageviews:339,referralClicks:14},{path:'//evil.example/',pageviews:1,referralClicks:0},{path:'<img src=x onerror=alert(1)>',pageviews:1,referralClicks:0}],
    sources:[{source:'Direct / unclassified',visits:300,referralClicks:20},{source:'Search',visits:156,referralClicks:14},{source:'<script>alert(1)</script>',visits:1,referralClicks:0}],lastEventAt:'2026-09-12T10:45:00Z'};
}
const csp="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  res.setHeader('Content-Security-Policy',csp);res.setHeader('Cache-Control','no-store');
  if(url.pathname==='/api/summary'){
    const days=Number(url.searchParams.get('days'));apiCalls.push(days);
    const currentMode=mode;
    if(currentMode==='race'&&days===30)await delay(250);
    if(currentMode==='error'){res.writeHead(503);res.end('Unavailable');return;}
    const data=summary(days);
    if(currentMode==='invalid')data.totals.clickRate=400;
    if(currentMode==='empty'){
      for(const key of Object.keys(data.totals))data.totals[key]=0;
      for(const row of data.daily)for(const key of ['visitors','visits','pageviews','referralClicks'])row[key]=0;
      data.pages=[];data.sources=[];data.lastEventAt=null;
    }
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));return;
  }
  if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
  const files={'/':'dashboard.html','/dashboard.css':'dashboard.css','/dashboard.js':'dashboard.js'};
  if(!files[url.pathname]){res.writeHead(404);res.end();return;}
  const file=files[url.pathname];res.setHeader('Content-Type',file.endsWith('html')?'text/html':file.endsWith('css')?'text/css':'text/javascript');
  res.end(await readFile(new URL(file,import.meta.url)));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const chrome=spawn(process.env.CHROME_BIN,[`--remote-debugging-port=${debugPort}`,'--remote-allow-origins=*','--no-first-run',`--user-data-dir=${profile}`,'--disable-gpu','about:blank'],{stdio:'ignore'});
let ws;
try{
  let targets;
  for(let i=0;i<100;i++){try{targets=await(await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();break;}catch{}await delay(100);}
  assert(targets,'isolated browser started');
  ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  let id=0;const pending=new Map(),errors=[],requests=[];
  ws.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id){const p=pending.get(message.id);pending.delete(message.id);message.error?p.reject(Error(JSON.stringify(message.error))):p.resolve(message.result);}if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.text);if(message.method==='Network.requestWillBeSent')requests.push(message.params.request.url);});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));});
  const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.text);return result.result.value;};
  const waitFor=async expression=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await delay(30);}throw Error('Condition not reached: '+expression);};
  await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__csp=[];window.__intervals=[];const original=setInterval;window.setInterval=(fn,ms)=>{window.__intervals.push({fn,ms});return original(fn,ms)};document.addEventListener('securitypolicyviolation',e=>window.__csp.push(e.violatedDirective));`});
  await send('Page.navigate',{url:origin});
  await waitFor(`document.querySelector('#observation')?.dataset.state==='ready'`);
  assert.equal(await evaluate(`document.querySelector('#click-rate').textContent`),'4.39%','rate is already a percentage');
  assert.equal(await evaluate(`document.querySelector('#visitors').textContent`),'123');
  assert.equal(await evaluate(`document.querySelectorAll('[style],script:not([src])').length`),0,'no inline script/style');
  assert.equal(await evaluate(`document.querySelectorAll('tbody img,tbody script').length`),0,'server labels cannot inject DOM');
  assert.equal(await evaluate(`[...document.querySelectorAll('#pages-body a')].every(a=>a.origin==='https://zclthesis.com'&&a.rel.includes('noopener'))`),true,'only safe public-page links');
  assert.equal(await evaluate(`document.cookie===''&&localStorage.length===0&&sessionStorage.length===0`),true,'dashboard stores no identifiers');
  const layouts=[];
  for(const width of [320,390,768,1440]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:false});
    assert.equal(await evaluate('document.documentElement.scrollWidth'),width,'no document overflow');
    layouts.push(width);
    if(process.env.DASHBOARD_SCREENSHOT_DIR&&(width===390||width===1440)){
      const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
      await writeFile(join(process.env.DASHBOARD_SCREENSHOT_DIR,`zcl-analytics-${width}.png`),Buffer.from(shot.data,'base64'));
    }
  }
  for(const days of [1,30,90,7]){
    await evaluate(`document.querySelector('#period').value='${days}';document.querySelector('#period').dispatchEvent(new Event('change'))`);
    await waitFor(`document.querySelector('#observation').dataset.state==='ready'&&document.querySelector('#daily-plot').children.length===${days}`);
  }
  await evaluate(`document.querySelector('.day-column').focus();document.querySelector('.day-column').click()`);
  assert.match(await evaluate(`document.querySelector('#day-detail').textContent`),/Sep 6, 2026/,'keyboard-accessible daily details');
  const beforeAuto=apiCalls.length;
  await evaluate(`window.__intervals.find(x=>x.ms===60000).fn()`);await delay(80);
  assert.equal(apiCalls.length,beforeAuto,'automatic refresh is opt in');
  await evaluate(`document.querySelector('#auto-refresh').checked=true;Object.defineProperty(document,'hidden',{configurable:true,value:true});window.__intervals.find(x=>x.ms===60000).fn()`);await delay(80);
  assert.equal(apiCalls.length,beforeAuto,'hidden pages do not refresh automatically');
  await evaluate(`Object.defineProperty(document,'hidden',{configurable:true,value:false});window.__intervals.find(x=>x.ms===60000).fn()`);
  await waitFor(`document.querySelector('#observation').dataset.state==='ready'`);
  assert.equal(apiCalls.length,beforeAuto+1,'visible opt-in refresh runs');
  mode='error';await evaluate(`document.querySelector('#period').value='30';document.querySelector('#period').dispatchEvent(new Event('change'))`);
  await waitFor(`document.querySelector('#observation').dataset.state==='error'`);
  assert.equal(await evaluate(`document.querySelector('#visitors').textContent`),'123','failed refresh retains valid values');
  assert.match(await evaluate(`document.querySelector('#error').textContent`),/last successful result/);
  await send('Page.navigate',{url:origin});await waitFor(`document.querySelector('#observation')?.dataset.state==='error'`);
  assert.equal(await evaluate(`document.querySelector('#visitors').textContent`),'—','initial failure never invents zeros');
  mode='invalid';await evaluate(`document.querySelector('#refresh').click()`);await waitFor(`document.querySelector('#observation').dataset.state==='error'`);
  assert.equal(await evaluate(`document.querySelector('#visitors').textContent`),'—','invalid numeric payload rejected');
  mode='empty';await evaluate(`document.querySelector('#refresh').click()`);await waitFor(`document.querySelector('#observation').dataset.state==='ready'`);
  assert.equal(await evaluate(`document.querySelector('#visits').textContent`),'0','valid empty collection shows real zero');
  assert.match(await evaluate(`document.querySelector('#status').textContent`),/No recorded events/);
  assert.equal(await evaluate(`document.querySelector('#last-event').textContent`),'No event received');
  mode='race';await evaluate(`document.querySelector('#period').value='30';document.querySelector('#period').dispatchEvent(new Event('change'));document.querySelector('#period').value='90';document.querySelector('#period').dispatchEvent(new Event('change'))`);
  await waitFor(`document.querySelector('#observation').dataset.state==='ready'&&document.querySelector('#daily-plot').children.length===90`);await delay(300);
  assert.equal(await evaluate(`document.querySelector('#daily-plot').children.length`),90,'superseded response cannot replace selected range');
  assert.deepEqual(await evaluate('window.__csp'),[],'strict CSP has no violations');assert.deepEqual(errors,[],'no unhandled browser exceptions');
  assert(requests.every(url=>url.startsWith(origin)||url==='about:blank'),'no third-party requests');
  console.log(JSON.stringify({passed:true,layouts,checks:['safe DOM and links','strict self-only CSP','all date ranges','daily detail control','no browser storage','visible opt-in refresh','failed refresh preserves data','initial error keeps dashes','invalid response rejected','real zero collection','superseded request ignored','no external requests']},null,2));
} finally {ws?.close();chrome.kill('SIGTERM');server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await delay(250);await rm(profile,{recursive:true,force:true});}
