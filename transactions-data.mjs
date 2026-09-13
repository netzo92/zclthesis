import {createRequire} from 'node:module';
import {validAddress} from './richlist-data.mjs';
const {validateTransactionsPayload,transactionState}=createRequire(import.meta.url)('./public/transactions.js');
export const TRANSACTIONS_SOURCE='https://pool.zclthesis.com/api/transactions.json';
export const TRANSACTIONS_MAX_BYTES=2*1024*1024;
const ISO=value=>new Date(value).toISOString();
const SCRIPTS=new Set(['pubkey','pubkeyhash','scripthash','multisig','nulldata','other']);

/** Validate once against the browser contract, then reconstruct only public fields. */
export function parseTransactionsSnapshot(raw,now=Date.now()) {
  if(raw?.source!=='https://pool.zclthesis.com')throw Error('Invalid transaction source');
  const candidate={...raw,source:TRANSACTIONS_SOURCE,observedAt:new Date(now).toISOString()};
  validateTransactionsPayload(candidate,now);
  if(raw.status==='unavailable')return null;
  if(raw.chain.height>0x7fffffff||raw.node.connections>100000||Date.parse(raw.chain.blockAt)>now+7200000)throw Error('Invalid chain observation');
  const blockTimes=new Map([[raw.chain.height,Date.parse(raw.chain.blockAt)]]);
  const transactions=raw.transactions.map(tx=>{
    if(tx.transparentInputCount>200000||tx.transparentOutputCount>200000||(tx.isCoinbase&&tx.transparentInputCount!==0)||tx.outputs.length!==Math.min(tx.transparentOutputCount,32))throw Error('Invalid transparent component count');
    const blockAt=Date.parse(tx.blockAt);
    if(blockAt>now+7200000||(blockTimes.has(tx.blockHeight)&&blockTimes.get(tx.blockHeight)!==blockAt))throw Error('Inconsistent block time');
    blockTimes.set(tx.blockHeight,blockAt);
    let subtotal=0n;
    const outputs=tx.outputs.map((output,index)=>{
      if(output.n!==index||!SCRIPTS.has(output.scriptType)||!output.addresses.every(validAddress))throw Error('Invalid output');
      subtotal+=BigInt(output.amountZat);
      return {n:output.n,amountZat:output.amountZat,addresses:[...output.addresses],scriptType:output.scriptType};
    });
    if(tx.transparentOutputCount<=32&&subtotal!==BigInt(tx.transparentOutputZat))throw Error('Incomplete output total');
    return {txid:tx.txid,blockHeight:tx.blockHeight,blockHash:tx.blockHash,blockAt:ISO(tx.blockAt),confirmations:tx.confirmations,isCoinbase:tx.isCoinbase,
      transparentInputCount:tx.transparentInputCount,transparentOutputCount:tx.transparentOutputCount,transparentOutputZat:tx.transparentOutputZat,outputs,outputsTruncated:tx.outputsTruncated,hasShieldedComponents:tx.hasShieldedComponents};
  });
  const mempool=raw.mempool;
  if(mempool.transactions.length!==Math.min(mempool.total,50)||mempool.truncated!==(mempool.total>50))throw Error('Invalid mempool coverage');
  const pending=mempool.transactions.map(tx=>{
    if(tx.sizeBytes>200000)throw Error('Invalid transaction size');
    return {txid:tx.txid,localNodeSeenAt:ISO(tx.localNodeSeenAt),sizeBytes:tx.sizeBytes};
  });
  const blockAge=now-Date.parse(raw.chain.blockAt);
  const snapshot={schemaVersion:1,asset:'ZCL',source:TRANSACTIONS_SOURCE,generatedAt:ISO(raw.generatedAt),observedAt:new Date(now).toISOString(),status:raw.status,
    chain:{height:raw.chain.height,hash:raw.chain.hash,blockAt:ISO(raw.chain.blockAt)},
    node:{synced:raw.node.synced&&blockAge>=-300000&&blockAge<=1800000,connections:raw.node.connections},
    coverage:{blocksScanned:raw.coverage.blocksScanned,oldestHeight:raw.coverage.oldestHeight,transactionLimit:100,transactionsTruncated:raw.coverage.transactionsTruncated},transactions,
    mempool:{total:mempool.total,limit:50,truncated:mempool.truncated,transactions:pending}};
  snapshot.status=transactionState(snapshot,now);
  return snapshot;
}

export async function fetchTransactionsObservation(url=TRANSACTIONS_SOURCE,{fetcher=fetch}={}) {
  if(url!==TRANSACTIONS_SOURCE)throw Error('Invalid transaction source URL');
  const response=await fetcher(TRANSACTIONS_SOURCE,{redirect:'error',signal:AbortSignal.timeout(8000),headers:{Accept:'application/json'}});
  if(!response.ok||!response.body)throw Error('Transaction source unavailable');
  const length=response.headers.get('content-length');
  if(length!==null&&(!/^\d+$/.test(length)||Number(length)>TRANSACTIONS_MAX_BYTES)){await response.body.cancel();throw Error('Transaction observation too large');}
  const reader=response.body.getReader(),chunks=[];let size=0;
  try {
    while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>TRANSACTIONS_MAX_BYTES)throw Error('Transaction observation too large');chunks.push(value);}
  } finally {await reader.cancel();}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function createTransactionsData({load=fetchTransactionsObservation,clock=Date.now,ttl=30000}={}) {
  let snapshot=null,pending=null,failed=false,lastAttempt=-Infinity;
  async function refresh(){
    try {const next=parseTransactionsSnapshot(await load(TRANSACTIONS_SOURCE),clock());if(!next)throw Error('No transaction observation');snapshot=next;failed=false;}
    catch {failed=true;}
  }
  return async function getTransactionsData(){
    if(pending)await pending;
    else if(clock()-lastAttempt>=ttl){lastAttempt=clock();pending=refresh();try{await pending;}finally{pending=null;}}
    if(!snapshot)return {schemaVersion:1,asset:'ZCL',source:TRANSACTIONS_SOURCE,status:'unavailable',generatedAt:null,observedAt:null,chain:null,node:null,coverage:null,transactions:[],mempool:null};
    return {...structuredClone(snapshot),status:transactionState(snapshot,clock(),failed)};
  };
}
