(function () {
  'use strict';
  const SOURCE = 'https://pool.zclthesis.com/api/node.json';
  const MAX_AGE = 180000;
  const copy = {
    en: {
      ok: ['Node is current', 'The node reports a recent chain tip and active peer connections.'],
      syncing: ['Node is catching up', 'These are the node’s observations while it synchronizes. Its block height may be behind the network.'],
      warming: 'The node is warming up. It has not published chain measurements yet.',
      disconnected: ['No peer connections', 'The node has no connected peers. Its chain view may fall behind.'],
      stale: ['Observation is stale', 'The last observation is shown below. A current observation is not available yet.'],
      unavailable: ['Node data unavailable', 'A validated node observation is not available. Try refreshing shortly.'],
      unknown: ['Not declared', 'The exporter has not declared how this node obtained and validated its earlier chain history.'],
      'anchored-fast-sync': ['Anchored fast sync', 'The exporter reports a checkpoint-anchored bootstrap followed by forward validation. This is not a replay of every block from genesis.'],
      'validated-from-genesis': ['Validated from genesis', 'The exporter reports that this node replayed and validated the chain from genesis. This is the operator’s provenance declaration.'],
      refreshing: 'Refreshing…', refresh: 'Refresh now', seconds: 'seconds ago', minute: 'minute ago', minutes: 'minutes ago', hours: 'hours ago', now: 'Just now'
    },
    es: {
      ok: ['El nodo está al día', 'El nodo informa de un bloque reciente en la punta de la cadena y conexiones activas con pares.'],
      syncing: ['El nodo se está sincronizando', 'Estas son las observaciones del nodo mientras se sincroniza. Su altura de bloque puede ir por detrás de la red.'],
      warming: 'El nodo se está iniciando. Aún no ha publicado mediciones de la cadena.',
      disconnected: ['Sin conexiones con pares', 'El nodo no tiene pares conectados. Su visión de la cadena puede quedar atrasada.'],
      stale: ['Observación desactualizada', 'Abajo se muestra la última observación. Todavía no hay una observación actual disponible.'],
      unavailable: ['Datos del nodo no disponibles', 'No hay una observación validada del nodo disponible. Prueba a actualizar en unos instantes.'],
      unknown: ['No declarado', 'El exportador no ha declarado cómo este nodo obtuvo y validó el historial anterior de la cadena.'],
      'anchored-fast-sync': ['Sincronización rápida anclada', 'El exportador declara un arranque anclado en un punto de control seguido de validación hacia adelante. No equivale a reproducir cada bloque desde el génesis.'],
      'validated-from-genesis': ['Validado desde el génesis', 'El exportador declara que este nodo reprodujo y validó la cadena desde el génesis. Es una declaración de procedencia del operador.'],
      refreshing: 'Actualizando…', refresh: 'Actualizar ahora', seconds: 'segundos', minute: 'minuto', minutes: 'minutos', hours: 'horas', now: 'Ahora mismo'
    }
  };
  const finite = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
  function validateNetworkPayload(data) {
    if (data?.schemaVersion !== 1 || data.asset !== 'ZCL' || data.source !== SOURCE || !['ok','syncing','disconnected','stale','unavailable'].includes(data.status)) throw Error('Invalid network response');
    if (data.status === 'unavailable') return {status:'unavailable'};
    if (!timestamp(data.generatedAt) || !timestamp(data.observedAt) || !data.node || !data.mining || typeof data.node.synced !== 'boolean') throw Error('Invalid observation');
    for (const n of [data.node.connections, data.node.verificationProgress, data.mining.difficulty, data.mining.networkSolps]) if (n !== null && !finite(n)) throw Error('Invalid measurement');
    if (data.node.verificationProgress > 1 || (data.node.connections !== null && !Number.isSafeInteger(data.node.connections))) throw Error('Invalid node measurement');
    if (data.chain !== null && (!Number.isSafeInteger(data.chain?.height) || data.chain.height < 0 || !/^[a-f0-9]{64}$/.test(data.chain.hash) || !timestamp(data.chain.blockAt))) throw Error('Invalid chain');
    return data;
  }
  function buildNetworkView(data, language = 'en', now = Date.now(), failed = false) {
    const lang = language === 'es' ? 'es' : 'en', text = copy[lang], locale = lang === 'es' ? 'es-ES' : 'en-US';
    const number = (value, digits = 0) => finite(value) ? new Intl.NumberFormat(locale, {maximumFractionDigits:digits}).format(value) : '—';
    let status = data?.status || 'unavailable';
    if (data && status !== 'unavailable') {
      if (failed || now - Date.parse(data.generatedAt) > MAX_AGE || now - Date.parse(data.observedAt) > MAX_AGE) status = 'stale';
      else if (!data.chain) status = 'syncing';
      else if (data.node.connections === 0) status = 'disconnected';
      else if (status === 'ok' && (!data.node.synced || data.node.verificationProgress < 0.9999 || now - Date.parse(data.chain.blockAt) > 1800000 || Date.parse(data.chain.blockAt) > now + 300000)) status = 'syncing';
    }
    const available = data && data.status !== 'unavailable';
    const progress = available ? data.node.verificationProgress : null;
    const provenance = available && ['anchored-fast-sync','validated-from-genesis'].includes(data.node.bootstrapValidation) ? data.node.bootstrapValidation : 'unknown';
    const solps = available ? data.mining.networkSolps : null;
    let rate = '—';
    if (finite(solps)) {
      const scale = solps >= 1e9 ? [1e9,'G'] : solps >= 1e6 ? [1e6,'M'] : solps >= 1e3 ? [1e3,'k'] : [1,''];
      rate = number(solps / scale[0], 3) + ' ' + scale[1] + 'Sol/s';
    }
    let age = '—';
    if (available) {
      const seconds = Math.max(0, Math.floor((now-Date.parse(data.generatedAt))/1000));
      const count = seconds < 60 ? seconds : seconds < 3600 ? Math.floor(seconds/60) : Math.floor(seconds/3600);
      const unit = seconds < 60 ? text.seconds : seconds < 120 ? text.minute : seconds < 3600 ? text.minutes : text.hours;
      age = seconds < 5 ? text.now : (lang === 'es' ? 'Hace ' : '') + number(count) + ' ' + unit;
    }
    return {status, title:text[status][0], detail:status === 'syncing' && !data?.chain ? text.warming : text[status][1],
      height:available ? number(data.chain?.height) : '—', connections:available ? number(data.node.connections) : '—',
      difficulty:available ? number(data.mining.difficulty, 5) : '—', solps:rate, progress,
      progressText:finite(progress) ? new Intl.NumberFormat(locale,{style:'percent',maximumFractionDigits:4}).format(progress) : '—',
      hash:available ? data.chain?.hash || '—' : '—', software:available && typeof data.node.softwareVersion === 'string' ? data.node.softwareVersion : '—',
      validation:available ? text[provenance][0] : '—', validationDetail:available ? text[provenance][1] : text.unavailable[1],
      generatedAt:available ? data.generatedAt : null, observedAt:available ? data.observedAt : null, blockAt:available ? data.chain?.blockAt : null, age, locale};
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = {validateNetworkPayload, buildNetworkView};
  if (typeof document === 'undefined') return;
  const lang = document.documentElement.lang === 'es' ? 'es' : 'en';
  const button = document.getElementById('network-refresh');
  if (!button) return;
  let snapshot = null, failed = false, busy = false;
  const set = (id, value) => {document.getElementById(id).textContent = value;};
  function render() {
    const view = buildNetworkView(snapshot, lang, Date.now(), failed);
    document.getElementById('network-state').dataset.status = view.status;
    document.getElementById('network-observation').dataset.status = view.status;
    for (const [id,key] of Object.entries({'network-status':'title','network-status-detail':'detail','network-height':'height','network-connections':'connections','network-difficulty':'difficulty','network-solps':'solps','network-progress-value':'progressText','network-hash':'hash','network-software':'software','network-validation':'validation','network-validation-detail':'validationDetail','network-age':'age'})) set(id,view[key]);
    const progress = document.getElementById('network-progress');
    progress.hidden = view.progress === null;
    if (view.progress !== null) progress.value = view.progress;
    for (const [id,key] of Object.entries({'network-published':'generatedAt','network-observed':'observedAt','network-block-time':'blockAt'})) {
      const element = document.getElementById(id), value = view[key];
      element.textContent = value ? new Intl.DateTimeFormat(view.locale,{dateStyle:'medium',timeStyle:'medium',timeZone:'UTC'}).format(new Date(value)) + ' UTC' : '—';
      if (value) element.dateTime = value; else element.removeAttribute('datetime');
    }
  }
  async function refresh() {
    if (busy || document.hidden) return;
    busy = true; button.disabled = true; button.textContent = copy[lang].refreshing;
    try {
      const response = await fetch('/api/network', {signal:AbortSignal.timeout(12000),headers:{Accept:'application/json'}});
      if (!response.ok) throw Error('Observation unavailable');
      snapshot = validateNetworkPayload(await response.json()); failed = false;
    } catch {failed = true;}
    finally {busy = false; button.disabled = false; button.textContent = copy[lang].refresh; render();}
  }
  button.hidden = false;
  button.addEventListener('click',refresh);
  document.addEventListener('visibilitychange', () => {if (!document.hidden) {render(); refresh();}});
  setInterval(() => {if (!document.hidden) render();}, 10000);
  setInterval(refresh, 30000);
  refresh();
})();
