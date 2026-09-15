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
export const BRIDGE_FEE_POLICY='2026-09-15-v1';
export function formatBridgeSol(value,language='en'){
  if(!isBridgeUnits(value))return null;
  const units=BigInt(value),fraction=(units%1000000000n).toString().padStart(9,'0').replace(/0+$/,'');
  return (units/1000000000n).toString()+(fraction?(language==='es'?',':'.')+fraction:'');
}
export function bridgePercentageFee(value){return isBridgeUnits(value)?((BigInt(value)*10n+9999n)/10000n).toString():null;}
function decimalRatio(value){
  if(typeof value!=='string'||value.length>64||!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value))return null;
  const [whole,fraction='']=value.split('.'),numerator=BigInt(whole+fraction);
  return numerator>0n?{numerator,denominator:10n**BigInt(fraction.length)}:null;
}
export function bridgeDepositFeeLamports(amountZat,rate){
  if(!isBridgeUnits(amountZat))return null;
  const zcl=decimalRatio(rate?.zclPrice),sol=decimalRatio(rate?.solPrice);if(!zcl||!sol)return null;
  const top=BigInt(amountZat)*zcl.numerator*sol.denominator*10n*1000000000n,bottom=100000000n*sol.numerator*zcl.denominator*10000n;
  return ((top+bottom-1n)/bottom).toString();
}
function timestamp(value){return typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)?Date.parse(value):NaN;}
function stable(value){
  if(Array.isArray(value))return '['+value.map(stable).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}';
  return JSON.stringify(value);
}
export function sameBridgeQuote(left,right){return !!left&&!!right&&stable(left)===stable(right);}
export function validBridgeQuote(value,{kind,amountZat,now=Date.now(),allowExpired=false}={}){
  if(!value||! /^[a-f0-9]{32}$/.test(value.quoteId??'')||value.policyVersion!==BRIDGE_FEE_POLICY||
    !['deposit','redemption'].includes(value.kind)||(kind&&value.kind!==kind)||(amountZat&&value.amountZat!==amountZat)||value.feeBps!==10||
    ![value.amountZat,value.feeLamports,value.feeZat,value.networkFeeZat,value.netAmountZat].every(field=>isBridgeUnits(field)&&BigInt(field)<=18446744073709551615n)||BigInt(value.amountZat)===0n||BigInt(value.netAmountZat)===0n)return false;
  const created=timestamp(value.createdAt),expires=timestamp(value.expiresAt);
  if(!Number.isFinite(created)||!Number.isFinite(expires)||expires<=created||expires-created>300000||created>now+30000||(!allowExpired&&now>=expires))return false;
  if(value.kind==='redemption')return value.feeAsset==='ZCL'&&value.feeRecipient===null&&value.rate===undefined&&value.feeLamports==='0'&&value.feeZat===bridgePercentageFee(value.amountZat)&&value.networkFeeZat==='10000'&&
    BigInt(value.amountZat)-BigInt(value.feeZat)-BigInt(value.networkFeeZat)===BigInt(value.netAmountZat);
  const rate=value.rate;
  if(!rate||rate.source!=='NonKYC'||rate.quoteCurrency!=='USDT'||
    rate.zclUrl!=='https://api.nonkyc.io/api/v2/market/getbysymbol/ZCL_USDT'||rate.solUrl!=='https://api.nonkyc.io/api/v2/market/getbysymbol/SOL_USDT'||
    !['observedAt','zclUpdatedAt','solUpdatedAt','zclLastTradeAt','solLastTradeAt'].every(key=>Number.isFinite(timestamp(rate[key]))&&timestamp(rate[key])<=created+30000))return false;
  if(created-timestamp(rate.observedAt)>60000||['zclUpdatedAt','solUpdatedAt'].some(key=>created-timestamp(rate[key])>180000)||['zclLastTradeAt','solLastTradeAt'].some(key=>created-timestamp(rate[key])>900000))return false;
  return value.feeAsset==='SOL'&&isSolanaPublicAddress(value.feeRecipient)&&BigInt(value.feeLamports)>0n&&value.feeLamports===bridgeDepositFeeLamports(value.amountZat,rate)&&value.feeZat==='0'&&value.networkFeeZat==='0'&&value.netAmountZat===value.amountZat;
}
export function validBridgeStatus(value,now=Date.now()){
  if(!value||![1,2].includes(value.schemaVersion)||value.environment!=='testnet'||value.zclNetwork!=='regtest'||
    value.solanaNetwork!=='devnet'||value.tokenSymbol!=='wZCL-TEST'||value.decimals!==8||
    typeof value.acceptingDeposits!=='boolean'||typeof value.acceptingRedemptions!=='boolean'||
    typeof value.faucetEnabled!=='boolean'||
    ![value.minimumZat,value.maximumZat].every(isBridgeUnits)||
    ![value.depositConfirmations,value.redemptionConfirmations].every(n=>Number.isSafeInteger(n)&&n>0)||
    !(value.mint===null||isSolanaPublicAddress(value.mint))||
    typeof value.generatedAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value.generatedAt))return false;
  const age=now-Date.parse(value.generatedAt);
  if(!Number.isFinite(age)||age< -60000||age>=90000)return false;
  const fees=value.schemaVersion===2?typeof value.processingAvailable==='boolean'&&value.depositFeeBps===10&&value.redemptionFeeBps===10&&value.depositFeeAsset==='SOL'&&value.redemptionFeeAsset==='ZCL'&&value.feePolicyVersion===BRIDGE_FEE_POLICY:
    [value.depositFeeZat,value.redemptionFeeZat].every(isBridgeUnits)&&BigInt(value.depositFeeZat)<BigInt(value.maximumZat)&&BigInt(value.redemptionFeeZat)<BigInt(value.maximumZat);
  return fees&&BigInt(value.minimumZat)>0n&&BigInt(value.maximumZat)>=BigInt(value.minimumZat)&&
    (!(value.acceptingDeposits||value.acceptingRedemptions)||value.mint!==null);
}
const operationStates={
  deposit:['preparing','awaiting_deposit','faucet_prepared','faucet_submitted','confirming','awaiting_mint_signature','mint_prepared','mint_submitted','completed','failed','needs_review'],
  redemption:['preparing','awaiting_signature','burn_prepared','burn_submitted','burn_confirmed','withdrawal_prepared','withdrawal_submitted','completed','failed','needs_review','expired'],
};
export function validBridgeOperation(value){
  if(!value||typeof value.id!=='string'||! /^[a-f0-9]{32}$/.test(value.id)||
    !Array.isArray(operationStates[value.kind])||!operationStates[value.kind].includes(value.state)||
    !isBridgeUnits(value.amountZat)||BigInt(value.amountZat)===0n)return false;
  if(value.kind==='deposit'&&(!isSolanaPublicAddress(value.recipient)||(value.state!=='preparing'&&!isRegtestAddressFormat(value.depositAddress))))return false;
  if(value.kind==='redemption'&&(!isSolanaPublicAddress(value.owner)||!isRegtestAddressFormat(value.recipient)))return false;
  if(value.feeQuote!==undefined&&!validBridgeQuote(value.feeQuote,{kind:value.kind,amountZat:value.amountZat,allowExpired:true}))return false;
  if(value.state==='awaiting_mint_signature'&&(!value.feeQuote||typeof value.transactionBase64!=='string'||!value.transactionBase64))return false;
  if(value.state==='completed'){
    if(typeof value.solanaSignature!=='string'||! /^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(value.solanaSignature))return false;
    const txid=value.kind==='deposit'?value.depositTxid:value.withdrawalTxid;
    if(typeof txid!=='string'||! /^[a-f0-9]{64}$/i.test(txid))return false;
  }
  return true;
}
