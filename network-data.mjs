export const NETWORK_SOURCE = 'https://pool.zclthesis.com/api/node.json';
export const NETWORK_MAX_AGE = 180000;
const FUTURE_TOLERANCE = 300000;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const time = (value, now) => typeof value === 'string' && Number.isFinite(Date.parse(value)) && Date.parse(value) >= 1470000000000 && Date.parse(value) <= now + FUTURE_TOLERANCE;
const numberOrNull = (value, zero = true) => typeof value === 'number' && Number.isFinite(value) && (zero ? value >= 0 : value > 0) ? value : null;

/** Allowlist the public observation; never forward arbitrary upstream fields. */
export function parseNetworkSnapshot(data, now = Date.now()) {
  if (data?.schemaVersion !== 1 || data.asset !== 'ZCL' || !time(data.generatedAt, now)) throw Error('Invalid node observation identity');
  const generatedAt = new Date(data.generatedAt).toISOString();
  if (data.status === 'synchronizing' && data.node?.synced === false && !data.chain) {
    return {schemaVersion:1, asset:'ZCL', generatedAt, chain:null,
      node:{synced:false, connections:null, verificationProgress:null, softwareVersion:null, bootstrapValidation:'unknown'},
      mining:{difficulty:null, networkSolps:null}};
  }
  const chain = data.chain, node = data.node;
  if (data.source !== 'https://pool.zclthesis.com' || !integer(chain?.height) || chain.height > 0xffffffff || !/^[a-f0-9]{64}$/.test(chain.hash) || !time(chain.blockAt, now) ||
      typeof node?.synced !== 'boolean' || !integer(node.connections) || node.connections > 100000 ||
      typeof node.verificationProgress !== 'number' || !Number.isFinite(node.verificationProgress) || node.verificationProgress < 0 || node.verificationProgress > 1.000001) {
    throw Error('Invalid node observation');
  }
  const softwareVersion = typeof node.softwareVersion === 'string' && /^[\x20-\x7e]{1,160}$/.test(node.softwareVersion) ? node.softwareVersion : null;
  const bootstrapValidation = ['anchored-fast-sync','validated-from-genesis'].includes(node.bootstrapValidation) ? node.bootstrapValidation : 'unknown';
  return {schemaVersion:1, asset:'ZCL', generatedAt,
    chain:{height:chain.height, hash:chain.hash, blockAt:new Date(chain.blockAt).toISOString()},
    node:{synced:node.synced, connections:node.connections, verificationProgress:Math.min(1,node.verificationProgress), softwareVersion, bootstrapValidation},
    mining:{difficulty:numberOrNull(data.mining?.difficulty,false), networkSolps:numberOrNull(data.mining?.networkSolps)}};
}

export function networkStatus(snapshot, now = Date.now(), failed = false) {
  if (!snapshot) return 'unavailable';
  if (failed || now-Date.parse(snapshot.generatedAt)>NETWORK_MAX_AGE || now-Date.parse(snapshot.observedAt)>NETWORK_MAX_AGE) return 'stale';
  if (!snapshot.chain) return 'syncing';
  if (snapshot.node.connections === 0) return 'disconnected';
  const blockAge = now-Date.parse(snapshot.chain.blockAt);
  return snapshot.node.synced && snapshot.node.verificationProgress>=0.9999 && blockAge>=-FUTURE_TOLERANCE && blockAge<=1800000 ? 'ok' : 'syncing';
}

async function fetchObservation(url) {
  const response = await fetch(url,{redirect:'error',signal:AbortSignal.timeout(8000),headers:{Accept:'application/json'}});
  if (!response.ok || !response.body) throw Error('Node source unavailable');
  const reader=response.body.getReader(), chunks=[]; let size=0;
  try {
    while (true) {
      const {value,done}=await reader.read(); if(done) break;
      size+=value.length; if(size>16384) throw Error('Node observation too large');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function createNetworkData({load=fetchObservation,clock=Date.now,ttl=30000}={}) {
  let snapshot, pending, failed=false, lastAttempt=-Infinity;
  async function refresh() {
    try {
      const raw=await load(NETWORK_SOURCE), now=clock();
      snapshot={...parseNetworkSnapshot(raw,now), observedAt:new Date(now).toISOString()};
      failed=false;
    } catch { failed=true; }
  }
  return async function getNetworkData() {
    if(pending) await pending;
    else if(clock()-lastAttempt>=ttl) {
      lastAttempt=clock(); pending=refresh();
      try {await pending;} finally {pending=null;}
    }
    if(!snapshot) return {schemaVersion:1,asset:'ZCL',status:'unavailable',source:NETWORK_SOURCE,generatedAt:null,observedAt:null,chain:null,node:null,mining:null};
    return {...structuredClone(snapshot),status:networkStatus(snapshot,clock(),failed),source:NETWORK_SOURCE};
  };
}
