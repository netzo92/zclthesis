import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
const {validateNetworkPayload,buildNetworkView}=createRequire(import.meta.url)('../public/network.js');
const now=Date.parse('2026-09-12T06:00:00Z');
const fixture=()=>({schemaVersion:1,asset:'ZCL',source:'https://pool.zclthesis.com/api/node.json',status:'ok',generatedAt:new Date(now-10000).toISOString(),observedAt:new Date(now).toISOString(),chain:{height:3247900,hash:'a'.repeat(64),blockAt:new Date(now-60000).toISOString()},node:{synced:true,connections:8,verificationProgress:0.99999,softwareVersion:'/MagicBean:2.1.2-beta6/',bootstrapValidation:'anchored-fast-sync'},mining:{difficulty:110.123,networkSolps:12000}});
test('browser rejects malformed responses before displaying measurements',()=>{
  assert.equal(validateNetworkPayload(fixture()).chain.height,3247900);
  for(const change of [d=>d.source='https://example.org',d=>d.status='ready',d=>d.mining.networkSolps='12000',d=>d.chain.hash='<script>',d=>d.generatedAt='bad',d=>d.node.connections=NaN,d=>d.node.verificationProgress=1.5]){const d=fixture();change(d);assert.throws(()=>validateNetworkPayload(d));}
});
test('English and Spanish render equivalent measured values and provenance with localized copy',()=>{
  const en=buildNetworkView(fixture(),'en',now),es=buildNetworkView(fixture(),'es',now);
  assert.equal(en.status,'ok');assert.equal(es.status,'ok');assert.equal(en.height,'3,247,900');assert.equal(es.height,'3.247.900');
  assert.equal(en.solps,'12 kSol/s');assert.equal(es.solps,'12 kSol/s');assert.equal(en.hash,es.hash);
  assert.match(en.validation,/Anchored/);assert.match(es.validation,/anclada/);assert.match(es.title,/está al día/);
});
test('observations expire in the browser, failed refresh retains visible values and source times',()=>{
  const d=fixture(),stale=buildNetworkView(d,'en',now+181000),failed=buildNetworkView(d,'es',now,true);
  assert.equal(stale.status,'stale');assert.equal(failed.status,'stale');assert.equal(stale.height,'3,247,900');assert.equal(stale.generatedAt,d.generatedAt);
  d.chain.blockAt=new Date(now-3600000).toISOString();assert.equal(buildNetworkView(d,'en',now).status,'syncing');
  d.node.connections=0;assert.equal(buildNetworkView(d,'en',now).status,'disconnected');
});
test('unavailable and warmup do not manufacture measurements; measured zero is displayed',()=>{
  const empty=buildNetworkView(null,'es',now);assert.equal(empty.status,'unavailable');assert.equal(empty.height,'—');assert.equal(empty.progress,null);assert.equal(empty.solps,'—');
  const d=fixture();d.chain=null;d.node.connections=null;d.node.verificationProgress=null;d.mining={difficulty:null,networkSolps:null};
  const warmup=buildNetworkView(validateNetworkPayload(d),'en',now);assert.equal(warmup.status,'syncing');assert.equal(warmup.height,'—');assert.equal(warmup.progressText,'—');assert.equal(warmup.solps,'—');
  d.mining.networkSolps=0;assert.equal(buildNetworkView(d,'en',now).solps,'0 Sol/s');
});
test('network pages expose matching renderer targets and equivalent language/source routes',async()=>{
  const [en,es]=await Promise.all(['public/network/index.html','public/es/network/index.html'].map(p=>readFile(new URL('../'+p,import.meta.url),'utf8')));
  const targets=html=>[...html.matchAll(/id="(network-[^"]+)"/g)].map(m=>m[1]).sort();assert.deepEqual(targets(en),targets(es));
  for(const html of [en,es]){assert.match(html,/\/network\/\?lang=en/);assert.match(html,/\/es\/network\/\?lang=es/);assert.match(html,/id="network-height">—</);assert.match(html,/id="market-comparison"/);assert.match(html,/https:\/\/pool.zclthesis.com\/api\/node.json/);assert.match(html,/href="\/api\/network"/);}
});
