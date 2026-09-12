import {ClassicLevel} from 'classic-level';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,cp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {SNAPSHOT_ANCHOR} from '../richlist-data.mjs';
import {coins,address,varint,serializedOutput,sha256} from './chainstate.mjs';
const args=process.argv.slice(2);
if(args.length!==2)throw Error('Usage: node scripts/export-state.mjs SNAPSHOT_DIR OUTPUT_DIR');
const [snapshotDir,outputDir]=args.map(path=>resolve(path));
const anchor=SNAPSHOT_ANCHOR;
// This anchor is pinned to the public release, never taken on trust from the peer's manifest.
await mkdir(outputDir,{recursive:true});
const work=join(outputDir,'chainstate-working');
await cp(join(snapshotDir,'chainstate'),work,{recursive:true,errorOnExist:true,force:false});
const db=new ClassicLevel(work,{keyEncoding:'buffer',valueEncoding:'buffer',createIfMissing:false});
const digest=()=>createHash('sha256');const finish=h=>sha256(h.digest());
let transactions=0,utxos=0,total=0n,unattributed=0n;const accounts=new Map();
try {
 const best=await db.get(Buffer.from('B'));if(!best||Buffer.from(best).reverse().toString('hex')!==anchor.hash)throw Error('Chainstate is not at the pinned anchor');
 const outputsHash=digest().update(best),metadataHash=digest();
 for await(const [key,value] of db.iterator({gte:Buffer.from('c'),lt:Buffer.from('d')})){
  if(key.length!==33)throw Error('Invalid coin key');const c=coins(value);if(c.height>anchor.height||c.height<0)throw Error('Invalid coin height');
  metadataHash.update(varint(c.height)).update(Buffer.from([c.coinbase?1:0])).update(varint(c.version));
  for(const o of c.outputs){
   if(o.value<0n||o.value>1146248700000000n)throw Error('Invalid amount');
   outputsHash.update(serializedOutput(o));utxos++;total+=o.value;
   const a=address(o.script);if(!a){unattributed+=o.value;continue;}if(o.value===0n)continue;
   let entry=accounts.get(a);if(!entry){entry={address:a,balance:0n,count:0,lots:new Map()};accounts.set(a,entry);}
   entry.balance+=o.value;entry.count++;entry.lots.set(c.height,(entry.lots.get(c.height)||0n)+o.value);
  }
  outputsHash.update(varint(0));transactions++;
  if(transactions%250000===0)console.log(JSON.stringify({transactions,utxos,addresses:accounts.size}));
 }
 const transparent=finish(outputsHash),metadata=finish(metadataHash);
 const full=digest().update(transparent).update(metadata);
 for(const prefix of ['a','z']){const root=await db.get(Buffer.from(prefix));if(!root||root.length!==32)throw Error('Missing shielded anchor');full.update(root);}
 for(const prefix of ['A','Z','s','S'])for await(const [key] of db.iterator({gte:Buffer.concat([Buffer.from(prefix),Buffer.alloc(32)]),lt:Buffer.from(String.fromCharCode(prefix.charCodeAt(0)+1))})){if(key.length!==33)throw Error('Invalid shielded key');full.update(key.subarray(1));}
 const computed=finish(full).reverse().toString('hex');if(computed!==anchor.commitment)throw Error(`Chainstate commitment mismatch: ${computed}`);
 const result={anchor,transparentHash:Buffer.from(transparent).reverse().toString('hex'),transactions,utxoCount:utxos,totalZatoshis:total.toString(),unattributedZatoshis:unattributed.toString(),addresses:[...accounts.values()].map(a=>({address:a.address,balanceZatoshis:a.balance.toString(),utxoCount:a.count,lots:[...a.lots].map(([height,balance])=>[height,balance.toString()])}))};
 await writeFile(join(outputDir,'verified-state.json'),JSON.stringify(result));console.log(JSON.stringify({verified:true,commitment:computed,transactions,utxos,addresses:accounts.size,totalZatoshis:total.toString()}));
}finally{await db.close();await rm(work,{recursive:true,force:true});}
