import test from 'node:test';
import assert from 'node:assert/strict';
import {parseVolumeSnapshot,createVolumeData,fetchVolumeSnapshot,VOLUME_SOURCE,VOLUME_MAX_BYTES,VOLUME_LAUNCH} from '../volume-data.mjs';
const now=Date.parse('2026-09-12T04:10:00Z');
const fixture=()=>({schemaVersion:1,pair:'ZCL/USDT',source:'NonKYC',launchedAt:VOLUME_LAUNCH,
  generatedAt:'2026-09-12T04:09:59Z',checkedThrough:'2026-09-12T04:09:50Z',coverageStart:VOLUME_LAUNCH,
  firstTradeAt:'2026-09-12T03:23:25.866Z',lastTradeAt:'2026-09-12T04:08:00Z',tradeCount:3,
  volumeBase:'9007199254740993.123456789',volumeQuote:'1.123456789123456789',bucketSeconds:3600,
  windowStart:'2026-09-12T03:00:00Z',status:'live',buckets:[
    {start:'2026-09-12T03:00:00Z',volumeBase:'9007199254740993.1',volumeQuote:'1.1',tradeCount:2,covered:true},
    {start:'2026-09-12T04:00:00Z',volumeBase:'0.023456789',volumeQuote:'0.023456789123456789',tradeCount:1,covered:true}]});

test('retains exact quantities and only public fields, including microsecond launch timestamp',()=>{
  const d=fixture();d.launchedAt='2026-09-12T03:23:13.198605Z';d.coverageStart=d.launchedAt;d.private='PRIVATE';d.buckets[0].secret='PRIVATE';
  const parsed=parseVolumeSnapshot(d,now);assert.equal(parsed.status,'live');assert.equal(parsed.volumeBase,d.volumeBase);assert.equal(parsed.volumeQuote,d.volumeQuote);assert.equal(parsed.launchedAt,VOLUME_LAUNCH);assert(!JSON.stringify(parsed).includes('PRIVATE'));
});
test('rejects invalid totals, out-of-order hours, foreign pair and false launch reference',()=>{
  const edits=[d=>d.pair='ZEC/USDT',d=>d.source='Other',d=>d.launchedAt='2026-09-12T03:00:00Z',d=>d.volumeBase='-1',d=>d.volumeQuote='NaN',d=>d.tradeCount=1,d=>d.volumeQuote='1.123456789123456788',d=>d.buckets[1].start=d.buckets[0].start,d=>d.buckets[0].covered='true',d=>d.firstTradeAt='2026-09-12T03:10:00Z',d=>d.checkedThrough='2026-09-12T04:11:00Z'];
  for(const edit of edits){const d=fixture();edit(d);assert.throws(()=>parseVolumeSnapshot(d,now));}
});
test('missing coverage is partial, frozen snapshots stale, and covered zero-trade hours remain zero',()=>{
  const d=fixture();d.buckets[0].covered=false;assert.equal(parseVolumeSnapshot(d,now).status,'partial');
  d.buckets[0].covered=true;d.coverageStart=null;assert.equal(parseVolumeSnapshot(d,now).status,'partial');
  assert.equal(parseVolumeSnapshot(fixture(),now+180001).status,'stale');
  const empty=fixture();empty.firstTradeAt=null;empty.lastTradeAt=null;empty.tradeCount=0;empty.volumeBase='0';empty.volumeQuote='0';for(const b of empty.buckets){b.tradeCount=0;b.volumeBase='0';b.volumeQuote='0';}
  assert.equal(parseVolumeSnapshot(empty,now).status,'live');
});
test('full launch-window bars reconcile exactly and always include the latest hour',()=>{
  const missing=fixture();missing.buckets.pop();assert.throws(()=>parseVolumeSnapshot(missing,now));
  const mismatch=fixture();mismatch.volumeBase='9007199254740993.123456790';assert.throws(()=>parseVolumeSnapshot(mismatch,now));
  const count=fixture();count.tradeCount=4;assert.throws(()=>parseVolumeSnapshot(count,now));
  const later=fixture();later.windowStart=later.buckets[1].start;later.buckets.shift();assert.equal(parseVolumeSnapshot(later,now).tradeCount,3);
});
test('coalesces fetches and retains dated stale values on failure without exposing errors',async()=>{
  let time=now,calls=0,fail=false;const get=createVolumeData({clock:()=>time,load:async url=>{assert.equal(url,VOLUME_SOURCE);calls++;if(fail)throw Error('PRIVATE');return fixture();}});
  const [a,b]=await Promise.all([get(),get()]);assert.deepEqual(a,b);assert.equal(calls,1);
  fail=true;time+=60001;const stale=await get();assert.equal(stale.status,'stale');assert.equal(stale.generatedAt,a.generatedAt);assert.equal(stale.fetchedAt,a.fetchedAt);stale.buckets[0].volumeQuote='9';assert.equal((await get()).buckets[0].volumeQuote,'1.1');assert.equal(calls,2);assert(!JSON.stringify(stale).includes('PRIVATE'));
  const unavailable=await createVolumeData({load:async()=>{throw Error('PRIVATE');}})();assert.equal(unavailable.status,'unavailable');assert.equal(unavailable.volumeQuote,null);assert.equal(unavailable.tradeCount,null);
});
test('fixed upstream URL and bounded fetch prevent redirects and oversized responses',async()=>{
  let options;const raw=await fetchVolumeSnapshot(VOLUME_SOURCE,{fetcher:async(url,opts)=>{options=opts;return new Response(JSON.stringify(fixture()));}});assert.equal(raw.pair,'ZCL/USDT');assert.equal(options.redirect,'error');assert(options.signal instanceof AbortSignal);
  await assert.rejects(fetchVolumeSnapshot('https://other.example/'));
  await assert.rejects(fetchVolumeSnapshot(VOLUME_SOURCE,{fetcher:async()=>new Response('{}',{headers:{'content-length':String(VOLUME_MAX_BYTES+1)}})}),/too large/);
  await assert.rejects(fetchVolumeSnapshot(VOLUME_SOURCE,{fetcher:async()=>new Response(new Uint8Array(VOLUME_MAX_BYTES+1))}),/too large/);
});
