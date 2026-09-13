import test from 'node:test';
import assert from 'node:assert/strict';
import {parseChain,parseMarket,createLiveData,SOURCES,parseOwnNode,NODE_SOURCE,chainAge} from '../live-data.mjs';
const now=Date.parse('2026-09-12T04:00:00Z');
const block={blocks:[{height:3247603,hash:'a'.repeat(64),time:now/1000-60,isMainChain:true}]};
const market={symbol:'ZCL/USDT',lastPrice:'0.29',lastTradeAt:now-60000,volumeSecondary:'430.2',changePercent:'-4.8',isActive:true};
test('chain age uses the public launch calendar date and UTC rather than page launch or elapsed-year rounding',()=>{
 const age=chainAge(Date.parse('2026-09-13T02:00:00Z'));
 assert.deepEqual([age.years,age.months,age.days,age.totalDays],[9,10,7,3598]);
 assert.equal(age.launchedAt,'2016-11-06');assert.equal(age.asOfDate,'2026-09-13');
 assert.equal(age.basis,'public-launch-date-utc');assert.equal(age.source,'https://zclassic.org/');
 for(const [at,expected] of [['2016-11-06T23:59:59Z',[0,0,0]],['2026-11-05T23:59:59Z',[9,11,30]],['2026-11-06T00:00:00Z',[10,0,0]],['2024-03-05T23:59:59Z',[7,3,28]],['2024-03-06T00:00:00Z',[7,4,0]]]){
  const a=chainAge(Date.parse(at));assert.deepEqual([a.years,a.months,a.days],expected,at);
 }
 assert.equal(chainAge(Date.parse('2016-11-05T23:59:59Z')),null);assert.equal(chainAge(NaN),null);
});
test('chain age remains available when price and block sources are unavailable and advances across UTC midnight',async()=>{
 let time=Date.parse('2026-11-05T23:59:59Z');
 const get=createLiveData({clock:()=>time,load:async()=>{throw Error('offline');}});
 assert.equal((await get()).chainAge.years,9);
 time+=1000;const data=await get();assert.equal(data.chainAge.years,10);assert.equal(data.chainAge.months,0);
 assert.equal(data.market.status,'unavailable');
});
test('validates asset, price and block identity instead of accepting misleading data',()=>{
 assert.equal(parseChain(block,now).height,3247603);
 assert.equal(parseMarket(market,now).quote,'USDT');
 for(const invalid of [null,'',false,'NaN',0,-1])assert.throws(()=>parseMarket({...market,lastPrice:invalid},now));
 assert.throws(()=>parseMarket({...market,symbol:'ZEC/USDT'},now));
 assert.throws(()=>parseMarket({...market,lastTradeAt:now+3600000},now));
 assert.throws(()=>parseChain({blocks:[{...block.blocks[0],isMainChain:false}]},now));
 assert.throws(()=>parseChain({blocks:[]},now));
});
test('deduplicates simultaneous loads and preserves independent data on failure',async()=>{
 let time=now,calls=0,failChain=false;
 const get=createLiveData({clock:()=>time,load:async url=>{calls++;if(url===SOURCES.chain){if(failChain)throw Error('offline');return block;}return market;}});
 const [first,second]=await Promise.all([get(),get()]);
 assert.equal(calls,3);assert.deepEqual(first,second);assert.equal(first.chain.status,'ok');
 await get();assert.equal(calls,3);
 time+=61000;failChain=true;const next=await get();
 assert.equal(next.chain.status,'stale');assert.equal(next.chain.fetchedAt,first.chain.fetchedAt);
 assert.deepEqual(next.chain.value,first.chain.value);assert.equal(next.market.status,'ok');
 time+=3600000;const old=await get();assert.equal(old.market.status,'stale');
});
test('missing sources are unavailable and retries are throttled',async()=>{
 let calls=0;const get=createLiveData({clock:()=>now,load:async()=>{calls++;throw Error('offline');}});
 const data=await get();assert.equal(data.chain.status,'unavailable');assert.equal(data.market.status,'unavailable');
 assert.equal(data.market.value,undefined);await get();assert.equal(calls,3);
});
test('old source timestamps are stale even after a successful fetch',async()=>{
 const get=createLiveData({clock:()=>now,load:async u=>u===SOURCES.chain?{blocks:[{...block.blocks[0],time:now/1000-3600}]}:{...market,lastTradeAt:now-7200000}});
 const data=await get();assert.equal(data.chain.status,'stale');assert.equal(data.market.status,'stale');
});
test('uses our synced node first and falls back when its export is stale or unsynced',async()=>{
 const own={schemaVersion:1,asset:'ZCL',generatedAt:new Date(now).toISOString(),chain:{height:3247700,hash:'b'.repeat(64),blockAt:new Date(now-30000).toISOString()},node:{synced:true,connections:8}};
 assert.equal(parseOwnNode(own,now).height,3247700);
 for(const mutate of [d=>d.node.synced=false,d=>d.node.connections=0,d=>d.asset='ZEC',d=>d.generatedAt=new Date(now-181000).toISOString(),d=>d.chain.blockAt=new Date(now-1800001).toISOString()]){const d=structuredClone(own);mutate(d);assert.throws(()=>parseOwnNode(d,now));}
 let state=own,time=now;const calls=[];
 const get=createLiveData({clock:()=>time,load:async url=>{calls.push(url);return url===NODE_SOURCE?state:url===SOURCES.chain?block:market;}});
 const first=await get();assert.equal(first.chain.source,NODE_SOURCE);assert(!calls.includes(SOURCES.chain));
 time+=61000;state={...own,node:{synced:false,connections:8}};
 const next=await get();assert.equal(next.chain.source,SOURCES.chain);assert.equal(next.chain.status,'ok');assert(calls.includes(SOURCES.chain));
});
