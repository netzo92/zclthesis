import test from 'node:test';
import assert from 'node:assert/strict';
import {createTransactionsData,parseTransactionsSnapshot,fetchTransactionsObservation,TRANSACTIONS_SOURCE,TRANSACTIONS_MAX_BYTES} from '../transactions-data.mjs';
const now=Date.parse('2026-09-12T23:00:00Z'),h=x=>x.repeat(64);
const address='t1UYsZVJkLPeMjxEtACvSxfWuNmddpWfxzs';
const fixture=()=>({schemaVersion:1,asset:'ZCL',source:'https://pool.zclthesis.com',generatedAt:'2026-09-12T22:59:50Z',status:'ok',chain:{height:100,hash:h('a'),blockAt:'2026-09-12T22:59:00Z'},node:{synced:true,connections:5},coverage:{blocksScanned:3,oldestHeight:98,transactionLimit:100,transactionsTruncated:false},transactions:[{txid:h('b'),blockHeight:100,blockHash:h('a'),blockAt:'2026-09-12T22:59:00Z',confirmations:1,isCoinbase:false,transparentInputCount:2,transparentOutputCount:1,transparentOutputZat:'2000000000000001',outputs:[{n:0,amountZat:'2000000000000001',addresses:[address],scriptType:'pubkeyhash'}],outputsTruncated:false,hasShieldedComponents:true}],mempool:{total:1,limit:50,truncated:false,transactions:[{txid:h('c'),localNodeSeenAt:'2026-09-12T22:58:00Z',sizeBytes:234}]}});

test('allowlists every nested output and sets a fresh website observation without altering exact amounts',()=>{
 const raw=fixture();raw.rpcpassword='TOP_PRIVATE';raw.node.wallet='NODE_PRIVATE';raw.chain.path='CHAIN_PRIVATE';raw.transactions[0].private='TX_PRIVATE';raw.transactions[0].outputs[0].key='OUTPUT_PRIVATE';raw.mempool.transactions[0].ip='PEER_PRIVATE';
 const parsed=parseTransactionsSnapshot(raw,now);assert.equal(parsed.source,TRANSACTIONS_SOURCE);assert.equal(parsed.observedAt,new Date(now).toISOString());assert.equal(parsed.transactions[0].transparentOutputZat,'2000000000000001');assert(!JSON.stringify(parsed).includes('PRIVATE'));
});
test('rejects wrong sources, money overflow, invalid address checksums and inconsistent exporter bounds',()=>{
 const edits=[d=>d.source='https://evil.example',d=>d.transactions[0].transparentOutputZat='2100000000000001',d=>d.transactions[0].outputs[0].amountZat='2100000000000001',d=>d.transactions[0].outputs[0].addresses=[address.slice(0,-1)+'a'],d=>d.transactions[0].outputs[0].scriptType='<img>',d=>d.transactions[0].transparentInputCount=200001,d=>d.transactions[0].isCoinbase=true,d=>d.mempool.transactions[0].sizeBytes=200001,d=>d.transactions[0].blockAt='2026-09-12T22:58:00Z'];
 for(const edit of edits){const d=fixture();edit(d);assert.throws(()=>parseTransactionsSnapshot(d,now));}
});
test('coalesces concurrent fetches, throttles failed retries and preserves source times on failure',async()=>{
 let calls=0,time=now,fail=false;const get=createTransactionsData({clock:()=>time,load:async url=>{assert.equal(url,TRANSACTIONS_SOURCE);calls++;if(fail)throw Error('SECRET_FAILURE');return fixture();}});
 const [first,second]=await Promise.all([get(),get()]);assert.equal(calls,1);assert.deepEqual(first,second);assert.equal(first.status,'ok');
 time+=30001;fail=true;const stale=await get();assert.equal(stale.status,'stale');assert.equal(stale.generatedAt,first.generatedAt);assert.equal(stale.observedAt,first.observedAt);stale.transactions[0].txid='mutated';assert.equal((await get()).transactions[0].txid,h('b'));assert.equal(calls,2);assert(!JSON.stringify(stale).includes('SECRET'));
});
test('old exports remain stale after a successful website fetch; disconnected and syncing remain distinct',async()=>{
 const d=fixture();d.generatedAt='2026-09-12T22:58:00Z';assert.equal((await createTransactionsData({clock:()=>now,load:async()=>d})()).status,'stale');
 const disconnected=fixture();disconnected.node.connections=0;assert.equal(parseTransactionsSnapshot(disconnected,now).status,'disconnected');
 const oldTip=fixture();oldTip.chain.blockAt='2026-09-12T21:00:00Z';oldTip.transactions[0].blockAt=oldTip.chain.blockAt;assert.equal(parseTransactionsSnapshot(oldTip,now).status,'syncing');
});
test('a reorg replaces the validated snapshot rather than retaining orphaned rows',async()=>{
 let time=now,raw=fixture();const get=createTransactionsData({clock:()=>time,load:async()=>raw});const first=await get();
 raw=fixture();raw.chain.height=99;raw.chain.hash=h('d');raw.coverage.oldestHeight=97;raw.transactions[0].blockHeight=99;raw.transactions[0].blockHash=h('d');raw.transactions[0].txid=h('e');time+=30001;
 const second=await get();assert.equal(second.chain.height,99);assert.equal(second.transactions.length,1);assert.equal(second.transactions[0].txid,h('e'));assert.notEqual(second.transactions[0].txid,first.transactions[0].txid);
});
test('initial failures have unavailable nulls; unavailable refresh retains prior validated observations as stale',async()=>{
 let raw=fixture(),time=now;const unavailable={schemaVersion:1,asset:'ZCL',source:'https://pool.zclthesis.com',generatedAt:new Date(now).toISOString(),status:'unavailable',chain:null,node:null,coverage:null,transactions:[],mempool:null};
 const empty=await createTransactionsData({clock:()=>now,load:async()=>unavailable})();assert.equal(empty.status,'unavailable');assert.equal(empty.mempool,null);assert.equal(empty.generatedAt,null);assert.deepEqual(empty.transactions,[]);
 const get=createTransactionsData({clock:()=>time,load:async()=>raw});await get();raw=unavailable;time+=30001;const held=await get();assert.equal(held.status,'stale');assert.equal(held.transactions[0].txid,h('b'));
});
test('source fetch pins URL, disables redirects and bounds declared or streamed bytes',async()=>{
 const body=JSON.stringify(fixture());let options;
 const fetched=await fetchTransactionsObservation(TRANSACTIONS_SOURCE,{fetcher:async(url,opts)=>{assert.equal(url,TRANSACTIONS_SOURCE);options=opts;return new Response(body,{headers:{'content-type':'application/json'}});}});assert.equal(fetched.asset,'ZCL');assert.equal(options.redirect,'error');assert(options.signal instanceof AbortSignal);
 await assert.rejects(fetchTransactionsObservation('https://evil.example',{fetcher:()=>{throw Error('must not fetch');}}));
 await assert.rejects(fetchTransactionsObservation(TRANSACTIONS_SOURCE,{fetcher:async()=>new Response('{}',{headers:{'content-length':String(TRANSACTIONS_MAX_BYTES+1)}})}),/too large/);
 await assert.rejects(fetchTransactionsObservation(TRANSACTIONS_SOURCE,{fetcher:async()=>new Response(new Uint8Array(TRANSACTIONS_MAX_BYTES+1))}),/too large/);
 await assert.rejects(fetchTransactionsObservation(TRANSACTIONS_SOURCE,{fetcher:async()=>new Response('Unavailable',{status:503})}),/unavailable/);
});
