import {parseBridgeAmount,formatBridgeAmount,bridgeDirection,isSolanaPublicAddress,isRegtestAddressFormat,isBridgeUnits,validBridgeStatus,validBridgeOperation} from './bridge-model.mjs';
const es=document.documentElement.lang==='es',$=id=>document.getElementById(id),say=(en,sp)=>es?sp:en;
const api='/api/bridge',operationStorage='zcl-test-bridge-operation';
let direction='deposit',config=null,checkedAt=0,checkedMonotonic=0,checkedAge=0,busy=false,wallet=null,operation=null,polling=false,refreshing=false,revision=0;
let requestIdentity=null,signedOperation=null;
let releasedOperationId=null;
const amount=value=>formatBridgeAmount(value,es?'es':'en');
const online=()=>navigator.onLine!==false;
const fresh=()=>config&&online()&&checkedAge+performance.now()-checkedMonotonic<90000;
const activeOperation=()=>operation&&operation.id!==releasedOperationId&&!['completed','failed','expired'].includes(operation.state);
const errorText=()=>say('The request could not be verified. Check the test service and retry; no completion is assumed.','No se pudo verificar la solicitud. Comprueba el servicio de prueba y reintenta; no se da por completada.');
function showError(text=errorText()){$('bridge-action-reason').textContent=text;}
async function request(path,{method='GET',body}={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),method==='GET'?8000:30000);
  try{
    const response=await fetch(api+path,{method,signal:controller.signal,cache:'no-store',credentials:'omit',
      headers:body===undefined?{Accept:'application/json'}:{Accept:'application/json','Content-Type':'application/json'},
      ...(body===undefined?{}:{body:JSON.stringify(body)})});
    if(!response.ok)throw new Error('HTTP '+response.status);
    return await response.json();
  }finally{clearTimeout(timer);}
}
function canSubmit(){
  const parsed=parseBridgeAmount($('bridge-amount').value),recipient=$('bridge-recipient').value.trim();
  if(!fresh()||busy||activeOperation()||!parsed.ok)return false;
  if(BigInt(parsed.units)<BigInt(config.minimumZat)||BigInt(parsed.units)>BigInt(config.maximumZat))return false;
  if(BigInt(parsed.units)<=BigInt(direction==='deposit'?config.depositFeeZat:config.redemptionFeeZat))return false;
  return direction==='deposit'?config.acceptingDeposits&&isSolanaPublicAddress(recipient):
    config.acceptingRedemptions&&isRegtestAddressFormat(recipient)&&!!wallet;
}
function actionReason(){
  if(!fresh())return say('Actions are paused until a fresh testnet configuration is verified.','Las acciones están en pausa hasta verificar una configuración reciente de testnet.');
  if(busy)return say('Waiting for the requested action…','Esperando la acción solicitada…');
  if(activeOperation())return say('Finish the current test transfer below before starting another.','Finaliza la transferencia de prueba actual antes de iniciar otra.');
  if(!(direction==='deposit'?config.acceptingDeposits:config.acceptingRedemptions))return say('This test direction is currently paused.','Esta dirección de prueba está en pausa.');
  const parsed=parseBridgeAmount($('bridge-amount').value);
  if(!parsed.ok)return say('Enter a positive test amount.','Introduce un importe de prueba positivo.');
  if(BigInt(parsed.units)<BigInt(config.minimumZat)||BigInt(parsed.units)>BigInt(config.maximumZat))
    return say('Test amount must be between ','El importe de prueba debe estar entre ')+amount(config.minimumZat)+' – '+amount(config.maximumZat)+' ZCL.';
  if(direction==='redeem'&&!wallet)return say('Connect the devnet wallet holding your test tokens.','Conecta la wallet de devnet que contiene tus tokens de prueba.');
  const recipient=$('bridge-recipient').value.trim();
  if(!(direction==='deposit'?isSolanaPublicAddress(recipient):isRegtestAddressFormat(recipient)))
    return direction==='deposit'?say('Enter a public Solana receiving address or connect a test wallet.','Introduce una dirección pública de Solana o conecta una wallet de prueba.'):
      say('Enter a regtest tm… or t2… address, or create a service-managed test address.','Introduce una dirección de regtest tm… o t2…, o crea una dirección de prueba gestionada por el servicio.');
  return say('Test assets only. You will review each transaction step.','Solo activos de prueba. Revisarás cada paso de la transacción.');
}
function controls(){
  $('bridge-action').disabled=!canSubmit();
  $('bridge-wallet-connect').disabled=!fresh()||busy;
  $('bridge-create-address').disabled=!fresh()||busy||activeOperation()||!config?.acceptingRedemptions;
  $('bridge-faucet').disabled=!fresh()||busy||!config?.faucetEnabled||!config?.acceptingDeposits||operation?.kind!=='deposit'||operation?.state!=='awaiting_deposit';
  $('bridge-sign').disabled=!fresh()||busy||!config?.acceptingRedemptions||!wallet||operation?.owner!==wallet.address||operation?.state!=='awaiting_signature';
  $('bridge-new-transfer').disabled=busy||polling||operation?.id===releasedOperationId||!['needs_review','expired'].includes(operation?.state);
  $('bridge-result-refresh').disabled=busy||polling||!online();$('bridge-status-refresh').disabled=refreshing||!online();
  $('bridge-amount').disabled=busy||!!activeOperation();$('bridge-recipient').disabled=busy||!!activeOperation();
  document.querySelectorAll('[name="bridge-direction"]').forEach(input=>input.disabled=busy||!!activeOperation());
  $('bridge-action-reason').textContent=actionReason();
}
function preview(){
  const assets=bridgeDirection(direction),parsed=parseBridgeAmount($('bridge-amount').value);
  $('bridge-input-asset').textContent=assets.from==='wZCL'?'wZCL-TEST':'ZCL';$('bridge-output-asset').textContent=assets.to==='wZCL'?'wZCL-TEST':'ZCL';
  $('bridge-gross-preview').textContent=parsed.ok?amount(parsed.units):'—';
  const invalid=!parsed.ok&&parsed.reason!=='empty';
  $('bridge-amount').setAttribute('aria-invalid',String(invalid));
  $('bridge-amount-error').textContent=invalid?say('Enter a positive amount with up to 8 decimal places.','Introduce un importe positivo con un máximo de 8 decimales.'):'';
  $('bridge-recipient-label').textContent=direction==='deposit'?say('Receiving Solana devnet address','Dirección de recepción en Solana devnet'):say('Receiving ZCL regtest address','Dirección de recepción de ZCL regtest');
  $('bridge-action').textContent=direction==='deposit'?say('Start test deposit','Iniciar depósito de prueba'):say('Prepare test redemption','Preparar canje de prueba');
  $('bridge-deposit-steps').hidden=direction!=='deposit';$('bridge-redeem-steps').hidden=direction!=='redeem';$('bridge-managed-address').hidden=direction!=='redeem';
  const fee=fresh()?(direction==='deposit'?config.depositFeeZat:config.redemptionFeeZat):null;
  $('bridge-fee').textContent=fee===null?'—':amount(fee)+' ZCL';
  $('bridge-net').textContent=fee!==null&&parsed.ok&&BigInt(parsed.units)>BigInt(fee)?amount((BigInt(parsed.units)-BigInt(fee)).toString())+' '+(assets.to==='wZCL'?'wZCL-TEST':'ZCL'):'—';
  controls();
}
function renderConfig(){
  const ready=fresh(),accepting=ready&&(config.acceptingDeposits||config.acceptingRedemptions);
  $('bridge-status-box').dataset.status=accepting?'ready':'paused';
  $('bridge-status').textContent=accepting?say('Test bridge available','Puente de prueba disponible'):say('Test bridge paused','Puente de prueba en pausa');
  $('bridge-status-detail').textContent=accepting?say('Verified test configuration: ZCL regtest and Solana devnet. No mainnet funds.','Configuración de prueba verificada: ZCL regtest y Solana devnet. Sin fondos de mainnet.'):
    say('Actions remain disabled until the test service publishes valid, available configuration.','Las acciones siguen desactivadas hasta que el servicio publique una configuración válida y disponible.');
  $('bridge-zcl-status').textContent=ready?'Regtest':say('Not verified','Sin verificar');
  $('bridge-solana-status').textContent=ready?'Devnet':say('Not verified','Sin verificar');
  $('bridge-mint').textContent=ready&&config.mint?config.mint:say('Not published','Sin publicar');
  $('bridge-backing').textContent=ready?(isBridgeUnits(config.backingZat)?amount(config.backingZat)+' ZCL':say('Not reported by service','El servicio no lo informa')):'—';
  if(!ready)$('bridge-wallet-balance').textContent=say('Test balances unavailable.','Saldos de prueba no disponibles.');
  $('bridge-confirmations').textContent=ready?String(config.depositConfirmations)+' / '+String(config.redemptionConfirmations):'—';
  $('bridge-limits').textContent=ready?amount(config.minimumZat)+' – '+amount(config.maximumZat)+' ZCL; '+say('fees ','comisiones ')+amount(config.depositFeeZat)+' / '+amount(config.redemptionFeeZat)+' ZCL':say('Not published','Sin publicar');
  $('bridge-observed').textContent=checkedAt?say('Service configuration checked at ','Configuración del servicio consultada a las ')+new Date(checkedAt).toISOString()+'. '+say('Confirmations and fees are listed as deposit / redemption. Balances are service-reported.','Las confirmaciones y comisiones se muestran como depósito / canje. El servicio informa los saldos.'):
    say('Waiting for a dated service observation.','Esperando una observación del servicio con fecha.');
  preview();
}
async function refreshConfig(){
  if(refreshing)return;refreshing=true;
  try{
    const next=await request('/status'),now=Date.now();if(!validBridgeStatus(next,now))throw new Error('Invalid test configuration');
    if(config?.mint!==next.mint)$('bridge-wallet-balance').textContent=say('Test balances unavailable.','Saldos de prueba no disponibles.');
    config=next;checkedAt=now;checkedMonotonic=performance.now();checkedAge=Math.max(0,now-Date.parse(next.generatedAt));
  }
  catch{config=null;}
  finally{refreshing=false;renderConfig();}
}
const stateText={
  preparing:['Preparing the test operation','Preparando la operación de prueba'],
  faucet_prepared:['Test faucet transfer prepared','Transferencia del faucet de prueba preparada'],
  faucet_submitted:['Test faucet transfer submitted to regtest','Transferencia del faucet enviada a regtest'],
  burn_prepared:['Signed test burn prepared for devnet','Quema de prueba firmada y preparada para devnet'],
  needs_review:['Operator review required; completion is not verified','Se requiere revisión del operador; la finalización no está verificada'],
  expired:['Unsigned devnet quote expired; request a new test redemption','La cotización de devnet sin firmar ha caducado; solicita un nuevo canje de prueba'],
  awaiting_deposit:['Awaiting test ZCL deposit','Esperando el depósito de ZCL de prueba'],
  confirming:['Verifying regtest confirmations','Verificando confirmaciones de regtest'],
  mint_prepared:['Test token issuance prepared','Emisión de tokens de prueba preparada'],
  mint_submitted:['Test token issuance submitted to devnet','Emisión de tokens de prueba enviada a devnet'],
  awaiting_signature:['Waiting for your devnet signature','Esperando tu firma en devnet'],
  burn_submitted:['Test token burn submitted to devnet','Quema de tokens de prueba enviada a devnet'],
  burn_confirmed:['Test token burn confirmed','Quema de tokens de prueba confirmada'],
  withdrawal_prepared:['Regtest release prepared','Liberación en regtest preparada'],
  withdrawal_submitted:['Regtest release submitted','Liberación en regtest enviada'],
  completed:['Test transfer completed','Transferencia de prueba completada'],failed:['Test transfer failed','La transferencia de prueba ha fallado'],
};
function transactionLine(label,value,solana=false){
  if(typeof value!=='string'||!(solana?/^[1-9A-HJ-NP-Za-km-z]{64,100}$/:/^[a-f0-9]{64}$/i).test(value))return;
  const p=document.createElement('p'),title=document.createElement('strong'),code=document.createElement('code');title.textContent=label;code.textContent=value;p.append(title,code);
  if(solana){const link=document.createElement('a');link.href='https://explorer.solana.com/tx/'+value+'?cluster=devnet';link.target='_blank';link.rel='noopener noreferrer';link.textContent=say('View on Solana devnet ↗','Ver en Solana devnet ↗');p.append(link);}
  $('bridge-transactions').append(p);
}
function setOperation(next){
  if(!validBridgeOperation(next))throw new Error('Invalid operation');
  if(operation&&activeOperation()&&operation.id!==next.id)throw new Error('Operation mismatch');
  if(operation?.id===next.id&&['kind','amountZat','recipient','owner','depositAddress'].some(key=>operation[key]!==undefined&&operation[key]!==next[key]))throw new Error('Operation identity changed');
  const terminalTransition=['completed','failed','expired'].includes(next.state)&&(operation?.id!==next.id||operation?.state!==next.state);
  const restoreExpired=next.state==='expired'&&terminalTransition&&next.id!==releasedOperationId;
  if(operation?.id!==next.id)releasedOperationId=null;
  operation=next;
  if(activeOperation()||restoreExpired){
    direction=next.kind==='deposit'?'deposit':'redeem';
    document.querySelectorAll('[name="bridge-direction"]').forEach(input=>input.checked=input.value===direction);
    $('bridge-amount').value=formatBridgeAmount(next.amountZat);$('bridge-recipient').value=next.recipient;
  }
  try{sessionStorage.setItem(operationStorage,next.id);}catch{}
  $('bridge-result').hidden=false;$('bridge-result-title').textContent=next.kind==='deposit'?say('Your test deposit','Tu depósito de prueba'):say('Your test redemption','Tu canje de prueba');
  $('bridge-result-status').textContent=stateText[next.state][es?1:0];
  $('bridge-result-detail').textContent=say('Test amount: ','Importe de prueba: ')+amount(next.amountZat)+' ZCL. '+say('Operation: ','Operación: ')+next.id+'. '+
    (next.state==='awaiting_signature'?say('Connect the matching devnet wallet, then review and sign.','Conecta la wallet de devnet correspondiente y después revisa y firma.'):'');
  $('bridge-deposit-address').hidden=next.kind!=='deposit'||!next.depositAddress;$('bridge-deposit-address').textContent=next.kind==='deposit'&&next.depositAddress?say('REGTEST ONLY: ','SOLO REGTEST: ')+next.depositAddress:'';
  $('bridge-faucet').hidden=next.kind!=='deposit'||next.state!=='awaiting_deposit';$('bridge-sign').hidden=next.kind!=='redemption'||next.state!=='awaiting_signature';$('bridge-result-refresh').hidden=false;
  $('bridge-new-transfer').hidden=!['needs_review','expired'].includes(next.state)||next.id===releasedOperationId;
  $('bridge-transactions').replaceChildren();transactionLine(say('Regtest deposit transaction','Transacción de depósito en regtest'),next.depositTxid);
  transactionLine(say('Solana devnet transaction','Transacción de Solana devnet'),next.solanaSignature,true);
  transactionLine(say('Regtest release transaction','Transacción de liberación en regtest'),next.withdrawalTxid);
  if(terminalTransition){if(next.id!==releasedOperationId){requestIdentity=null;signedOperation=null;}void refreshWallet();}
  preview();
}
async function pollOperation(){
  if(!operation||polling||busy||!online())return;polling=true;const id=operation.id,version=revision;controls();
  try{const next=await request('/operations/'+id);if(id!==next.id)throw new Error('Operation mismatch');if(version===revision&&operation?.id===id)setOperation(next);}
  catch{if(version===revision)$('bridge-result-status').textContent=say('Refresh unavailable; the last verified state is retained.','Actualización no disponible; se conserva el último estado verificado.');}
  finally{polling=false;controls();}
}
async function refreshWallet(){
  if(!wallet||!fresh())return;const address=wallet.address,mint=config.mint;
  try{
    const result=await request('/wallet?address='+encodeURIComponent(address));
    if(wallet?.address!==address)return;
    if(!fresh()||config.mint!==mint||result.owner!==address||result.mint!==mint||!isBridgeUnits(result.amountZat)||!isBridgeUnits(result.solLamports))throw Error('Test balance identity mismatch');
    const sol=BigInt(result.solLamports),fraction=(sol%1000000000n).toString().padStart(9,'0').replace(/0+$/,'');
    $('bridge-wallet-balance').textContent='wZCL-TEST: '+amount(result.amountZat)+' · SOL (devnet): '+(sol/1000000000n).toString()+(fraction?(es?',':'.')+fraction:'');
  }catch{if(wallet?.address===address)$('bridge-wallet-balance').textContent=say('Test balances unavailable.','Saldos de prueba no disponibles.');}
}
async function action(operationFn,failureMessage){
  if(busy||!fresh())return;busy=true;revision++;controls();
  let failure=false;
  try{await operationFn();}catch{failure=true;}
  finally{busy=false;preview();if(failure)showError(failureMessage);}
}
$('bridge-wallet-connect').addEventListener('click',()=>action(async()=>{
  const {connectTestWallet}=await import('./bridge-wallet.mjs?v=20260914-testnet');
  const connected=await connectTestWallet();if(!isSolanaPublicAddress(connected?.address))throw new Error('Invalid wallet address');
  wallet=connected;$('bridge-wallet-address').textContent=wallet.address;$('bridge-wallet-connect').textContent=say('Reconnect wallet','Reconectar wallet');
  if(direction==='deposit'&&!$('bridge-recipient').value.trim())$('bridge-recipient').value=wallet.address;
  await refreshWallet();
},say('Could not connect the test wallet. Install or enable Phantom or Solflare, then try again.','No se pudo conectar la wallet de prueba. Instala o activa Phantom o Solflare y reintenta.')));
$('bridge-create-address').addEventListener('click',()=>action(async()=>{
  const result=await request('/test-address',{method:'POST',body:{}});
  if(result.managed!==true||!isRegtestAddressFormat(result.address))throw new Error('Invalid test address');
  $('bridge-recipient').value=result.address;
}));
$('bridge-form').addEventListener('submit',event=>{
  event.preventDefault();if(!canSubmit())return;
  const parsed=parseBridgeAmount($('bridge-amount').value),recipient=$('bridge-recipient').value.trim(),kind=direction==='deposit'?'deposit':'redemption';
  const fields={recipient,amountZat:parsed.units,...(kind==='redemption'?{owner:wallet.address}:{})};
  const key=JSON.stringify({kind,...fields});if(requestIdentity?.key!==key)requestIdentity={key,id:crypto.randomUUID()};
  void action(async()=>{
    const next=await request(kind==='deposit'?'/deposits':'/redemptions',{method:'POST',body:{...fields,clientRequestId:requestIdentity.id}});
    if(next.kind!==kind||next.recipient!==recipient||next.amountZat!==parsed.units||(kind==='redemption'&&next.owner!==fields.owner))throw new Error('Intent mismatch');
    setOperation(next);
  });
});
$('bridge-faucet').addEventListener('click',()=>{
  if($('bridge-faucet').disabled||!operation)return;const id=operation.id;
  void action(async()=>{const next=await request('/deposits/'+id+'/faucet',{method:'POST',body:{}});if(next.id!==id)throw new Error('Operation mismatch');setOperation(next);});
});
$('bridge-sign').addEventListener('click',()=>{
  if($('bridge-sign').disabled||!operation||operation.owner!==wallet?.address)return;
  const expected={id:operation.id,owner:operation.owner,recipient:operation.recipient,amountZat:operation.amountZat,mint:config.mint};
  void action(async()=>{
    const {signTestTransaction}=await import('./bridge-wallet.mjs?v=20260914-testnet');
    if(signedOperation?.id!==expected.id){
      if(typeof operation.transactionBase64!=='string')throw new Error('Unsigned transaction unavailable');
      const base64=await signTestTransaction({transactionBase64:operation.transactionBase64,expectedMint:expected.mint,owner:expected.owner,amountZat:expected.amountZat,intentId:expected.id,zclDestination:expected.recipient});
      signedOperation={id:expected.id,base64};
    }
    if(!fresh()||config.mint!==expected.mint||wallet?.address!==expected.owner)throw new Error('Test configuration changed');
    const next=await request('/redemptions/'+expected.id+'/submit',{method:'POST',body:{signedTransactionBase64:signedOperation.base64}});
    if(next.id!==expected.id||next.owner!==expected.owner||next.recipient!==expected.recipient||next.amountZat!==expected.amountZat)throw new Error('Operation mismatch');
    setOperation(next);
  });
});
$('bridge-result-refresh').addEventListener('click',()=>void pollOperation());
$('bridge-new-transfer').addEventListener('click',()=>{
  if($('bridge-new-transfer').disabled||!operation)return;
  const note=document.createElement('p'),link=document.createElement('a');
  note.textContent=(operation.state==='needs_review'?say('Previous transfer still requires review; no completion or refund is assumed. ','La transferencia anterior aún requiere revisión; no se da por completada ni reembolsada. '):say('Previous unsigned quote expired. ','La cotización anterior sin firmar ha caducado. '))+amount(operation.amountZat)+' ZCL · '+operation.id+' ';
  link.href=api+'/operations/'+operation.id;link.target='_blank';link.rel='noopener noreferrer';link.textContent=say('Check previous operation ↗','Consultar la operación anterior ↗');
  note.append(link);$('bridge-previous-operations').append(note);$('bridge-previous-operations').hidden=false;
  releasedOperationId=operation.id;requestIdentity=null;signedOperation=null;revision++;
  $('bridge-new-transfer').hidden=true;preview();
});
$('bridge-status-refresh').addEventListener('click',()=>void refreshConfig());
document.querySelectorAll('[name="bridge-direction"]').forEach(input=>input.addEventListener('change',()=>{
  direction=input.value;$('bridge-recipient').value=direction==='deposit'&&wallet?wallet.address:'';preview();
}));
$('bridge-amount').addEventListener('input',preview);$('bridge-recipient').addEventListener('input',controls);
window.addEventListener('offline',()=>{config=null;renderConfig();});window.addEventListener('online',()=>void refreshConfig());
document.addEventListener('visibilitychange',()=>{if(!document.hidden){void refreshConfig();void pollOperation();}});
setInterval(()=>{if(!document.hidden)void refreshConfig();},30000);
setInterval(()=>{if(!document.hidden&&activeOperation())void pollOperation();if(!fresh())renderConfig();},5000);
preview();
void refreshConfig().then(async()=>{
  let id;try{id=sessionStorage.getItem(operationStorage);}catch{}
  if(!/^[a-f0-9]{32}$/.test(id||''))return;
  const version=revision;
  try{const next=await request('/operations/'+id);if(next.id!==id)throw new Error('Operation mismatch');if(version===revision&&!operation)setOperation(next);}catch{}
});
