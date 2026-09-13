export const SOURCES = {
  chain: 'https://explorer.zcl.zelcore.io/api/blocks?limit=1',
  market: 'https://api.nonkyc.io/api/v2/market/getbysymbol/ZCL_USDT',
};
export const NODE_SOURCE = 'https://pool.zclthesis.com/api/node.json';
export const ZCL_LAUNCH_DATE = '2016-11-06';
/** Calendar age since the public launch, not a measurement of uninterrupted uptime. */
export function chainAge(now=Date.now()) {
  if(!Number.isFinite(now))return null;
  const date=new Date(now),start=Date.UTC(2016,10,6);
  const today=Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate());
  if(!Number.isFinite(today)||today<start)return null;
  let years=date.getUTCFullYear()-2016;
  if(date.getUTCMonth()<10||(date.getUTCMonth()===10&&date.getUTCDate()<6))years--;
  let months=(date.getUTCMonth()-10+12)%12;
  if(date.getUTCDate()<6)months=(months+11)%12;
  const anniversary=Date.UTC(2016+years,10+months,6);
  return {asset:'ZCL',launchedAt:ZCL_LAUNCH_DATE,basis:'public-launch-date-utc',
    years,months,days:(today-anniversary)/86400000,totalDays:(today-start)/86400000,
    asOfDate:new Date(today).toISOString().slice(0,10),source:'https://zclassic.org/'};
}
const numeric = value => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) ? Number(value) : NaN;
function validTime(value, now) { return Number.isFinite(value) && value > 1480000000000 && value <= now + 300000; }
export function parseChain(data, now = Date.now()) {
  const b = data?.blocks?.[0];
  if (!b || !Number.isSafeInteger(b.height) || b.height < 1 || !/^[a-f0-9]{64}$/.test(b.hash) || !validTime(b.time * 1000, now) || b.isMainChain !== true) throw Error('Invalid block response');
  return {height:b.height, hash:b.hash, blockAt:new Date(b.time * 1000).toISOString()};
}
export function parseOwnNode(data, now = Date.now()) {
  const c=data?.chain, n=data?.node, generated=Date.parse(data?.generatedAt), block=Date.parse(c?.blockAt);
  if(data?.schemaVersion!==1||data?.asset!=='ZCL'||n?.synced!==true||!Number.isSafeInteger(n.connections)||n.connections<1||
      !Number.isSafeInteger(c?.height)||c.height<1||!/^[0-9a-f]{64}$/.test(c.hash)||!validTime(block,now)||now-block>1800000||
      !validTime(generated,now)||now-generated>180000)throw Error('Our node is not current');
  return {height:c.height,hash:c.hash,blockAt:c.blockAt};
}
export function parseMarket(data, now = Date.now()) {
  const price = numeric(data?.lastPrice), volume = numeric(data?.volumeSecondary), change = numeric(data?.changePercent);
  if (data?.symbol !== 'ZCL/USDT' || !Number.isFinite(price) || price <= 0 || !validTime(data.lastTradeAt, now)) throw Error('Invalid market response');
  return {price, quote:'USDT', tradeAt:new Date(data.lastTradeAt).toISOString(), volume24h:Number.isFinite(volume) && volume >= 0 ? volume : null, change24h:Number.isFinite(change) ? change : null, paused:data.isPaused === true || data.isActive === false};
}
async function fetchJSON(url) {
  const response = await fetch(url,{signal:AbortSignal.timeout(url===NODE_SOURCE?2500:8000),headers:{Accept:'application/json'}});
  if (!response.ok) throw Error(`HTTP ${response.status}`);
  const reader=response.body.getReader(); let size=0; const chunks=[];
  try { while (true) {const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>262144)throw Error('Response too large');chunks.push(value);} }
  finally {await reader.cancel();}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export function createLiveData({load=fetchJSON, clock=Date.now, ttl=60000}={}) {
  const cache={}; let pending, lastAttempt=-Infinity;
  async function refresh() {
    await Promise.all(Object.entries(SOURCES).map(async ([name,url])=>{
      try {
        let value,source=url;
        if(name==='chain') {
          try {value=parseOwnNode(await load(NODE_SOURCE),clock());source=NODE_SOURCE;}
          catch {value=parseChain(await load(url),clock());}
        }else value=parseMarket(await load(url),clock());
        cache[name]={value,source,fetchedAt:new Date(clock()).toISOString(),failed:false};
      }
      catch {cache[name]={...cache[name],failed:true};}
    }));
  }
  return async function getLiveData() {
    if(pending) await pending;
    else if(clock()-lastAttempt>=ttl) {lastAttempt=clock();pending=refresh();try{await pending;}finally{pending=null;}}
    const now=clock();const result={generatedAt:new Date(now).toISOString(),chainAge:chainAge(now)};
    for(const name of Object.keys(SOURCES)) {
      const entry=cache[name];const observed=entry?.value?.[name==='chain'?'blockAt':'tradeAt'];
      const aged=observed && now-Date.parse(observed)>(name==='chain'?1800000:3600000);
      result[name]={...entry,source:entry?.source||SOURCES[name],status:!entry?.value?'unavailable':entry.failed || aged || entry.value.paused || now-Date.parse(entry.fetchedAt)>180000?'stale':'ok'};
    }
    return result;
  };
}
