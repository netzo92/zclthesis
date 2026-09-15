import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as model from '../public/bridge-model.mjs';
import {feeConfig,quoteFixture} from './bridge-fee-fixtures.mjs';
const source=(await readFile(new URL('../public/bridge.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/,'').replace(/import\('\.\/bridge-wallet\.mjs\?v=[^']+'\)/g,'Promise.resolve(walletModule)');
const walletAddress='11111111111111111111111111111111',regtest='tm'+'1'.repeat(33);
const config=()=>({schemaVersion:1,environment:'testnet',zclNetwork:'regtest',solanaNetwork:'devnet',tokenSymbol:'wZCL-TEST',decimals:8,mint:walletAddress,acceptingDeposits:true,acceptingRedemptions:true,minimumZat:'1000000',maximumZat:'1000000000',depositConfirmations:6,redemptionConfirmations:6,depositFeeZat:'0',redemptionFeeZat:'0',faucetEnabled:true,generatedAt:new Date().toISOString()});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness({lang='en',resume,fees=false}={}){
 const elements=new Map(),requests=[],events=new Map(),signed=[],storage=new Map(resume?[['zcl-test-bridge-operation',resume.id]]:[]);
 let now=0,uuid=0,connects=0,quotes=0;
 const create=()=>({textContent:'',value:'',hidden:false,disabled:false,dataset:{},children:[],listeners:new Map(),
  addEventListener(type,fn){this.listeners.set(type,fn);},setAttribute(name,value){this[name]=value;},append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=nodes;}});
 const get=id=>{if(!elements.has(id))elements.set(id,create());return elements.get(id);};
 get('bridge-amount').value='1';
 const radios=['deposit','redeem'].map(value=>Object.assign(create(),{value,checked:value==='deposit'}));
 const h={get,requests,signed,storage,config:fees?feeConfig():config(),current:resume??null,connects:()=>connects,
  walletResponse:{owner:walletAddress,mint:walletAddress,amountZat:'100000000',solLamports:'2000000000'}};
 const context=vm.createContext({...model,console,AbortController,URL,performance:{now:()=>now},Date,
  navigator:{onLine:true},crypto:{randomUUID:()=>`aaaaaaaa-aaaa-4aaa-8aaa-${String(++uuid).padStart(12,'0')}`},
  document:{documentElement:{lang},hidden:false,getElementById:get,createElement:create,querySelectorAll:()=>radios,addEventListener(type,fn){events.set(type,fn);}},
  window:{addEventListener(type,fn){events.set(type,fn);}},sessionStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},
  setTimeout(){return 1;},clearTimeout(){},setInterval(){return 1;},
  walletModule:{async connectTestWallet(){connects++;return {address:walletAddress};},async signTestTransaction(fields){signed.push(fields);await h.onSign?.();return 'signed-fixture';}},
  fetch:async(url,options)=>{
   const path=new URL(url,'https://test.invalid').pathname,body=options.body?JSON.parse(options.body):null;requests.push({path,method:options.method,body});
   let data;
   if(path.endsWith('/status'))data=h.config;
   else if(path.endsWith('/quotes')){h.quote=quoteFixture({...body,quoteId:String(++quotes).padStart(32,'0')});data=h.quoteResponse?await h.quoteResponse(h.quote):h.quote;}
   else if(path.endsWith('/wallet'))data=typeof h.walletResponse==='function'?await h.walletResponse():h.walletResponse;
   else if(path.endsWith('/test-address'))data={address:regtest,managed:true};
   else if(path.endsWith('/deposits')){h.current={id:'a'.repeat(32),kind:'deposit',state:'awaiting_deposit',recipient:body.recipient,amountZat:body.amountZat,depositAddress:regtest,...(fees?{feeQuote:structuredClone(h.quote)}:{})};data=h.current;}
   else if(path.endsWith('/faucet')){h.current={...h.current,state:fees?'awaiting_mint_signature':'completed',depositTxid:'b'.repeat(64),...(fees?{transactionBase64:'fixture-mint-transaction'}:{solanaSignature:'2'.repeat(88)})};data=h.current;}
   else if(path.endsWith('/redemptions')){h.current={id:'c'.repeat(32),kind:'redemption',state:'awaiting_signature',owner:body.owner,recipient:body.recipient,amountZat:body.amountZat,transactionBase64:'fixture-transaction',...(fees?{feeQuote:structuredClone(h.quote)}:{})};data=h.current;}
   else if(path.endsWith('/submit')){h.current={...h.current,state:'completed',solanaSignature:'3'.repeat(88),withdrawalTxid:'d'.repeat(64)};data=h.current;}
   else if(path.includes('/operations/'))data=h.current;
   else throw Error('Unexpected mock request '+path);
   return {ok:true,json:async()=>structuredClone(data)};
  },
 });
 vm.runInContext(source,context);
 h.flush=async()=>{await tick();await tick();};
 h.click=async id=>{await get(id).listeners.get('click')?.();await h.flush();};
 h.submit=async()=>{get('bridge-form').listeners.get('submit')({preventDefault(){}});await h.flush();};
 h.fill=async(id,value)=>{get(id).value=value;get(id).listeners.get('input')?.();await h.flush();};
 h.direction=async value=>{const radio=radios.find(r=>r.value===value);radio.listeners.get('change')();await h.flush();};
 h.review=async()=>{get('bridge-quote-reviewed').checked=true;get('bridge-quote-reviewed').listeners.get('change')();await h.flush();};
 h.evaluate=text=>vm.runInContext(text,context);h.advance=ms=>{now+=ms;};return h;
}
test('bridge viewing and restoring an intent never connects, funds, or signs automatically',async()=>{
 const op={id:'c'.repeat(32),kind:'redemption',state:'awaiting_signature',owner:walletAddress,recipient:regtest,amountZat:'100000000',transactionBase64:'fixture'};
 const h=harness({resume:op});await h.flush();
 assert.equal(h.requests.filter(x=>x.method==='POST').length,0);assert.equal(h.connects(),0);assert.equal(h.signed.length,0);
 assert.equal(h.get('bridge-sign').hidden,false);assert.equal(h.get('bridge-sign').disabled,true);
 assert.equal(h.get('bridge-recipient').value,regtest);assert.equal(h.get('bridge-deposit-steps').hidden,true);
});
test('both languages require explicit deposit funding and a separately reviewed exact redemption signature',async()=>{
 for(const lang of ['en','es']){
  const h=harness({lang});await h.flush();assert.equal(h.get('bridge-action').disabled,true);
  await h.fill('bridge-recipient',walletAddress);assert.equal(h.get('bridge-action').disabled,false);
  await h.submit();assert.equal(h.get('bridge-faucet').disabled,false);
  assert.equal(h.requests.filter(x=>x.path.endsWith('/faucet')).length,0);
  await h.click('bridge-faucet');assert.equal(h.get('bridge-action').disabled,false);
  await h.direction('redeem');await h.click('bridge-wallet-connect');await h.click('bridge-create-address');
  await h.submit();assert.equal(h.signed.length,0);assert.equal(h.get('bridge-sign').disabled,false);
  await h.click('bridge-sign');assert.equal(h.signed.length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(h.signed[0])),{transactionBase64:'fixture-transaction',expectedMint:walletAddress,owner:walletAddress,amountZat:'100000000',intentId:'c'.repeat(32),zclDestination:regtest});
  assert.equal(h.requests.filter(x=>x.path.endsWith('/submit')).length,1);
  assert.match(h.get('bridge-result-status').textContent,lang==='es'?/completada/:/completed/);
  assert.equal(h.storage.get('zcl-test-bridge-operation'),'c'.repeat(32));
 }
});
test('wrong-network or stale configuration closes actions, and a changed intent cannot replace its destination',async()=>{
 const h=harness();await h.flush();await h.fill('bridge-recipient',walletAddress);await h.submit();
 h.current={...h.current,recipient:'2'.repeat(43)};await h.click('bridge-result-refresh');
 assert.equal(h.get('bridge-recipient').value,walletAddress);assert.match(h.get('bridge-result-status').textContent,/Refresh unavailable/);
 h.config={...h.config,solanaNetwork:'mainnet-beta'};await h.click('bridge-status-refresh');assert.equal(h.get('bridge-wallet-connect').disabled,true);assert.equal(h.get('bridge-faucet').disabled,true);
 h.config=config();await h.click('bridge-status-refresh');h.advance(90001);h.evaluate('renderConfig()');
 assert.equal(h.get('bridge-action').disabled,true);assert.equal(h.get('bridge-sign').disabled,true);assert.equal(h.get('bridge-fee').textContent,'—');
});

test('stale generatedAt cannot renew configuration and incoming snapshot age counts toward expiry',async()=>{
 for(const lang of ['en','es']){
  const h=harness({lang});await h.flush();await h.fill('bridge-recipient',walletAddress);
  h.config={...config(),generatedAt:new Date(Date.now()-90001).toISOString()};await h.click('bridge-status-refresh');
  assert.equal(h.get('bridge-action').disabled,true);assert.equal(h.get('bridge-wallet-connect').disabled,true);
  h.config={...config(),generatedAt:new Date(Date.now()-80000).toISOString()};await h.click('bridge-status-refresh');
  assert.equal(h.get('bridge-action').disabled,false);h.advance(10001);h.evaluate('renderConfig()');
  assert.equal(h.get('bridge-action').disabled,true);assert.equal(h.get('bridge-fee').textContent,'—');
  assert.equal(h.requests.filter(x=>x.method==='POST').length,0);
 }
});

test('wallet amounts are displayed only for the requested owner and current test mint',async()=>{
 for(const lang of ['en','es']){
  const h=harness({lang});await h.flush();await h.click('bridge-wallet-connect');
  assert.match(h.get('bridge-wallet-balance').textContent,/wZCL-TEST: 1/);
  const valid={...h.walletResponse};
  for(const patch of [{owner:'2'.repeat(43)},{mint:'2'.repeat(43)},{owner:undefined},{mint:undefined},{amountZat:'-1'}]){
   h.walletResponse={...valid,...patch};await h.evaluate('refreshWallet()');
   assert.match(h.get('bridge-wallet-balance').textContent,lang==='es'?/no disponibles/:/unavailable/);
  }
  let resolve;h.walletResponse=()=>new Promise(done=>{resolve=done;});
  const pending=h.evaluate('refreshWallet()');await h.flush();
  h.config={...config(),mint:'2'.repeat(43)};await h.click('bridge-status-refresh');
  resolve(valid);await pending;
  assert.match(h.get('bridge-wallet-balance').textContent,lang==='es'?/no disponibles/:/unavailable/);
 }
});

test('review-required operations can be left explicitly without hiding unresolved funds or starting a new transfer',async()=>{
 for(const lang of ['en','es']){
  const op={id:'b'.repeat(32),kind:'deposit',state:'needs_review',recipient:walletAddress,depositAddress:regtest,amountZat:'100000000'};
  const h=harness({lang,resume:op});await h.flush();
  assert.equal(h.get('bridge-action').disabled,true);assert.equal(h.get('bridge-new-transfer').disabled,false);
  await h.click('bridge-new-transfer');
  assert.equal(h.get('bridge-action').disabled,false);assert.equal(h.requests.filter(x=>x.method==='POST').length,0);
  assert.match(h.get('bridge-result-status').textContent,lang==='es'?/revisión/:/review/);
  const notes=h.get('bridge-previous-operations').children;
  assert.equal(notes.length,1);assert.match(notes[0].textContent,lang==='es'?/no se da por completada ni reembolsada/:/no completion or refund is assumed/);
  assert.match(notes[0].textContent,new RegExp(op.id));assert.equal(notes[0].children[0].href,'/api/bridge/operations/'+op.id);
  h.evaluate("requestIdentity={key:'new-draft',id:'pending-retry-id'}");
  h.current={...op,state:'completed',depositTxid:'d'.repeat(64),solanaSignature:'2'.repeat(88)};await h.click('bridge-result-refresh');
  assert.equal(h.evaluate('requestIdentity.id'),'pending-retry-id','a previous operation resolving cannot reset a newer retry identity');
  await h.submit();assert.equal(h.current.id,'a'.repeat(32));assert.equal(h.get('bridge-previous-operations').children.length,1);
 }
});

test('expired unsigned redemption quotes disable signing and explain requesting a new intent in both languages',async()=>{
 for(const lang of ['en','es']){
  const op={id:'c'.repeat(32),kind:'redemption',state:'expired',owner:walletAddress,recipient:regtest,amountZat:'100000000'};
  const h=harness({lang,resume:op});await h.flush();
  assert.equal(h.get('bridge-sign').disabled,true);assert.equal(h.get('bridge-sign').hidden,true);
  assert.match(h.get('bridge-result-status').textContent,lang==='es'?/ha caducado; solicita un nuevo/:/expired; request a new/);
  assert.equal(h.get('bridge-recipient').value,regtest);assert.equal(h.get('bridge-deposit-steps').hidden,true);
  assert.equal(h.signed.length,0);assert.equal(h.requests.filter(x=>x.method==='POST').length,0);
  assert.equal(h.get('bridge-new-transfer').disabled,false);
  await h.click('bridge-new-transfer');await h.direction('deposit');await h.fill('bridge-amount','2');await h.fill('bridge-recipient',walletAddress);
  await h.click('bridge-result-refresh');
  assert.equal(h.get('bridge-amount').value,'2');assert.equal(h.get('bridge-recipient').value,walletAddress);
  assert.equal(h.get('bridge-deposit-steps').hidden,false,'refreshing the expired quote cannot overwrite a new draft');
 }
});
test('v2 deposits require matching wallet and explicit fee review, then atomic fee/mint signing in both languages',async()=>{
 for(const lang of ['en','es']){
  const h=harness({lang,fees:true});await h.flush();await h.fill('bridge-recipient',walletAddress);
  assert.equal(h.get('bridge-action').disabled,true);assert.equal(h.get('bridge-quote-request').disabled,true);assert.equal(h.get('bridge-fee').textContent,'—');
  await h.click('bridge-wallet-connect');await h.click('bridge-quote-request');
  assert.match(h.get('bridge-fee').textContent,lang==='es'?/0,000003 SOL/:/0\.000003 SOL/);
  assert.equal(h.get('bridge-net').textContent,'1 wZCL-TEST');assert.equal(h.get('bridge-action').disabled,true);
  await h.review();assert.equal(h.get('bridge-action').disabled,false);await h.submit();
  const creation=h.requests.find(x=>x.path.endsWith('/deposits'));assert.equal(creation.body.quoteId,h.quote.quoteId);assert.equal(h.signed.length,0);
  await h.click('bridge-faucet');assert.equal(h.current.state,'awaiting_mint_signature');assert.equal(h.get('bridge-sign').disabled,false);
  h.advance(300001);await h.click('bridge-status-refresh');assert.equal(h.get('bridge-sign').disabled,false,'creation quote expiry does not invalidate an accepted operation');
  await h.click('bridge-sign');assert.equal(h.signed.length,1);assert.equal(h.signed[0].kind,'deposit');assert.equal(h.signed[0].recipient,walletAddress);assert.equal(h.signed[0].mintAuthority,h.quote.feeRecipient);assert.equal(h.signed[0].feeQuote.quoteId,h.quote.quoteId);
  assert.equal(h.requests.filter(x=>x.path==='/api/bridge/deposits/'+h.current.id+'/submit').length,1);assert.equal(h.current.state,'completed');
  assert.match(h.get('bridge-result-fees').textContent,lang==='es'?/0,000003 SOL/:/0\.000003 SOL/);assert.match(h.get('bridge-result-fees').textContent,/1 wZCL-TEST/);
 }
});
test('v2 redemption displays and signs exact bridge deduction, native fee and immutable net',async()=>{
 for(const lang of ['en','es']){
  const h=harness({lang,fees:true});await h.flush();await h.direction('redeem');await h.click('bridge-wallet-connect');await h.click('bridge-create-address');await h.click('bridge-quote-request');
  assert.equal(h.get('bridge-fee').textContent,(lang==='es'?'0,001':'0.001')+' ZCL');assert.equal(h.get('bridge-native-fee').textContent,(lang==='es'?'0,0001':'0.0001')+' ZCL');assert.equal(h.get('bridge-net').textContent,(lang==='es'?'0,9989':'0.9989')+' ZCL');
  await h.review();await h.submit();await h.click('bridge-sign');
  assert.equal(h.signed[0].kind,'redemption');assert.equal(h.signed[0].feeQuote.netAmountZat,'99890000');assert.equal(h.signed[0].zclDestination,regtest);
  assert.match(h.get('bridge-result-fees').textContent,lang==='es'?/0,9989 ZCL/:/0\.9989 ZCL/);
  await h.fill('bridge-amount','2');assert.equal(h.get('bridge-fee').textContent,'—');assert.match(h.get('bridge-result-fees').textContent,lang==='es'?/0,9989 ZCL/:/0\.9989 ZCL/);
 }
});
test('amount, recipient, direction, or expiry invalidates the reviewed quote before operation creation',async()=>{
 for(const change of ['amount','recipient','direction','expiry']){
  const h=harness({fees:true});await h.flush();await h.click('bridge-wallet-connect');await h.click('bridge-quote-request');await h.review();assert.equal(h.get('bridge-action').disabled,false);
  if(change==='amount')await h.fill('bridge-amount','2');
  if(change==='recipient')await h.fill('bridge-recipient','2'.repeat(43));
  if(change==='direction')await h.direction('redeem');
  if(change==='expiry'){h.advance(300001);await h.click('bridge-status-refresh');}
  assert.equal(h.get('bridge-action').disabled,true,change);assert.equal(h.get('bridge-quote-reviewed').checked,false,change);await h.submit();
  assert.equal(h.requests.filter(x=>x.path.endsWith('/deposits')||x.path.endsWith('/redemptions')).length,0);
 }
});
test('tampered conversion or an altered accepted snapshot cannot enable creation or replace an operation',async()=>{
 const h=harness({fees:true});await h.flush();await h.click('bridge-wallet-connect');
 h.quoteResponse=quote=>({...quote,feeLamports:'1'});await h.click('bridge-quote-request');await h.review();assert.equal(h.get('bridge-action').disabled,true);assert.equal(h.get('bridge-fee').textContent,'—');
 h.quoteResponse=null;await h.click('bridge-quote-request');await h.review();await h.submit();const accepted=h.get('bridge-result-fees').textContent;
 h.current={...h.current,feeQuote:{...h.current.feeQuote,quoteId:'f'.repeat(32)}};await h.click('bridge-result-refresh');
 assert.match(h.get('bridge-result-status').textContent,/Refresh unavailable/);assert.equal(h.get('bridge-result-fees').textContent,accepted);
});
test('a refreshed mint transaction during the wallet prompt preserves the deposit and requires a new signature',async()=>{
 for(const lang of ['en','es']){
  const h=harness({lang,fees:true});await h.flush();await h.click('bridge-wallet-connect');await h.click('bridge-quote-request');await h.review();await h.submit();await h.click('bridge-faucet');
  h.onSign=()=>{h.current={...h.current,transactionBase64:'refreshed-fixture-mint'};};await h.click('bridge-sign');
  assert.equal(h.requests.filter(x=>x.path.endsWith('/submit')).length,0);assert.equal(h.current.state,'awaiting_mint_signature');assert.equal(h.storage.get('zcl-test-bridge-operation'),h.current.id);
  assert.match(h.get('bridge-action-reason').textContent,lang==='es'?/No envíes otro depósito/:/Do not send another deposit/);
  h.onSign=null;await h.click('bridge-sign');assert.equal(h.signed.length,2);assert.equal(h.signed[1].transactionBase64,'refreshed-fixture-mint');
  assert.equal(h.current.state,'completed');assert.equal(h.requests.filter(x=>x.path.endsWith('/deposits')).length,1);
 }
});
test('both HTML pages expose equivalent explicit review controls and version the fee wallet entry',async()=>{
 for(const path of ['../public/bridge/index.html','../public/es/bridge/index.html']){
  const html=await readFile(new URL(path,import.meta.url),'utf8');
  for(const id of ['bridge-quote-request','bridge-quote-reviewed','bridge-quote-status','bridge-rate-reference','bridge-native-fee','bridge-result-fees'])assert.equal(html.split('id="'+id+'"').length,2,id);
  assert.match(html,/bridge\.mjs\?v=20260915-fees/);assert.match(html,/0[.,]1\s?%/);
 }
});
test('full admission capacity still permits existing fee settlement, but missing or false processing readiness blocks it',async()=>{
 const h=harness({fees:true});await h.flush();await h.click('bridge-wallet-connect');await h.click('bridge-quote-request');await h.review();await h.submit();
 h.config={...h.config,acceptingDeposits:false,acceptingRedemptions:false};await h.click('bridge-status-refresh');
 assert.equal(h.get('bridge-faucet').disabled,false);assert.match(h.get('bridge-status').textContent,/existing transfers can finish/);await h.click('bridge-faucet');assert.equal(h.get('bridge-sign').disabled,false);
 for(const processingAvailable of [false,undefined,'true']){h.config={...h.config,processingAvailable};await h.click('bridge-status-refresh');assert.equal(h.get('bridge-sign').disabled,true);}
 h.config={...feeConfig(),acceptingDeposits:false,acceptingRedemptions:false};await h.click('bridge-status-refresh');await h.click('bridge-sign');assert.equal(h.current.state,'completed');
 const op={id:'c'.repeat(32),kind:'redemption',state:'awaiting_signature',owner:walletAddress,recipient:regtest,amountZat:'100000000',feeQuote:quoteFixture({kind:'redemption'}),transactionBase64:'fixture'};
 const redemption=harness({fees:true,resume:op});await redemption.flush();await redemption.click('bridge-wallet-connect');redemption.config={...redemption.config,acceptingDeposits:false,acceptingRedemptions:false};await redemption.click('bridge-status-refresh');assert.equal(redemption.get('bridge-sign').disabled,false);
});
