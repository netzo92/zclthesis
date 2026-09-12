import test from 'node:test';
import assert from 'node:assert/strict';
import {Reader,varint,coins,address,amount,block,compact,hash256} from '../scripts/chainstate.mjs';
test('reads documented legacy CCoins fixtures, including sparse output masks',()=>{
 const a=coins(Buffer.from('0104835800816115944e077fe7c803cfa57f29b36bf87c1d358bb85e','hex'));
 assert.equal(a.height,203998);assert.equal(a.coinbase,false);assert.deepEqual(a.outputs.map(o=>[o.index,o.value]),[[1,60000000000n]]);
 assert.match(address(a.outputs[0].script),/^t1[1-9A-HJ-NP-Za-km-z]{33}$/);
 const b=coins(Buffer.from('0109044086ef97d5790061b01caab50f1b8e9c50a5057eb43c2d9563a4eebbd123008c988f1a4a4de2161e0f50aac7f17e7f9555caa486af3b','hex'));
 assert.equal(b.height,120891);assert.equal(b.coinbase,true);assert.deepEqual(b.outputs.map(o=>[o.index,o.value]),[[4,234925952n],[16,110397n]]);
 assert.throws(()=>coins(Buffer.from('0104','hex')),/Truncated/);
});
test('preserves integer amounts and rejects ambiguous or malformed reads',()=>{
 for(const n of [0,127,128,255,16511,16512,3126937,2**32,Number.MAX_SAFE_INTEGER])assert.equal(new Reader(varint(n)).varint(),n);
 assert.equal(amount(0),0n);assert.equal(amount(1),1n);assert.equal(amount(9),100000000n);
 assert.throws(()=>new Reader(Buffer.alloc(12,255)).varint(),/overflow/);
 assert.equal(address(Buffer.from('6a','hex')),null);
 const a=address(Buffer.from('a914000000000000000000000000000000000000000087','hex'));assert.match(a,/^t3/);
});
test('hashes exact serialized block header after variable disk-index metadata',()=>{
 const header=Buffer.alloc(140);header.writeInt32LE(4);header.writeUInt32LE(1779903078,100);
 const data=Buffer.concat([varint(170100),varint(3126937),varint(8|16|128),varint(1),varint(30),varint(100),varint(200),Buffer.alloc(4),Buffer.alloc(32),header,compact(1344),Buffer.alloc(1344)]);
 const parsed=block(data);assert.equal(parsed.height,3126937);assert.equal(parsed.time,1779903078);assert.deepEqual(parsed.hash,hash256(Buffer.concat([header,compact(1344),Buffer.alloc(1344)])));
 assert.throws(()=>block(data.subarray(0,-1)),/Truncated/);
});
