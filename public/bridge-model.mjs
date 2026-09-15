// Exact eight-decimal amounts for the test interface. No network or wallet access.
const SCALE=100000000n;
export function parseBridgeAmount(value){
  if(typeof value!=='string')return {ok:false,reason:'invalid'};
  const text=value.trim();
  if(!text)return {ok:false,reason:'empty'};
  if(text.length>32)return {ok:false,reason:'invalid'};
  const match=/^(\d+)(?:[.,](\d{0,8}))?$/.exec(text);
  if(!match)return {ok:false,reason:'precision'};
  const units=BigInt(match[1])*SCALE+BigInt((match[2]||'').padEnd(8,'0'));
  if(units===0n)return {ok:false,reason:'positive'};
  return {ok:true,units:units.toString(),amount:formatBridgeAmount(units)};
}
export function formatBridgeAmount(value,language='en'){
  const units=typeof value==='bigint'?value:typeof value==='string'&&/^\d+$/.test(value)?BigInt(value):null;
  if(units===null||units<0n)return null;
  const whole=units/SCALE,fraction=(units%SCALE).toString().padStart(8,'0').replace(/0+$/,'');
  return whole.toString()+(fraction?(language==='es'?',':'.')+fraction:'');
}
export function bridgeDirection(value){return value==='redeem'?{from:'wZCL',to:'ZCL'}:{from:'ZCL',to:'wZCL'};}
export function isSolanaPublicAddress(value){
  if(typeof value!=='string'||! /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value))return false;
  const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let number=0n;for(const char of value)number=number*58n+BigInt(alphabet.indexOf(char));
  let bytes=0;while(number>0n){bytes++;number>>=8n;}
  return bytes+(value.match(/^1*/)?.[0].length||0)===32;
}
export function isRegtestAddressFormat(value){return typeof value==='string'&&/^(?:tm|t2)[1-9A-HJ-NP-Za-km-z]{33}$/.test(value);}
export function isBridgeUnits(value){return typeof value==='string'&&/^(?:0|[1-9]\d{0,23})$/.test(value);}
export function validBridgeStatus(value,now=Date.now()){
  if(!value||value.schemaVersion!==1||value.environment!=='testnet'||value.zclNetwork!=='regtest'||
    value.solanaNetwork!=='devnet'||value.tokenSymbol!=='wZCL-TEST'||value.decimals!==8||
    typeof value.acceptingDeposits!=='boolean'||typeof value.acceptingRedemptions!=='boolean'||
    typeof value.faucetEnabled!=='boolean'||
    ![value.minimumZat,value.maximumZat,value.depositFeeZat,value.redemptionFeeZat].every(isBridgeUnits)||
    ![value.depositConfirmations,value.redemptionConfirmations].every(n=>Number.isSafeInteger(n)&&n>0)||
    !(value.mint===null||isSolanaPublicAddress(value.mint))||
    typeof value.generatedAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value.generatedAt))return false;
  const age=now-Date.parse(value.generatedAt);
  if(!Number.isFinite(age)||age< -60000||age>=90000)return false;
  return BigInt(value.minimumZat)>0n&&BigInt(value.maximumZat)>=BigInt(value.minimumZat)&&
    BigInt(value.depositFeeZat)<BigInt(value.maximumZat)&&BigInt(value.redemptionFeeZat)<BigInt(value.maximumZat)&&
    (!(value.acceptingDeposits||value.acceptingRedemptions)||value.mint!==null);
}
const operationStates={
  deposit:['preparing','awaiting_deposit','faucet_prepared','faucet_submitted','confirming','mint_prepared','mint_submitted','completed','failed','needs_review'],
  redemption:['preparing','awaiting_signature','burn_prepared','burn_submitted','burn_confirmed','withdrawal_prepared','withdrawal_submitted','completed','failed','needs_review','expired'],
};
export function validBridgeOperation(value){
  if(!value||typeof value.id!=='string'||! /^[a-f0-9]{32}$/.test(value.id)||
    !Array.isArray(operationStates[value.kind])||!operationStates[value.kind].includes(value.state)||
    !isBridgeUnits(value.amountZat)||BigInt(value.amountZat)===0n)return false;
  if(value.kind==='deposit'&&(!isSolanaPublicAddress(value.recipient)||(value.state!=='preparing'&&!isRegtestAddressFormat(value.depositAddress))))return false;
  if(value.kind==='redemption'&&(!isSolanaPublicAddress(value.owner)||!isRegtestAddressFormat(value.recipient)))return false;
  if(value.state==='completed'){
    if(typeof value.solanaSignature!=='string'||! /^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(value.solanaSignature))return false;
    const txid=value.kind==='deposit'?value.depositTxid:value.withdrawalTxid;
    if(typeof txid!=='string'||! /^[a-f0-9]{64}$/i.test(txid))return false;
  }
  return true;
}
