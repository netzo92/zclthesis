import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePoolMined,createPoolMinedData,fetchPoolMined,POOL_MINED_SOURCE,POOL_MINED_MAX_BYTES} from '../pool-mined-data.mjs';
const now=Date.parse('2026-09-13T01:40:00Z');
const period=(mature='125000000',immature='62500000')=>({rewardZat:String(BigInt(mature)+BigInt(immature)),blocks:2,matureRewardZat:mature,matureBlocks:1,immatureRewardZat:immature,immatureBlocks:1});
const fixture=()=>({schemaVersion:1,asset:'ZCL',status:'ok',generatedAt:'2026-09-13T01:39:55Z',coverageStartedAt:null,
  coverageBasis:'retained-pool-ledger',windowBasis:'pool-recorded-time',rewardBasis:'gross-coinbase-including-fees',
  allTime:period('9007199254740993'),last24h:period(),lastHour:period(),unknownBlocks:0,excludedOrphans:1,accountingHeld:false});

test('retains every zatoshi and publishes aggregates without source internals',()=>{
  const raw=fixture();raw.private='PRIVATE';raw.allTime.address='PRIVATE';
  const result=parsePoolMined(raw,now);
  assert.equal(result.allTime.rewardZat,'9007199317240993');assert.equal(result.source,POOL_MINED_SOURCE);
  assert.equal(result.coverageStartedAt,null);assert.equal(result.stale,false);assert(!JSON.stringify(result).includes('PRIVATE'));
});
test('rejects invalid monetary totals, coverage, maturity breakdown and time windows',()=>{
  for(const edit of [r=>r.asset='ZEC',r=>r.rewardBasis='estimated-shares',r=>r.generatedAt='2026-09-13T01:45:00Z',
    r=>r.coverageStartedAt='2026-09-14T00:00:00Z',r=>r.allTime.rewardZat=187500000,r=>r.allTime.rewardZat='-1',
    r=>r.allTime.rewardZat='1e9',r=>r.allTime.blocks=0,r=>r.lastHour=period('125000001'),
    r=>r.allTime.matureRewardZat='0',r=>r.lastHour.matureBlocks=0,r=>r.unknownBlocks=1,r=>r.accountingHeld='false',r=>r.accountingHeld=true]){
    const raw=fixture();edit(raw);assert.throws(()=>parsePoolMined(raw,now));
  }
});
test('verified zero, unknown totals and unavailable totals stay distinct even when stale',()=>{
  const empty=()=>({rewardZat:'0',blocks:0,matureRewardZat:'0',matureBlocks:0,immatureRewardZat:'0',immatureBlocks:0});
  const raw=fixture();for(const key of ['allTime','last24h','lastHour'])raw[key]=empty();
  assert.equal(parsePoolMined(raw,now).lastHour.rewardZat,'0');
  raw.status='partial';raw.unknownBlocks=1;
  const partial=parsePoolMined(raw,now+180001);assert.equal(partial.status,'partial');assert.equal(partial.stale,true);
  raw.status='unavailable';for(const key of ['allTime','last24h','lastHour','unknownBlocks','excludedOrphans','accountingHeld'])raw[key]=null;
  assert.equal(parsePoolMined(raw,now).allTime,null);
  raw.allTime=empty();assert.throws(()=>parsePoolMined(raw,now));
});
test('coalesces thirty-second refreshes, isolates returned data and does not hide fetch failures',async()=>{
  let time=now,calls=0,fail=false;
  const get=createPoolMinedData({clock:()=>time,load:async url=>{assert.equal(url,POOL_MINED_SOURCE);calls++;if(fail)throw Error('PRIVATE');return fixture();}});
  const [a,b]=await Promise.all([get(),get()]);assert.deepEqual(a,b);assert.equal(calls,1);
  a.allTime.rewardZat='1';assert.notEqual((await get()).allTime.rewardZat,'1');
  fail=true;time+=30000;await assert.rejects(get(),/^Error: Pool rewards temporarily unavailable$/);assert.equal(calls,2);
  await assert.rejects(get());assert.equal(calls,2);
  fail=false;time+=30000;assert.equal((await get()).status,'ok');assert.equal(calls,3);
  const initial=createPoolMinedData({load:async()=>{throw Error('PRIVATE');}});await assert.rejects(initial(),/^Error: Pool rewards temporarily unavailable$/);
});
test('fixed upstream URL, redirect rejection and response bounds restrict public proxy',async()=>{
  let options;
  const result=await fetchPoolMined(POOL_MINED_SOURCE,{fetcher:async(url,opts)=>{options=opts;return new Response(JSON.stringify({schemaVersion:1,asset:'ZCL',mined:fixture()}));}});
  assert.deepEqual(result,fixture());assert.equal(options.redirect,'error');assert(options.signal instanceof AbortSignal);
  await assert.rejects(fetchPoolMined('http://localhost/'));
  await assert.rejects(fetchPoolMined(POOL_MINED_SOURCE,{fetcher:async()=>new Response('{}',{status:503})}));
  await assert.rejects(fetchPoolMined(POOL_MINED_SOURCE,{fetcher:async()=>new Response('{}',{headers:{'content-length':String(POOL_MINED_MAX_BYTES+1)}})}),/too large/);
  await assert.rejects(fetchPoolMined(POOL_MINED_SOURCE,{fetcher:async()=>new Response(new Uint8Array(POOL_MINED_MAX_BYTES+1))}),/too large/);
});
