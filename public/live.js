(() => {
  const el=id=>document.getElementById(id);
  const spanish=document.documentElement.lang==='es';
  const locale=spanish?'es-ES':'en-US';
  const number=new Intl.NumberFormat(locale,{maximumFractionDigits:5});
  const date=value=>new Date(value).toLocaleString(locale);
  const t=spanish?{
    node:'Nuestro nodo de la pool',fallback:'Explorador externo',unavailable:'No disponible',stale:'Desactualizado · ',block:'Hora del bloque',fetched:'consultado',trade:'Última operación en NonKYC',volume:'volumen de 24 h',
    explorer:'Explorador temporalmente no disponible.',market:'Datos de mercado temporalmente no disponibles.',ok:'Las fuentes responden.',
    partial:'Algunos datos están desactualizados o no disponibles; revisa las marcas de tiempo de las fuentes.',
    failed:'Falló la actualización. Los valores mostrados proceden de la última consulta exitosa.'
  }:{
    node:'Our pool node',fallback:'External explorer',unavailable:'Unavailable',stale:'Stale · ',block:'Block time',fetched:'fetched',trade:'Last NonKYC trade',volume:'24h volume',
    explorer:'Explorer temporarily unavailable.',market:'Market data temporarily unavailable.',ok:'Sources responding.',
    partial:'Some data is stale or unavailable; check the source timestamps.',
    failed:'Refresh failed. Any displayed values are from the last successful fetch.'
  };
  let snapshot, busy=false;
  function renderAge(age) {
    const valid=age?.asset==='ZCL'&&age.launchedAt==='2016-11-06'&&age.basis==='public-launch-date-utc'
      &&['years','months','days','totalDays'].every(key=>Number.isSafeInteger(age[key])&&age[key]>=0)
      &&age.months<12&&age.days<32;
    const unit=(value,name)=>new Intl.NumberFormat(locale,{style:'unit',unit:name,unitDisplay:'long'}).format(value);
    const value=valid?`${unit(age.years,'year')} · ${unit(age.months,'month')}`:'—';
    for(const node of document.querySelectorAll('[data-chain-age]'))node.textContent=value;
    const detail=el('chain-age-detail');
    if(detail)detail.textContent=valid
      ?`${number.format(age.totalDays)} ${spanish?'días de calendario desde el lanzamiento · 6 nov 2016':'calendar days since launch · 6 Nov 2016'}`
      :(spanish?'Lanzamiento: 6 de noviembre de 2016.':'Launched November 6, 2016.');
  }
  function render(data) {
    renderAge(data.chainAge);
    const chain=data.chain,market=data.market;
    el('block-value').textContent=chain?.value?number.format(chain.value.height):t.unavailable;
    el('block-detail').textContent=chain?.value?`${chain.status==='stale'?t.stale:''}${chain.source==='https://pool.zclthesis.com/api/node.json'?t.node:t.fallback} · ${t.block} ${date(chain.value.blockAt)} · ${t.fetched} ${date(chain.fetchedAt)}`:t.explorer;
    el('price-value').textContent=market?.value?`${number.format(market.value.price)} USDT`:t.unavailable;
    el('price-detail').textContent=market?.value?`${market.status==='stale'?t.stale:''}${t.trade} ${date(market.value.tradeAt)} · ${t.fetched} ${date(market.fetchedAt)}${market.value.volume24h===null?'':` · ${t.volume} ${number.format(market.value.volume24h)} USDT`}`:t.market;
    el('live-status').textContent=chain?.status==='ok'&&market?.status==='ok'?t.ok:t.partial;
  }
  async function refresh() {
    if(busy || document.hidden)return;busy=true;
    try {const response=await fetch('/api/live',{cache:'no-store',signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error('Unavailable');const data=await response.json();if(!data.chain||!data.market)throw Error('Invalid data');snapshot=data;render(data);}
    catch {if(snapshot){const old=structuredClone(snapshot);for(const key of ['chain','market'])old[key].status='stale';render(old);}else render({});el('live-status').textContent=t.failed;}
    finally {busy=false;}
  }
  refresh();setInterval(refresh,60000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
})();
