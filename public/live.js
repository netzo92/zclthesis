(() => {
  const el=id=>document.getElementById(id);
  const number=new Intl.NumberFormat('en-US',{maximumFractionDigits:5});
  const date=value=>new Date(value).toLocaleString();
  let snapshot, busy=false;
  function render(data) {
    const chain=data.chain,market=data.market;
    el('block-value').textContent=chain?.value?number.format(chain.value.height):'Unavailable';
    el('block-detail').textContent=chain?.value?`${chain.status==='stale'?'Stale · ':''}Block time ${date(chain.value.blockAt)} · fetched ${date(chain.fetchedAt)}`:'Explorer temporarily unavailable.';
    el('price-value').textContent=market?.value?`${number.format(market.value.price)} USDT`:'Unavailable';
    el('price-detail').textContent=market?.value?`${market.status==='stale'?'Stale · ':''}Last trade ${date(market.value.tradeAt)} · fetched ${date(market.fetchedAt)}${market.value.volume24h===null?'':` · 24h volume ${number.format(market.value.volume24h)} USDT`}`:'Market feed temporarily unavailable.';
    el('live-status').textContent=chain?.status==='ok'&&market?.status==='ok'?'Sources responding.':'Some data is stale or unavailable; check the source timestamps.';
  }
  async function refresh() {
    if(busy || document.hidden)return;busy=true;
    try {const response=await fetch('/api/live',{cache:'no-store',signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error('Unavailable');const data=await response.json();if(!data.chain||!data.market)throw Error('Invalid data');snapshot=data;render(data);}
    catch {if(snapshot){const old=structuredClone(snapshot);for(const key of ['chain','market'])old[key].status='stale';render(old);}else render({});el('live-status').textContent='Refresh failed. Any displayed values are from the last successful fetch.';}
    finally {busy=false;}
  }
  refresh();setInterval(refresh,60000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
})();
