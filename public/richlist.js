(() => {
  const mount = document.getElementById('richlist-app');
  if (!mount) return;

  const spanish = document.documentElement.lang === 'es';
  const locale = spanish ? 'es-ES' : 'en-US';
  const integer = new Intl.NumberFormat(locale);
  const decimal = new Intl.NumberFormat(locale).formatToParts(1.1).find(part => part.type === 'decimal').value;
  const dates = new Intl.DateTimeFormat(locale, {year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC'});
  const t = spanish ? {
    loading: 'Cargando la instantánea de saldos…', refresh: 'Actualizar instantánea', refreshing: 'Consultando…',
    download: 'Descargar CSV', search: 'Buscar dirección', searchHint: 'Dirección completa o parte de ella',
    filter: 'Antigüedad de todo el saldo', all: 'Todos los saldos', first: 'Sin gastar durante al menos 100.000 bloques',
    second: 'Sin gastar durante al menos 500.000 bloques', third: 'Sin gastar durante al menos 1.000.000 de bloques',
    snapshot: 'Instantánea', block: 'Bloque', blockTime: 'Fecha del bloque (UTC)', generated: 'Instantánea generada (UTC)',
    source: 'Fuente', verification: 'Verificación', indexed: 'Saldo transparente indexado',
    addresses: 'Direcciones indexadas', outputs: 'Salidas sin gastar', unattributed: 'Saldo sin dirección atribuible',
    current: 'Instantánea disponible. Los saldos corresponden al bloque indicado.',
    stale: 'Instantánea histórica. Los saldos corresponden al bloque indicado y pueden haber cambiado desde entonces.',
    unavailable: 'No se pudo cargar una instantánea válida. Vuelve a intentarlo con «Actualizar instantánea».',
    retained: 'Falló la actualización. Se conserva la instantánea anterior; sus saldos pueden haber cambiado.',
    rank: 'Puesto', address: 'Dirección transparente', balance: 'Saldo (ZCL)', oldest: 'UTXO más antiguo (bloque)',
    newest: 'UTXO más reciente (bloque)', count: 'UTXO', empty: 'Ninguna dirección coincide con estos filtros.',
    region: 'Lista de saldos de direcciones transparentes', table: 'Saldos de direcciones; desplázate horizontalmente para ver todas las columnas',
    unknown: 'Desconocido', shownBalance: 'Saldo mostrado',
    compiledAnchor: 'El estado de la cadena coincide con el compromiso de Zclassic v2.1.2-beta6; no se reprodujo el historial desde el bloque génesis.',
    explanation: 'La antigüedad se mide exactamente en bloques: la altura de la instantánea menos la altura de creación de cada salida que sigue sin gastar (UTXO). Los filtros exigen que todo el saldo alcance el umbral. No indica el último gasto de la dirección ni demuestra que se hayan perdido las claves. No se convierte la antigüedad en bloques a años.',
    scrollHint: 'Desliza la tabla para ver los saldos y las alturas de bloque.',
    scope: 'Solo direcciones transparentes atribuibles, sin agrupar propietarios. Los saldos protegidos no se pueden clasificar. Una dirección puede representar a muchos usuarios y una persona puede controlar varias direcciones.',
    results: (shown, matching) => `Se muestran ${integer.format(shown)} de ${integer.format(matching)} direcciones coincidentes (máximo 100). Los puestos corresponden a la lista completa de saldos indexados.`,
    open: address => `Ver ${address} en el explorador de Zelcore`,
  } : {
    loading: 'Loading the balance snapshot…', refresh: 'Refresh snapshot', refreshing: 'Checking…',
    download: 'Download CSV', search: 'Search address', searchHint: 'Full address or part of one',
    filter: 'Age of the entire balance', all: 'All balances', first: 'Unspent for at least 100,000 blocks',
    second: 'Unspent for at least 500,000 blocks', third: 'Unspent for at least 1,000,000 blocks',
    snapshot: 'Snapshot', block: 'Block', blockTime: 'Block date (UTC)', generated: 'Snapshot generated (UTC)',
    source: 'Source', verification: 'Verification', indexed: 'Indexed transparent balance',
    addresses: 'Indexed addresses', outputs: 'Unspent outputs', unattributed: 'Balance without an attributable address',
    current: 'Snapshot available. Balances are as of the stated block.',
    stale: 'Historical snapshot. Balances are as of the stated block and may have changed since then.',
    unavailable: 'A valid snapshot could not be loaded. Try the Refresh snapshot button again.',
    retained: 'Refresh failed. The previous snapshot is retained; its balances may have changed.',
    rank: 'Rank', address: 'Transparent address', balance: 'Balance (ZCL)', oldest: 'Oldest UTXO (block)',
    newest: 'Newest UTXO (block)', count: 'UTXOs', empty: 'No addresses match these filters.',
    region: 'Transparent address balance list', table: 'Address balances; scroll horizontally to see every column',
    unknown: 'Unknown', shownBalance: 'Balance shown',
    compiledAnchor: 'Chainstate matched the commitment in Zclassic v2.1.2-beta6; history was not replayed from genesis.',
    explanation: 'Age is measured exactly in blocks: the snapshot height minus the creation height of each currently unspent output (UTXO). Filters require the entire balance to meet the threshold. This is not the address’s last spend and does not prove keys are lost. Block age is not converted into years.',
    scrollHint: 'Scroll sideways to see balances and block heights.',
    scope: 'Attributable transparent addresses only, without grouping owners. Shielded balances cannot be ranked. One address can represent many users, and one person can control several addresses.',
    results: (shown, matching) => `Showing ${integer.format(shown)} of ${integer.format(matching)} matching addresses (maximum 100). Ranks use the complete indexed balance list.`,
    open: address => `View ${address} on the Zelcore explorer`,
  };

  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  }
  function button(text) {
    const element = node('button', text, 'richlist-button');
    element.type = 'button';
    return element;
  }
  function amount(value, localized = true) {
    const units = BigInt(value);
    const whole = units / 100000000n;
    const fraction = (units % 100000000n).toString().padStart(8, '0');
    return `${localized ? integer.format(whole) : whole.toString()}${localized ? decimal : '.'}${fraction}`;
  }
  function date(value, includeTime = false) {
    if (!value || !Number.isFinite(Date.parse(value))) return t.unknown;
    if (includeTime) return new Date(value).toLocaleString(locale, {timeZone: 'UTC'});
    return dates.format(new Date(value));
  }

  mount.classList.add('richlist-app');
  mount.setAttribute('role', 'region');
  mount.setAttribute('aria-label', t.region);
  const status = node('p', t.loading, 'richlist-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const refreshButton = button(t.refresh);
  const downloadButton = button(t.download);
  downloadButton.disabled = true;
  const actions = node('div', undefined, 'richlist-actions');
  actions.append(refreshButton, downloadButton);
  const toolbar = node('div', undefined, 'richlist-toolbar');
  toolbar.append(status, actions);
  const metadata = node('div', undefined, 'richlist-metadata');
  metadata.hidden = true;

  const controls = node('div', undefined, 'richlist-controls');
  const searchLabel = node('label', t.search);
  const search = node('input');
  search.type = 'search';
  search.placeholder = t.searchHint;
  search.autocomplete = 'off';
  search.spellcheck = false;
  search.maxLength = 100;
  searchLabel.append(search);
  const filterLabel = node('label', t.filter);
  const filter = node('select');
  for (const [value, label] of [['0', t.all], ['100000', t.first], ['500000', t.second], ['1000000', t.third]]) {
    const option = node('option', label);
    option.value = value;
    filter.append(option);
  }
  filterLabel.append(filter);
  controls.append(searchLabel, filterLabel);
  controls.hidden = true;
  const explanation = node('p', t.explanation, 'richlist-explanation');
  explanation.id = 'richlist-age-help';
  filter.setAttribute('aria-describedby', explanation.id);
  const scope = node('p', t.scope, 'richlist-explanation');
  const results = node('p', undefined, 'richlist-results');
  results.setAttribute('aria-live', 'polite');
  const scroll = node('div', undefined, 'richlist-table-scroll');
  scroll.tabIndex = 0;
  scroll.setAttribute('role', 'region');
  scroll.setAttribute('aria-label', t.table);
  scroll.hidden = true;
  const table = node('table');
  const caption = node('caption', t.region, 'richlist-visually-hidden');
  const thead = node('thead');
  const headings = node('tr');
  for (const text of [t.rank, t.address, t.balance, t.count, t.oldest, t.newest]) {
    const heading = node('th', text);
    heading.scope = 'col';
    headings.append(heading);
  }
  thead.append(headings);
  const tbody = node('tbody');
  table.append(caption, thead, tbody);
  scroll.append(table);
  mount.replaceChildren(toolbar, metadata, controls, results, node('p', t.scrollHint, 'richlist-scroll-hint'), scroll, explanation, scope);

  let saved = null;
  let rows = [];
  let visibleRows = [];
  let busy = false;

  function validUnits(value) {
    return typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value);
  }
  function validate(data) {
    if (!data || !['ok', 'stale'].includes(data.status) || !data.snapshot || !Array.isArray(data.addresses)) throw Error('Invalid snapshot');
    const snapshot = data.snapshot;
    if (snapshot.scope !== 'transparent-utxos' || !Number.isSafeInteger(snapshot.height) || snapshot.height < 0 ||
        !/^[a-f0-9]{64}$/i.test(snapshot.hash) || !Number.isFinite(Date.parse(snapshot.blockAt)) ||
        !Number.isFinite(Date.parse(snapshot.generatedAt)) || !Number.isSafeInteger(snapshot.addressCount) ||
        snapshot.addressCount !== data.addresses.length || !Number.isSafeInteger(snapshot.utxoCount) || snapshot.utxoCount < 0 ||
        !validUnits(snapshot.totalZatoshis) || !validUnits(snapshot.unattributedZatoshis)) throw Error('Invalid metadata');
    const seen = new Set();
    for (const row of data.addresses) {
      if (!row || typeof row.address !== 'string' || !/^t[13][1-9A-HJ-NP-Za-km-z]{33}$/.test(row.address) || seen.has(row.address) ||
          !Number.isSafeInteger(row.utxoCount) || row.utxoCount < 1 || !validUnits(row.balanceZatoshis) || BigInt(row.balanceZatoshis) <= 0n) throw Error('Invalid address');
      if (!Number.isSafeInteger(row.oldestHeight) || !Number.isSafeInteger(row.newestHeight) ||
          row.oldestHeight < 0 || row.oldestHeight > row.newestHeight || row.newestHeight > snapshot.height) throw Error('Invalid creation heights');
      for (const key of ['aged100kZatoshis', 'aged500kZatoshis', 'aged1mZatoshis']) {
        if (!validUnits(row[key]) || BigInt(row[key]) > BigInt(row.balanceZatoshis)) throw Error('Invalid age balance');
      }
      if (BigInt(row.aged1mZatoshis) > BigInt(row.aged500kZatoshis) || BigInt(row.aged500kZatoshis) > BigInt(row.aged100kZatoshis)) throw Error('Invalid age order');
      seen.add(row.address);
    }
    return data;
  }
  function metric(list, label, value, className) {
    const group = node('div');
    group.append(node('dt', label), node('dd', value, className));
    list.append(group);
  }
  function renderMetadata() {
    const snapshot = saved.snapshot;
    const stats = node('dl', undefined, 'richlist-stats');
    metric(stats, t.indexed, `${amount(snapshot.totalZatoshis)} ZCL`);
    metric(stats, t.addresses, integer.format(snapshot.addressCount));
    metric(stats, t.outputs, integer.format(snapshot.utxoCount));
    const details = node('dl', undefined, 'richlist-details');
    metric(details, t.block, integer.format(snapshot.height));
    metric(details, t.blockTime, date(snapshot.blockAt, true));
    metric(details, t.generated, date(snapshot.generatedAt, true));
    metric(details, t.snapshot, snapshot.hash, 'richlist-hash');
    const sourceUrl = 'https://github.com/ZclassicCommunity/zclassic/releases/tag/v2.1.2-beta6';
    if (snapshot.source === sourceUrl || snapshot.source === 'Zclassic v2.1.2-beta6') {
      const group = node('div');
      const value = node('dd');
      const link = node('a', 'Zclassic v2.1.2-beta6');
      link.href = sourceUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      value.append(link);
      group.append(node('dt', t.source), value);
      details.append(group);
    } else if (typeof snapshot.source === 'string' && snapshot.source) metric(details, t.source, snapshot.source);
    if (typeof snapshot.verification === 'string' && snapshot.verification) metric(details, t.verification, snapshot.verification === 'compiled-anchor' ? t.compiledAnchor : snapshot.verification);
    if (BigInt(snapshot.unattributedZatoshis) > 0n) metric(details, t.unattributed, `${amount(snapshot.unattributedZatoshis)} ZCL`);
    metadata.replaceChildren(stats, details);
    metadata.hidden = false;
    controls.hidden = false;
    scroll.hidden = false;
  }
  function renderRows() {
    if (!saved) return;
    const query = search.value.trim();
    const ageKey = {'100000': 'aged100kZatoshis', '500000': 'aged500kZatoshis', '1000000': 'aged1mZatoshis'}[filter.value];
    const matching = rows.filter(row => (!query || row.address.includes(query)) && (!ageKey || row[ageKey] === row.balanceZatoshis));
    visibleRows = matching.slice(0, 100);
    const fragment = document.createDocumentFragment();
    for (const row of visibleRows) {
      const tr = node('tr');
      tr.append(node('td', integer.format(row.rank), 'richlist-rank'));
      const addressCell = node('td', undefined, 'richlist-address');
      const link = node('a', row.address);
      link.href = `https://explorer.zcl.zelcore.io/address/${encodeURIComponent(row.address)}`;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.setAttribute('aria-label', t.open(row.address));
      addressCell.append(link);
      tr.append(addressCell, node('td', amount(row.balanceZatoshis), 'richlist-number'),
        node('td', integer.format(row.utxoCount), 'richlist-number'),
        node('td', integer.format(row.oldestHeight), 'richlist-number'), node('td', integer.format(row.newestHeight), 'richlist-number'));
      fragment.append(tr);
    }
    if (!visibleRows.length) {
      const tr = node('tr');
      const td = node('td', t.empty, 'richlist-empty');
      td.colSpan = 6;
      tr.append(td);
      fragment.append(tr);
    }
    tbody.replaceChildren(fragment);
    const total = visibleRows.reduce((sum, row) => sum + BigInt(row.balanceZatoshis), 0n);
    results.textContent = `${t.results(visibleRows.length, matching.length)} ${t.shownBalance}: ${amount(total)} ZCL.`;
    downloadButton.disabled = busy || visibleRows.length === 0;
  }
  async function refresh() {
    if (busy) return;
    busy = true;
    refreshButton.disabled = true;
    downloadButton.disabled = true;
    refreshButton.textContent = t.refreshing;
    status.textContent = t.loading;
    mount.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch('/api/richlist', {cache: 'no-cache', signal: AbortSignal.timeout(30000)});
      if (!response.ok) throw Error('Unavailable');
      const data = validate(await response.json());
      saved = data;
      rows = data.addresses.slice().sort((a, b) => {
        const left = BigInt(a.balanceZatoshis), right = BigInt(b.balanceZatoshis);
        return left > right ? -1 : left < right ? 1 : a.address < b.address ? -1 : a.address > b.address ? 1 : 0;
      }).map((row, index) => ({...row, rank: index + 1}));
      renderMetadata();
      status.textContent = data.status === 'stale' ? t.stale : t.current;
      status.dataset.state = data.status;
      renderRows();
    } catch {
      status.textContent = saved ? t.retained : t.unavailable;
      status.dataset.state = saved ? 'stale' : 'unavailable';
    } finally {
      busy = false;
      refreshButton.disabled = false;
      refreshButton.textContent = t.refresh;
      downloadButton.disabled = visibleRows.length === 0;
      mount.setAttribute('aria-busy', 'false');
    }
  }
  function download() {
    if (!saved || !visibleRows.length) return;
    const csvRows = [['snapshot_height', 'snapshot_hash', 'snapshot_block_time_utc', 'global_rank', 'address', 'balance_zcl', 'utxo_count', 'oldest_utxo_height', 'newest_utxo_height', 'filter_blocks']];
    for (const row of visibleRows) csvRows.push([
      saved.snapshot.height, saved.snapshot.hash, saved.snapshot.blockAt, row.rank, row.address,
      amount(row.balanceZatoshis, false), row.utxoCount, row.oldestHeight, row.newestHeight, filter.value,
    ]);
    const csv = csvRows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], {type: 'text/csv;charset=utf-8'}));
    const link = node('a');
    link.href = url;
    link.download = `zcl-transparent-balances-${saved.snapshot.height}.csv`;
    link.hidden = true;
    mount.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  search.addEventListener('input', renderRows);
  filter.addEventListener('change', renderRows);
  refreshButton.addEventListener('click', refresh);
  downloadButton.addEventListener('click', download);
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); refresh(); }
    }, {rootMargin: '400px'});
    observer.observe(mount);
  } else refresh();
})();
