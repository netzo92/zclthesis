import http from 'node:http';
import {createLiveData} from './live-data.mjs';
const getLiveData=createLiveData();
import {readFile} from 'node:fs/promises';
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/live.js', ['live.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
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
  if(path==='/api/live') {
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Type','application/json; charset=utf-8');
    if(req.method==='HEAD'){res.end();return;}
    try {res.end(JSON.stringify(await getLiveData()));} catch {res.writeHead(503);res.end(JSON.stringify({error:'Data temporarily unavailable'}));}
    return;
  }
  const asset = assets.get(path);
  if (!asset) {res.writeHead(404,{'Content-Type':'text/plain'});res.end(req.method==='HEAD'?undefined:'Not found');return;}
  res.writeHead(200,{'Content-Type':asset.type,'Cache-Control':'public, max-age=300'});
  res.end(req.method==='HEAD'?undefined:asset.body);
}).listen(Number(process.env.PORT || 8080),'0.0.0.0',()=>console.log('myzclthesis listening'));
