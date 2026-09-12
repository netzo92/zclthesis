import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

const source = await readFile(new URL('../public/performance.js', import.meta.url), 'utf8');
const instant = Date.parse('2026-09-12T18:00:00Z');
const fixture = () => ({
  status: 'ok', fetchedAt: '2026-09-12T18:00:00Z',
  coins: {zcl: {marketCapUsd: 1250000, updatedAt: '2026-09-12T17:59:00Z'}},
  sinceLaunch: {baseline: {marketCapUsd: 1000000, observedAt: '2026-09-10T16:00:00Z', launchedAt: '2026-09-10T16:10:00Z', source: 'https://api.coingecko.com/api/v3/coins/zclassic/market_chart/range?vs_currency=usd&from=1&to=2', method: 'nearest-observation'}, changePercent: -999},
});
class Element {
  constructor(text = '') { this.text = text; this.children = []; this.dataset = {}; this.attributes = {}; }
  set textContent(value) { this.text = value; this.children = []; }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
  append(child) { this.children.push(child); }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; }
}
function harness(lang = 'en', exists = true) {
  const elements = new Map(), events = new Map(), documentEvents = new Map(), timers = [];
  for (const id of ['launch-performance', ...['baseline-value', 'current-value', 'change-value', 'performance-status', 'baseline-time', 'current-time', 'reference-link'].map(x => `launch-${x}`)]) elements.set(id, new Element());
  elements.get('launch-baseline-value').textContent = 'Static launch reference';
  elements.get('launch-baseline-time').textContent = 'Static reference time';
  elements.get('launch-performance').dataset.status = 'loading';
  let clock = instant;
  class Clock extends Date { static now() { return clock; } }
  const document = {documentElement: {lang}, hidden: false, getElementById: id => exists ? elements.get(id) : null, createElement: () => new Element(), addEventListener: (name, fn) => documentEvents.set(name, fn)};
  runInNewContext(source, {document, window: {addEventListener: (name, fn) => events.set(name, fn)}, Date: Clock, Intl, URL, setInterval: (fn, ms) => timers.push({fn, ms}), fetch: () => { throw Error('Banner must not fetch'); }});
  return {
    get: id => elements.get(`launch-${id}`), document, timers,
    event: (data, failed = false) => events.get('zcl-market-comparison')({detail: {data, failed}}),
    tick: offset => { clock = instant + offset; timers[0].fn(); },
    visible: () => { document.hidden = false; documentEvents.get('visibilitychange')(); },
  };
}

test('uses the shared event only and computes change independently in English and Spanish', () => {
  for (const lang of ['en', 'es']) {
    const h = harness(lang); h.event(fixture());
    assert.equal(h.get('performance').dataset.status, 'ok');
    assert.match(h.get('baseline-value').textContent, /1[,.]000[,.]000/);
    assert.match(h.get('current-value').textContent, /1[,.]250[,.]000/);
    assert.equal(h.get('change-value').textContent, lang === 'es' ? '+25,00%Subida' : '+25.00%Gain');
    assert.equal(h.get('change-value').dataset.trend, 'gain');
    assert.match(h.get('baseline-time').textContent, /UTC/);
    assert.match(h.get('current-time').textContent, /17:59:00 UTC/);
    assert.match(h.get('performance-status').textContent, lang === 'es' ? /cinco minutos/ : /five minutes/);
    assert.equal(h.get('reference-link').href, 'https://www.coingecko.com/en/coins/zclassic');
    assert.equal(h.get('reference-link').rel, 'noopener noreferrer');
    assert.equal(h.timers.length, 1); assert.equal(h.timers[0].ms, 15000);
  }
});
test('losses have a sign and label; insignificant negative and positive changes render unchanged', () => {
  const h = harness();
  for (const [cap, output, trend] of [[875000, '−12.50%Loss', 'loss'], [999999, '0.00%Unchanged', 'unchanged'], [1000001, '0.00%Unchanged', 'unchanged'], [1000000, '0.00%Unchanged', 'unchanged']]) {
    const data = fixture(); data.coins.zcl.marketCapUsd = cap; h.event(data);
    assert.equal(h.get('change-value').textContent, output);
    assert.equal(h.get('change-value').dataset.trend, trend);
    assert.match(h.get('change-value').attributes['aria-label'], new RegExp(trend === 'loss' ? 'Loss' : 'Unchanged'));
  }
});
test('null and invalid data clear current/change but preserve static or previously verified baseline', () => {
  const h = harness(); h.event(null, true);
  assert.equal(h.get('baseline-value').textContent, 'Static launch reference');
  assert.equal(h.get('baseline-time').textContent, 'Static reference time');
  assert.equal(h.get('current-value').textContent, '—');
  h.event(fixture()); const prior = h.get('baseline-value').textContent;
  h.event(null, true);
  assert.equal(h.get('baseline-value').textContent, prior);
  assert.equal(h.get('current-value').textContent, '—');
  assert.equal(h.get('change-value').textContent, '—');
  assert.equal(h.get('change-value').dataset.trend, undefined);
  assert.equal(h.get('change-value').attributes['aria-label'], undefined);
  assert.equal(h.get('performance').dataset.status, 'unavailable');
});
test('failed refresh with a valid cached observation retains measured values with stale copy', () => {
  const h = harness('es'); h.event(fixture(), true);
  assert.equal(h.get('performance').dataset.status, 'stale');
  assert.equal(h.get('change-value').textContent, '+25,00%Subida');
  assert.match(h.get('performance-status').textContent, /Datos desactualizados/);
  const data = fixture(); data.status = 'stale'; h.event(data);
  assert.equal(h.get('performance').dataset.status, 'stale');
});
test('both source and fetch timestamps expire locally, including on return to a visible page', () => {
  const h = harness(); h.event(fixture());
  h.document.hidden = true; h.tick(61 * 60 * 1000);
  assert.equal(h.get('performance').dataset.status, 'ok');
  h.visible(); assert.equal(h.get('performance').dataset.status, 'stale');
  const visible = harness(); visible.event(fixture()); visible.tick(60 * 60 * 1000);
  assert.equal(visible.get('performance').dataset.status, 'stale');
  const oldFetch = fixture(); oldFetch.fetchedAt = '2026-09-12T16:00:00Z';
  const second = harness(); second.event(oldFetch); assert.equal(second.get('performance').dataset.status, 'stale');
});
test('rejects missing, nonnumeric, nonpositive, invalid and far-future current measurements', () => {
  const edits = [d => d.status = 'live', d => d.fetchedAt = 'today', d => d.fetchedAt = '2026-09-13T18:00:00Z', d => d.coins.zcl.updatedAt = null, d => d.coins.zcl.updatedAt = '<script>', d => d.coins.zcl.updatedAt = '2026-09-14T00:00:00Z', d => d.coins.zcl.marketCapUsd = 0, d => d.coins.zcl.marketCapUsd = -1, d => d.coins.zcl.marketCapUsd = '1250000', d => d.coins.zcl.marketCapUsd = Infinity, d => d.coins.zcl.marketCapUsd = NaN];
  for (const edit of edits) { const h = harness(), data = fixture(); edit(data); h.event(data); assert.equal(h.get('performance').dataset.status, 'unavailable'); assert.equal(h.get('current-value').textContent, '—'); }
});
test('missing or untrusted historical references preserve static baseline and suppress percentage', () => {
  const edits = [d => d.sinceLaunch = null, d => d.sinceLaunch.baseline.marketCapUsd = 0, d => d.sinceLaunch.baseline.method = 'exact-at-launch', d => d.sinceLaunch.baseline.launchedAt = 'bad', d => d.sinceLaunch.baseline.source = 'https://api.coingecko.com.evil.example/', d => d.sinceLaunch.baseline.source = 'https://user:password@api.coingecko.com/', d => d.sinceLaunch.baseline.source = 'javascript:alert(1)', d => d.sinceLaunch.baseline.source = '<img src=x>'];
  for (const edit of edits) {
    const h = harness(), data = fixture(); edit(data); h.event(data);
    assert.equal(h.get('baseline-value').textContent, 'Static launch reference');
    assert.equal(h.get('change-value').textContent, '—');
    assert.notEqual(h.get('current-value').textContent, '—');
    assert.match(h.get('performance-status').textContent, /verified historical reference/);
    assert.equal(h.get('reference-link').href, 'https://www.coingecko.com/en/coins/zclassic');
  }
});
test('overflowing computed ratios never display an infinite percentage', () => {
  const h = harness(), data = fixture(); data.sinceLaunch.baseline.marketCapUsd = Number.MIN_VALUE;
  h.event(data); assert.equal(h.get('change-value').textContent, '—'); assert.equal(h.get('performance').dataset.status, 'unavailable');
});
test('launch-day reference uses the observation timestamp and timestamps cannot inject HTML', () => {
  const h = harness('es'), data = fixture(); data.sinceLaunch.baseline.method = 'launch-day-observation'; h.event(data);
  assert.match(h.get('baseline-time').textContent, /Referencia del lanzamiento:.*16:00:00 UTC/);
  data.sinceLaunch.baseline.observedAt = '2026-09-10T16:00:00Z<img>'; h.event(data);
  assert.doesNotMatch(h.get('baseline-time').textContent, /<img/); assert.equal(h.get('change-value').textContent, '—');
});
test('a before-launch reference cannot be from after launch or compared against an older current observation', () => {
  const h = harness(), data = fixture();
  data.sinceLaunch.baseline.observedAt = '2026-09-10T16:15:00Z'; h.event(data);
  assert.equal(h.get('change-value').textContent, '—');
  assert.equal(h.get('baseline-value').textContent, 'Static launch reference');
  const old = fixture(); old.coins.zcl.updatedAt = '2026-09-10T15:59:00Z'; h.event(old);
  assert.equal(h.get('change-value').textContent, '—');
  assert.match(h.get('performance-status').textContent, /predates the launch reference/);
  assert.notEqual(h.get('baseline-value').textContent, 'Static launch reference');
});
test('does nothing on pages without the banner', () => { assert.equal(harness('en', false).timers.length, 0); });
