import test from 'node:test';
import assert from 'node:assert/strict';
import {parseBridgeAmount,formatBridgeAmount,bridgeDirection} from '../public/bridge-model.mjs';
test('bridge amount preview preserves eight decimals and values beyond Number integer precision',()=>{
  for(const [text,units] of [['0.00000001','1'],['1.23456789','123456789'],['1,23456789','123456789'],['90071992.54740993','9007199254740993']]){
    const parsed=parseBridgeAmount(text);assert.equal(parsed.ok,true);assert.equal(parsed.units,units);
  }
  assert.equal(formatBridgeAmount('9007199254740993'),'90071992.54740993');
  assert.equal(formatBridgeAmount('123456789','es'),'1,23456789');
});
test('bridge preview rejects nonpositive, ambiguous, nondecimal and overprecise amounts',()=>{
  for(const text of ['','0','0.00000000','-1','1e3','1,234.5','0.000000001','NaN','Infinity','1'.repeat(33)])assert.equal(parseBridgeAmount(text).ok,false,text);
  assert.equal(parseBridgeAmount(null).ok,false);
  assert.equal(parseBridgeAmount('0002.50000000').amount,'2.5');
  assert.equal(formatBridgeAmount('-1'),null);
});
test('deposit and redemption previews keep source and destination distinct',()=>{
  assert.deepEqual(bridgeDirection('deposit'),{from:'ZCL',to:'wZCL'});
  assert.deepEqual(bridgeDirection('redeem'),{from:'wZCL',to:'ZCL'});
});

import {isSolanaPublicAddress,isRegtestAddressFormat,validBridgeStatus,validBridgeOperation} from '../public/bridge-model.mjs';
const publicKey='11111111111111111111111111111111';
const regtest='tm'+'1'.repeat(33);
const status=()=>({schemaVersion:1,environment:'testnet',zclNetwork:'regtest',solanaNetwork:'devnet',tokenSymbol:'wZCL-TEST',decimals:8,mint:publicKey,acceptingDeposits:true,acceptingRedemptions:true,minimumZat:'1000000',maximumZat:'1000000000',depositConfirmations:6,redemptionConfirmations:6,depositFeeZat:'0',redemptionFeeZat:'0',faucetEnabled:true,generatedAt:new Date().toISOString()});
test('only explicit complete regtest/devnet configuration can enable test bridge actions',()=>{
  assert.equal(validBridgeStatus(status()),true);
  for(const [key,value] of [['environment','mainnet'],['zclNetwork','main'],['solanaNetwork','mainnet-beta'],['decimals',9],['tokenSymbol','wZCL'],['mint',null],['acceptingDeposits','true'],['minimumZat','0'],['maximumZat','1'],['depositConfirmations',0],['redemptionFeeZat','-1']])
    assert.equal(validBridgeStatus({...status(),[key]:value}),false,key);
  assert.equal(validBridgeStatus({...status(),mint:null,acceptingDeposits:false,acceptingRedemptions:false}),true,'a paused deployment may have no published mint');
});
test('test configuration requires a dated recent observation and rejects stale or inconsistent future data',()=>{
  const now=Date.parse('2026-09-15T12:00:00Z');
  for(const offset of [-89999,0,60000])assert.equal(validBridgeStatus({...status(),generatedAt:new Date(now+offset).toISOString()},now),true);
  for(const value of [undefined,null,123,'not-a-date','2026-09-15',new Date(now-90000).toISOString(),new Date(now+60001).toISOString()])
    assert.equal(validBridgeStatus({...status(),generatedAt:value},now),false,String(value));
});
test('public address format filters reject obvious wrong networks without claiming checksum validation',()=>{
  assert.equal(isSolanaPublicAddress(publicKey),true);
  assert.equal(isSolanaPublicAddress('1'.repeat(31)),false);
  assert.equal(isSolanaPublicAddress('1'.repeat(33)),false);
  assert.equal(isSolanaPublicAddress('0'.repeat(44)),false);
  assert.equal(isRegtestAddressFormat(regtest),true);
  assert.equal(isRegtestAddressFormat('t2'+'1'.repeat(33)),true);
  assert.equal(isRegtestAddressFormat('t1'+'1'.repeat(33)),false);
  assert.equal(isRegtestAddressFormat('t3'+'1'.repeat(33)),false);
});
test('operation states never invent completion or accept unrelated account fields',()=>{
  const op={id:'a'.repeat(32),kind:'deposit',state:'awaiting_deposit',recipient:publicKey,amountZat:'100000000',depositAddress:regtest};
  assert.equal(validBridgeOperation(op),true);
  for(const changed of [{kind:'redemption'},{state:'burn_confirmed'},{state:'completed'},{kind:'__proto__'},{id:'../../../other'},{amountZat:'-1'}])
    assert.equal(validBridgeOperation({...op,...changed}),false);
  assert.equal(validBridgeOperation({...op,state:'completed',depositTxid:'b'.repeat(64),solanaSignature:'2'.repeat(88)}),true);
  const redemption={...op,kind:'redemption',owner:publicKey,recipient:regtest,state:'awaiting_signature'};
  assert.equal(validBridgeOperation(redemption),true);
  assert.equal(validBridgeOperation({...redemption,state:'completed',solanaSignature:'2'.repeat(88)}),false);
  assert.equal(validBridgeOperation({...redemption,state:'completed',solanaSignature:'2'.repeat(88),withdrawalTxid:'c'.repeat(64)}),true);
  assert.equal(validBridgeOperation({...redemption,state:'expired'}),true);
  assert.equal(validBridgeOperation({...op,state:'expired'}),false,'only an unsigned redemption quote can expire');
});
