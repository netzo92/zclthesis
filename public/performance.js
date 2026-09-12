(() => {
  'use strict';
  const mount = document.getElementById('launch-performance');
  if (!mount) return;
  const fields = {};
  for (const name of ['baseline-value', 'current-value', 'change-value', 'performance-status', 'baseline-time', 'current-time', 'reference-link']) {
    fields[name] = document.getElementById(`launch-${name}`);
    if (!fields[name]) return;
  }
  const spanish = document.documentElement.lang === 'es';
  const locale = spanish ? 'es-ES' : 'en-US';
  const t = spanish ? {
    gain: 'Subida', loss: 'Bajada', unchanged: 'Sin cambio',
    loading: 'Consultando la capitalización de ZCL en CoinGecko.',
    ok: 'Comparación de capitalización de ZCL con la referencia del lanzamiento.',
    stale: 'Datos desactualizados: se muestra la última observación disponible; no es una cotización en tiempo real.',
    unavailable: 'Capitalización actual y variación no disponibles. Se conserva la referencia del lanzamiento.',
    noBaseline: 'Comparación con el lanzamiento no disponible: falta una referencia histórica verificada.',
    beforeReference: 'Variación no disponible: la observación actual es anterior a la referencia del lanzamiento.',
    cadence: 'Se consulta cada cinco minutos mientras la página está visible.',
    updated: 'Fuente actualizada', observed: 'Referencia del lanzamiento',
    unavailableTime: 'Hora de la fuente no disponible.', reference: 'Fuente: CoinGecko · Zclassic ↗',
  } : {
    gain: 'Gain', loss: 'Loss', unchanged: 'Unchanged',
    loading: 'Checking ZCL market capitalization on CoinGecko.',
    ok: 'ZCL market capitalization compared with the launch reference.',
    stale: 'Stale data: showing the last available observation, not a real-time quote.',
    unavailable: 'Current market cap and change unavailable. The launch reference is preserved.',
    noBaseline: 'Launch comparison unavailable: a verified historical reference is missing.',
    beforeReference: 'Change unavailable: the current observation predates the launch reference.',
    cadence: 'Checks every five minutes while the page is visible.',
    updated: 'Source updated', observed: 'Launch reference',
    unavailableTime: 'Source update time unavailable.', reference: 'Source: CoinGecko · Zclassic ↗',
  };
  const caps = new Intl.NumberFormat(locale, {style: 'currency', currency: 'USD', currencyDisplay: 'code', maximumFractionDigits: 0});
  const percentages = new Intl.NumberFormat(locale, {minimumFractionDigits: 2, maximumFractionDigits: 2});
  const dates = new Intl.DateTimeFormat(locale, {year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC', hourCycle: 'h23'});
  const maxAge = 60 * 60 * 1000;
  const futureTolerance = 5 * 60 * 1000;
  const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
  const timestamp = value => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN;
    const parsed = Date.parse(value);
    return parsed >= 0 && parsed <= Date.now() + futureTolerance ? parsed : NaN;
  };
  const date = value => `${dates.format(value)} UTC`;
  function officialSource(value) {
    if (value === 'CoinGecko') return true;
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
        (url.hostname === 'api.coingecko.com' || (url.hostname === 'www.coingecko.com' && url.pathname === '/en/coins/zclassic'));
    } catch { return false; }
  }
  function baseline(value) {
    if (!value || !positive(value.marketCapUsd) || !officialSource(value.source) || !['nearest-observation', 'launch-day-observation'].includes(value.method)) return null;
    const observedAt = timestamp(value.observedAt), launchedAt = timestamp(value.launchedAt);
    if (![observedAt, launchedAt].every(Number.isFinite) || (value.method === 'nearest-observation' && observedAt > launchedAt)) return null;
    return {marketCapUsd: value.marketCapUsd, observedAt, launchedAt, method: value.method};
  }
  function validate(data) {
    if (!data || !['ok', 'stale'].includes(data.status) || !positive(data.coins?.zcl?.marketCapUsd)) return null;
    const fetchedAt = timestamp(data.fetchedAt), updatedAt = timestamp(data.coins.zcl.updatedAt);
    if (![fetchedAt, updatedAt].every(Number.isFinite)) return null;
    return {status: data.status, marketCapUsd: data.coins.zcl.marketCapUsd, fetchedAt, updatedAt, baseline: baseline(data.sinceLaunch?.baseline)};
  }
  fields['reference-link'].href = 'https://www.coingecko.com/en/coins/zclassic';
  fields['reference-link'].rel = 'noopener noreferrer';
  fields['reference-link'].textContent = t.reference;
  fields['performance-status'].setAttribute('role', 'status');
  fields['performance-status'].setAttribute('aria-live', 'polite');
  fields['performance-status'].setAttribute('aria-atomic', 'true');
  let snapshot = null, failed = false;
  const status = value => {
    // Do not repeat screen-reader announcements on an unchanged age check.
    if (fields['performance-status'].textContent !== value) fields['performance-status'].textContent = value;
  };
  function change(value) {
    const rounded = Math.abs(value) < 0.005 ? 0 : value;
    const trend = rounded === 0 ? 'unchanged' : rounded > 0 ? 'gain' : 'loss';
    const label = t[trend];
    const amount = `${rounded > 0 ? '+' : rounded < 0 ? '−' : ''}${percentages.format(Math.abs(rounded))}%`;
    const caption = document.createElement('span');
    caption.className = 'launch-performance-trend';
    caption.textContent = label;
    fields['change-value'].textContent = amount;
    fields['change-value'].append(caption);
    fields['change-value'].dataset.trend = trend;
    fields['change-value'].setAttribute('aria-label', `${label}: ${amount}`);
  }
  function clearChange() {
    fields['change-value'].textContent = '—';
    delete fields['change-value'].dataset.trend;
    fields['change-value'].removeAttribute('aria-label');
  }
  function render() {
    if (!snapshot) {
      mount.dataset.status = 'unavailable';
      fields['current-value'].textContent = '—';
      fields['current-time'].textContent = t.unavailableTime;
      clearChange();
      status(`${t.unavailable} ${t.cadence}`);
      return;
    }
    const stale = failed || snapshot.status === 'stale' || [snapshot.fetchedAt, snapshot.updatedAt].some(value => Date.now() - value > maxAge);
    fields['current-value'].textContent = caps.format(snapshot.marketCapUsd);
    fields['current-time'].textContent = `${t.updated}: ${date(snapshot.updatedAt)}`;
    const reference = snapshot.baseline;
    const predatesReference = reference && snapshot.updatedAt < reference.observedAt;
    // Calculate from the two caps; never trust an independently supplied percentage.
    const percentage = reference && !predatesReference ? (snapshot.marketCapUsd / reference.marketCapUsd - 1) * 100 : NaN;
    if (reference) {
      fields['baseline-value'].textContent = caps.format(reference.marketCapUsd);
      fields['baseline-time'].textContent = `${t.observed}: ${date(reference.observedAt)}`;
    }
    if (Number.isFinite(percentage)) change(percentage); else clearChange();
    mount.dataset.status = stale ? 'stale' : Number.isFinite(percentage) ? 'ok' : 'unavailable';
    const unavailable = predatesReference ? t.beforeReference : t.noBaseline;
    status(`${stale ? t.stale : Number.isFinite(percentage) ? t.ok : unavailable}${stale && !Number.isFinite(percentage) ? ` ${unavailable}` : ''} ${t.cadence}`);
  }
  status(`${t.loading} ${t.cadence}`);
  window.addEventListener('zcl-market-comparison', event => {
    snapshot = validate(event.detail?.data);
    failed = event.detail?.failed === true;
    render();
  });
  // The shared comparison request refreshes data; this timer only ages the display.
  setInterval(() => { if (!document.hidden && snapshot) render(); }, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && snapshot) render(); });
})();
