import http from 'node:http';
import {createLiveData} from './live-data.mjs';
const getLiveData=createLiveData();
import {createMarketComparison} from './market-comparison.mjs';
import {createNetworkData} from './network-data.mjs';
import {createRichListStore,createRichListComparison} from './richlist-feeds.mjs';
const getComparison=createMarketComparison();
const getNetworkData=createNetworkData();
const getRichList=await createRichListStore();
const getRichListComparison=createRichListComparison({getZcl:getRichList});
import {readFile} from 'node:fs/promises';
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/es', ['es/index.html', 'text/html; charset=utf-8']],
  ['/es/', ['es/index.html', 'text/html; charset=utf-8']],
  ['/es/index.html', ['es/index.html', 'text/html; charset=utf-8']],
  ['/network', ['network/index.html', 'text/html; charset=utf-8']],
  ['/network/', ['network/index.html', 'text/html; charset=utf-8']],
  ['/network/index.html', ['network/index.html', 'text/html; charset=utf-8']],
  ['/es/network', ['es/network/index.html', 'text/html; charset=utf-8']],
  ['/es/network/', ['es/network/index.html', 'text/html; charset=utf-8']],
  ['/es/network/index.html', ['es/network/index.html', 'text/html; charset=utf-8']],
  ['/network.js', ['network.js', 'text/javascript; charset=utf-8']],
  ['/network.css', ['network.css', 'text/css; charset=utf-8']],
  ['/language.js', ['language.js', 'text/javascript; charset=utf-8']],
  ['/live.js', ['live.js', 'text/javascript; charset=utf-8']],
  ['/comparison.js', ['comparison.js', 'text/javascript; charset=utf-8']],
  ['/comparison.css', ['comparison.css', 'text/css; charset=utf-8']],
  ['/richlist.js', ['richlist.js', 'text/javascript; charset=utf-8']],
  ['/richlist.css', ['richlist.css', 'text/css; charset=utf-8']],
  ['/richlist-comparison.js', ['richlist-comparison.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/offline-wallet.html', ['offline-wallet.html', 'text/html; charset=utf-8']],
  ['/offline-wallet.sha256', ['offline-wallet.sha256', 'text/plain; charset=utf-8']],
]);
const assets = new Map(await Promise.all([...files].map(async ([url,[file,type]]) =>
  [url, {body:await readFile(new URL(`./public/${file}`, import.meta.url)), type}])));
http.createServer(async (req,res) => {
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
  if (!['GET','HEAD'].includes(req.method)) {res.writeHead(405,{'Allow':'GET, HEAD'});res.end();return;}
  let path;
  try { path = new URL(req.url,'http://localhost').pathname; } catch {res.writeHead(400);res.end();return;}
  if(path==='/api/richlist') {
    const richList=await getRichList();
    res.setHeader('Content-Type','application/json; charset=utf-8');
    if(!richList){res.writeHead(503,{'Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:'{"status":"unavailable"}');return;}
    res.setHeader('Cache-Control','public, max-age=300');
    res.setHeader('Vary','Accept-Encoding');
    res.setHeader('ETag',richList.etag);
    if(req.headers['if-none-match']===richList.etag){res.writeHead(304);res.end();return;}
    const gzip=(req.headers['accept-encoding']||'').split(',').some(value=>/^gzip(?:\s*;\s*q=(?:1(?:\.0*)?|0\.[0-9]*[1-9][0-9]*))?$/i.test(value.trim()));
    const body=gzip?richList.gzip:richList.body;
    if(gzip)res.setHeader('Content-Encoding','gzip');
    res.setHeader('Content-Length',body.length);
    res.end(req.method==='HEAD'?undefined:body);
    return;
  }
  if(path==='/api/live'||path==='/api/comparison'||path==='/api/richlist-comparison'||path==='/api/network') {
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Type','application/json; charset=utf-8');
    if(req.method==='HEAD'){res.end();return;}
    try {res.end(JSON.stringify(await (path==='/api/network'?getNetworkData():path==='/api/comparison'?getComparison():path==='/api/richlist-comparison'?getRichListComparison():getLiveData())));} catch {res.writeHead(503);res.end(JSON.stringify({error:'Data temporarily unavailable'}));}
    return;
  }
  const asset = assets.get(path);
  if (!asset) {res.writeHead(404,{'Content-Type':'text/plain'});res.end(req.method==='HEAD'?undefined:'Not found');return;}
  if(path==='/offline-wallet.html') res.setHeader('Content-Disposition','attachment; filename="zcl-offline-wallet.html"');
  if(path==='/offline-wallet.sha256') res.setHeader('Content-Disposition','attachment; filename="zcl-offline-wallet.sha256"');
  res.writeHead(200,{'Content-Type':asset.type,'Cache-Control':'public, max-age=300'});
  res.end(req.method==='HEAD'?undefined:asset.body);
}).listen(Number(process.env.PORT || 8080),'0.0.0.0',()=>console.log('myzclthesis listening'));
