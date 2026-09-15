import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable,PassThrough} from 'node:stream';
import {EventEmitter} from 'node:events';
import {createBridgeRelay} from '../bridge-relay.mjs';
async function request(relay,{method='GET',path='/status',headers={},body=[]}={}){
 const req=Readable.from(body.map(b=>Buffer.from(b)));
 Object.assign(req,{method,url:'/api/bridge'+path,headers});
 const result={headers:{}};
 const res={setHeader(k,v){result.headers[k.toLowerCase()]=v;},writeHead(code){result.status=code;},end(value){result.body=value===undefined?null:JSON.parse(value);}};
 await relay(req,res);return result;
}
const endpoint='https://bridge-testnet.zclthesis.com';
const authorized={origin:'https://zclthesis.com','content-type':'application/json'};
test('unconfigured relay advertises closed test networks and cannot create deposits',async()=>{
 const relay=createBridgeRelay({endpoint:'',fetcher(){assert.fail('No unconfigured upstream requests');}});
 const status=await request(relay);
 assert.equal(status.status,200);assert.equal(status.headers['cache-control'],'no-store');
 for(const field of ['acceptingDeposits','acceptingRedemptions','faucetEnabled'])assert.equal(status.body[field],false);
 assert.equal(status.body.mint,null);assert.equal(status.body.zclNetwork,'regtest');assert.equal(status.body.solanaNetwork,'devnet');
 assert.equal((await request(relay,{path:'/deposits',method:'POST',headers:authorized,body:['{}']})).status,503);
 assert.equal((await request(relay,{method:'HEAD'})).body,null);
 assert.throws(()=>createBridgeRelay({endpoint:'https://example.com'}),/Unexpected/);
});
test('relay rejects arbitrary paths, methods, cross-origin posts and non-JSON bodies before forwarding',async()=>{
 const relay=createBridgeRelay({endpoint,fetcher(){assert.fail('Rejected requests must not be forwarded');}});
 for(const options of [{path:'/wallet.dat'},{path:'/../status'},{path:'/operations/'+'z'.repeat(32)}])assert.equal((await request(relay,options)).status,404);
 assert.equal((await request(relay,{method:'DELETE'})).status,405);
 for(const headers of [{},{...authorized,origin:'https://other.example'},{...authorized,'content-type':'text/plain'}])assert.equal((await request(relay,{method:'POST',path:'/deposits',headers})).status,403);
 assert.equal((await request(relay,{method:'POST',path:'/deposits',headers:authorized,body:['x'.repeat(12001)]})).status,413);
});
test('relay forwards only fixed test host, explicit headers and bounded JSON; HEAD omits body',async()=>{
 const calls=[];
 const relay=createBridgeRelay({endpoint,fetcher:async(url,options)=>{calls.push({url:String(url),options});return new Response('{"ok":true}',{status:201});}});
 const result=await request(relay,{method:'POST',path:'/deposits',headers:{...authorized,cookie:'private-cookie',authorization:'private-auth'},body:['{"amountZat":"1000000"}']});
 assert.equal(result.status,201);assert.deepEqual(result.body,{ok:true});
 assert.equal(calls[0].url,endpoint+'/deposits');assert.equal(calls[0].options.redirect,'error');
 assert.deepEqual(calls[0].options.headers,{'Content-Type':'application/json',Origin:'https://zclthesis.com'});
 assert.equal(calls[0].options.body.toString(),'{"amountZat":"1000000"}');
 assert.equal((await request(relay,{method:'HEAD'})).body,null);assert.equal(calls[1].options.method,'GET');
});
test('unavailable, malformed or oversized upstream returns generic retry guidance',async()=>{
 for(const fetcher of [async()=>{throw Error('private internal detail');},async()=>new Response('not-json'),async()=>new Response('x'.repeat(131073))]){
  const r=await request(createBridgeRelay({endpoint,fetcher}));
  assert.equal(r.status,503);assert.match(r.body.error,/existing operation/);assert.doesNotMatch(JSON.stringify(r),/private internal/);
 }
});

test('a disconnected client body is handled without an unhandled request rejection',async()=>{
 const relay=createBridgeRelay({endpoint,fetcher(){assert.fail('Broken bodies must not reach upstream');}});
 const req=Readable.from((async function*(){yield Buffer.from('{');throw Error('private stream failure');})());
 Object.assign(req,{method:'POST',url:'/api/bridge/deposits',headers:authorized});
 let status,body;
 await relay(req,{setHeader(){},writeHead(code){status=code;},end(text){body=JSON.parse(text);}});
 assert.equal(status,400);assert.equal(body.error,'The request body could not be read');
});

test('an unfinished upload has a finite deadline, releases listeners, and never reaches upstream',async()=>{
 const relay=createBridgeRelay({endpoint,uploadTimeoutMs:20,fetcher(){assert.fail('Incomplete uploads must not be forwarded');}});
 const req=new PassThrough();Object.assign(req,{method:'POST',url:'/api/bridge/deposits',headers:authorized});
 const res=new EventEmitter(),headers={};let status,body;
 Object.assign(res,{setHeader(key,value){headers[key]=value;},writeHead(code){status=code;},end(value){body=JSON.parse(value);this.emit('finish');}});
 const pending=relay(req,res);req.write('{');await pending;
 assert.equal(status,408);assert.match(body.error,/nothing was forwarded/);assert.equal(headers.Connection,'close');
 assert.equal(req.destroyed,true);
 for(const event of ['data','end','error','aborted','close'])assert.equal(req.listenerCount(event),0,event);
 for(const uploadTimeoutMs of [0,-1,10001,NaN,1.5])assert.throws(()=>createBridgeRelay({uploadTimeoutMs}),/deadline/);
});

test('aborted uploads return a bounded failure, while a complete split upload clears its deadline',async()=>{
 let forwarded=0;
 const relay=createBridgeRelay({endpoint,uploadTimeoutMs:20,fetcher:async()=>{forwarded++;return new Response('{"ok":true}');}});
 const req=new PassThrough();Object.assign(req,{method:'POST',url:'/api/bridge/deposits',headers:authorized});
 let code,body;
 const pending=relay(req,{setHeader(){},writeHead(value){code=value;},end(value){body=JSON.parse(value);}});
 req.write('{');req.emit('aborted');await pending;req.destroy();
 assert.equal(code,400);assert.equal(forwarded,0);assert.match(body.error,/could not be read/);
 const result=await request(relay,{method:'POST',path:'/deposits',headers:authorized,body:['{"amountZat":','"1000000"}']});
 assert.equal(result.status,200);assert.deepEqual(result.body,{ok:true});assert.equal(forwarded,1);
});
test('fee quotes and deposit signatures use only bounded authorized POST routes',async()=>{
 const paths=[],relay=createBridgeRelay({endpoint,fetcher:async(url)=>{paths.push(new URL(url).pathname);return new Response('{"ok":true}');}});
 for(const path of ['/quotes','/deposits/'+'a'.repeat(32)+'/submit']){
  assert.equal((await request(relay,{path,method:'POST',headers:authorized,body:['{}']})).status,200);
  assert.equal((await request(relay,{path})).status,405);
  assert.equal((await request(relay,{path,method:'POST',headers:authorized,body:['x'.repeat(12001)]})).status,413);
 }
 assert.deepEqual(paths,['/quotes','/deposits/'+'a'.repeat(32)+'/submit']);
 assert.equal((await request(relay,{path:'/status',method:'POST',headers:authorized,body:['{}']})).status,405);
});
