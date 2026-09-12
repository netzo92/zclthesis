import test from 'node:test';
import assert from 'node:assert/strict';
import {COMPARISON_SOURCE, createMarketComparison, parseMarketComparison} from '../market-comparison.mjs';

const now = Date.parse('2026-09-12T08:00:00Z');
const fixture = () => [
  {id: 'zclassic', symbol: 'zcl', market_cap: 2000000, current_price: 0.25, circulating_supply: 8000000, last_updated: '2026-09-12T07:59:00Z'},
  {id: 'zcash', symbol: 'zec', market_cap: 600000000, current_price: 40, circulating_supply: 15000000, last_updated: '2026-09-12T07:58:00Z'},
];

test('compares the requested assets in either provider order and derives ratios from caps', () => {
  const parsed = parseMarketComparison(fixture().reverse(), now);
  assert.equal(parsed.coins.zcl.marketCapUsd, 2000000);
  assert.equal(parsed.coins.zec.priceUsd, 40);
  assert.equal(parsed.zecToZclRatio, 300);
  assert.ok(Math.abs(parsed.zclPercentOfZec - 1 / 3) < Number.EPSILON);
});

test('rejects missing, duplicate, wrong-identity and malformed comparison data', () => {
  for (const data of [null, {}, [], fixture().slice(0, 1), [fixture()[0], fixture()[0]], [...fixture(), fixture()[0]]]) {
    assert.throws(() => parseMarketComparison(data, now));
  }
  for (const field of ['market_cap', 'current_price', 'circulating_supply']) {
    for (const invalid of [null, '', '100', false, NaN, Infinity, 0, -1]) {
      const data = fixture(); data[0][field] = invalid;
      assert.throws(() => parseMarketComparison(data, now), `${field}: ${invalid}`);
    }
  }
  for (const patch of [{id: 'bitcoin'}, {symbol: 'zec'}, {last_updated: null}, {last_updated: 'not a date'}, {last_updated: '2000-01-01T00:00:00Z'}, {last_updated: '2026-09-12T09:00:00Z'}]) {
    const data = fixture(); Object.assign(data[1], patch);
    if (patch.symbol === 'zec') data[0].symbol = 'zec';
    assert.throws(() => parseMarketComparison(data, now));
  }
  const overflow = fixture(); overflow[0].market_cap = Number.MIN_VALUE;
  assert.throws(() => parseMarketComparison(overflow, now));
});

test('coalesces concurrent calls, caches for five minutes and isolates returned snapshots', async () => {
  let time = now, calls = 0;
  const get = createMarketComparison({clock: () => time, load: async url => {
    assert.equal(url, COMPARISON_SOURCE); calls++; return fixture();
  }});
  const [first, second] = await Promise.all([get(), get()]);
  assert.equal(calls, 1); assert.deepEqual(first, second); assert.equal(first.status, 'ok');
  first.coins.zcl.marketCapUsd = 0;
  time += 299999;
  assert.equal((await get()).coins.zcl.marketCapUsd, 2000000); assert.equal(calls, 1);
  time += 1; await get(); assert.equal(calls, 2);
});

test('retains a consistent stale pair on failed or incomplete refresh and recovers', async () => {
  let time = now, mode = 'ok';
  const get = createMarketComparison({clock: () => time, load: async () => {
    if (mode === 'offline') throw Error('offline');
    return mode === 'missing' ? fixture().slice(0, 1) : fixture();
  }});
  const first = await get();
  for (const nextMode of ['offline', 'missing']) {
    mode = nextMode; time += 300000;
    const retained = await get();
    assert.equal(retained.status, 'stale'); assert.equal(retained.fetchedAt, first.fetchedAt);
    assert.deepEqual(retained.coins, first.coins); assert.equal(retained.zecToZclRatio, first.zecToZclRatio);
  }
  mode = 'ok'; time += 300000;
  assert.equal((await get()).status, 'ok');
});

test('first-load failures are unavailable and throttled; old provider observations stay stale', async () => {
  let calls = 0;
  const unavailable = createMarketComparison({clock: () => now, load: async () => {calls++; throw Error('rate limited');}});
  const result = await unavailable();
  assert.equal(result.status, 'unavailable'); assert.equal(result.coins, null);
  assert.equal(result.zecToZclRatio, null); assert.equal(result.fetchedAt, null);
  await unavailable(); assert.equal(calls, 1);
  const old = fixture(); old[0].last_updated = '2026-09-12T06:00:00Z';
  const stale = createMarketComparison({clock: () => now, load: async () => old});
  assert.equal((await stale()).status, 'stale');
});

test('the network loader bounds response size and handles bad HTTP or JSON', async t => {
  for (const response of [new Response('x'.repeat(65537)), new Response('not JSON'), new Response('rate limited', {status: 429})]) {
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      assert.equal(url, COMPARISON_SOURCE);
      assert.ok(options.signal instanceof AbortSignal);
      assert.equal(options.headers.Accept, 'application/json');
      return response;
    });
    assert.equal((await createMarketComparison({clock: () => now})()).status, 'unavailable');
    t.mock.restoreAll();
  }
});
