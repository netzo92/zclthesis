import {compareWithLaunch} from './market-performance.mjs';
export const COMPARISON_SOURCE = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=zclassic%2Czcash&sparkline=false';
const MAX_AGE = 60 * 60 * 1000;
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;

export function parseMarketComparison(data, now = Date.now()) {
  if (!Array.isArray(data) || data.length !== 2) throw Error('Expected both comparison assets');
  const coins = {};
  for (const [symbol, id] of [['zcl', 'zclassic'], ['zec', 'zcash']]) {
    const matches = data.filter(coin => coin?.id === id && coin.symbol === symbol);
    if (matches.length !== 1) throw Error('Invalid comparison asset identity');
    const coin = matches[0];
    const updated = typeof coin.last_updated === 'string' ? Date.parse(coin.last_updated) : NaN;
    if (![coin.market_cap, coin.current_price, coin.circulating_supply].every(positive) ||
        !Number.isFinite(updated) || updated < 1470000000000 || updated > now + 300000) {
      throw Error('Invalid comparison market data');
    }
    coins[symbol] = {
      marketCapUsd: coin.market_cap,
      priceUsd: coin.current_price,
      circulatingSupply: coin.circulating_supply,
      updatedAt: new Date(updated).toISOString(),
    };
  }
  const zecToZclRatio = coins.zec.marketCapUsd / coins.zcl.marketCapUsd;
  const zclPercentOfZec = coins.zcl.marketCapUsd / coins.zec.marketCapUsd * 100;
  if (![zecToZclRatio, zclPercentOfZec].every(positive)) throw Error('Invalid comparison ratio');
  return {coins, zecToZclRatio, zclPercentOfZec};
}

async function fetchJSON(url) {
  const response = await fetch(url, {signal: AbortSignal.timeout(8000), headers: {Accept: 'application/json'}});
  if (!response.ok) throw Error(`HTTP ${response.status}`);
  if (!response.body) throw Error('Missing response body');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 65536) throw Error('Response too large');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function createMarketComparison({load = fetchJSON, clock = Date.now, ttl = 300000, baseline = null} = {}) {
  let snapshot, pending, failed = false, lastAttempt = -Infinity;
  async function refresh() {
    try {
      const raw = await load(COMPARISON_SOURCE);
      const now = clock();
      snapshot = {...parseMarketComparison(raw, now), fetchedAt: new Date(now).toISOString()};
      failed = false;
    } catch { failed = true; }
  }
  return async function getMarketComparison() {
    if (pending) await pending;
    else if (clock() - lastAttempt >= ttl) {
      lastAttempt = clock();
      pending = refresh();
      try { await pending; } finally { pending = null; }
    }
    if (!snapshot) return {
      status: 'unavailable', fetchedAt: null, source: COMPARISON_SOURCE,
      coins: null, zecToZclRatio: null, zclPercentOfZec: null, sinceLaunch: compareWithLaunch(null, baseline),
    };
    const now = clock();
    const aged = now - Date.parse(snapshot.fetchedAt) > MAX_AGE ||
      Object.values(snapshot.coins).some(coin => now - Date.parse(coin.updatedAt) > MAX_AGE);
    return {...structuredClone(snapshot), status: failed || aged ? 'stale' : 'ok', source: COMPARISON_SOURCE,
      sinceLaunch: compareWithLaunch(snapshot.coins.zcl, baseline)};
  };
}
