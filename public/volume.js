(() => {
  'use strict';
  const mount = document.getElementById('observed-volume');
  if (!mount) return;
  const $ = name => document.getElementById(`volume-${name}`);
  const es = document.documentElement.lang === 'es';
  const locale = es ? 'es-ES' : 'en-US';
  const text = es ? {
    loading: 'Consultando las operaciones de NonKYC…',
    live: 'Recopilación al día.', partial: 'Cobertura parcial: los totales pueden omitir operaciones.',
    stale: 'Datos desactualizados: se conserva la última recopilación disponible.',
    unavailable: 'Volumen observado no disponible. Se volverá a consultar en un minuto.',
    checked: 'Consultado hasta', unchecked: 'Todavía no hay una consulta completa verificada.', trades: 'operaciones',
    empty: 'Todavía no hemos recopilado operaciones. Esto no demuestra que no haya actividad en el mercado.',
    noHours: 'Todavía no hay datos horarios para mostrar.',
    hint: 'Toca una barra, pasa el cursor o usa las flechas del teclado para consultar cada hora.',
    pending: 'Hora en curso', incomplete: 'Cobertura incompleta', covered: 'Intervalo cubierto',
    observed: 'Volumen observado', hourly: 'Volumen por hora · UTC',
  } : {
    loading: 'Checking collected NonKYC trades…',
    live: 'Collection is up to date.', partial: 'Partial coverage: totals may omit trades.',
    stale: 'Stale data: showing the last available collection.',
    unavailable: 'Observed volume is unavailable. Retrying in one minute.',
    checked: 'Checked through', unchecked: 'A complete collection check has not yet been verified.', trades: 'trades',
    empty: 'No trades collected yet. This does not establish that the market has no activity.',
    noHours: 'No hourly observations to display yet.',
    hint: 'Tap or hover a bar, or use the arrow keys to inspect each hour.',
    pending: 'Hour in progress', incomplete: 'Incomplete coverage', covered: 'Covered interval',
    observed: 'Observed volume', hourly: 'Hourly volume · UTC',
  };
  const hour = 3600000, maxAge = 3 * 60000;
  const integer = new Intl.NumberFormat(locale, {maximumFractionDigits: 0});
  const compact = new Intl.NumberFormat(locale, {notation: 'compact', maximumFractionDigits: 1});
  const dates = new Intl.DateTimeFormat(locale, {month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone: 'UTC'});
  const shortDates = new Intl.DateTimeFormat(locale, {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC'});
  const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) && Number.isFinite(Date.parse(value));
  const decimal = value => typeof value === 'string' && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value));
  // Preserve the API's decimal precision in the accessible hourly details.
  function exact(value) {
    const [whole, fraction] = value.split('.');
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, es ? '.' : ',');
    const tail = fraction?.replace(/0+$/, '');
    return tail ? `${grouped}${es ? ',' : '.'}${tail}` : grouped;
  }
  function summary(value) {
    return new Intl.NumberFormat(locale, {maximumFractionDigits: Number(value) < 1 ? 6 : 2}).format(Number(value));
  }
  const date = value => `${dates.format(new Date(value))} UTC`;
  function validate(data) {
    if (!data || data.schemaVersion !== 1 || data.pair !== 'ZCL/USDT' || data.source !== 'NonKYC' ||
        !['live', 'partial', 'stale'].includes(data.status) || data.bucketSeconds !== 3600 ||
        !['launchedAt', 'generatedAt', 'windowStart'].every(key => timestamp(data[key])) ||
        !(data.checkedThrough === null || timestamp(data.checkedThrough)) ||
        !decimal(data.volumeBase) || !decimal(data.volumeQuote) ||
        !Number.isSafeInteger(data.tradeCount) || data.tradeCount < 0 ||
        !Array.isArray(data.buckets) || data.buckets.length > 168) return null;
    const launch = Date.parse(data.launchedAt), checked = Date.parse(data.checkedThrough), generated = Date.parse(data.generatedAt);
    if (launch > generated || (data.checkedThrough !== null && (launch > checked || checked > generated)) || generated > Date.now() + maxAge) return null;
    let previous = -Infinity;
    for (const bucket of data.buckets) {
      const start = Date.parse(bucket?.start);
      if (!timestamp(bucket?.start) || start <= previous || start % hour !== 0 ||
          start < Math.floor(launch / hour) * hour || start > Math.floor(generated / hour) * hour ||
          !decimal(bucket.volumeBase) || !decimal(bucket.volumeQuote) ||
          !Number.isSafeInteger(bucket.tradeCount) || bucket.tradeCount < 0 || typeof bucket.covered !== 'boolean') return null;
      previous = start;
    }
    return data;
  }
  let snapshot = null, failed = false, busy = false, unit = 'USDT', range = 24, selected = null;
  function setStatus(value) { if ($('status').textContent !== value) $('status').textContent = value; }
  function details(bucket) {
    const start = Math.max(Date.parse(bucket.start), Date.parse(snapshot.launchedAt));
    const end = Date.parse(bucket.start) + hour;
    const pending = end > Date.parse(snapshot.generatedAt);
    return `${date(start)} → ${date(end)} · ${exact(bucket.volumeQuote)} USDT · ${exact(bucket.volumeBase)} ZCL · ${integer.format(bucket.tradeCount)} ${text.trades} · ${pending ? `${text.pending}; ` : ''}${bucket.covered ? text.covered : text.incomplete}`;
  }
  function select(button, bucket, focus = false) {
    selected = bucket.start;
    for (const other of $('bars').children) other.tabIndex = other === button ? 0 : -1;
    $('hour-detail').textContent = details(bucket);
    if (focus) button.focus();
  }
  function chart() {
    const buckets = snapshot.buckets.slice(-range);
    const bars = $('bars');
    const focusedStart = bars.contains(document.activeElement) ? document.activeElement.dataset.start : null;
    bars.replaceChildren();
    $('plot').hidden = !buckets.length;
    $('empty').hidden = !!snapshot.tradeCount && !!buckets.length;
    $('empty').textContent = snapshot.tradeCount ? text.noHours : text.empty;
    if (!buckets.length) return;
    const key = unit === 'USDT' ? 'volumeQuote' : 'volumeBase';
    const maximum = Math.max(...buckets.map(bucket => Number(bucket[key])), 0);
    $('scale-top').textContent = maximum ? compact.format(maximum) : '0';
    $('scale-mid').textContent = maximum ? compact.format(maximum / 2) : '';
    $('hourly-label').textContent = `${text.hourly} · ${unit}`;
    const currentSelection = buckets.some(bucket => bucket.start === selected) ? selected : buckets.at(-1).start;
    const buttons = [];
    for (const [index, bucket] of buckets.entries()) {
      const button = document.createElement('button'), fill = document.createElement('span');
      button.type = 'button'; button.className = 'volume-bar';
      button.dataset.start = bucket.start;
      button.dataset.covered = String(bucket.covered);
      button.dataset.pending = String(Date.parse(bucket.start) + hour > Date.parse(snapshot.generatedAt));
      button.dataset.zero = String(Number(bucket[key]) === 0);
      button.tabIndex = bucket.start === currentSelection ? 0 : -1;
      button.setAttribute('aria-label', details(bucket));
      button.title = details(bucket);
      fill.className = 'volume-bar-fill';
      fill.style.height = `${maximum ? Number(bucket[key]) / maximum * 100 : 0}%`;
      button.append(fill);
      button.addEventListener('mouseenter', () => { $('hour-detail').textContent = details(bucket); });
      button.addEventListener('focus', () => select(button, bucket));
      button.addEventListener('click', () => select(button, bucket));
      button.addEventListener('keydown', event => {
        let target;
        if (event.key === 'ArrowRight') target = Math.min(index + 1, buckets.length - 1);
        if (event.key === 'ArrowLeft') target = Math.max(index - 1, 0);
        if (event.key === 'Home') target = 0;
        if (event.key === 'End') target = buckets.length - 1;
        if (target !== undefined) { event.preventDefault(); select(buttons[target], buckets[target], true); }
      });
      buttons.push(button); bars.append(button);
    }
    $('axis-start').textContent = shortDates.format(new Date(buckets[0].start));
    $('axis-mid').textContent = shortDates.format(new Date(buckets[Math.floor(buckets.length / 2)].start));
    $('axis-end').textContent = `${shortDates.format(new Date(Date.parse(buckets.at(-1).start) + hour))} UTC`;
    const chosen = buckets.findIndex(bucket => bucket.start === (focusedStart || currentSelection));
    if (selected || focusedStart) select(buttons[Math.max(0, chosen)], buckets[Math.max(0, chosen)], !!focusedStart);
    else $('hour-detail').textContent = text.hint;
  }
  function render() {
    if (!snapshot) {
      mount.dataset.status = 'unavailable';
      for (const name of ['quote-total', 'base-total', 'trade-count']) $(name).textContent = '—';
      $('plot').hidden = true; $('empty').hidden = true;
      setStatus(text.unavailable);
      return;
    }
    const stale = failed || snapshot.status === 'stale' || (snapshot.checkedThrough && Date.now() - Date.parse(snapshot.checkedThrough) > maxAge) || Date.now() - Date.parse(snapshot.generatedAt) > maxAge;
    const partial = snapshot.status === 'partial' || !snapshot.checkedThrough || snapshot.buckets.some(bucket => !bucket.covered && Date.parse(bucket.start) + hour <= Date.parse(snapshot.generatedAt));
    mount.dataset.status = stale ? 'stale' : partial ? 'partial' : 'live';
    $('quote-total').textContent = summary(snapshot.volumeQuote);
    $('quote-total').title = `${exact(snapshot.volumeQuote)} USDT`;
    $('base-total').textContent = summary(snapshot.volumeBase);
    $('base-total').title = `${exact(snapshot.volumeBase)} ZCL`;
    $('trade-count').textContent = integer.format(snapshot.tradeCount);
    $('launch-time').dateTime = snapshot.launchedAt;
    $('launch-time').textContent = date(snapshot.launchedAt);
    setStatus(`${stale ? text.stale : partial ? text.partial : text.live} ${snapshot.checkedThrough ? `${text.checked}: ${date(snapshot.checkedThrough)}.` : text.unchecked}`);
    chart();
  }
  for (const button of mount.querySelectorAll('[data-volume-unit]')) {
    button.addEventListener('click', () => {
      unit = button.dataset.volumeUnit;
      for (const other of mount.querySelectorAll('[data-volume-unit]')) other.setAttribute('aria-pressed', String(other === button));
      if (snapshot) chart();
    });
  }
  for (const button of mount.querySelectorAll('[data-volume-range]')) {
    button.addEventListener('click', () => {
      range = Number(button.dataset.volumeRange);
      for (const other of mount.querySelectorAll('[data-volume-range]')) other.setAttribute('aria-pressed', String(other === button));
      if (snapshot) chart();
    });
  }
  async function refresh() {
    if (busy || document.hidden) return;
    busy = true;
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('/api/volume', {signal: controller.signal, headers: {Accept: 'application/json'}});
      if (!response.ok) throw new Error('Volume feed unavailable');
      const next = validate(await response.json());
      if (!next) throw new Error('Invalid volume feed');
      snapshot = next; failed = false;
    } catch { failed = true; }
    finally { clearTimeout(timeout); busy = false; render(); }
  }
  setStatus(text.loading);
  refresh();
  setInterval(() => { if (!document.hidden) refresh(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { if (snapshot) render(); refresh(); } });
})();
