(() => {
  'use strict';
  const visitorKey = 'zcl-analytics-visitor';
  const sessionKey = 'zcl-analytics-session';
  const optOutKey = 'zcl-analytics-disabled';
  const allowed = new Map([
    ['/', '/'], ['/index.html', '/'], ['/es', '/es/'], ['/es/', '/es/'], ['/es/index.html', '/es/'],
    ['/network', '/network/'], ['/network/', '/network/'], ['/network/index.html', '/network/'],
    ['/es/network', '/es/network/'], ['/es/network/', '/es/network/'], ['/es/network/index.html', '/es/network/'],
  ]);
  const path = allowed.get(location.pathname);
  if (!path || location.protocol !== 'https:' || navigator.webdriver || !crypto.randomUUID) return;
  const blocked = () => {
    try {
      const disabled = navigator.doNotTrack === '1' || window.doNotTrack === '1'
        || navigator.globalPrivacyControl === true || localStorage.getItem(optOutKey) === '1';
      if (disabled) { localStorage.removeItem(visitorKey); sessionStorage.removeItem(sessionKey); }
      return disabled;
    } catch { return true; }
  };
  const source = () => {
    if (!document.referrer) return 'direct';
    try {
      const host = new URL(document.referrer).hostname.toLowerCase();
      const is = domain => host === domain || host.endsWith('.' + domain);
      if (is('zclthesis.com') || host === location.hostname) return 'internal';
      if (['google.com', 'bing.com', 'duckduckgo.com', 'search.yahoo.com', 'search.brave.com', 'ecosia.org'].some(is)) return 'search';
      if (['x.com', 't.co', 'twitter.com', 'reddit.com', 'facebook.com', 'instagram.com', 't.me', 'youtube.com', 'bsky.app'].some(is)) return 'social';
      if (is('github.com')) return 'github';
      if (is('nonkyc.io')) return 'nonkyc';
      if (is('zclassic.org')) return 'zclassic';
      if (['z.cash', 'zcashcommunity.com', 'electriccoin.co', 'zfnd.org'].some(is)) return 'zcash';
    } catch {}
    return 'other';
  };
  const parse = value => { try { return JSON.parse(value); } catch { return null; } };
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const identity = () => {
    const now = Date.now();
    let visitor = parse(localStorage.getItem(visitorKey));
    let session = parse(sessionStorage.getItem(sessionKey));
    if (!visitor || !uuid.test(visitor.id) || !Number.isFinite(visitor.expires) || visitor.expires <= now) {
      visitor = {id: crypto.randomUUID(), expires: now + 30 * 86400000};
      localStorage.setItem(visitorKey, JSON.stringify(visitor));
      session = null;
    }
    if (!session || !uuid.test(session.id) || !Number.isFinite(session.last) || now - session.last > 30 * 60000) {
      session = {id: crypto.randomUUID(), source: source(), last: now};
    }
    session.last = now;
    sessionStorage.setItem(sessionKey, JSON.stringify(session));
    return {visitor: visitor.id, session: session.id, source: session.source};
  };
  const send = type => {
    if (blocked()) return;
    try {
      const body = JSON.stringify({id: crypto.randomUUID(), ...identity(), type, path});
      if (navigator.sendBeacon?.('/api/analytics/event', new Blob([body], {type: 'application/json'}))) return;
      fetch('/api/analytics/event', {method: 'POST', body, headers: {'Content-Type': 'application/json'},
        credentials: 'omit', keepalive: true}).catch(() => {});
    } catch {} // Navigation and the buy link never depend on analytics succeeding.
  };
  let viewed = false;
  const view = () => {
    if (viewed || document.visibilityState !== 'visible') return;
    // Let the language preference redirect settle before counting the page.
    try {
      const preferred = new URL(location.href).searchParams.get('lang') || localStorage.getItem('zcl-language');
      if (['en', 'es'].includes(preferred) && preferred !== document.documentElement.lang) return;
    } catch { return; }
    viewed = true;
    send('pageview');
  };
  setTimeout(view, 500);
  document.addEventListener('visibilitychange', view);
  const click = event => {
    if ((event.type === 'click' && event.button !== 0) || (event.type === 'auxclick' && event.button !== 1)) return;
    const link = event.target.closest?.('a');
    if (link?.href !== 'https://nonkyc.io/?ref=69d580940a7d426e95b803c5') return;
    view();
    send('referral_click');
  };
  document.addEventListener('click', click);
  document.addEventListener('auxclick', click);
})();
