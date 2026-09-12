const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;

export function parseLaunchBaseline(value) {
  if (!value || value.schemaVersion !== 1 || value.assetId !== 'zclassic' || value.currency !== 'usd'
    || !positive(value.marketCapUsd) || !['nearest-observation', 'launch-day-observation'].includes(value.method)) {
    throw Error('Invalid ZCL launch reference');
  }
  const launched = Date.parse(value.launchedAt), observed = Date.parse(value.observedAt), captured = Date.parse(value.capturedAt);
  if (![launched, observed, captured].every(Number.isFinite) || launched < Date.UTC(2026, 8, 1)
    || captured < observed || captured < launched) throw Error('Invalid launch reference times');
  if (value.method === 'nearest-observation' && (observed > launched || launched - observed > 3600000)) throw Error('Reference must be shortly before launch');
  if (value.method === 'launch-day-observation' && value.observedAt.slice(0, 10) !== value.launchedAt.slice(0, 10)) throw Error('Reference must be on the launch day');
  const source = new URL(value.source);
  if (source.origin !== 'https://api.coingecko.com' || !source.pathname.startsWith('/api/v3/coins/zclassic/')
    || source.username || source.password || source.hash) throw Error('Invalid reference source');
  return Object.freeze({
    marketCapUsd: value.marketCapUsd, launchedAt: new Date(launched).toISOString(),
    observedAt: new Date(observed).toISOString(), capturedAt: new Date(captured).toISOString(),
    source: source.href, method: value.method,
  });
}

export function compareWithLaunch(coin, baseline) {
  if (!baseline) return null;
  let changePercent = null;
  if (positive(coin?.marketCapUsd) && Number.isFinite(Date.parse(coin.updatedAt))
    && Date.parse(coin.updatedAt) >= Date.parse(baseline.observedAt)) {
    const change = (coin.marketCapUsd / baseline.marketCapUsd - 1) * 100;
    if (Number.isFinite(change)) changePercent = change;
  }
  return {baseline: {...baseline}, changePercent};
}
