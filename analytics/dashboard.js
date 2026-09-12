'use strict';

(() => {
  const $ = selector => document.querySelector(selector);
  const countFormat = new Intl.NumberFormat('en-US');
  const rateFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
  const dayFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
  const allowedDays = new Set([1, 7, 30, 90]);
  const counts = ['visitors', 'visits', 'pageviews', 'referralClicks'];
  let lastSummary = null;
  let requestId = 0;
  let activeRequest = null;
  let loading = false;
  let lastRefreshAt = 0;

  function validCount(value) { return Number.isSafeInteger(value) && value >= 0; }
  function validTime(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
  function validDate(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && validTime(value) && new Date(value).toISOString().slice(0, 10) === value; }
  function validate(data, days) {
    if (!data || data.days !== days || !validTime(data.generatedAt) || !validTime(data.from) || !validTime(data.to) || Date.parse(data.from) > Date.parse(data.to)) throw Error('Invalid summary');
    for (const field of ['recordingStarted', 'lastEventAt']) if (data[field] !== null && !validTime(data[field])) throw Error('Invalid collection timestamp');
    if (!data.totals || ![...counts, 'clickingVisits'].every(key => validCount(data.totals[key])) || !Number.isFinite(data.totals.clickRate) || data.totals.clickRate < 0 || data.totals.clickRate > 100 || data.totals.clickingVisits > data.totals.visits) throw Error('Invalid totals');
    if (!Array.isArray(data.daily) || data.daily.length > 90 || !data.daily.every(row => row && validDate(row.date) && counts.every(key => validCount(row[key]))) || new Set(data.daily.map(row => row.date)).size !== data.daily.length) throw Error('Invalid daily series');
    if (!Array.isArray(data.pages) || data.pages.length > 5000 || !data.pages.every(row => row && typeof row.path === 'string' && row.path.length <= 2048 && validCount(row.pageviews) && validCount(row.referralClicks))) throw Error('Invalid page table');
    if (!Array.isArray(data.sources) || data.sources.length > 500 || !data.sources.every(row => row && typeof row.source === 'string' && row.source.length <= 250 && validCount(row.visits) && validCount(row.referralClicks))) throw Error('Invalid source table');
    return data;
  }

  function utc(value, missing = 'Not yet reported') {
    return value === null ? missing : new Date(value).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
  }
  function rangeText(data) { return `${dayFormat.format(new Date(data.from))} – ${dayFormat.format(new Date(data.to))} · UTC`; }
  function periodText(days) { return days === 1 ? 'today' : `the last ${days} days`; }
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function emptyRow(body, text) {
    const row = element('tr');
    const cell = element('td', text, 'table-empty');
    cell.colSpan = 3;
    row.append(cell);
    body.replaceChildren(row);
  }
  function publicPage(path) {
    if (!path.startsWith('/') || path.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(path)) return null;
    try {
      const url = new URL(path, 'https://zclthesis.com/');
      return url.origin === 'https://zclthesis.com' ? url.href : null;
    } catch { return null; }
  }
  function renderPages(rows) {
    const body = $('#pages-body');
    if (!rows.length) { emptyRow(body, 'No recorded page activity in this range.'); return; }
    const fragment = document.createDocumentFragment();
    for (const page of [...rows].sort((a, b) => b.pageviews - a.pageviews || a.path.localeCompare(b.path))) {
      const row = element('tr');
      const cell = element('td');
      const link = publicPage(page.path);
      if (link) {
        const anchor = element('a', page.path || '/', 'page-link');
        anchor.href = link; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer';
        cell.append(anchor);
      } else cell.textContent = page.path || '(Unspecified page)';
      row.append(cell, element('td', countFormat.format(page.pageviews), 'numeric'), element('td', countFormat.format(page.referralClicks), 'numeric'));
      fragment.append(row);
    }
    body.replaceChildren(fragment);
  }
  function renderSources(rows) {
    const body = $('#sources-body');
    if (!rows.length) { emptyRow(body, 'No recorded source activity in this range.'); return; }
    const fragment = document.createDocumentFragment();
    for (const source of [...rows].sort((a, b) => b.visits - a.visits || a.source.localeCompare(b.source))) {
      const row = element('tr');
      row.append(element('td', source.source || '(Unclassified)'), element('td', countFormat.format(source.visits), 'numeric'), element('td', countFormat.format(source.referralClicks), 'numeric'));
      fragment.append(row);
    }
    body.replaceChildren(fragment);
  }
  function renderChart(rows) {
    const data = [...rows].sort((a, b) => a.date.localeCompare(b.date));
    const plot = $('#daily-plot');
    plot.replaceChildren();
    $('#chart-content').hidden = !data.length;
    $('#chart-empty').hidden = Boolean(data.length);
    if (!data.length) { $('#chart-empty').textContent = 'No daily observations were returned for this range.'; return; }
    const maximum = Math.max(1, ...data.flatMap(day => [day.visits, day.referralClicks]));
    $('#chart-scale').textContent = `0–${countFormat.format(maximum)}`;
    const selectDay = (button, day) => {
      for (const node of plot.children) node.setAttribute('aria-pressed', String(node === button));
      $('#day-detail').textContent = `${dayFormat.format(new Date(day.date))} · UTC — ${countFormat.format(day.visitors)} approximate visitors; ${countFormat.format(day.visits)} visits; ${countFormat.format(day.pageviews)} pageviews; ${countFormat.format(day.referralClicks)} NonKYC clicks.`;
    };
    for (const day of data) {
      const button = element('button', undefined, 'day-column');
      button.type = 'button'; button.setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-label', `${dayFormat.format(new Date(day.date))}, UTC: ${countFormat.format(day.visits)} visits, ${countFormat.format(day.referralClicks)} referral clicks. Show daily details.`);
      const bars = element('span', undefined, 'bar-pair'); bars.setAttribute('aria-hidden', 'true');
      for (const [key, className] of [['visits', 'bar-visits'], ['referralClicks', 'bar-clicks']]) {
        const level = day[key] === 0 ? 0 : Math.max(1, Math.round(day[key] / maximum * 100));
        bars.append(element('span', undefined, `bar ${className} h${level}`));
      }
      const tick = element('span', day.date.slice(5), 'day-tick'); tick.setAttribute('aria-hidden', 'true');
      button.append(bars, tick); button.addEventListener('click', () => selectDay(button, day));
      plot.append(button);
    }
    selectDay(plot.lastElementChild, data[data.length - 1]);
  }
  function render(data) {
    for (const [id, key] of [['visitors', 'visitors'], ['visits', 'visits'], ['pageviews', 'pageviews'], ['referral-clicks', 'referralClicks']]) $(`#${id}`).textContent = countFormat.format(data.totals[key]);
    $('#click-rate').textContent = `${rateFormat.format(data.totals.clickRate)}%`;
    $('#click-rate-detail').textContent = `${countFormat.format(data.totals.clickingVisits)} of ${countFormat.format(data.totals.visits)} visits had a referral click`;
    $('#range').textContent = rangeText(data);
    $('#recording-started').textContent = utc(data.recordingStarted);
    $('#last-event').textContent = utc(data.lastEventAt, 'No event received');
    $('#generated-at').textContent = utc(data.generatedAt);
    renderChart(data.daily); renderPages(data.pages); renderSources(data.sources);
    const empty = counts.every(key => data.totals[key] === 0);
    $('#status').textContent = empty ? 'No recorded events in this date range.' : `Updated ${utc(data.generatedAt)}`;
    $('#observation').dataset.state = 'ready';
  }
  async function refresh() {
    const days = Number($('#period').value);
    if (!allowedDays.has(days)) return;
    const current = ++requestId;
    activeRequest?.abort();
    const controller = new AbortController(); activeRequest = controller;
    loading = true; $('#refresh').disabled = true; $('#metrics').setAttribute('aria-busy', 'true');
    $('#error').hidden = true; $('#observation').dataset.state = 'loading';
    $('#status').textContent = `Loading ${periodText(days)}…${lastSummary ? ' Previous result remains visible.' : ''}`;
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(`/api/summary?days=${days}`, { signal: controller.signal, cache: 'no-store', credentials: 'omit', headers: { Accept: 'application/json' } });
      if (!response.ok) throw Error('Summary request failed');
      const data = validate(await response.json(), days);
      if (current !== requestId) return;
      render(data); lastSummary = data; lastRefreshAt = Date.now();
    } catch {
      if (current !== requestId) return;
      $('#observation').dataset.state = 'error';
      $('#status').textContent = 'Analytics could not be refreshed.';
      $('#error').textContent = lastSummary
        ? `Could not load ${periodText(days)}. Still showing the last successful result for ${rangeText(lastSummary)}, generated ${utc(lastSummary.generatedAt)}. Use Refresh to try again.`
        : 'Analytics is unavailable. The dashes below mean data could not be loaded, not zero activity. Use Refresh to try again.';
      $('#error').hidden = false;
      if (!lastSummary) {
        $('#chart-empty').textContent = 'Daily data is unavailable.';
        emptyRow($('#pages-body'), 'Page data is unavailable.');
        emptyRow($('#sources-body'), 'Source data is unavailable.');
      }
    } finally {
      clearTimeout(timeout);
      if (current === requestId) { loading = false; $('#refresh').disabled = false; $('#metrics').setAttribute('aria-busy', 'false'); }
    }
  }
  $('#period').addEventListener('change', refresh);
  $('#refresh').addEventListener('click', refresh);
  setInterval(() => { if ($('#auto-refresh').checked && !document.hidden && !loading) refresh(); }, 60000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && $('#auto-refresh').checked && !loading && Date.now() - lastRefreshAt >= 60000) refresh();
  });
  refresh();
})();
