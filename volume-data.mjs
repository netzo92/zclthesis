export const VOLUME_SOURCE='https://pool.zclthesis.com/api/prices/zcl-usdt-volume.json';
export const VOLUME_MAX_BYTES=128*1024;
export const VOLUME_LAUNCH='2026-09-12T03:23:13.198Z';
const HOUR=3600000,STALE=180000;
const date=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(value)?Date.parse(value):NaN;
const iso=value=>new Date(value).toISOString();
const count=value=>Number.isSafeInteger(value)&&value>=0;
const decimal=value=>typeof value==='string'&&value.length<=96&&/^\d+(?:\.\d+)?$/.test(value)&&Number.isFinite(Number(value));
const scaled=value=>{const [whole,fraction='']=value.split('.');return {value:BigInt(whole+fraction),scale:fraction.length};};
function sumWithin(values,total,exact=false){
  const all=[...values,total].map(scaled),scale=Math.max(...all.map(x=>x.scale));
  const numbers=all.map(x=>x.value*10n**BigInt(scale-x.scale));
  const sum=numbers.slice(0,-1).reduce((a,b)=>a+b,0n);
  return exact?sum===numbers.at(-1):sum<=numbers.at(-1);
}

/** Preserve exact exchange quantities; expose only the public volume contract. */
export function parseVolumeSnapshot(raw,now=Date.now()){
  if(raw?.schemaVersion!==1||raw.pair!=='ZCL/USDT'||raw.source!=='NonKYC'
    ||date(raw.launchedAt)!==Date.parse(VOLUME_LAUNCH)||raw.bucketSeconds!==3600
    ||!['live','stale','partial'].includes(raw.status)||!count(raw.tradeCount)
    ||!decimal(raw.volumeBase)||!decimal(raw.volumeQuote)||!Array.isArray(raw.buckets)
    ||raw.buckets.length<1||raw.buckets.length>168)throw Error('Invalid volume snapshot');
  const launched=date(raw.launchedAt),generated=date(raw.generatedAt),start=date(raw.windowStart);
  const checked=raw.checkedThrough===null?null:date(raw.checkedThrough);
  const coverage=raw.coverageStart===null?null:date(raw.coverageStart);
  if(!Number.isFinite(generated)||generated<launched||generated>now+60000
    ||!Number.isFinite(start)||start%HOUR!==0||start<Math.floor(launched/HOUR)*HOUR||start>generated
    ||(checked!==null&&(!Number.isFinite(checked)||checked<launched||checked>generated))
    ||(coverage!==null&&(!Number.isFinite(coverage)||coverage<launched||checked===null||coverage>checked)))throw Error('Invalid volume coverage');
  const first=raw.firstTradeAt===null?null:date(raw.firstTradeAt),last=raw.lastTradeAt===null?null:date(raw.lastTradeAt);
  if(raw.tradeCount===0?(first!==null||last!==null||Number(raw.volumeBase)!==0||Number(raw.volumeQuote)!==0)
    :(!Number.isFinite(first)||!Number.isFinite(last)||first<launched||last<first||last>generated||Number(raw.volumeBase)<=0||Number(raw.volumeQuote)<=0))throw Error('Invalid volume totals');
  const buckets=raw.buckets.map((bucket,index)=>{
    const at=date(bucket.start);
    if(at!==start+index*HOUR||at>generated||!decimal(bucket.volumeBase)||!decimal(bucket.volumeQuote)
      ||!count(bucket.tradeCount)||typeof bucket.covered!=='boolean'
      ||(bucket.tradeCount===0?(Number(bucket.volumeBase)!==0||Number(bucket.volumeQuote)!==0):(Number(bucket.volumeBase)<=0||Number(bucket.volumeQuote)<=0)))throw Error('Invalid hourly volume');
    return {start:iso(at),volumeBase:bucket.volumeBase,volumeQuote:bucket.volumeQuote,tradeCount:bucket.tradeCount,covered:bucket.covered};
  });
  const fullWindow=start===Math.floor(launched/HOUR)*HOUR;
  const bucketCount=buckets.reduce((sum,b)=>sum+b.tradeCount,0);
  if(date(buckets.at(-1).start)!==Math.floor(generated/HOUR)*HOUR
    ||(fullWindow?bucketCount!==raw.tradeCount:bucketCount>raw.tradeCount)
    ||!sumWithin(buckets.map(b=>b.volumeBase),raw.volumeBase,fullWindow)
    ||!sumWithin(buckets.map(b=>b.volumeQuote),raw.volumeQuote,fullWindow))throw Error('Hourly volume does not reconcile');
  let status=raw.status;
  if(status==='live'&&(coverage!==launched||checked===null||buckets.some(b=>!b.covered)))status='partial';
  if(now-generated>STALE||(checked!==null&&now-checked>STALE))status='stale';
  return {schemaVersion:1,pair:'ZCL/USDT',source:'NonKYC',launchedAt:iso(launched),generatedAt:iso(generated),
    checkedThrough:checked===null?null:iso(checked),coverageStart:coverage===null?null:iso(coverage),
    firstTradeAt:first===null?null:iso(first),lastTradeAt:last===null?null:iso(last),
    tradeCount:raw.tradeCount,volumeBase:raw.volumeBase,volumeQuote:raw.volumeQuote,bucketSeconds:3600,
    windowStart:iso(start),buckets,status,fetchedAt:iso(now)};
}

export async function fetchVolumeSnapshot(url=VOLUME_SOURCE,{fetcher=fetch}={}){
  if(url!==VOLUME_SOURCE)throw Error('Invalid volume URL');
  const response=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(8000),headers:{Accept:'application/json'}});
  if(!response.ok||!response.body)throw Error('Volume source unavailable');
  const length=response.headers.get('content-length');
  if(length!==null&&(!/^\d+$/.test(length)||Number(length)>VOLUME_MAX_BYTES)){await response.body.cancel();throw Error('Volume response too large');}
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>VOLUME_MAX_BYTES)throw Error('Volume response too large');chunks.push(value);}}
  finally{await reader.cancel();}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function createVolumeData({load=fetchVolumeSnapshot,clock=Date.now,ttl=60000}={}){
  let snapshot=null,pending=null,failed=false,lastAttempt=-Infinity;
  async function refresh(){try{snapshot=parseVolumeSnapshot(await load(VOLUME_SOURCE),clock());failed=false;}catch{failed=true;}}
  return async function getVolumeData(){
    if(pending)await pending;
    else if(clock()-lastAttempt>=ttl){lastAttempt=clock();pending=refresh();try{await pending;}finally{pending=null;}}
    if(!snapshot)return {schemaVersion:1,pair:'ZCL/USDT',source:'NonKYC',launchedAt:VOLUME_LAUNCH,status:'unavailable',generatedAt:null,checkedThrough:null,coverageStart:null,firstTradeAt:null,lastTradeAt:null,tradeCount:null,volumeBase:null,volumeQuote:null,bucketSeconds:3600,windowStart:null,buckets:[],fetchedAt:null};
    const result=structuredClone(snapshot);
    if(failed||clock()-date(result.generatedAt)>STALE||(result.checkedThrough!==null&&clock()-date(result.checkedThrough)>STALE))result.status='stale';
    return result;
  };
}
