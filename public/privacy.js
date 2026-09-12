(() => {
  const button = document.querySelector('#analytics-toggle');
  const status = document.querySelector('#analytics-preference');
  const es = document.documentElement.lang === 'es';
  const render = () => {
    try {
      const signal = navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.globalPrivacyControl === true;
      const disabled = signal || localStorage.getItem('zcl-analytics-disabled') === '1';
      status.textContent = signal
        ? (es ? 'Desactivada por la señal de privacidad de tu navegador.' : 'Disabled by your browser’s privacy signal.')
        : disabled ? (es ? 'Analítica desactivada en este navegador.' : 'Analytics disabled in this browser.')
        : (es ? 'Analítica activada en este navegador.' : 'Analytics enabled in this browser.');
      button.textContent = disabled ? (es ? 'Activar analítica' : 'Enable analytics') : (es ? 'Desactivar analítica' : 'Disable analytics');
      button.disabled = signal;
      button.dataset.disabled = String(disabled);
    } catch { status.textContent = es ? 'El almacenamiento no está disponible; la analítica está desactivada.' : 'Storage is unavailable; analytics is disabled.'; button.disabled = true; }
  };
  button.addEventListener('click', () => {
    try {
      if (button.dataset.disabled === 'true') localStorage.removeItem('zcl-analytics-disabled');
      else {
        localStorage.setItem('zcl-analytics-disabled', '1');
        localStorage.removeItem('zcl-analytics-visitor');
        sessionStorage.removeItem('zcl-analytics-session');
      }
    } catch {}
    render();
  });
  render();
})();
