import test from 'node:test';
import assert from 'node:assert/strict';
import {address} from '../scripts/chainstate.mjs';
import {validateRichList,validateNodeContext,packageRichList} from '../richlist-data.mjs';
import {parseZecRichList,createRichListStore,createRichListComparison,ZCL_RICHLIST_URL,ZEC_RICHLIST_URL,fetchDocument} from '../richlist-feeds.mjs';

const now=Date.parse('2026-09-12T06:00:00Z');
const addresses=Array.from({length:100},(_,i)=>{
 const hash=Buffer.alloc(20);hash.writeUInt32BE(i,16);
 return {address:address(Buffer.concat([Buffer.from('76a914','hex'),hash,Buffer.from('88ac','hex')])),balanceZatoshis:String((100-i)*100000001)};
});
const sum=rows=>rows.reduce((n,a)=>n+BigInt(a.balanceZatoshis),0n).toString();
function fixture(){return {
 raw:{success:true,addresses:addresses.map((a,i)=>({rank:i+1,address:a.address,balanceZat:a.balanceZatoshis,label:'not imported'})),pagination:{total:850000,offset:0,limit:100},concentration:{top10Zat:sum(addresses.slice(0,10)),top100Zat:sum(addresses),totalAddressedZat:'1000000000000',directAddresslessZat:'123',totalTransparentZat:'1000000000123'}},
 headers:{date:new Date(now).toUTCString(),'x-cipherscan-indexed-height':'3480477','x-cipherscan-cache':'HIT'},
 block:{height:'3480477',hash:'b'.repeat(64),timestamp:String(now/1000-60)}
};}
function own(){return {snapshot:{verification:'own-node-snapshot',source:'https://pool.zclthesis.com',height:3247700,hash:'a'.repeat(64),commitment:'c'.repeat(64),blockAt:new Date(now-60000).toISOString(),generatedAt:new Date(now).toISOString(),totalZatoshis:sum(addresses),unattributedZatoshis:'0',utxoCount:100,addressCount:100,bootstrapValidation:'anchored-fast-sync',scope:'transparent-utxos'},addresses:addresses.map(a=>({...a,utxoCount:1,oldestHeight:100000,newestHeight:100000,aged100kZatoshis:a.balanceZatoshis,aged500kZatoshis:a.balanceZatoshis,aged1mZatoshis:a.balanceZatoshis}))};}
test('validates exact ZEC balances, coverage and within-response concentration totals without importing owner labels',()=>{
 const f=fixture(),p=parseZecRichList(f.raw,f.headers,f.block,now);
 assert.equal(p.coverage,'top-100');assert.equal(p.addressCount,850000);assert.equal(p.addresses.length,100);assert.equal(p.totalZatoshis,'1000000000123');assert.equal(p.addresses[0].label,undefined);
 for(const change of [f=>f.raw.concentration.top10Zat='1',f=>f.raw.concentration.totalTransparentZat='1000000000124',f=>f.raw.addresses[5]=f.raw.addresses[4],f=>f.raw.addresses[0].balanceZat=100,f=>f.raw.pagination.offset=100,f=>f.block.height='123',f=>f.headers['x-cipherscan-cache']='STALE',f=>delete f.headers['x-cipherscan-indexed-height']]){const d=fixture();change(d);assert.throws(()=>parseZecRichList(d.raw,d.headers,d.block,now));}
});
test('own-node snapshots require the configured source, trust label and complete reconciled address data',()=>{
 const d=own();assert.equal(validateRichList(d,now),d);assert.equal(validateNodeContext(d.snapshot,now),d.snapshot);
 for(const change of [d=>d.snapshot.source='https://example.org',d=>d.snapshot.bootstrapValidation='fully-verified',d=>d.snapshot.totalZatoshis='1',d=>d.snapshot.verification='trust-me']){const v=own();change(v);assert.throws(()=>validateRichList(v,now));}
});
test('ZCL feed coalesces refreshes, rejects old artifacts and retains stale data on failure',async()=>{
 let time=now,calls=0,fail=false,data=own();
 const get=await createRichListStore({initial:packageRichList(data,{now}),clock:()=>time,load:async url=>{assert.equal(url,ZCL_RICHLIST_URL);calls++;if(fail)throw Error('offline');return {data};}});
 const [a,b]=await Promise.all([get(),get()]);assert.equal(calls,1);assert.equal(a,b);assert.equal(a.status,'ok');
 fail=true;time+=300001;const stale=await get();assert.equal(stale.status,'stale');assert.equal(stale.data.snapshot.hash,data.snapshot.hash);
 fail=false;time+=300001;data=own();data.snapshot.generatedAt=new Date(now-1).toISOString();assert.equal((await get()).status,'stale');
 time+=300001;data=own();data.snapshot.generatedAt=new Date(time).toISOString();assert.equal((await get()).status,'ok');
});
test('hourly ZEC refresh preserves independently available ZCL and marks aged index data stale',async()=>{
 let time=now,calls=0,fail=false;const f=fixture();
 const get=createRichListComparison({getZcl:async()=>packageRichList(own(),{now:time}),clock:()=>time,load:async url=>{calls++;if(fail)throw Error('offline');return url===ZEC_RICHLIST_URL?{data:f.raw,headers:f.headers}:{data:f.block,headers:{}};}});
 const [a,b]=await Promise.all([get(),get()]);assert.equal(calls,2);assert.deepEqual(a,b);assert.equal(a.coins.zec.status,'ok');assert.equal(a.coins.zcl.coverage,'full-address-index');
 time+=3600001;fail=true;const stale=await get();assert.equal(stale.coins.zec.status,'stale');assert.equal(stale.coins.zcl.status,'ok');assert.equal(stale.coins.zec.generatedAt,a.coins.zec.generatedAt);
 time+=3600001;assert.equal((await get()).coins.zcl.status,'stale');
 const missing=createRichListComparison({getZcl:async()=>null,clock:()=>now,load:async()=>{throw Error('offline');}});assert.deepEqual((await missing()).coins,{zcl:null,zec:null});
});
test('network loader rejects oversized documents and bad HTTP',async()=>{
 const original=globalThis.fetch;
 try {globalThis.fetch=async()=>new Response('x'.repeat(101));await assert.rejects(()=>fetchDocument('https://example.org',100));globalThis.fetch=async()=>new Response('{}',{status:503});await assert.rejects(()=>fetchDocument('https://example.org'));}
 finally {globalThis.fetch=original;}
});
