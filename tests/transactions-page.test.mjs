import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {validateTransactionsPayload, formatZcl, transactionState} = createRequire(import.meta.url)('../public/transactions.js');
const now = Date.parse('2026-09-12T23:00:00Z');
const h = char => char.repeat(64);
const address = 't1UYsZVJkLPeMjxEtACvSxfWuNmddpWfxzs';
function fixture() {
  return {schemaVersion:1,asset:'ZCL',source:'https://pool.zclthesis.com/api/transactions.json',generatedAt:'2026-09-12T22:59:50Z',observedAt:'2026-09-12T23:00:00Z',status:'ok',
    chain:{height:100,hash:h('a'),blockAt:'2026-09-12T22:59:00Z'},node:{synced:true,connections:5},coverage:{blocksScanned:3,oldestHeight:98,transactionLimit:100,transactionsTruncated:false},
    transactions:[{txid:h('b'),blockHeight:100,blockHash:h('a'),blockAt:'2026-09-12T22:59:00Z',confirmations:1,isCoinbase:false,transparentInputCount:2,transparentOutputCount:2,transparentOutputZat:'100000001',
      outputs:[{n:0,amountZat:'100000000',addresses:[address],scriptType:'pubkeyhash'},{n:1,amountZat:'1',addresses:[],scriptType:'nonstandard'}],outputsTruncated:false,hasShieldedComponents:true}],
    mempool:{total:1,limit:50,truncated:false,transactions:[{txid:h('c'),localNodeSeenAt:'2026-09-12T22:58:00Z',sizeBytes:234}]}};
}
const unavailable = () => ({schemaVersion:1,asset:'ZCL',source:'https://pool.zclthesis.com/api/transactions.json',status:'unavailable',generatedAt:null,observedAt:'2026-09-12T23:00:00Z',chain:null,node:null,coverage:null,transactions:[],mempool:null});

test('formats exact nonnegative integer zatoshis with eight decimals, without floating-point division', () => {
  for (const [zat,en,es] of [['0','0.00000000','0,00000000'],['1','0.00000001','0,00000001'],['100000001','1.00000001','1,00000001'],['2100000000000000','21,000,000.00000000','21.000.000,00000000'],['2000000000000001','20,000,000.00000001','20.000.000,00000001']]) {
    assert.equal(formatZcl(zat,'en'),en); assert.equal(formatZcl(zat,'es'),es);
  }
  for (const value of [0,1,-1,'-1','1.0','1e8','01','Infinity','1<script>','2100000000000001','9007199254740993']) assert.throws(() => formatZcl(value));
});
test('accepts canonical confirmed and local mempool observations without conflating shielded value', () => {
  const data=validateTransactionsPayload(fixture(),now);
  assert.equal(data.transactions[0].transparentOutputZat,'100000001');
  assert.equal(data.transactions[0].hasShieldedComponents,true);
  assert.equal(data.transactions[0].outputs[1].addresses.length,0);
  assert.equal(data.mempool.transactions[0].localNodeSeenAt,'2026-09-12T22:58:00Z');
});
test('rejects inconsistent tip confirmations, duplicate IDs, contradictory blocks and invalid coverage', () => {
  for (const edit of [d=>d.transactions[0].confirmations=2,d=>d.transactions[0].blockHash=h('f'),d=>d.transactions[0].blockHeight=97,d=>d.transactions.push(structuredClone(d.transactions[0])),d=>d.mempool.transactions[0].txid=d.transactions[0].txid,d=>d.coverage.blocksScanned=4,d=>d.coverage.oldestHeight=101,d=>d.coverage.transactionLimit=1000]) {
    const data=fixture(); edit(data); assert.throws(()=>validateTransactionsPayload(data,now));
  }
});
test('new validated reorg snapshots can move to a lower tip without retaining orphaned rows', () => {
  const before=validateTransactionsPayload(fixture(),now),after=fixture();
  after.chain.height=99;after.chain.hash=h('d');after.coverage.oldestHeight=97;
  after.transactions[0].blockHeight=99;after.transactions[0].blockHash=h('d');after.transactions[0].txid=h('e');
  const current=validateTransactionsPayload(after,now);
  assert.equal(current.chain.height,99);assert.notEqual(current.transactions[0].txid,before.transactions[0].txid);assert.equal(current.transactions[0].confirmations,1);
});
test('partial outputs preserve full visible total but cannot exceed it; complete outputs must reconcile', () => {
  const partial=fixture();partial.transactions[0].outputs.pop();partial.transactions[0].outputsTruncated=true;
  assert.equal(validateTransactionsPayload(partial,now).transactions[0].transparentOutputZat,'100000001');
  for (const edit of [d=>d.transactions[0].outputs[0].amountZat='100000002',d=>d.transactions[0].transparentOutputZat='100000000',d=>d.transactions[0].outputs[1].n=0,d=>d.transactions[0].outputs[1].n=2,d=>d.transactions[0].transparentOutputZat=100000001,d=>d.transactions[0].transparentOutputCount=3]) {
    const data=fixture();edit(data);assert.throws(()=>validateTransactionsPayload(data,now));
  }
});
test('malformed IDs, addresses, timestamps and unrelated source URLs are rejected before rendering', () => {
  for (const edit of [d=>d.source='https://evil.example/feed',d=>d.transactions[0].txid='<img src=x>',d=>d.transactions[0].outputs[0].addresses=['javascript:alert(1)'],d=>d.generatedAt='2026-09-13T23:00:00Z',d=>d.observedAt='today',d=>d.transactions[0].blockAt='<script>',d=>d.mempool.transactions[0].localNodeSeenAt='2026-09-13T23:00:00Z',d=>d.mempool.transactions[0].sizeBytes=-1,d=>d.node.connections=1.2]) {
    const data=fixture();edit(data);assert.throws(()=>validateTransactionsPayload(data,now));
  }
});
test('mempool zero and unavailable remain distinct; truncation and total counts must agree', () => {
  const empty=fixture();empty.mempool.total=0;empty.mempool.transactions=[];
  assert.equal(validateTransactionsPayload(empty,now).mempool.total,0);
  const missing=fixture();missing.mempool=null;assert.throws(()=>validateTransactionsPayload(missing,now));
  assert.equal(validateTransactionsPayload(unavailable(),now).mempool,null);
  for(const edit of [d=>d.mempool.total=0,d=>d.mempool.total=2,d=>d.mempool.limit=500,d=>d.mempool.transactions.push(structuredClone(d.mempool.transactions[0]))]) {
    const data=fixture();edit(data);assert.throws(()=>validateTransactionsPayload(data,now));
  }
});
test('staleness uses both export and website observation age, and failed refresh marks retained data stale', () => {
  const data=fixture();assert.equal(transactionState(data,now),'ok');assert.equal(transactionState(data,now,true),'stale');assert.equal(transactionState(data,now+80001),'stale');
  data.generatedAt='2026-09-12T23:00:00Z';data.observedAt='2026-09-12T22:58:00Z';assert.equal(transactionState(data,now),'stale');
  const syncing=fixture();syncing.node.synced=false;assert.equal(transactionState(syncing,now),'syncing');
  const disconnected=fixture();disconnected.node.connections=0;assert.equal(transactionState(disconnected,now),'disconnected');
  assert.equal(transactionState(null,now),'unavailable');assert.equal(transactionState(unavailable(),now),'unavailable');
});
test('unavailable snapshots cannot smuggle measurements or pretend to contain an empty active chain', () => {
  const data=unavailable();data.chain=fixture().chain;assert.throws(()=>validateTransactionsPayload(data,now));
  const other=unavailable();other.transactions=fixture().transactions;assert.throws(()=>validateTransactionsPayload(other,now));
});
