import {loadRichList, packageRichList, validateRichList, validAddress} from './richlist-data.mjs';

export const ZCL_RICHLIST_URL = 'https://pool.zclthesis.com/api/richlist/zcl.json';
export const ZEC_RICHLIST_URL = 'https://api.mainnet.cipherscan.app/api/rich-list?limit=100';
const MAX_AGE = 7200000;
const amount = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,15})$/.test(value) && BigInt(value) <= 2100000000000000n;
const sum = rows => rows.reduce((total, row) => total + BigInt(row.balanceZatoshis), 0n);

export async function fetchDocument(url, maxBytes = 262144, timeout = 12000) {
  const response = await fetch(url, {signal: AbortSignal.timeout(timeout), headers: {Accept: 'application/json'}});
  if (!response.ok || !response.body) throw Error('Source unavailable');
  const chunks = [], reader = response.body.getReader();
  let size = 0;
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) throw Error('Source response too large');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return {data: JSON.parse(Buffer.concat(chunks).toString('utf8')), headers: Object.fromEntries(response.headers)};
}

export async function createRichListStore({load = fetchDocument, clock = Date.now, ttl = 300000, initial} = {}) {
  let packet = initial;
  if (!packet) {
    try { packet = await loadRichList(); } catch { /* An unavailable fallback does not prevent a current fetch. */ }
  }
  let pending, failed = false, lastAttempt = -Infinity;
  return async function getRichList() {
    if (pending) await pending;
    else if (clock() - lastAttempt >= ttl) {
      lastAttempt = clock();
      pending = (async () => {
        try {
          const {data} = await load(ZCL_RICHLIST_URL, 64 * 1024 * 1024, 20000);
          validateRichList(data, clock());
          if (data.snapshot.verification !== 'own-node-snapshot') throw Error('Expected our current node artifact');
          if (packet && Date.parse(data.snapshot.generatedAt) < Date.parse(packet.data.snapshot.generatedAt)) throw Error('Older artifact');
          packet = packageRichList(data, {now: clock()});
          failed = false;
        } catch { failed = true; }
      })();
      try { await pending; } finally { pending = null; }
    }
    if (!packet) return null;
    const stale = failed || clock() - Date.parse(packet.data.snapshot.blockAt) > MAX_AGE;
    if (packet.status !== (stale ? 'stale' : 'ok')) packet = packageRichList(packet.data, {failed, now: clock()});
    return packet;
  };
}

export function parseZecRichList(raw, headers, block, now = Date.now()) {
  const height = Number(headers['x-cipherscan-indexed-height']);
  const blockAt = Number(block?.timestamp) * 1000;
  const sourceObserved = Date.parse(headers.date);
  if (raw?.success !== true || !Array.isArray(raw.addresses) || raw.addresses.length !== 100 ||
      raw.pagination?.offset !== 0 || raw.pagination?.limit !== 100 || !Number.isSafeInteger(raw.pagination?.total) || raw.pagination.total < 100 ||
      !Number.isSafeInteger(height) || height < 1 || Number(block.height) !== height || !/^[0-9a-f]{64}$/.test(block.hash) ||
      !Number.isFinite(blockAt) || blockAt < 1470000000000 || blockAt > now + 300000 ||
      !Number.isFinite(sourceObserved) || sourceObserved > now + 300000 || now - sourceObserved > MAX_AGE ||
      /stale/i.test(headers['x-cipherscan-cache'] || '')) throw Error('Invalid or stale Zcash index response');
  const seen = new Set();
  let previous = 2100000000000000n;
  const addresses = raw.addresses.map((row, index) => {
    if (row.rank !== index + 1 || !validAddress(row.address) || seen.has(row.address) || !amount(row.balanceZat) ||
        BigInt(row.balanceZat) <= 0n || BigInt(row.balanceZat) > previous) throw Error('Invalid Zcash ranking');
    seen.add(row.address); previous = BigInt(row.balanceZat);
    // Provider labels and address-activity dates are intentionally not part of this dataset.
    return {address: row.address, balanceZatoshis: row.balanceZat};
  });
  const c = raw.concentration;
  for (const field of ['top10Zat', 'top100Zat', 'totalTransparentZat', 'totalAddressedZat', 'directAddresslessZat']) {
    if (!amount(c?.[field])) throw Error('Invalid Zcash concentration amount');
  }
  if (sum(addresses.slice(0, 10)) !== BigInt(c.top10Zat) || sum(addresses) !== BigInt(c.top100Zat) ||
      BigInt(c.totalAddressedZat) + BigInt(c.directAddresslessZat) !== BigInt(c.totalTransparentZat) ||
      BigInt(c.top100Zat) > BigInt(c.totalAddressedZat)) throw Error('Zcash index totals do not reconcile');
  return {
    asset: 'ZEC', source: 'https://cipherscan.app/rich-list', sourceKind: 'provider-index', coverage: 'top-100',
    height, hash: block.hash, blockAt: new Date(blockAt).toISOString(), observedAt: new Date(sourceObserved).toISOString(),
    generatedAt: new Date(now).toISOString(), addressCount: raw.pagination.total,
    totalZatoshis: c.totalTransparentZat, addressedZatoshis: c.totalAddressedZat,
    unattributedZatoshis: c.directAddresslessZat, top10Zatoshis: c.top10Zat, top100Zatoshis: c.top100Zat, addresses,
  };
}

export function summarizeZcl(packet) {
  if (!packet) return null;
  const {snapshot: s, addresses} = packet.data;
  const sorted = addresses.slice().sort((a, b) => BigInt(a.balanceZatoshis) > BigInt(b.balanceZatoshis) ? -1 : BigInt(a.balanceZatoshis) < BigInt(b.balanceZatoshis) ? 1 : a.address.localeCompare(b.address));
  return {
    asset: 'ZCL', status: packet.status, source: s.source, sourceKind: s.verification, coverage: 'full-address-index',
    height: s.height, hash: s.hash, blockAt: s.blockAt, generatedAt: s.generatedAt, observedAt: s.generatedAt,
    addressCount: s.addressCount, totalZatoshis: s.totalZatoshis,
    addressedZatoshis: (BigInt(s.totalZatoshis) - BigInt(s.unattributedZatoshis)).toString(),
    unattributedZatoshis: s.unattributedZatoshis,
    top10Zatoshis: sum(sorted.slice(0, 10)).toString(), top100Zatoshis: sum(sorted.slice(0, 100)).toString(),
    addresses: sorted.slice(0, 100).map(({address, balanceZatoshis}) => ({address, balanceZatoshis})),
  };
}

export function createRichListComparison({getZcl, load = fetchDocument, clock = Date.now, ttl = 3600000} = {}) {
  let snapshot, pending, failed = false, lastAttempt = -Infinity;
  async function refresh() {
    try {
      const response = await load(ZEC_RICHLIST_URL);
      const height = response.headers['x-cipherscan-indexed-height'];
      if (!/^[1-9][0-9]{0,8}$/.test(height || '')) throw Error('Missing index height');
      const block = await load(`https://api.mainnet.cipherscan.app/api/block/${height}`, 4 * 1024 * 1024);
      snapshot = parseZecRichList(response.data, response.headers, block.data, clock());
      failed = false;
    } catch { failed = true; }
  }
  return async function getComparison() {
    const zclPromise = getZcl();
    if (pending) await pending;
    else if (clock() - lastAttempt >= ttl) {
      lastAttempt = clock(); pending = refresh();
      try { await pending; } finally { pending = null; }
    }
    const zcl = summarizeZcl(await zclPromise);
    const zec = snapshot ? {...snapshot, status: failed || clock() - Date.parse(snapshot.blockAt) > MAX_AGE || clock() - Date.parse(snapshot.generatedAt) > MAX_AGE ? 'stale' : 'ok'} : null;
    return {generatedAt: new Date(clock()).toISOString(), refreshHours: {zcl: 2, zec: 1}, coins: {zcl, zec}};
  };
}
