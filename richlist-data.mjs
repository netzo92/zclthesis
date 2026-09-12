import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
export const SNAPSHOT_ANCHOR={height:3126937,hash:'00000663e40f1fe0bc32a7e7282fac25de5fe8ecefd9c627e2fd948d388f7053',commitment:'4efb67005d842e9d5bab21831fef8905a7fcb89e7264e43bd1aa00623f5a585f',blockAt:'2026-05-27T17:31:18.000Z'};
const MAX_MONEY=1146248700000000n;
const units=v=>typeof v==='string'&&/^(0|[1-9][0-9]{0,15})$/.test(v)&&BigInt(v)<=MAX_MONEY;
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(v)&&Number.isFinite(Date.parse(v));
export function validAddress(value){
 if(typeof value!=='string'||!/^t[13][1-9A-HJ-NP-Za-km-z]{33}$/.test(value))return false;
 const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';let n=0n;for(const c of value)n=n*58n+BigInt(alphabet.indexOf(c));const raw=Buffer.from(n.toString(16).padStart(52,'0'),'hex');
 if(raw.length!==26||raw[0]!==0x1c||![0xb8,0xbd].includes(raw[1]))return false;
 const hash=b=>createHash('sha256').update(b).digest();return hash(hash(raw.subarray(0,22))).subarray(0,4).equals(raw.subarray(22));
}
export function validateRichList(data,now=Date.now()){
 const s=data?.snapshot;if(!s||s.scope!=='transparent-utxos'||!Number.isSafeInteger(s.height)||s.height<1||!(/^[0-9a-f]{64}$/).test(s.hash)||!(/^[0-9a-f]{64}$/).test(s.commitment)||!date(s.blockAt)||!date(s.generatedAt)||Date.parse(s.blockAt)>now+7200000||Date.parse(s.generatedAt)>now+300000||Date.parse(s.generatedAt)<Date.parse(s.blockAt)||!units(s.totalZatoshis)||!units(s.unattributedZatoshis)||!Number.isSafeInteger(s.utxoCount)||s.utxoCount<1||!Array.isArray(data.addresses)||s.addressCount!==data.addresses.length||s.addressCount<1)throw Error('Invalid rich-list metadata');
 if(s.verification==='compiled-anchor'){
  if(s.source!=='https://github.com/ZclassicCommunity/zclassic/releases/tag/v2.1.2-beta6')throw Error('Unrecognized source');
  for(const [key,value] of Object.entries(SNAPSHOT_ANCHOR))if(s[key]!==value)throw Error('Unrecognized snapshot anchor');
 }else validateNodeContext(s,now);
 let total=BigInt(s.unattributedZatoshis),count=0;const seen=new Set();
 for(const a of data.addresses){
  if(!validAddress(a.address)||seen.has(a.address)||!units(a.balanceZatoshis)||BigInt(a.balanceZatoshis)<=0n||!Number.isSafeInteger(a.utxoCount)||a.utxoCount<1||!Number.isSafeInteger(a.oldestHeight)||!Number.isSafeInteger(a.newestHeight)||a.oldestHeight<0||a.oldestHeight>a.newestHeight||a.newestHeight>s.height)throw Error('Invalid rich-list address');
  let previous=BigInt(a.balanceZatoshis);for(const key of ['aged100kZatoshis','aged500kZatoshis','aged1mZatoshis']){if(!units(a[key])||BigInt(a[key])>previous)throw Error('Invalid dormant balance');previous=BigInt(a[key]);}
  total+=BigInt(a.balanceZatoshis);count+=a.utxoCount;seen.add(a.address);
 }
 if(total!==BigInt(s.totalZatoshis)||count>s.utxoCount)throw Error('Rich-list totals do not reconcile');return data;
}
export function validateNodeContext(s,now=Date.now()){
 if(!s||s.verification!=='own-node-snapshot'||s.source!=='https://pool.zclthesis.com'||!Number.isSafeInteger(s.height)||s.height<SNAPSHOT_ANCHOR.height||!(/^[0-9a-f]{64}$/).test(s.hash)||!(/^[0-9a-f]{64}$/).test(s.commitment)||!date(s.blockAt)||Date.parse(s.blockAt)>now+7200000||!units(s.totalZatoshis)||!Number.isSafeInteger(s.utxoCount)||s.utxoCount<1||!['anchored-fast-sync','validated-from-genesis','unknown'].includes(s.bootstrapValidation))throw Error('Invalid own-node snapshot context');
 return s;
}
export function packageRichList(data,{failed=false,now=Date.now()}={}){
 const status=failed||now-Date.parse(data.snapshot.blockAt)>7200000?'stale':'ok';
 const body=Buffer.from(JSON.stringify({status,...data}));
 return {data,status,body,gzip:gzipSync(body),etag:'W/"'+createHash('sha256').update(body).digest('hex')+'"'};
}
export async function loadRichList(file=new URL('./data/richlist.json',import.meta.url)){
 // The bundled historical snapshot remains a fallback when the node feed is unavailable.
 const bytes=await readFile(file);if(bytes.length>64*1024*1024)throw Error('Rich-list snapshot too large');
 const data=validateRichList(JSON.parse(bytes.toString('utf8')));
 return packageRichList(data);
}
