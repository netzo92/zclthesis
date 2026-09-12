import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRichList,SNAPSHOT_ANCHOR} from '../richlist-data.mjs';
import {address} from '../scripts/chainstate.mjs';
function fixture(){return {snapshot:{...SNAPSHOT_ANCHOR,generatedAt:'2026-09-12T01:00:00.000Z',source:'https://github.com/ZclassicCommunity/zclassic/releases/tag/v2.1.2-beta6',verification:'compiled-anchor',scope:'transparent-utxos',addressCount:1,utxoCount:1,totalZatoshis:'100000001',unattributedZatoshis:'0'},addresses:[{address:address(Buffer.from('76a914000000000000000000000000000000000000000088ac','hex')),balanceZatoshis:'100000001',utxoCount:1,oldestHeight:100000,newestHeight:100000,aged100kZatoshis:'100000001',aged500kZatoshis:'100000001',aged1mZatoshis:'100000001'}]};}
const now=Date.parse('2026-09-12T04:00:00Z');
test('accepts a complete reconciled snapshot with exact unit strings',()=>{const data=fixture();assert.equal(validateRichList(data,now),data);});
test('rejects checksum, duplicate, balance and coverage inconsistencies',()=>{
 for(const mutate of [d=>d.addresses[0].address=d.addresses[0].address.slice(0,-1)+'0',d=>{d.addresses.push({...d.addresses[0]});d.snapshot.addressCount=2;},d=>d.addresses[0].balanceZatoshis='100000002',d=>d.snapshot.addressCount=2,d=>d.snapshot.utxoCount=0,d=>d.addresses[0].aged500kZatoshis='100000002']){
  const d=fixture();mutate(d);assert.throws(()=>validateRichList(d,now));
 }
});
test('rejects unknown anchor, future or impossible output metadata',()=>{
 for(const mutate of [d=>d.snapshot.hash='0'.repeat(64),d=>d.snapshot.commitment='0'.repeat(64),d=>d.snapshot.generatedAt='2030-01-01T00:00:00Z',d=>d.addresses[0].newestHeight=d.snapshot.height+1,d=>d.addresses[0].oldestHeight=100001,d=>d.addresses[0].balanceZatoshis='1e8']){const d=fixture();mutate(d);assert.throws(()=>validateRichList(d,now));}
});
