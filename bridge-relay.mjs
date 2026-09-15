const unavailable=()=>({schemaVersion:1,environment:'testnet',zclNetwork:'regtest',solanaNetwork:'devnet',tokenSymbol:'wZCL-TEST',decimals:8,mint:null,acceptingDeposits:false,acceptingRedemptions:false,minimumZat:'1000000',maximumZat:'1000000000',depositConfirmations:6,redemptionConfirmations:6,depositFeeZat:'0',redemptionFeeZat:'0',faucetEnabled:false,reason:'Test bridge is being prepared; deposits and redemptions are not open.',generatedAt:new Date().toISOString()});
function readUpload(req,timeoutMs){
 return new Promise((resolve,reject)=>{
  let size=0,finished=false;const chunks=[];
  const finish=(code)=>{
   if(finished)return;finished=true;clearTimeout(timer);
   req.removeListener('data',data);req.removeListener('end',end);req.removeListener('error',fail);
   req.removeListener('aborted',fail);req.removeListener('close',closed);
   if(code){req.pause();reject(code);}else resolve(Buffer.concat(chunks));
  };
  const data=chunk=>{size+=chunk.length;if(size>12000)finish(413);else chunks.push(chunk);};
  const end=()=>finish(),fail=()=>finish(400),closed=()=>{if(!req.readableEnded)fail();};
  const timer=setTimeout(()=>finish(408),timeoutMs);
  req.on('data',data).on('end',end).on('error',fail).on('aborted',fail).on('close',closed);
  if(req.destroyed||req.aborted)fail();
 });
}
export function createBridgeRelay({endpoint=process.env.BRIDGE_TESTNET_URL,fetcher=fetch,uploadTimeoutMs=10000}={}){
 if(endpoint&&endpoint!=='https://bridge-testnet.zclthesis.com')throw Error('Unexpected test bridge endpoint');
 if(!Number.isInteger(uploadTimeoutMs)||uploadTimeoutMs<1||uploadTimeoutMs>10000)throw Error('Invalid upload deadline');
 return async(req,res)=>{
  const url=new URL(req.url,'https://zclthesis.com');
  res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');
  const send=(code,body)=>{res.writeHead(code);res.end(req.method==='HEAD'?undefined:JSON.stringify(body));};
  const path=url.pathname.slice('/api/bridge'.length);
  if(!['GET','HEAD','POST'].includes(req.method)){res.setHeader('Allow','GET, HEAD, POST');send(405,{error:'Method not allowed'});return;}
  if(!/^\/(?:status|wallet|deposits|redemptions|test-address|operations\/[a-f0-9]{32}|deposits\/[a-f0-9]{32}\/faucet|redemptions\/[a-f0-9]{32}\/submit)$/.test(path)){send(404,{error:'Unknown bridge endpoint'});return;}
  const post=req.method==='POST';
  if(post&&(req.headers.origin!=='https://zclthesis.com'||!/^application\/json(?:;|$)/i.test(req.headers['content-type']??''))){send(403,{error:'Use the ZCL Thesis test bridge page'});return;}
  if(!endpoint){send(path==='/status'&&!post?200:503,path==='/status'&&!post?unavailable():{error:'The test bridge is not open yet'});return;}
  let payload;
  if(post){try{payload=await readUpload(req,uploadTimeoutMs);}catch(code){
   // Finish the error response before closing an incomplete upload's socket.
   // No partial body reaches the bridge and no mutation is retried here.
   res.setHeader('Connection','close');res.once?.('finish',()=>req.destroy());
   send(code,{error:code===408?'Request upload timed out; nothing was forwarded':code===413?'Request too large':'The request body could not be read'});
   return;
  }}
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
  try{
   const target=new URL(path+url.search,endpoint);
   const response=await fetcher(target,{method:req.method==='HEAD'?'GET':req.method,headers:{'Content-Type':'application/json',Origin:'https://zclthesis.com'},body:payload,redirect:'error',signal:controller.signal});
   const reader=response.body.getReader();let size=0;const chunks=[];
   for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>131072){controller.abort();throw Error('Oversized bridge response');}chunks.push(value);}
   const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));send(response.status,data);
  }catch{send(503,{error:'Test bridge temporarily unavailable; check your existing operation before retrying'});}finally{clearTimeout(timer);}
 };
}
