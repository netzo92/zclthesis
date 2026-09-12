(() => {
  const mount = document.getElementById('market-comparison');
  if (!mount) return;
  const spanish = document.documentElement.lang === 'es';
  const locale = spanish ? 'es-ES' : 'en-US';
  const t = spanish ? {
    label: 'Comparación de capitalización de mercado en dólares estadounidenses',
    cap: 'CAPITALIZACIÓN · USD', price: 'Precio de referencia', supply: 'Oferta circulante informada',
    updated: 'Actualizado por la fuente', fetched: 'Consultado', ratio: 'RELACIÓN ZEC / ZCL',
    ratioLabel: 'Capitalización de Zcash dividida por la de Zclassic', percentage: 'La capitalización de ZCL equivale al', ofZec: 'de la de ZEC.',
    loading: 'Consultando la comparación de CoinGecko…', unavailable: 'No disponible',
    ok: 'Datos de CoinGecko disponibles. Se actualizan cada cinco minutos mientras la página está visible.',
    stale: 'Datos desactualizados: revisa las horas de actualización. La fuente tiene más de una hora de antigüedad o no se pudo actualizar.',
    failed: 'No se pudo actualizar la comparación. Los valores mostrados proceden de la última consulta exitosa.',
    missing: 'Comparación temporalmente no disponible. Consulta las fuentes de CoinGecko; volveremos a intentarlo.',
    note: 'Capitalización de mercado = precio × oferta circulante informada por el proveedor. No mide el dinero invertido. Una capitalización menor no demuestra que un activo esté barato ni que la diferencia vaya a cerrarse. Los precios de referencia no garantizan un precio de ejecución.',
  } : {
    label: 'Market capitalization comparison in US dollars',
    cap: 'MARKET CAPITALIZATION · USD', price: 'Reference price', supply: 'Reported circulating supply',
    updated: 'Source updated', fetched: 'Fetched', ratio: 'ZEC / ZCL RATIO',
    ratioLabel: 'Zcash market cap divided by Zclassic market cap', percentage: 'ZCL’s market cap is', ofZec: 'of ZEC’s.',
    loading: 'Checking the CoinGecko comparison…', unavailable: 'Unavailable',
    ok: 'CoinGecko data available. Refreshes every five minutes while the page is visible.',
    stale: 'Stale data: check the update times. The source is over an hour old or could not be refreshed.',
    failed: 'Comparison refresh failed. Any displayed values are from the last successful fetch.',
    missing: 'Comparison temporarily unavailable. Check the CoinGecko sources; we will retry.',
    note: 'Market cap = price × provider-reported circulating supply. It does not measure money invested. A smaller cap does not establish that an asset is cheap or that the gap will close. Reference prices do not guarantee an execution price.',
  };
  const caps = new Intl.NumberFormat(locale, {style: 'currency', currency: 'USD', currencyDisplay: 'code', maximumFractionDigits: 0});
  const prices = new Intl.NumberFormat(locale, {style: 'currency', currency: 'USD', currencyDisplay: 'code', maximumSignificantDigits: 6});
  const supply = new Intl.NumberFormat(locale, {maximumFractionDigits: 0});
  const ratio = new Intl.NumberFormat(locale, {maximumSignificantDigits: 4});
  const date = value => new Date(value).toLocaleString(locale);
  const node = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  mount.classList.add('market-comparison');
  mount.setAttribute('aria-label', t.label);
  const grid = node('div', 'comparison-grid');
  const fields = {};
  for (const [symbol, name, id] of [['zcl', 'Zclassic', 'zclassic'], ['zec', 'Zcash', 'zcash']]) {
    const card = node('article', 'comparison-card');
    const heading = node('h3', '', `${name} · ${symbol.toUpperCase()}`);
    heading.id = `comparison-${symbol}-heading`;
    card.setAttribute('aria-labelledby', heading.id);
    const value = node('strong', 'comparison-value', '—');
    const detail = node('p', 'comparison-detail');
    const timestamp = node('p', 'comparison-time');
    const source = node('a', 'comparison-source', `CoinGecko · ${name} ↗`);
    source.href = `https://www.coingecko.com/en/coins/${id}`;
    card.append(heading, node('p', 'eyebrow', t.cap), value, detail, timestamp, source);
    grid.append(card);
    fields[symbol] = {value, detail, timestamp};
  }
  const relative = node('article', 'comparison-card comparison-relative');
  const ratioHeading = node('h3', '', t.ratio);
  const ratioValue = node('strong', 'comparison-value', '—');
  const percentage = node('p', 'comparison-detail');
  const fetched = node('p', 'comparison-time');
  relative.append(ratioHeading, node('p', 'comparison-ratio-label', t.ratioLabel), ratioValue, percentage, fetched);
  grid.append(relative);
  const status = node('p', 'comparison-status', t.loading);
  status.setAttribute('role', 'status');
  mount.replaceChildren(grid, status, node('p', 'comparison-note', t.note));

  let snapshot, busy = false;
  const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
  function validate(data) {
    if (!['ok', 'stale'].includes(data?.status) || !Number.isFinite(Date.parse(data.fetchedAt))) throw Error('No comparison snapshot');
    for (const symbol of ['zcl', 'zec']) {
      const coin = data.coins?.[symbol];
      if (!coin || ![coin.marketCapUsd, coin.priceUsd, coin.circulatingSupply].every(positive) || !Number.isFinite(Date.parse(coin.updatedAt))) throw Error('Invalid comparison snapshot');
    }
    if (![data.zecToZclRatio, data.zclPercentOfZec].every(positive)) throw Error('Invalid ratio');
    return data;
  }
  function render(data, failed = false) {
    window.dispatchEvent(new CustomEvent('zcl-market-comparison', {detail: {data, failed}}));
    mount.dataset.status = data ? failed ? 'stale' : data.status : 'unavailable';
    for (const symbol of ['zcl', 'zec']) {
      const coin = data?.coins[symbol];
      fields[symbol].value.textContent = coin ? caps.format(coin.marketCapUsd) : t.unavailable;
      fields[symbol].detail.textContent = coin ? `${t.price}: ${prices.format(coin.priceUsd)} · ${t.supply}: ${supply.format(coin.circulatingSupply)} ${symbol.toUpperCase()}` : '';
      fields[symbol].timestamp.textContent = coin ? `${t.updated}: ${date(coin.updatedAt)}` : '';
    }
    ratioValue.textContent = data ? `${ratio.format(data.zecToZclRatio)}×` : t.unavailable;
    percentage.textContent = data ? `${t.percentage} ${ratio.format(data.zclPercentOfZec)} % ${t.ofZec}` : '';
    fetched.textContent = data ? `${t.fetched}: ${date(data.fetchedAt)}` : '';
    status.textContent = !data ? t.missing : failed ? t.failed : data.status === 'stale' ? t.stale : t.ok;
  }
  async function refresh() {
    if (busy || document.hidden) return;
    busy = true;
    try {
      const response = await fetch('/api/comparison', {cache: 'no-store', signal: AbortSignal.timeout(12000)});
      if (!response.ok) throw Error('Comparison unavailable');
      snapshot = validate(await response.json());
      render(snapshot);
    } catch { render(snapshot, true); }
    finally { busy = false; }
  }
  refresh();
  setInterval(refresh, 300000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
})();
