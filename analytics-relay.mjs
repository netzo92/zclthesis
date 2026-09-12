// The public site can submit events, but has no route for reading analytics.
export const ANALYTICS_ORIGINS = new Set([
  'https://zclthesis.com', 'https://www.zclthesis.com',
  'https://myzclthesis-633108169526.us-central1.run.app',
]);
const paths = new Set(['/', '/es/', '/network/', '/es/network/']);
const sources = new Set(['direct', 'internal', 'search', 'social', 'github', 'nonkyc', 'zclassic', 'zcash', 'other']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validAnalyticsEvent(event) {
  return event && typeof event === 'object' && !Array.isArray(event)
    && Object.keys(event).sort().join(',') === 'id,path,session,source,type,visitor'
    && ['id', 'visitor', 'session'].every(key => typeof event[key] === 'string' && uuid.test(event[key]))
    && paths.has(event.path) && sources.has(event.source)
    && (event.type === 'pageview' || (event.type === 'referral_click' && ['/', '/es/'].includes(event.path)));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    const finish = (error, value) => {
      clearTimeout(timer);
      req.removeListener('data', data);
      req.removeListener('end', end);
      req.removeListener('error', fail);
      error ? reject(error) : resolve(value);
    };
    const fail = () => finish(400);
    const data = chunk => {
      size += chunk.length;
      if (size > 2048) { finish(413); req.resume(); }
      else chunks.push(chunk);
    };
    const end = () => finish(null, Buffer.concat(chunks).toString('utf8'));
    const timer = setTimeout(() => { finish(408); req.resume(); }, 5000);
    timer.unref?.();
    req.on('data', data).on('end', end).on('error', fail);
  });
}

export function createAnalyticsRelay({fetchFn = fetch, now = Date.now,
  collectorUrl = 'https://pool.zclthesis.com/api/analytics/event', enabled = true,
  token = process.env.ANALYTICS_RELAY_TOKEN} = {}) {
  let minute = 0, received = 0, active = 0;
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const end = code => { res.writeHead(code); res.end(); };
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); end(405); return; }
    if (!ANALYTICS_ORIGINS.has(req.headers.origin) || req.headers['sec-fetch-site'] === 'cross-site') { end(403); return; }
    if (req.headers.dnt === '1' || req.headers['sec-gpc'] === '1'
      || /bot|spider|crawl|headless|lighthouse|slurp/i.test(req.headers['user-agent'] || '')) { end(204); return; }
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] || '')) { end(415); return; }
    if (Number(req.headers['content-length']) > 2048) { end(413); return; }
    if (!enabled || !token) { end(503); return; }
    const bucket = Math.floor(now() / 60000);
    if (bucket !== minute) { minute = bucket; received = 0; }
    if (++received > 1200 || active >= 32) { res.setHeader('Retry-After', '60'); end(429); return; }
    active++;
    try {
      let event;
      try { event = JSON.parse(await readBody(req)); }
      catch (error) { end(Number.isInteger(error) ? error : 400); return; }
      if (!validAnalyticsEvent(event)) { end(400); return; }
      // Never forward browser headers, IPs, full URLs, cookies, or credentials.
      const response = await fetchFn(collectorUrl, {
        method: 'POST', headers: {'Content-Type': 'application/json', Origin: req.headers.origin, Authorization: `Bearer ${token}`},
        body: JSON.stringify(event), signal: AbortSignal.timeout(4000), redirect: 'error',
      });
      await response.body?.cancel();
      end(response.status === 204 ? 204 : response.status === 429 ? 429 : 503);
    } catch { end(503); }
    finally { active--; }
  };
}
