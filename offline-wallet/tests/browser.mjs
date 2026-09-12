// Manual browser validation; CHROME_BIN must point to a trusted Chromium executable.
// Only the public scalar 1 is generated. All browser RNG calls are stubbed; no fresh private keys or key screenshots.
import {spawn} from 'node:child_process';
import {writeFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';

if (!process.env.CHROME_BIN) throw new Error('Set CHROME_BIN to a Chromium executable');
const port = Number(process.env.CHROME_DEBUG_PORT || 9367);
const profile = await mkdtemp(join(tmpdir(),'zcl-offline-check-'));
const chrome = spawn(process.env.CHROME_BIN,[`--remote-debugging-port=${port}`,'--remote-allow-origins=*','--no-first-run',`--user-data-dir=${profile}`,'--disable-gpu','about:blank'],{stdio:'ignore'});
let ws;
try {
  let targets;
  for(let i=0;i<100;i++){try{targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();break;}catch{}await delay(100);}
  assert(targets,'Chromium started');
  ws = new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  let id=0;const pending=new Map(),errors=[],requests=[],loaded=new Set();
  ws.addEventListener('message',event=>{
    const data=JSON.parse(event.data);
    if(data.id){const p=pending.get(data.id);if(p){pending.delete(data.id);data.error?p.reject(Error(JSON.stringify(data.error))):p.resolve(data.result);}}
    if(data.method==='Runtime.exceptionThrown')errors.push(data.params.exceptionDetails.text);
    if(data.method==='Network.requestWillBeSent')requests.push(data.params.request.url);
    if(data.method==='Page.lifecycleEvent'&&data.params.name==='load')loaded.add(data.params.loaderId);
  });
  const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value;};
  const navigate=async url=>{
    const result=await send('Page.navigate',{url});
    for(let i=0;i<100&&!loaded.has(result.loaderId);i++)await delay(100);
    assert(loaded.has(result.loaderId),'document loaded');
  };
  await send('Page.enable');await send('Page.setLifecycleEventsEnabled',{enabled:true});await send('Runtime.enable');await send('Network.enable');
  await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  const hook=await send('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.__testRngCalls=0;
    Object.defineProperty(globalThis.crypto,'getRandomValues',{configurable:true,value(bytes){if(bytes.length===32)window.__testRngCalls++;bytes.fill(0);bytes[bytes.length-1]=1;return bytes;}});
    window.confirm=()=>true;
  `});
  const file=new URL('../../public/offline-wallet.html',import.meta.url).href;
  await navigate(file);
  assert.equal(await evaluate('navigator.onLine'),false);
  assert.equal(await evaluate('window.__testRngCalls'),0,'no generation on load');
  assert.equal(await evaluate('document.getElementById("generate").disabled'),true);
  assert.equal(await evaluate('document.getElementById("result").hidden'),true);
  const report={offline:true,layouts:[],checks:[]};
  for(const lang of ['en','es']) {
    await evaluate(`document.querySelector('[data-language=${lang}]').click()`);
    assert.equal(await evaluate('document.documentElement.lang'),lang);
    assert.equal(await evaluate('[...document.querySelectorAll("[data-text]")].every(e=>e.textContent.length>0)'),true,'all strings translated');
    for(const width of [320,390,768,1440]){
      await send('Emulation.setDeviceMetricsOverride',{width,height:1050,deviceScaleFactor:1,mobile:false});
      assert.equal(await evaluate('document.documentElement.scrollWidth'),width,'no horizontal overflow');
      report.layouts.push({lang,width});
      if(process.env.WALLET_SCREENSHOT_DIR&&((lang==='en'&&width===1440)||(lang==='es'&&width===390))) {
        const image=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
        await writeFile(join(process.env.WALLET_SCREENSHOT_DIR,`zcl-offline-${lang}-${width}.png`),Buffer.from(image.data,'base64'));
      }
    }
  }
  await evaluate('document.getElementById("ack").click();document.getElementById("generate").click()');
  assert.equal(await evaluate('window.__testRngCalls'),1,'one explicit CSPRNG sample');
  assert.equal(await evaluate('document.getElementById("address").textContent'),'t1UYsZVJkLPeMjxEtACvSxfWuNmddpWfxzs');
  assert.equal(await evaluate('document.getElementById("private-key").textContent.includes("KwDi")'),false,'private key hidden');
  assert.equal(await evaluate('document.getElementById("backup").disabled'),true);
  await evaluate('document.getElementById("reveal").click()');
  assert.equal(await evaluate('document.getElementById("private-key").textContent'),'KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73sVHnoWn');
  await evaluate('document.querySelector("[data-language=en]").click()');
  assert.equal(await evaluate('window.__testRngCalls'),1,'language change does not regenerate');
  await evaluate('document.getElementById("reveal").click()');
  assert.equal(await evaluate('document.getElementById("private-key").textContent'),'Private key hidden');
  // Capture backup Blob in memory only; never create a physical secret file in tests.
  await evaluate(`window.__backupText='';window.__downloads=0;URL.createObjectURL=blob=>{blob.text().then(text=>window.__backupText=text);return 'blob:test-only';};URL.revokeObjectURL=()=>{};HTMLAnchorElement.prototype.click=function(){window.__downloads++;}`);
  await evaluate('document.getElementById("backup-ack").click();document.getElementById("backup").click()');
  assert.equal(await evaluate('window.__downloads'),1);
  assert.equal(await evaluate('window.__backupText.includes("UNENCRYPTED") && window.__backupText.includes("t1UYsZVJkLPeMjxEtACvSxfWuNmddpWfxzs") && window.__backupText.includes("KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73sVHnoWn")'),true);
  await evaluate('document.getElementById("clear").click()');
  assert.equal(await evaluate('document.getElementById("address").textContent'),'');
  assert.equal(await evaluate('document.getElementById("result").hidden'),true);
  assert.equal(await evaluate('document.getElementById("generate").disabled'),true);
  // A throwing browser CSPRNG must fail without any wallet output.
  await evaluate('Object.defineProperty(crypto,"getRandomValues",{configurable:true,value(){throw Error("test denial");}});document.getElementById("ack").click();document.getElementById("generate").click()');
  assert.equal(await evaluate('document.getElementById("result").hidden'),true);
  assert.equal(await evaluate('document.getElementById("status").textContent.startsWith("Generation failed")'),true);
  await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:hook.identifier});
  await send('Page.addScriptToEvaluateOnNewDocument',{source:'Object.defineProperty(globalThis.crypto,"getRandomValues",{value:undefined});'});
  await navigate(file);
  await evaluate('document.getElementById("ack").click()');
  assert.equal(await evaluate('document.getElementById("generate").disabled'),true,'missing CSPRNG disables generation');
  assert.equal(await evaluate('document.getElementById("crypto-error").hidden'),false);
  assert.deepEqual(errors,[],'no unhandled browser errors');
  assert.deepEqual(requests.filter(url=>!url.startsWith('file:')),[],'no network requests');
  report.checks=['no automatic generation','explicit CSPRNG sample','known ZCL vector','hidden WIF','language preserves wallet','explicit unencrypted backup','clear','throwing RNG fails closed','missing RNG disabled','no network requests','no browser errors'];
  console.log(JSON.stringify(report,null,2));
} finally {
  ws?.close();chrome.kill('SIGTERM');
  await delay(250);await rm(profile,{recursive:true,force:true});
}
