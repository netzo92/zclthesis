(() => {
  const current=document.documentElement.lang;
  const url=new URL(location.href);
  const explicit=url.searchParams.get('lang');
  let preferred;
  try {
    preferred=localStorage.getItem('zcl-language');
    if(explicit==='en'||explicit==='es') {
      preferred=explicit;
      localStorage.setItem('zcl-language',explicit);
    } else if(current==='es') {
      preferred='es';
      localStorage.setItem('zcl-language','es');
    }
  } catch { preferred=explicit; }
  if((preferred==='es'||preferred==='en')&&preferred!==current) {
    const section=/^\/(?:es\/)?(network|privacy)(?:\/|$)/.exec(url.pathname)?.[1];
    const suffix=section?section+'/':'';
    url.pathname=(preferred==='es'?'/es/':'/')+suffix;
    location.replace(url.href);
    return;
  }
  document.querySelectorAll('[data-language]').forEach(link=>{
    const update=()=>{
      const target=new URL(link.href);
      target.hash=location.hash;
      link.href=target.href;
    };
    update();
    window.addEventListener('hashchange',update);
    link.addEventListener('click',()=>{
      try {localStorage.setItem('zcl-language',link.dataset.language);} catch {}
    });
  });
})();
