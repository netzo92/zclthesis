import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {createAnalyticsRelay, validAnalyticsEvent} from '../analytics-relay.mjs';

const event = (overrides = {}) => ({id: randomUUID(), visitor: randomUUID(), session: randomUUID(),
  type: 'pageview', path: '/', source: 'direct', ...overrides});
test('only bounded, anonymous event fields are accepted', () => {
  assert.equal(validAnalyticsEvent(event()), true);
  for (const bad of [{wallet:'private'}, {ip:'1.2.3.4'}, {path:'/offline-wallet.html'},
    {path:'/?key=secret'}, {source:'https://personal.example'}, {id:'not-a-uuid'},
    {type:'referral_click',path:'/bridge/'}, {type:'referral_click',path:'/network'},
    {type:'referral_click',path:'/es/network/?ref=private'}, {type:'trade'}]) assert.equal(validAnalyticsEvent(event(bad)), false);
  for (const path of ['/', '/es/', '/network/', '/es/network/']) {
    for (const type of ['pageview','referral_click']) assert.equal(validAnalyticsEvent(event({path,type})),true);
  }
});

test('public relay is write-only, checks origin, and never forwards browser headers', async t => {
  const forwarded = [];
  const relay = createAnalyticsRelay({token:'test-only-credential',fetchFn:async (...args) => {forwarded.push(args); return new Response(null,{status:204});}});
  const server = http.createServer(relay).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => {server.closeAllConnections();server.close();});
  const url = `http://127.0.0.1:${server.address().port}/api/analytics/event`;
  const post = (headers = {}, body = JSON.stringify(event())) => fetch(url, {method:'POST', body,
    headers:{Origin:'https://zclthesis.com','Content-Type':'application/json',...headers}});
  assert.equal((await fetch(url)).status, 405);
  assert.equal((await post({Origin:'https://attacker.example'})).status, 403);
  assert.equal((await post({'Sec-Fetch-Site':'cross-site'})).status, 403);
  assert.equal((await post({'Content-Type':'text/plain'})).status, 415);
  assert.equal((await post({}, 'x'.repeat(2049))).status, 413);
  assert.equal((await post({}, '{')).status, 400);
  assert.equal((await post({}, JSON.stringify(event({secret:'no'})))).status, 400);
  assert.equal((await post({DNT:'1'})).status, 204);
  assert.equal((await post({'Sec-GPC':'1'})).status, 204);
  assert.equal((await post({'User-Agent':'Googlebot'})).status, 204);
  assert.equal(forwarded.length, 0);
  const good = event();
  assert.equal((await post({Cookie:'secret=value','X-Forwarded-For':'1.2.3.4',Referer:'https://private.example/?secret=yes'}, JSON.stringify(good))).status, 204);
  assert.equal(forwarded.length, 1);
  assert.deepEqual(forwarded[0][1].headers, {'Content-Type':'application/json',Origin:'https://zclthesis.com',Authorization:'Bearer test-only-credential'});
  assert.deepEqual(JSON.parse(forwarded[0][1].body), good);
  for (const path of ['/network/','/es/network/']) {
    const click=event({type:'referral_click',path});
    assert.equal((await post({},JSON.stringify(click))).status,204);
    assert.deepEqual(JSON.parse(forwarded.at(-1)[1].body),click);
  }
  assert.equal(forwarded.length,3);
});

test('collector outages and throttling remain failures', async t => {
  let status = 503;
  const server = http.createServer(createAnalyticsRelay({token:'test-only-credential',fetchFn:async () => new Response(null,{status})})).listen(0,'127.0.0.1');
  await new Promise(resolve => server.once('listening',resolve));
  t.after(() => {server.closeAllConnections();server.close();});
  const send = () => fetch(`http://127.0.0.1:${server.address().port}`,{method:'POST',headers:{Origin:'https://zclthesis.com','Content-Type':'application/json'},body:JSON.stringify(event())});
  assert.equal((await send()).status,503);
  status=429; assert.equal((await send()).status,429);
});

const script = await readFile(new URL('../public/analytics.js',import.meta.url),'utf8');
const storage = () => {
  const map = new Map();
  return {getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)};
};
function browser({path='/',local=storage(),session=storage(),nav={},referrer='',lang='en'}={}) {
  const sent=[], listeners=new Map(), timers=[];
  const context={URL,Blob,Date,setTimeout:fn=>timers.push(fn),crypto:{randomUUID},
    location:{href:'https://zclthesis.com'+path,pathname:path,hostname:'zclthesis.com',protocol:'https:'},
    navigator:{sendBeacon:(url,body)=>{sent.push({url,body});return true;},...nav},
    document:{visibilityState:'visible',referrer,documentElement:{lang},addEventListener:(name,fn)=>listeners.set(name,fn)},
    localStorage:local,sessionStorage:session,window:{}};
  runInNewContext(script,context);
  timers.forEach(fn=>fn());
  return {sent,listeners,local,session};
}
async function payloads(b) { return Promise.all(b.sent.map(async e=>JSON.parse(await e.body.text()))); }
const referralCode='69d580940a7d426e95b803c5';
const referralUrls=['/','/allreserves','/api/v1/system/allreserves'].map(path=>'https://nonkyc.io'+path+'?ref='+referralCode);
const clickLink=(b,href,type='click',button=0)=>b.listeners.get(type)?.({type,button,target:{closest:()=>({href})}});

test('visitor and session persist across page views; referral goes only to expected link', async () => {
  const first=browser({referrer:'https://www.google.com/search?q=private+search'});
  const second=browser({path:'/network/',local:first.local,session:first.session});
  const [a]=await payloads(first), [b]=await payloads(second);
  assert.equal(a.source,'search'); assert.equal(b.source,'search');
  assert.equal(a.visitor,b.visitor);assert.equal(a.session,b.session);assert.notEqual(a.id,b.id);
  const click=href=>first.listeners.get('click')({type:'click',button:0,target:{closest:()=>({href})}});
  click('https://nonkyc.io/market/ZCL_USDT');assert.equal(first.sent.length,1);
  click('https://nonkyc.io/?ref=69d580940a7d426e95b803c5');assert.equal(first.sent.length,2);
  const [,c]=await payloads(first);assert.equal(c.type,'referral_click');assert.equal(c.session,a.session);
  assert.deepEqual(Object.keys(c).sort(),['id','path','session','source','type','visitor']);
});

test('all three approved referral destinations track from the four allowlisted public pages', async () => {
  for (const path of ['/','/es/','/network/','/es/network/']) {
    const b=browser({path,lang:path.startsWith('/es/')?'es':'en'});
    for (const href of referralUrls) clickLink(b,href);
    clickLink(b,referralUrls[1],'auxclick',1);
    const rows=await payloads(b);
    assert.equal(rows.length,5,path);assert.equal(rows[0].type,'pageview');
    for (const row of rows.slice(1)) {
      assert.equal(row.path,path);assert.equal(row.type,'referral_click');assert.equal(row.session,rows[0].session);
      assert.deepEqual(Object.keys(row).sort(),['id','path','session','source','type','visitor']);
      assert.equal(validAnalyticsEvent(row),true);
    }
    assert.equal(b.sent.every(({url})=>url==='/api/analytics/event'),true);
  }
});

test('referral recognition rejects wrong origins, paths, codes and duplicate or extra parameters', async () => {
  const b=browser({path:'/network/'}),good=referralUrls[1];
  const rejected=[
    good.replace('https:','http:'),good.replace('nonkyc.io','www.nonkyc.io'),
    good.replace('nonkyc.io','nonkyc.io.evil.example'),good.replace('nonkyc.io','nonkyc.io:8443'),
    good.replace('nonkyc.io','user@nonkyc.io'),good.replace('nonkyc.io','user:password@nonkyc.io'),
    good.replace('/allreserves','/market/ZCL_USDT'),good.replace('/allreserves','/allreserves/'),
    good.replace(referralCode,'wrong'),good.replace('?ref=','?REF='),
    good+'&ref='+referralCode,good+'&ref=wrong',good.replace('?ref=','?ref=wrong&ref='),
    good+'&%72ef='+referralCode,good+'&extra=1',good+'#section',
    'https://nonkyc.io/allreserves','/allreserves?ref='+referralCode,'javascript:alert(1)',undefined,
  ];
  for(const href of rejected){clickLink(b,href);assert.equal(b.sent.length,1,String(href));}
  clickLink(b,good,'click',1);clickLink(b,good,'click',2);clickLink(b,good,'auxclick',0);clickLink(b,good,'auxclick',2);
  assert.equal(b.sent.length,1);
  clickLink(b,good);assert.equal(b.sent.length,2);assert.equal((await payloads(b))[1].type,'referral_click');
});

test('network referral clicks preserve privacy and page exclusions, including opt-out after a page view', () => {
  for(const path of ['/network/','/es/network/']) {
    for(const nav of [{doNotTrack:'1'},{globalPrivacyControl:true},{webdriver:true}]) {
      const b=browser({path,lang:path.startsWith('/es/')?'es':'en',nav});
      for(const href of referralUrls)clickLink(b,href);assert.equal(b.sent.length,0);
    }
    const b=browser({path,lang:path.startsWith('/es/')?'es':'en'});assert.equal(b.sent.length,1);
    b.local.setItem('zcl-analytics-disabled','1');for(const href of referralUrls)clickLink(b,href);
    assert.equal(b.sent.length,1);assert.equal(b.local.getItem('zcl-analytics-visitor'),null);assert.equal(b.session.getItem('zcl-analytics-session'),null);
  }
  for(const path of ['/offline-wallet.html','/privacy/','/es/privacy/','/bridge/','/es/bridge/','/admin']) {
    const b=browser({path});for(const href of referralUrls)clickLink(b,href);assert.equal(b.sent.length,0);
  }
  const blocked=browser({path:'/network/',local:{getItem:()=>{throw Error('storage blocked');}}});
  for(const href of referralUrls)clickLink(blocked,href);assert.equal(blocked.sent.length,0);
});

test('privacy signals, offline wallet, automation, and explicit opt-out suppress tracking', () => {
  for (const nav of [{doNotTrack:'1'},{globalPrivacyControl:true},{webdriver:true}]) assert.equal(browser({nav}).sent.length,0);
  for (const path of ['/offline-wallet.html','/privacy/','/admin','/es/privacy/']) assert.equal(browser({path}).sent.length,0);
  const local=storage();local.setItem('zcl-analytics-disabled','1');
  local.setItem('zcl-analytics-visitor','previous');
  assert.equal(browser({local}).sent.length,0);
  assert.equal(local.getItem('zcl-analytics-visitor'),null);
  assert.equal(browser({local:{getItem:()=>{throw Error('blocked');}}}).sent.length,0);
});

test('expired identifiers rotate and a pending language redirect is not double counted', async () => {
  const local=storage(),session=storage();
  const oldVisitor=randomUUID(),oldSession=randomUUID();
  local.setItem('zcl-analytics-visitor',JSON.stringify({id:oldVisitor,expires:Date.now()-1}));
  session.setItem('zcl-analytics-session',JSON.stringify({id:oldSession,last:Date.now(),source:'direct'}));
  const [a]=await payloads(browser({local,session}));
  assert.notEqual(a.visitor,oldVisitor);assert.notEqual(a.session,oldSession);
  local.setItem('zcl-language','es');
  assert.equal(browser({local}).sent.length,0);
  assert.equal(browser({path:'/es/',lang:'es',local}).sent.length,1);
});

test('all four public pages track and link to localized privacy; wallet has no tracker', async () => {
  for (const path of ['index.html','es/index.html','network/index.html','es/network/index.html']) {
    const html=await readFile(new URL('../public/'+path,import.meta.url),'utf8');
    assert.match(html, /src="\/analytics\.js(?:\?v=[a-zA-Z0-9-]+)?"/);
    assert.match(html,path.startsWith('es/')?/href="\/es\/privacy\//:/href="\/privacy\//);
  }
  const wallet=await readFile(new URL('../public/offline-wallet.html',import.meta.url),'utf8');
  assert.doesNotMatch(wallet,/analytics\.js|api\/analytics|zcl-analytics/);
});
