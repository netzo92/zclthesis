import test from 'node:test';
import assert from 'node:assert/strict';
import {parseChain,parseMarket,createLiveData,SOURCES} from '../live-data.mjs';
const now=Date.parse('2026-09-12T04:00:00Z');
const block={blocks:[{height:3247603,hash:'a'.repeat(64),time:now/1000-60,isMainChain:true}]};
const market={symbol:'ZCL/USDT',lastPrice:'0.29',lastTradeAt:now-60000,volumeSecondary:'430.2',changePercent:'-4.8',isActive:true};
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
 assert.equal(calls,2);assert.deepEqual(first,second);assert.equal(first.chain.status,'ok');
 await get();assert.equal(calls,2);
 time+=61000;failChain=true;const next=await get();
 assert.equal(next.chain.status,'stale');assert.equal(next.chain.fetchedAt,first.chain.fetchedAt);
 assert.deepEqual(next.chain.value,first.chain.value);assert.equal(next.market.status,'ok');
 time+=3600000;const old=await get();assert.equal(old.market.status,'stale');
});
test('missing sources are unavailable and retries are throttled',async()=>{
 let calls=0;const get=createLiveData({clock:()=>now,load:async()=>{calls++;throw Error('offline');}});
 const data=await get();assert.equal(data.chain.status,'unavailable');assert.equal(data.market.status,'unavailable');
 assert.equal(data.market.value,undefined);await get();assert.equal(calls,2);
});
test('old source timestamps are stale even after a successful fetch',async()=>{
 const get=createLiveData({clock:()=>now,load:async u=>u===SOURCES.chain?{blocks:[{...block.blocks[0],time:now/1000-3600}]}:{...market,lastTradeAt:now-7200000}});
 const data=await get();assert.equal(data.chain.status,'stale');assert.equal(data.market.status,'stale');
});
