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
import {validBridgeQuote,sameBridgeQuote,bridgePercentageFee,bridgeDepositFeeLamports,formatBridgeSol} from '../public/bridge-model.mjs';
import {feeConfig,quoteFixture} from './bridge-fee-fixtures.mjs';
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
test('v2 status requires the exact percentage policy and never substitutes old zero fee fields',()=>{
 assert.equal(validBridgeStatus(feeConfig()),true);
 for(const patch of [{depositFeeBps:0},{redemptionFeeBps:100},{depositFeeAsset:'ZCL'},{redemptionFeeAsset:'SOL'},{feePolicyVersion:'unknown'},{depositFeeBps:undefined,depositFeeZat:'0'},{processingAvailable:undefined},{processingAvailable:'true'},{processingAvailable:false},{mint:null,acceptingDeposits:false,acceptingRedemptions:false}])assert.equal(validBridgeStatus({...feeConfig(),...patch}),false);
});
test('quotes verify single-ceiling SOL conversion and exact ZCL fee/net arithmetic',()=>{
 assert.equal(bridgePercentageFee('1'),'1');assert.equal(bridgePercentageFee('100000001'),'100001');
 assert.equal(bridgeDepositFeeLamports('1',{zclPrice:'1',solPrice:'1'}),'1','round only final lamports, not a preliminary ZCL fee');
 assert.equal(bridgeDepositFeeLamports('100000001',{zclPrice:'0.39',solPrice:'130'}),'3001');
 assert.equal(formatBridgeSol('3001'),'0.000003001');assert.equal(formatBridgeSol('3001','es'),'0,000003001');
 for(const kind of ['deposit','redemption']){
  const quote=quoteFixture({kind,amountZat:'100000001'});assert.equal(validBridgeQuote(quote),true);
  for(const key of ['feeLamports','feeZat','networkFeeZat','netAmountZat'])assert.equal(validBridgeQuote({...quote,[key]:(BigInt(quote[key])+1n).toString()}),false,key);
  assert.equal(validBridgeQuote(quote,{kind:kind==='deposit'?'redemption':'deposit'}),false);assert.equal(validBridgeQuote(quote,{amountZat:'100000000'}),false);
 }
 const quote=quoteFixture();
 for(const patch of [{solPrice:'0'},{zclPrice:'NaN'},{zclPrice:'0.40'},{quoteCurrency:'USD'},{source:'unverified'},{solUrl:'https://example.com/price'}])assert.equal(validBridgeQuote({...quote,rate:{...quote.rate,...patch}}),false);
});
test('expired creation quotes fail closed while historical operation snapshots remain valid and immutable',()=>{
 const now=Date.parse('2026-09-15T18:00:00Z'),quote=quoteFixture({now});
 assert.equal(validBridgeQuote(quote,{now:now+299999}),true);assert.equal(validBridgeQuote(quote,{now:now+300000}),false);
 assert.equal(validBridgeQuote({...quote,expiresAt:new Date(now+300001).toISOString()},{now}),false);
 assert.equal(validBridgeQuote(quote,{now:now+86400000,allowExpired:true}),true);
 const reordered=Object.fromEntries(Object.entries(quote).reverse());assert.equal(sameBridgeQuote(quote,reordered),true);assert.equal(sameBridgeQuote(quote,{...quote,quoteId:'f'.repeat(32)}),false);
 const historical=quoteFixture({now:Date.now()-86400000});
 const op={id:'a'.repeat(32),kind:'deposit',state:'awaiting_mint_signature',recipient:publicKey,depositAddress:regtest,amountZat:historical.amountZat,feeQuote:historical,transactionBase64:'fixture'};
 assert.equal(validBridgeOperation(op),true);assert.equal(validBridgeOperation({...op,feeQuote:undefined}),false);assert.equal(validBridgeOperation({...op,feeQuote:{...quote,feeLamports:'1'}}),false);
});
test('historical quote rates must have been fresh when accepted, and redemption snapshots cannot add a SOL recipient',()=>{
 const now=Date.now(),quote=quoteFixture({now:now-86400000});
 for(const [key,maxAge]of [['observedAt',60000],['zclUpdatedAt',180000],['solUpdatedAt',180000],['zclLastTradeAt',900000],['solLastTradeAt',900000]]){
  const changed={...quote,rate:{...quote.rate,[key]:new Date(Date.parse(quote.createdAt)-maxAge-1).toISOString()}};
  assert.equal(validBridgeQuote(changed,{now,allowExpired:true}),false,key);
 }
 assert.equal(validBridgeQuote(quoteFixture({now:now+30001}),{now,allowExpired:true}),false);
 const redemption=quoteFixture({kind:'redemption'});assert.equal(validBridgeQuote({...redemption,feeRecipient:publicKey}),false);assert.equal(validBridgeQuote({...redemption,rate:null}),false);
});
