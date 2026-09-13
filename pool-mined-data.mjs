export const POOL_MINED_SOURCE='https://pool.zclthesis.com/api/pool.json';
export const POOL_MINED_MAX_BYTES=32*1024;
const WINDOWS=['allTime','last24h','lastHour'];
const AMOUNTS=['rewardZat','matureRewardZat','immatureRewardZat'];
const COUNTS=['blocks','matureBlocks','immatureBlocks'];
const STALE_MS=180000;
const date=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(value)?Date.parse(value):NaN;
const count=value=>Number.isSafeInteger(value)&&value>=0;
const zat=value=>typeof value==='string'&&/^(?:0|[1-9]\d{0,23})$/.test(value);

function parseWindow(raw){
  if(!raw||!AMOUNTS.every(key=>zat(raw[key]))||!COUNTS.every(key=>count(raw[key]))
    ||BigInt(raw.rewardZat)!==BigInt(raw.matureRewardZat)+BigInt(raw.immatureRewardZat)
    ||raw.blocks!==raw.matureBlocks+raw.immatureBlocks
    ||AMOUNTS.some((key,i)=>raw[COUNTS[i]]===0&&raw[key]!=='0'))throw Error('Invalid pool reward totals');
  return Object.fromEntries([...AMOUNTS,...COUNTS].map(key=>[key,raw[key]]));
}

/** Publish aggregate block rewards only; never relay wallet/accounting records. */
export function parsePoolMined(raw,now=Date.now()){
  if(raw?.schemaVersion!==1||raw.asset!=='ZCL'||!['ok','partial','unavailable'].includes(raw.status)
    ||raw.coverageBasis!=='retained-pool-ledger'||raw.windowBasis!=='pool-recorded-time'
    ||raw.rewardBasis!=='gross-coinbase-including-fees')throw Error('Invalid pool mined snapshot');
  const generated=date(raw.generatedAt),coverage=raw.coverageStartedAt===null?null:date(raw.coverageStartedAt);
  if(!Number.isFinite(generated)||generated>now+60000
    ||(coverage!==null&&(!Number.isFinite(coverage)||coverage>generated)))throw Error('Invalid pool reward timestamp');
  const result={schemaVersion:1,asset:'ZCL',status:raw.status,generatedAt:new Date(generated).toISOString(),
    coverageStartedAt:coverage===null?null:new Date(coverage).toISOString(),coverageBasis:raw.coverageBasis,
    windowBasis:raw.windowBasis,rewardBasis:raw.rewardBasis};
  if(raw.status==='unavailable'){
    if(![...WINDOWS,'unknownBlocks','excludedOrphans','accountingHeld'].every(key=>raw[key]===null))throw Error('Unavailable rewards must be null');
    for(const key of [...WINDOWS,'unknownBlocks','excludedOrphans','accountingHeld'])result[key]=null;
  }else{
    if(!count(raw.unknownBlocks)||!count(raw.excludedOrphans)||typeof raw.accountingHeld!=='boolean'
      ||(raw.status==='ok'&&(raw.unknownBlocks!==0||raw.accountingHeld)))throw Error('Invalid pool reward coverage');
    for(const key of WINDOWS)result[key]=parseWindow(raw[key]);
    for(const key of [...AMOUNTS,...COUNTS]){
      if(BigInt(result.lastHour[key])>BigInt(result.last24h[key])||BigInt(result.last24h[key])>BigInt(result.allTime[key]))throw Error('Pool reward windows do not reconcile');
    }
    for(const key of ['unknownBlocks','excludedOrphans','accountingHeld'])result[key]=raw[key];
  }
  return {...result,source:POOL_MINED_SOURCE,fetchedAt:new Date(now).toISOString(),stale:now-generated>STALE_MS};
}

export async function fetchPoolMined(url=POOL_MINED_SOURCE,{fetcher=fetch}={}){
  if(url!==POOL_MINED_SOURCE)throw Error('Invalid pool URL');
  const response=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(8000),headers:{Accept:'application/json'}});
  if(!response.ok||!response.body)throw Error('Pool source unavailable');
  const length=response.headers.get('content-length');
  if(length!==null&&(!/^\d+$/.test(length)||Number(length)>POOL_MINED_MAX_BYTES)){await response.body.cancel();throw Error('Pool response too large');}
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>POOL_MINED_MAX_BYTES)throw Error('Pool response too large');chunks.push(value);}}
  finally{await reader.cancel();}
  const raw=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(raw?.schemaVersion!==1||raw.asset!=='ZCL')throw Error('Invalid pool source');
  return raw.mined;
}

export function createPoolMinedData({load=fetchPoolMined,clock=Date.now,ttl=30000}={}){
  let snapshot=null,pending=null,lastAttempt=-Infinity,failed=false;
  async function refresh(){try{snapshot=parsePoolMined(await load(POOL_MINED_SOURCE),clock());failed=false;}catch{failed=true;}}
  return async function getPoolMined(){
    if(pending)await pending;
    else if(clock()-lastAttempt>=ttl){lastAttempt=clock();pending=refresh();try{await pending;}finally{pending=null;}}
    if(failed||!snapshot)throw Error('Pool rewards temporarily unavailable');
    const result=structuredClone(snapshot);
    result.stale=clock()-date(result.generatedAt)>STALE_MS;
    return result;
  };
}
