import test from 'node:test';
import assert from 'node:assert/strict';
import {createNetworkData,parseNetworkSnapshot,networkStatus,NETWORK_SOURCE} from '../network-data.mjs';
const now=Date.parse('2026-09-12T06:00:00Z');
const fixture=()=>({schemaVersion:1,asset:'ZCL',generatedAt:new Date(now-10000).toISOString(),source:'https://pool.zclthesis.com',
  chain:{height:3247900,hash:'a'.repeat(64),blockAt:new Date(now-60000).toISOString()},
  node:{synced:true,connections:8,verificationProgress:0.99999,softwareVersion:'/MagicBean:2.1.2-beta6/',bootstrapValidation:'anchored-fast-sync'},
  mining:{difficulty:110.123,networkSolps:12000}});
test('allowlists observations and preserves proof provenance without leaking extra fields',()=>{
  const raw=fixture();raw.rpcpassword='secret';raw.node.rpcuser='private';raw.chain.extra='hidden';
  const parsed=parseNetworkSnapshot(raw,now);
  assert.equal(parsed.chain.height,3247900);assert.equal(parsed.node.bootstrapValidation,'anchored-fast-sync');
  assert(!JSON.stringify(parsed).includes('secret'));assert(!JSON.stringify(parsed).includes('private'));assert(!JSON.stringify(parsed).includes('hidden'));
  assert.equal(networkStatus({...parsed,observedAt:new Date(now).toISOString()},now),'ok');
});
test('rejects wrong assets, unsafe identity, impossible values and invalid times',()=>{
  const mutations=[d=>d.asset='ZEC',d=>d.schemaVersion=2,d=>d.source='https://example.org',d=>d.chain.height=-1,d=>d.chain.height=1.5,
    d=>d.chain.hash='bad',d=>d.chain.blockAt='bad',d=>d.generatedAt=new Date(now+600000).toISOString(),d=>d.node.connections=-1,
    d=>d.node.connections='8',d=>d.node.verificationProgress=NaN,d=>d.node.verificationProgress=1.01,d=>d.node.synced='true'];
  for(const mutate of mutations){const raw=fixture();mutate(raw);assert.throws(()=>parseNetworkSnapshot(raw,now));}
});
test('missing or invalid estimates remain unavailable instead of invented zeros',()=>{
  const raw=fixture();raw.mining={difficulty:0,networkSolps:'12000'};raw.node.bootstrapValidation='claimed-secure';raw.node.softwareVersion='bad\nversion';
  const data=parseNetworkSnapshot(raw,now);
  assert.deepEqual(data.mining,{difficulty:null,networkSolps:null});assert.equal(data.node.bootstrapValidation,'unknown');assert.equal(data.node.softwareVersion,null);
  raw.mining.networkSolps=0;assert.equal(parseNetworkSnapshot(raw,now).mining.networkSolps,0);
});
test('represents warmup with empty metrics and distinguishes disconnection from synchronization',()=>{
  const warmup=parseNetworkSnapshot({schemaVersion:1,asset:'ZCL',generatedAt:new Date(now).toISOString(),status:'synchronizing',node:{synced:false}},now);
  assert.equal(warmup.chain,null);assert.equal(warmup.node.connections,null);assert.equal(networkStatus(warmup,now),'syncing');
  const disconnected=fixture();disconnected.node.connections=0;disconnected.node.synced=false;
  assert.equal(networkStatus(parseNetworkSnapshot(disconnected,now),now),'disconnected');
  const behind=fixture();behind.node.verificationProgress=0.95;
  assert.equal(networkStatus(parseNetworkSnapshot(behind,now),now),'syncing');
  behind.node.verificationProgress=1;behind.chain.blockAt=new Date(now-3600000).toISOString();
  assert.equal(networkStatus(parseNetworkSnapshot(behind,now),now),'syncing');
});
test('coalesces requests, throttles failures and preserves old source times when refresh fails',async()=>{
  let calls=0,time=now,fail=false;
  const get=createNetworkData({clock:()=>time,load:async url=>{assert.equal(url,NETWORK_SOURCE);calls++;if(fail)throw Error('private credentials must not leak');return fixture();}});
  const [one,two]=await Promise.all([get(),get()]);assert.equal(calls,1);assert.deepEqual(one,two);assert.equal(one.status,'ok');
  time+=31000;fail=true;const stale=await get();assert.equal(stale.status,'stale');assert.equal(stale.generatedAt,one.generatedAt);assert.equal(stale.observedAt,one.observedAt);assert.deepEqual(stale.chain,one.chain);
  stale.chain.height=0;assert.equal((await get()).chain.height,one.chain.height);assert.equal(calls,2);
  assert(!JSON.stringify(stale).includes('credentials'));
});
test('a successful fetch of an old export is stale and does not reset freshness',async()=>{
  const raw=fixture();raw.generatedAt=new Date(now-181000).toISOString();
  const get=createNetworkData({clock:()=>now,load:async()=>raw});assert.equal((await get()).status,'stale');
});
test('no successful observation returns explicit unavailable and never fabricated measurements',async()=>{
  let calls=0;const get=createNetworkData({clock:()=>now,load:async()=>{calls++;throw Error('offline');}});
  const data=await get();assert.equal(data.status,'unavailable');assert.equal(data.chain,null);assert.equal(data.node,null);assert.equal(data.mining,null);
  await get();assert.equal(calls,1);
});
