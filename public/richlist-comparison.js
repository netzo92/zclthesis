(() => {
  const mount = document.getElementById('richlist-comparison');
  if (!mount) return;
  const es = document.documentElement.lang === 'es', locale = es ? 'es-ES' : 'en-US';
  const t = es ? {
    loading: 'Consultando los índices transparentes…', unavailable: 'No disponible', stale: 'Desactualizado', current: 'Disponible',
    ten: '10 DIRECCIONES PRINCIPALES', hundred: '100 DIRECCIONES PRINCIPALES', denominator: 'Denominador: valor transparente indexado',
    addresses: 'Direcciones con saldo en el índice', omitted: 'Valor sin dirección atribuida', full: 'Índice ZCL completo; búsqueda y antigüedad UTXO abajo.',
    partial: 'Se muestran las 100 principales de un índice ZEC más amplio. Sin filtros de antigüedad UTXO.',
    block: 'Bloque de la instantánea', index: 'Punta del índice observada', time: 'Hora del bloque', generated: 'Exportada', observed: 'Consultada',
    provider: 'CipherScan · índice del proveedor', node: 'Nuestro nodo ZCL', historical: 'Respaldo histórico ZCL',
    rows: 'Ver las 100 direcciones principales de Zcash', rank: 'Puesto', address: 'Dirección transparente', balance: 'Saldo (ZEC)',
    source: 'Fuente', refresh: 'ZCL: exportación prevista cada dos horas. ZEC: consulta cada hora. Un fallo conserva los datos anteriores y los marca como desactualizados.',
    missing: 'No se pudo consultar ZEC. La tabla aparecerá cuando haya una respuesta válida.',
    note: 'Las proporciones usan el valor transparente indexado de cada fuente, incluidos los importes que no se atribuyen a una dirección. Excluyen saldos protegidos; no son porcentajes de la oferta circulante ni de propietarios individuales. El tratamiento de scripts y los tiempos de actualización difieren. ZCL resuelve salidas P2PK a su dirección; CipherScan las cuenta entre las salidas sin dirección. La altura ZEC es la punta observada del índice, no una garantía de que todos los saldos formen una instantánea atómica. No se comparan claves perdidas ni identidades.',
    scroll: 'Desplázate horizontalmente para ver los saldos.'
  } : {
    loading: 'Checking the transparent indexes…', unavailable: 'Unavailable', stale: 'Stale', current: 'Available',
    ten: 'TOP 10 ADDRESSES', hundred: 'TOP 100 ADDRESSES', denominator: 'Denominator: indexed transparent value',
    addresses: 'Funded addresses in the index', omitted: 'Value without an attributed address', full: 'Full ZCL index; search and UTXO ages below.',
    partial: 'Showing the top 100 from a larger ZEC index. No UTXO-age filters.',
    block: 'Snapshot block', index: 'Observed index tip', time: 'Block time', generated: 'Exported', observed: 'Fetched',
    provider: 'CipherScan · provider index', node: 'Our ZCL node', historical: 'Historical ZCL fallback',
    rows: 'View Zcash’s top 100 transparent addresses', rank: 'Rank', address: 'Transparent address', balance: 'Balance (ZEC)',
    source: 'Source', refresh: 'ZCL: exports target every two hours. ZEC: fetched hourly. Failed refreshes retain earlier data and mark it stale.',
    missing: 'ZEC could not be fetched. Its table will appear after a valid response.',
    note: 'Shares use each source’s indexed transparent value, including value not attributed to an address. Shielded holdings are excluded; these are not shares of circulating supply or individual owners. Script handling and update times differ. ZCL resolves P2PK outputs to an address; CipherScan includes them among addressless outputs. The ZEC height is the observed index tip, not a guarantee that all balances form an atomic snapshot. Lost keys and identities are not compared.',
    scroll: 'Scroll sideways to see the balances.'
  };
  const integer = new Intl.NumberFormat(locale), percent = new Intl.NumberFormat(locale, {maximumFractionDigits: 2});
  const decimal = new Intl.NumberFormat(locale).formatToParts(1.1).find(p => p.type === 'decimal').value;
  const units = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,15})$/.test(value);
  const amount = value => {const n = BigInt(value); return `${integer.format(n / 100000000n)}${decimal}${(n % 100000000n).toString().padStart(8, '0')}`;};
  const date = value => new Date(value).toLocaleString(locale, {timeZone: 'UTC'}) + ' UTC';
  const element = (tag, text, className) => {const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e;};
  mount.classList.add('richlist-comparison');
  const status = element('p', t.loading, 'richlist-comparison-status'); status.setAttribute('role', 'status');
  const cards = element('div', undefined, 'richlist-comparison-cards');
  const details = element('details', undefined, 'zec-richlist');
  details.append(element('summary', t.rows));
  const tableRegion = element('div', undefined, 'richlist-table-scroll'); tableRegion.tabIndex = 0; tableRegion.setAttribute('aria-label', t.rows);
  const table = element('table'), head = element('thead'), heading = element('tr'), body = element('tbody');
  for (const text of [t.rank, t.address, t.balance]) {const th = element('th', text); th.scope = 'col'; heading.append(th);}
  head.append(heading); table.append(head, body); tableRegion.append(table);
  details.append(element('p', t.partial), element('p', t.scroll, 'richlist-scroll-hint'), tableRegion);
  details.hidden = true;
  mount.replaceChildren(cards, status, details, element('p', t.refresh, 'richlist-explanation'), element('p', t.note, 'richlist-explanation'));

  function validateCoin(coin, symbol) {
    if (!coin) return null;
    if (coin.asset !== symbol || !['ok', 'stale'].includes(coin.status) || !Array.isArray(coin.addresses) || coin.addresses.length !== 100 ||
        !Number.isSafeInteger(coin.height) || !Number.isSafeInteger(coin.addressCount) || coin.addressCount < 100 ||
        ![coin.blockAt, coin.generatedAt, coin.observedAt].every(v => Number.isFinite(Date.parse(v)))) throw Error('Invalid comparison metadata');
    for (const field of ['totalZatoshis', 'addressedZatoshis', 'unattributedZatoshis', 'top10Zatoshis', 'top100Zatoshis']) if (!units(coin[field])) throw Error('Invalid amounts');
    if (BigInt(coin.totalZatoshis) <= 0n || BigInt(coin.addressedZatoshis) + BigInt(coin.unattributedZatoshis) !== BigInt(coin.totalZatoshis)) throw Error('Invalid total');
    const seen = new Set(); let total = 0n;
    coin.addresses.forEach((row, i) => {
      if (!/^t[13][1-9A-HJ-NP-Za-km-z]{33}$/.test(row.address) || seen.has(row.address) || !units(row.balanceZatoshis)) throw Error('Invalid rows');
      seen.add(row.address); total += BigInt(row.balanceZatoshis);
      if (i === 9 && total !== BigInt(coin.top10Zatoshis)) throw Error('Invalid top 10');
    });
    if (total !== BigInt(coin.top100Zatoshis) || total > BigInt(coin.totalZatoshis)) throw Error('Invalid top 100');
    return coin;
  }
  function render(data, failed = false) {
    const fragment = document.createDocumentFragment();
    for (const [key, name] of [['zcl', 'Zclassic · ZCL'], ['zec', 'Zcash · ZEC']]) {
      const coin = data?.coins?.[key], card = element('article', undefined, 'richlist-comparison-card');
      card.append(element('h3', name));
      if (!coin) card.append(element('p', t.unavailable));
      else {
        card.dataset.status = failed ? 'stale' : coin.status;
        const top = element('div', undefined, 'concentration-values');
        for (const [label, field] of [[t.ten, 'top10Zatoshis'], [t.hundred, 'top100Zatoshis']]) {
          const group = element('div'); group.append(element('p', label, 'eyebrow'), element('strong', `${percent.format(Number(coin[field]) / Number(coin.totalZatoshis) * 100)}%`)); top.append(group);
        }
        card.append(element('p', failed || coin.status === 'stale' ? t.stale : t.current, 'richlist-comparison-freshness'), top,
          element('p', `${t.denominator}: ${amount(coin.totalZatoshis)} ${coin.asset}`),
          element('p', `${t.addresses}: ${integer.format(coin.addressCount)} · ${t.omitted}: ${amount(coin.unattributedZatoshis)} ${coin.asset}`),
          element('p', `${key === 'zec' ? t.index : t.block}: ${integer.format(coin.height)} · ${t.time}: ${date(coin.blockAt)}`),
          element('p', `${key === 'zec' ? t.observed : t.generated}: ${date(key === 'zec' ? coin.observedAt : coin.generatedAt)}`));
        const source = element('a', key === 'zec' ? t.provider : coin.sourceKind === 'compiled-anchor' ? t.historical : t.node);
        source.href = key === 'zec' ? 'https://cipherscan.app/rich-list' : coin.sourceKind === 'compiled-anchor' ? 'https://github.com/ZclassicCommunity/zclassic/releases/tag/v2.1.2-beta6' : 'https://pool.zclthesis.com';
        card.append(source, element('p', key === 'zec' ? t.partial : t.full));
      }
      fragment.append(card);
    }
    cards.replaceChildren(fragment);
    const zec = data?.coins?.zec;
    details.hidden = !zec;
    if (zec) {
      const rows = document.createDocumentFragment();
      zec.addresses.forEach((row, index) => {
        const tr = element('tr'), cell = element('td', undefined, 'richlist-address'), link = element('a', row.address);
        link.href = `https://cipherscan.app/address/${encodeURIComponent(row.address)}`; cell.append(link);
        tr.append(element('td', integer.format(index + 1)), cell, element('td', amount(row.balanceZatoshis), 'richlist-number')); rows.append(tr);
      });
      body.replaceChildren(rows);
    }
    status.textContent = !zec ? t.missing : `${t.source}: CipherScan · ${t.observed}: ${date(zec.observedAt)}`;
  }
  let saved, busy = false, active = false;
  async function refresh() {
    if (busy || document.hidden) return;
    active = true; busy = true;
    try {
      const response = await fetch('/api/richlist-comparison', {cache: 'no-store', signal: AbortSignal.timeout(35000)});
      if (!response.ok) throw Error('Unavailable');
      const data = await response.json();
      if (!data?.coins) throw Error('Missing comparison');
      data.coins.zcl = validateCoin(data.coins.zcl, 'ZCL'); data.coins.zec = validateCoin(data.coins.zec, 'ZEC');
      saved = data; render(data);
    } catch {render(saved, true);}
    finally {busy = false;}
  }
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {if (entries.some(e => e.isIntersecting)) {observer.disconnect(); refresh();}}, {rootMargin: '400px'});
    observer.observe(mount);
  } else refresh();
  setInterval(() => {if (active) refresh();}, 3600000);
  document.addEventListener('visibilitychange', () => {if (active && !document.hidden) refresh();});
})();
