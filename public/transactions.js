(function () {
  'use strict';
  const SOURCE = 'https://pool.zclthesis.com/api/transactions.json';
  const EXPLORER = 'https://explorer.zcl.zelcore.io/tx/';
  const MAX_AGE = 90000;
  const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  const integer = value => Number.isSafeInteger(value) && value >= 0;
  const amount = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,15})$/.test(value) && BigInt(value) <= 2100000000000000n;
  const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)) && Date.parse(value) >= 0;
  const address = value => typeof value === 'string' && /^t[13][1-9A-HJ-NP-Za-km-z]{33}$/.test(value);
  const text = {
    en: {
      ok: ['Recent transactions', 'Confirmed transactions from our node’s chain view. The mempool is this node’s unconfirmed view.'],
      syncing: ['Node is synchronizing', 'This feed can be behind the network while the node catches up.'],
      disconnected: ['Node has no peers', 'The node is disconnected. Its chain and mempool views may fall behind.'],
      stale: ['Transaction observation is stale', 'Keeping the last validated observation. Its confirmations and mempool are not current.'],
      unavailable: ['Transaction feed unavailable', 'A validated observation is not available yet. Missing data is shown as a dash, not zero.'],
      loading: 'Checking transactions…', loadingDetail: 'Waiting for a validated observation from our node.',
      refresh: 'Refresh now', refreshing: 'Refreshing…', cadence: 'Refreshes every 30 seconds while visible; observations older than 90 seconds are marked stale.',
      blocks: 'blocks scanned', heights: 'heights', tip: 'Tip', confirmed: 'confirmations at this tip', reward: 'Mining reward', transaction: 'Transaction',
      details: 'Outputs and details', output: 'Output', outputs: 'transparent outputs', inputs: 'transparent inputs',
      shielded: 'Shielded components present', notShielded: 'No shielded components reported',
      valueNote: 'Visible outputs can include change and do not include hidden values. They do not identify a payment amount or the parties involved.',
      script: 'Script type', noAddress: 'No transparent address decoded', truncatedOutputs: 'Output details are limited; the visible-output total includes all transparent outputs.',
      empty: 'No confirmed transactions in the scanned blocks.', emptyFiltered: 'No non-reward transactions in the scanned results.', hidden: 'mining rewards hidden',
      showing: 'Showing', of: 'of', returned: 'returned transactions', limited: 'Results are limited to 100 transactions; earlier activity may be omitted.',
      notFull: 'This is a recent block window, not the complete chain history.',
      mempoolEmpty: 'This node’s mempool was empty at the observation time.', mempoolUnavailable: 'Mempool data unavailable — no transaction count is available.',
      mempoolTotal: 'unconfirmed transactions reported by this node', mempoolLimited: 'Only the first 50 entries are shown.',
      mempoolNote: 'The time records admission to this node’s mempool, not network-wide arrival. Readmission can reset it. Transactions can leave the mempool without confirming.',
      awaiting: 'No observation available.', bytes: 'bytes', fullId: 'Full transaction ID',
    },
    es: {
      ok: ['Transacciones recientes', 'Transacciones confirmadas según la cadena de nuestro nodo. La mempool refleja la vista local de transacciones sin confirmar.'],
      syncing: ['El nodo se está sincronizando', 'Este listado puede ir por detrás de la red mientras el nodo se pone al día.'],
      disconnected: ['El nodo no tiene pares', 'El nodo está desconectado. Su vista de la cadena y de la mempool puede quedar atrasada.'],
      stale: ['Observación de transacciones desactualizada', 'Se conserva la última observación validada. Sus confirmaciones y su mempool no están al día.'],
      unavailable: ['Listado de transacciones no disponible', 'Todavía no hay una observación validada. Los datos ausentes se muestran con un guion, no con un cero.'],
      loading: 'Consultando transacciones…', loadingDetail: 'Esperando una observación validada de nuestro nodo.',
      refresh: 'Actualizar ahora', refreshing: 'Actualizando…', cadence: 'Se actualiza cada 30 segundos mientras la página está visible; las observaciones de más de 90 segundos se marcan como desactualizadas.',
      blocks: 'bloques revisados', heights: 'alturas', tip: 'Punta', confirmed: 'confirmaciones en esta punta', reward: 'Recompensa de minería', transaction: 'Transacción',
      details: 'Salidas y detalles', output: 'Salida', outputs: 'salidas transparentes', inputs: 'entradas transparentes',
      shielded: 'Contiene componentes blindados', notShielded: 'No se informan componentes blindados',
      valueNote: 'Las salidas visibles pueden incluir cambio y no incluyen valores ocultos. No identifican el importe de un pago ni a las partes involucradas.',
      script: 'Tipo de script', noAddress: 'No se decodificó una dirección transparente', truncatedOutputs: 'Los detalles de las salidas están limitados; el total visible incluye todas las salidas transparentes.',
      empty: 'No hay transacciones confirmadas en los bloques revisados.', emptyFiltered: 'No hay transacciones distintas de recompensas en los resultados revisados.', hidden: 'recompensas de minería ocultas',
      showing: 'Se muestran', of: 'de', returned: 'transacciones devueltas', limited: 'Los resultados se limitan a 100 transacciones; puede omitirse actividad anterior.',
      notFull: 'Es una ventana de bloques recientes, no el historial completo de la cadena.',
      mempoolEmpty: 'La mempool de este nodo estaba vacía en el momento de la observación.', mempoolUnavailable: 'Datos de la mempool no disponibles — no hay un recuento de transacciones.',
      mempoolTotal: 'transacciones sin confirmar informadas por este nodo', mempoolLimited: 'Solo se muestran las primeras 50 entradas.',
      mempoolNote: 'La hora registra la admisión en la mempool de este nodo, no su llegada a toda la red. Una readmisión puede reiniciarla. Las transacciones pueden salir de la mempool sin confirmarse.',
      awaiting: 'No hay una observación disponible.', bytes: 'bytes', fullId: 'ID completo de la transacción',
    },
  };
  function validateTransactionsPayload(data, now = Date.now()) {
    const valid = condition => { if (!condition) throw Error('Invalid transaction observation'); };
    valid(data?.schemaVersion === 1 && data.asset === 'ZCL' && data.source === SOURCE && ['ok','syncing','disconnected','stale','unavailable'].includes(data.status));
    valid(Array.isArray(data.transactions) && data.transactions.length <= 100);
    if (data.status === 'unavailable') {
      valid(data.chain === null && data.node === null && data.coverage === null && data.mempool === null && data.transactions.length === 0);
      return data;
    }
    valid(timestamp(data.generatedAt) && timestamp(data.observedAt) && Math.max(Date.parse(data.generatedAt), Date.parse(data.observedAt)) <= now + 300000);
    valid(integer(data.chain?.height) && hash(data.chain.hash) && timestamp(data.chain.blockAt));
    valid(typeof data.node?.synced === 'boolean' && integer(data.node.connections));
    const coverage = data.coverage;
    valid(integer(coverage?.blocksScanned) && coverage.blocksScanned > 0 && coverage.blocksScanned <= 100 && integer(coverage.oldestHeight) && coverage.oldestHeight <= data.chain.height && coverage.blocksScanned === data.chain.height - coverage.oldestHeight + 1 && coverage.transactionLimit === 100 && typeof coverage.transactionsTruncated === 'boolean');
    const seen = new Set(), blocks = new Map([[data.chain.height, data.chain.hash]]);
    for (const tx of data.transactions) {
      valid(hash(tx?.txid) && !seen.has(tx.txid)); seen.add(tx.txid);
      valid(integer(tx.blockHeight) && tx.blockHeight >= coverage.oldestHeight && tx.blockHeight <= data.chain.height && hash(tx.blockHash) && timestamp(tx.blockAt));
      valid(!blocks.has(tx.blockHeight) || blocks.get(tx.blockHeight) === tx.blockHash); blocks.set(tx.blockHeight, tx.blockHash);
      valid(tx.confirmations === data.chain.height - tx.blockHeight + 1 && typeof tx.isCoinbase === 'boolean' && typeof tx.hasShieldedComponents === 'boolean');
      valid(integer(tx.transparentInputCount) && integer(tx.transparentOutputCount) && amount(tx.transparentOutputZat) && typeof tx.outputsTruncated === 'boolean');
      valid(Array.isArray(tx.outputs) && tx.outputs.length <= 32 && tx.outputs.length <= tx.transparentOutputCount);
      const outputs = new Set(); let total = 0n;
      for (const output of tx.outputs) {
        valid(integer(output?.n) && output.n < tx.transparentOutputCount && !outputs.has(output.n) && amount(output.amountZat)); outputs.add(output.n);
        valid(typeof output.scriptType === 'string' && output.scriptType.length <= 80 && Array.isArray(output.addresses) && output.addresses.length <= 8 && output.addresses.every(address));
        total += BigInt(output.amountZat);
      }
      valid(total <= BigInt(tx.transparentOutputZat));
      if (!tx.outputsTruncated) valid(tx.outputs.length === tx.transparentOutputCount && total === BigInt(tx.transparentOutputZat));
    }
    valid(data.mempool !== null);
    {
      const pool = data.mempool;
      valid(integer(pool?.total) && pool.limit === 50 && typeof pool.truncated === 'boolean' && Array.isArray(pool.transactions) && pool.transactions.length <= 50 && pool.transactions.length <= pool.total);
      if (!pool.truncated) valid(pool.total === pool.transactions.length);
      for (const tx of pool.transactions) {
        valid(hash(tx?.txid) && !seen.has(tx.txid) && timestamp(tx.localNodeSeenAt) && Date.parse(tx.localNodeSeenAt) <= Date.parse(data.generatedAt) + 300000 && integer(tx.sizeBytes) && tx.sizeBytes > 0); seen.add(tx.txid);
      }
    }
    return data;
  }
  function formatZcl(value, language = 'en') {
    if (!amount(value)) throw Error('Invalid ZCL amount');
    const zat = BigInt(value), whole = zat / 100000000n, fractional = (zat % 100000000n).toString().padStart(8, '0');
    return new Intl.NumberFormat(language === 'es' ? 'es-ES' : 'en-US', {maximumFractionDigits: 0}).format(whole) + (language === 'es' ? ',' : '.') + fractional;
  }
  function transactionState(data, now = Date.now(), failed = false) {
    if (!data || data.status === 'unavailable') return 'unavailable';
    if (failed || data.status === 'stale' || now - Date.parse(data.generatedAt) > MAX_AGE || now - Date.parse(data.observedAt) > MAX_AGE) return 'stale';
    if (data.node.connections === 0 || data.status === 'disconnected') return 'disconnected';
    if (!data.node.synced || data.status === 'syncing') return 'syncing';
    return 'ok';
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = {validateTransactionsPayload, formatZcl, transactionState};
  if (typeof document === 'undefined') return;
  const mount = document.getElementById('transactions');
  if (!mount) return;
  const ids = ['refresh','rewards','status','status-detail','published','tip','coverage','body','mempool-status','mempool-body'];
  const fields = Object.fromEntries(ids.map(id => [id, document.getElementById(`transactions-${id}`)]));
  if (Object.values(fields).some(element => !element)) return;
  const lang = document.documentElement.lang === 'es' ? 'es' : 'en', t = text[lang], locale = lang === 'es' ? 'es-ES' : 'en-US';
  const number = value => new Intl.NumberFormat(locale).format(value);
  const date = value => new Intl.DateTimeFormat(locale, {dateStyle:'medium',timeStyle:'medium',timeZone:'UTC',hourCycle:'h23'}).format(new Date(value)) + ' UTC';
  const set = (element, value) => { if (element.textContent !== value) element.textContent = value; };
  const element = (tag, className, value) => {
    const result = document.createElement(tag);
    if (className) result.className = className;
    if (value !== undefined) result.textContent = value;
    return result;
  };
  const txLink = txid => {
    const link = element('a', 'transactions-id', `${txid.slice(0, 14)}…${txid.slice(-10)}`);
    link.href = EXPLORER + txid; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.title = txid;
    link.setAttribute('aria-label', `${t.transaction}: ${txid}`); link.dataset.focusKey = 'transaction';
    return link;
  };
  function emptyRow(body, message, columns) {
    const row = element('tr'), cell = element('td', 'transactions-empty', message);
    cell.colSpan = columns; row.append(cell); body.replaceChildren(row);
  }
  function details(tx) {
    const detail = element('details', 'transactions-details');
    const summary = element('summary', '', `${t.details} (${number(tx.transparentOutputCount)})`);
    summary.dataset.focusKey = 'details'; detail.append(summary);
    let built = false;
    detail.addEventListener('toggle', () => {
      if (!detail.open || built) return;
      built = true;
      detail.append(element('p', 'transactions-note', `${number(tx.transparentInputCount)} ${t.inputs} · ${number(tx.transparentOutputCount)} ${t.outputs}`));
      detail.append(element('p', 'transactions-note', tx.hasShieldedComponents ? t.shielded : t.notShielded));
      detail.append(element('p', 'transactions-note', t.valueNote));
      const fullId = element('p', 'transactions-note', `${t.fullId}: `); fullId.append(element('code', '', tx.txid)); detail.append(fullId);
      const list = element('ol', 'transactions-outputs');
      for (const output of tx.outputs) {
        const row = element('li');
        row.append(element('strong', '', `${t.output} ${number(output.n)} · ${formatZcl(output.amountZat, lang)} ZCL`));
        if (output.addresses.length) for (const value of output.addresses) row.append(element('code', 'transactions-address', value));
        else row.append(element('p', 'transactions-note', t.noAddress));
        row.append(element('p', 'transactions-note', `${t.script}: ${output.scriptType}`)); list.append(row);
      }
      detail.append(list);
      if (tx.outputsTruncated) detail.append(element('p', 'transactions-note', t.truncatedOutputs));
    });
    return detail;
  }
  let snapshot = null, failed = false, busy = false, renderedSnapshot = null, renderedRewards = null;
  function rows(data) {
    const showRewards = fields.rewards.checked;
    if (renderedSnapshot === data && renderedRewards === showRewards) return;
    renderedSnapshot = data; renderedRewards = showRewards;
    const expanded = new Set([...fields.body.querySelectorAll('details[open]')].map(item => item.closest('tr').dataset.txid));
    const active = document.activeElement;
    const focused = (fields.body.contains(active) || fields['mempool-body'].contains(active)) && active?.dataset.focusKey
      ? {txid:active.closest('tr').dataset.txid,key:active.dataset.focusKey} : null;
    const restoreFocus = () => {
      if (!focused) return;
      const row = [...fields.body.rows, ...fields['mempool-body'].rows].find(item => item.dataset.txid === focused.txid);
      const target = row && [...row.querySelectorAll('[data-focus-key]')].find(item => item.dataset.focusKey === focused.key);
      (target || fields.refresh).focus({preventScroll:true});
    };
    if (!data || data.status === 'unavailable') {
      emptyRow(fields.body, t.awaiting, 4); emptyRow(fields['mempool-body'], t.mempoolUnavailable, 3); restoreFocus(); return;
    }
    const transactions = data.transactions.filter(tx => showRewards || !tx.isCoinbase);
    const fragment = document.createDocumentFragment();
    for (const tx of transactions) {
      const row = element('tr'), identity = element('td'), block = element('td'), value = element('td'), type = element('td');
      row.dataset.txid = tx.txid; identity.append(txLink(tx.txid));
      block.append(element('strong', '', number(tx.blockHeight)), element('p', 'transactions-note', `${number(tx.confirmations)} ${t.confirmed}`), element('p', 'transactions-note', date(tx.blockAt)));
      value.append(element('span', 'transactions-amount', `${formatZcl(tx.transparentOutputZat, lang)} ZCL`), element('p', 'transactions-note', `${number(tx.transparentOutputCount)} ${t.outputs}`));
      type.append(element('span', tx.isCoinbase ? 'transactions-badge transactions-reward' : 'transactions-badge', tx.isCoinbase ? t.reward : t.transaction));
      if (tx.hasShieldedComponents) type.append(element('p', 'transactions-note', t.shielded));
      const outputDetails = details(tx); if (expanded.has(tx.txid)) outputDetails.open = true;
      type.append(outputDetails); row.append(identity, block, value, type); fragment.append(row);
    }
    if (transactions.length) fields.body.replaceChildren(fragment);
    else emptyRow(fields.body, data.transactions.length ? `${t.emptyFiltered} ${number(data.transactions.length)} ${t.hidden}.` : t.empty, 4);
    if (!data.mempool) emptyRow(fields['mempool-body'], t.mempoolUnavailable, 3);
    else if (!data.mempool.transactions.length) emptyRow(fields['mempool-body'], t.mempoolEmpty, 3);
    else {
      const pool = document.createDocumentFragment();
      for (const tx of data.mempool.transactions) {
        const row = element('tr'), identity = element('td'); row.dataset.txid = tx.txid; identity.append(txLink(tx.txid));
        row.append(identity, element('td', '', date(tx.localNodeSeenAt)), element('td', '', `${number(tx.sizeBytes)} ${t.bytes}`)); pool.append(row);
      }
      fields['mempool-body'].replaceChildren(pool);
    }
    restoreFocus();
  }
  function render() {
    const state = transactionState(snapshot, Date.now(), failed);
    mount.dataset.status = state;
    set(fields.status, t[state][0]); set(fields['status-detail'], `${t[state][1]} ${t.cadence}`);
    const data = snapshot?.status === 'unavailable' ? null : snapshot;
    set(fields.published, data ? date(data.generatedAt) : '—');
    if (data) fields.published.setAttribute('datetime', data.generatedAt); else fields.published.removeAttribute('datetime');
    set(fields.tip, data ? `${t.tip} ${number(data.chain.height)} · ${data.chain.hash}` : '—');
    if (data) {
      const shown = data.transactions.filter(tx => fields.rewards.checked || !tx.isCoinbase).length;
      const hidden = data.transactions.length - shown;
      set(fields.coverage, `${number(data.coverage.blocksScanned)} ${t.blocks} (${t.heights} ${number(data.coverage.oldestHeight)}–${number(data.chain.height)}). ${t.showing} ${number(shown)} ${t.of} ${number(data.transactions.length)} ${t.returned}.${hidden ? ` ${number(hidden)} ${t.hidden}.` : ''} ${data.coverage.transactionsTruncated ? t.limited + ' ' : ''}${t.notFull}`);
    } else set(fields.coverage, '—');
    set(fields['mempool-status'], !data?.mempool ? t.mempoolUnavailable : `${data.mempool.total === 0 ? t.mempoolEmpty : number(data.mempool.total) + ' ' + t.mempoolTotal + '.'}${data.mempool.truncated ? ` ${t.mempoolLimited}` : ''} ${t.mempoolNote}${state === 'stale' ? ` ${t.stale[1]}` : ''}`);
    rows(data);
  }
  async function refresh() {
    if (busy || document.hidden) return;
    busy = true; fields.refresh.disabled = true; fields.refresh.textContent = t.refreshing; mount.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch('/api/transactions', {cache:'no-store',headers:{Accept:'application/json'},signal:AbortSignal.timeout(12000)});
      if (!response.ok) throw Error('Transaction feed unavailable');
      const next = validateTransactionsPayload(await response.json());
      if (next.status === 'unavailable' && snapshot && snapshot.status !== 'unavailable') failed = true;
      else { snapshot = next; failed = false; }
    } catch { failed = true; }
    finally {
      busy = false; fields.refresh.disabled = false; fields.refresh.textContent = t.refresh;
      mount.setAttribute('aria-busy', 'false'); render();
    }
  }
  mount.classList.add('transactions');
  fields.status.setAttribute('role', 'status'); fields.status.setAttribute('aria-live', 'polite');
  fields.refresh.hidden = false; fields.rewards.checked = false;
  fields.refresh.addEventListener('click', refresh); fields.rewards.addEventListener('change', render);
  set(fields.status, t.loading); set(fields['status-detail'], t.loadingDetail);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { if (snapshot || failed) render(); refresh(); } });
  setInterval(() => { if (!document.hidden && (snapshot || failed)) render(); }, 10000);
  setInterval(refresh, 30000);
  refresh();
})();
