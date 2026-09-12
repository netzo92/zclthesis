import test from 'node:test';
import assert from 'node:assert/strict';
import {parseLaunchBaseline, compareWithLaunch} from '../market-performance.mjs';
import {createMarketComparison} from '../market-comparison.mjs';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const reference = () => ({schemaVersion:1,assetId:'zclassic',currency:'usd',marketCapUsd:100,
  launchedAt:'2026-09-12T03:23:13Z',observedAt:'2026-09-12T03:20:00Z',capturedAt:'2026-09-12T22:20:00Z',
  source:'https://api.coingecko.com/api/v3/coins/zclassic/market_chart?vs_currency=usd&days=1',method:'nearest-observation'});
const current = cap => ({marketCapUsd:cap,updatedAt:'2026-09-12T22:20:00Z'});

test('launch comparison calculates gain, loss and unchanged cap from an immutable reference', () => {
  const baseline=parseLaunchBaseline(reference());
  assert.equal(compareWithLaunch(current(125),baseline).changePercent,25);
  assert.equal(compareWithLaunch(current(75),baseline).changePercent,-25);
  assert.equal(compareWithLaunch(current(100),baseline).changePercent,0);
  const precise=parseLaunchBaseline({...reference(),marketCapUsd:123.4567});
  assert.ok(Math.abs(compareWithLaunch(current(246.9134),precise).changePercent-100)<1e-10);
  const returned=compareWithLaunch(current(125),baseline);
  returned.baseline.marketCapUsd=1;
  assert.equal(compareWithLaunch(current(125),baseline).changePercent,25);
  assert.equal(Object.isFrozen(baseline),true);
});

test('missing, invalid or pre-reference current observations never become a percentage', () => {
  const baseline=parseLaunchBaseline(reference());
  for (const coin of [null,current(0),current(-1),current(Infinity),current('100'),
    {...current(120),updatedAt:'2026-09-12T03:19:00Z'}, {...current(120),updatedAt:'unknown'}]) {
    const result=compareWithLaunch(coin,baseline);
    assert.equal(result.changePercent,null);
    assert.equal(result.baseline.marketCapUsd,100);
  }
  assert.equal(compareWithLaunch(current(120),null),null);
});

test('baseline validation rejects wrong asset, currency, source and mismatched launch dates', () => {
  for (const patch of [{assetId:'zcash'},{currency:'eur'},{marketCapUsd:0},{marketCapUsd:'100'},
    {source:'https://attacker.example/history'}, {source:'https://api.coingecko.com/api/v3/coins/zcash/history'},
    {source:'https://private@api.coingecko.com/api/v3/coins/zclassic/history'},
    {observedAt:'unknown'}, {capturedAt:'2026-09-11T22:00:00Z'},
    {observedAt:'2026-09-11T03:20:00Z'}, {observedAt:'2026-09-12T03:25:00Z'}, {method:'first-current-value'},
    {method:'launch-day-observation',observedAt:'2026-09-11T03:20:00Z'}]) {
    assert.throws(()=>parseLaunchBaseline({...reference(),...patch}));
  }
});

test('the committed reference matches the last genuine source point before public launch', async () => {
  const raw=JSON.parse(await readFile(new URL('../data/market-baseline.json',import.meta.url),'utf8'));
  const baseline=parseLaunchBaseline(raw);
  const bytes=await readFile(new URL('../data/market-baseline-evidence.json',import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),raw.evidence.sha256);
  const evidence=JSON.parse(bytes);
  assert.equal(evidence.httpStatus,200);
  assert.equal(evidence.source,baseline.source);
  assert.equal(Date.parse(evidence.launch.serviceReadyAt),Date.parse(baseline.launchedAt));
  assert.ok(Date.parse(evidence.launch.publicInvokerGrantedAt)<Date.parse(baseline.launchedAt));
  const points=evidence.payload.market_caps.filter(([time,cap])=>time<=Date.parse(baseline.launchedAt)&&Number.isFinite(cap)&&cap>0).sort((a,b)=>a[0]-b[0]);
  assert.deepEqual(points.at(-1),[Date.parse(baseline.observedAt),baseline.marketCapUsd]);
});

test('a cached refresh failure and a new loader preserve the same launch reference', async () => {
  const baseline=parseLaunchBaseline(reference());
  let now=Date.parse('2026-09-12T22:20:00Z'),fail=false;
  const load=async()=>{
    if(fail)throw Error('rate limited');
    return [
      {id:'zclassic',symbol:'zcl',market_cap:125,current_price:1,circulating_supply:125,last_updated:new Date(now).toISOString()},
      {id:'zcash',symbol:'zec',market_cap:1000,current_price:1,circulating_supply:1000,last_updated:new Date(now).toISOString()},
    ];
  };
  const get=createMarketComparison({baseline,load,clock:()=>now});
  const first=await get(); assert.equal(first.sinceLaunch.changePercent,25);
  fail=true;now+=300000;
  const stale=await get();assert.equal(stale.status,'stale');assert.equal(stale.sinceLaunch.changePercent,25);
  assert.deepEqual(stale.sinceLaunch.baseline,first.sinceLaunch.baseline);
  const cold=await createMarketComparison({baseline,load,clock:()=>now})();
  assert.equal(cold.status,'unavailable');assert.equal(cold.sinceLaunch.changePercent,null);
  assert.deepEqual(cold.sinceLaunch.baseline,first.sinceLaunch.baseline);
});
