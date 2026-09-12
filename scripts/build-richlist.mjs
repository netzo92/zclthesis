import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {validateRichList,SNAPSHOT_ANCHOR,validateNodeContext} from '../richlist-data.mjs';
const args=process.argv.slice(2);if(args.length!==2)throw Error('Usage: node scripts/build-richlist.mjs VERIFIED_DIR OUTPUT_JSON');
const [dir,output]=args.map(path=>resolve(path));
const state=JSON.parse(await readFile(join(dir,'verified-state.json'),'utf8'));
const ownNode=state.anchor?.verification==='own-node-snapshot';
const pinned=ownNode?validateNodeContext(state.anchor):SNAPSHOT_ANCHOR;
if(!ownNode)for(const k of ['height','hash','commitment'])if(state.anchor[k]!==pinned[k])throw Error('Unrecognized anchor');
const thresholds=[['100k',100000],['500k',500000],['1m',1000000]];
const addresses=state.addresses.map(a=>{
 let oldestHeight=Infinity,newestHeight=0;const aged={'100k':0n,'500k':0n,'1m':0n};let sum=0n;
 for(const [height,units] of a.lots){if(!Number.isSafeInteger(height)||height<0||height>pinned.height)throw Error('Invalid output height');const value=BigInt(units);if(value<0n)throw Error('Invalid output lot');oldestHeight=Math.min(oldestHeight,height);newestHeight=Math.max(newestHeight,height);sum+=value;for(const [label,count] of thresholds)if(pinned.height-height>=count)aged[label]+=value;}
 if(sum!==BigInt(a.balanceZatoshis))throw Error('Address lot sum mismatch');
 return {address:a.address,balanceZatoshis:a.balanceZatoshis,utxoCount:a.utxoCount,oldestHeight,newestHeight,aged100kZatoshis:aged['100k'].toString(),aged500kZatoshis:aged['500k'].toString(),aged1mZatoshis:aged['1m'].toString()};
}).sort((a,b)=>BigInt(a.balanceZatoshis)>BigInt(b.balanceZatoshis)?-1:BigInt(a.balanceZatoshis)<BigInt(b.balanceZatoshis)?1:a.address<b.address?-1:a.address>b.address?1:0);
const result={snapshot:{...pinned,generatedAt:new Date().toISOString(),source:ownNode?pinned.source:'https://github.com/ZclassicCommunity/zclassic/releases/tag/v2.1.2-beta6',verification:ownNode?'own-node-snapshot':'compiled-anchor',scope:'transparent-utxos',addressCount:addresses.length,utxoCount:state.utxoCount,totalZatoshis:state.totalZatoshis,unattributedZatoshis:state.unattributedZatoshis},addresses};
validateRichList(result);await writeFile(output,JSON.stringify(result));console.log(JSON.stringify({output,addresses:addresses.length,blockAt:result.snapshot.blockAt,bytes:JSON.stringify(result).length}));
