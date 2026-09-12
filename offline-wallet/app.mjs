import {generateWallet} from './core.mjs';

const messages = {
  en: {
    title:'Your ZCL keys. Created offline.', eyebrow:'ZCLTHESIS / OFFLINE KEY GENERATOR',
    intro:'Save this HTML file, disconnect from the internet, then open the saved file in your browser. Everything needed is inside this one file.',
    scope:'Creates one Zclassic mainnet transparent receiving address and its compressed private key (WIF). It does not check balances, synchronize a node, create shielded addresses, or send transactions.',
    stepsTitle:'Before you generate', step1:'Use a trusted computer and browser without untrusted extensions. Downloading this file cannot protect a compromised device or a modified download.',
    step2:'Disconnect Wi-Fi, Ethernet, and any other internet connection. Close unrelated browser tabs. The connection indicator below is only a browser hint; it cannot verify isolation.',
    step3:'Prepare a private backup location. Anyone with the WIF can spend the funds; losing every copy means losing access. Use a small test amount and verify recovery before relying on the address.',
    local:'Saved local file detected.', hosted:'Open the downloaded HTML file from your device. Generation is disabled on a hosted webpage.',
    online:'Browser reports a network connection. Disconnect it before continuing.', offline:'Browser reports no network connection. Check that other connections are also disabled.',
    noCrypto:'This browser does not provide secure randomness. Generation is disabled; use a supported browser. There is no fallback.',
    ack:'I opened the saved file on a trusted device, disconnected its internet connections, and am ready to back up the private key.',
    generate:'Generate a new ZCL address', generated:'Address created locally. Back up the private key before closing or clearing this page.', failed:'Generation failed. No usable wallet was created. Do not use any partial output; check the browser and try again.',
    cleared:'The displayed keys have been cleared. Browser memory and operating-system copies cannot be reliably erased by this page.',
    resultTitle:'Your Zclassic address', addressLabel:'PUBLIC RECEIVING ADDRESS · ZCL MAINNET', addressHelp:'Share this address with a sender or use it for pool payouts. It is transparent: its on-chain activity is public.',
    privateLabel:'PRIVATE KEY · COMPRESSED WIF', privateHelp:'Keep this private. Never send it to a pool, exchange, website, or support chat. ZCL and ZEC share address/key prefixes: always choose Zclassic, and do not reuse this key on other chains.',
    hidden:'Private key hidden', reveal:'Reveal private key', hide:'Hide private key',
    backupAck:'I understand this backup is an unencrypted text file containing the private key. I will keep it off cloud-synced folders and shared devices.',
    backup:'Save private backup (.txt)', backupStarted:'Backup download requested. Check that the file was saved and record both the address and the complete WIF before clearing this page.',
    clear:'Clear this wallet', clearConfirm:'Have you saved and checked your backup? Clearing this page removes its displayed address and private key.',
    afterTitle:'After backing up', after:'Keep protected copies in separate private locations. Close the page before reconnecting. To spend later, use a trusted Zclassic wallet that supports importing compressed WIF, verify that it derives this same address, and back up that wallet. This page does not implement offline transaction signing.',
    memory:'No keys are stored by this page in cookies or browser storage, or sent over the network. A backup is saved only when you click its button. Private data can still be copied by browser extensions, malware, screenshots, disk backups, swap, or the operating system. Closing or clearing a page does not guarantee memory erasure.',
    provenance:'Source, build, and limitations', provenanceText:'Cryptography is bundled from @noble/curves 2.4.0, @noble/hashes 2.4.0, and @scure/base 2.4.0 (MIT). Entropy comes only from crypto.getRandomValues. Address prefixes and compressed WIF serialization follow Zclassic v2.1.2-beta6. This integration has not received an independent security audit.',
    source:'Build source: github.com/netzo92/zclthesis/tree/main/offline-wallet', licenses:'Bundled library licenses',
    noScript:'JavaScript is required. No wallet has been generated.', footer:'Zclassic mainnet · Transparent keys · Single self-contained file',
  },
  es: {
    title:'Tus claves ZCL. Creadas sin conexión.', eyebrow:'ZCLTHESIS / GENERADOR DE CLAVES SIN CONEXIÓN',
    intro:'Guarda este archivo HTML, desconecta internet y abre el archivo guardado en tu navegador. Todo lo necesario está dentro de este único archivo.',
    scope:'Crea una dirección transparente de recepción de la red principal de Zclassic y su clave privada comprimida (WIF). No consulta saldos, sincroniza un nodo, crea direcciones protegidas ni envía transacciones.',
    stepsTitle:'Antes de generar', step1:'Usa un equipo y navegador de confianza sin extensiones no confiables. Descargar este archivo no protege un dispositivo comprometido ni una descarga modificada.',
    step2:'Desconecta Wi-Fi, Ethernet y cualquier otra conexión a internet. Cierra las demás pestañas. El indicador de conexión de abajo solo es una pista del navegador; no puede verificar el aislamiento.',
    step3:'Prepara un lugar privado para la copia. Cualquiera con la WIF puede gastar los fondos; perder todas las copias significa perder el acceso. Prueba una cantidad pequeña y verifica la recuperación antes de confiar en la dirección.',
    local:'Se detectó un archivo local guardado.', hosted:'Abre el archivo HTML descargado desde tu dispositivo. La generación está desactivada en una página alojada en internet.',
    online:'El navegador indica que hay conexión de red. Desconéctala antes de continuar.', offline:'El navegador indica que no hay conexión de red. Comprueba que las demás conexiones también estén desactivadas.',
    noCrypto:'Este navegador no ofrece aleatoriedad segura. La generación está desactivada; usa un navegador compatible. No existe una alternativa menos segura.',
    ack:'Abrí el archivo guardado en un dispositivo de confianza, desconecté sus conexiones a internet y estoy preparado para guardar una copia de la clave privada.',
    generate:'Generar una dirección ZCL nueva', generated:'Dirección creada localmente. Guarda una copia de la clave privada antes de cerrar o limpiar esta página.', failed:'La generación falló. No se creó una billetera utilizable. No uses ningún resultado parcial; revisa el navegador y vuelve a intentarlo.',
    cleared:'Se borraron las claves mostradas. Esta página no puede borrar de forma fiable la memoria del navegador ni las copias del sistema operativo.',
    resultTitle:'Tu dirección de Zclassic', addressLabel:'DIRECCIÓN PÚBLICA DE RECEPCIÓN · RED PRINCIPAL ZCL', addressHelp:'Comparte esta dirección con quien te envíe fondos o úsala para los pagos de la pool. Es transparente: su actividad en la cadena es pública.',
    privateLabel:'CLAVE PRIVADA · WIF COMPRIMIDA', privateHelp:'Mantenla en privado. Nunca la envíes a una pool, un exchange, una web ni un chat de soporte. ZCL y ZEC comparten prefijos de direcciones y claves: elige siempre Zclassic y no reutilices esta clave en otras cadenas.',
    hidden:'Clave privada oculta', reveal:'Mostrar clave privada', hide:'Ocultar clave privada',
    backupAck:'Entiendo que esta copia es un archivo de texto sin cifrar que contiene la clave privada. La guardaré fuera de carpetas sincronizadas con la nube y dispositivos compartidos.',
    backup:'Guardar copia privada (.txt)', backupStarted:'Se solicitó la descarga de la copia. Comprueba que se guardó el archivo y conserva la dirección y la WIF completas antes de limpiar esta página.',
    clear:'Borrar esta billetera', clearConfirm:'¿Guardaste y comprobaste la copia? Limpiar esta página elimina la dirección y la clave privada que muestra.',
    afterTitle:'Después de guardar la copia', after:'Conserva copias protegidas en lugares privados separados. Cierra la página antes de volver a conectarte. Para gastar después, usa una billetera de Zclassic de confianza que admita importar WIF comprimidas, verifica que derive esta misma dirección y haz una copia de esa billetera. Esta página no implementa la firma de transacciones sin conexión.',
    memory:'Esta página no guarda claves en cookies ni en el almacenamiento del navegador, ni las envía por la red. Solo se guarda una copia cuando pulsas su botón. Las extensiones, el malware, las capturas de pantalla, las copias del disco, la memoria de intercambio o el sistema operativo podrían copiar datos privados. Cerrar o limpiar una página no garantiza el borrado de la memoria.',
    provenance:'Código, compilación y limitaciones', provenanceText:'La criptografía incluida procede de @noble/curves 2.4.0, @noble/hashes 2.4.0 y @scure/base 2.4.0 (MIT). La entropía procede únicamente de crypto.getRandomValues. Los prefijos y la codificación WIF comprimida siguen Zclassic v2.1.2-beta6. Esta integración no ha recibido una auditoría de seguridad independiente.',
    source:'Código de compilación: github.com/netzo92/zclthesis/tree/main/offline-wallet', licenses:'Licencias de las bibliotecas incluidas',
    noScript:'Se requiere JavaScript. No se ha generado ninguna billetera.', footer:'Red principal de Zclassic · Claves transparentes · Un único archivo autónomo',
  },
};

const $ = id => document.getElementById(id);
let language = 'en', wallet = null, revealed = false, statusKey = '';
const local = location.protocol === 'file:';
const capable = () => typeof globalThis.crypto?.getRandomValues === 'function';
function update() {
  const t = messages[language];
  document.documentElement.lang = language;
  document.title = language === 'es' ? 'Claves ZCL sin conexión | zclthesis' : 'Offline ZCL keys | zclthesis';
  for (const element of document.querySelectorAll('[data-text]')) element.textContent = t[element.dataset.text];
  for (const button of document.querySelectorAll('[data-language]')) button.setAttribute('aria-pressed', String(button.dataset.language === language));
  $('local-status').textContent = t[local ? 'local' : 'hosted'];
  $('network-status').textContent = t[navigator.onLine ? 'online' : 'offline'];
  $('crypto-error').hidden = capable();
  $('generate').disabled = !local || !capable() || !$('ack').checked || wallet !== null;
  $('status').textContent = statusKey ? t[statusKey] : '';
  $('result').hidden = wallet === null;
  $('address').textContent = wallet?.address ?? '';
  $('private-key').textContent = wallet && revealed ? wallet.wif : t.hidden;
  $('reveal').textContent = t[revealed ? 'hide' : 'reveal'];
  $('reveal').setAttribute('aria-pressed', String(revealed));
  $('backup').disabled = wallet === null || !$('backup-ack').checked;
}
for (const button of document.querySelectorAll('[data-language]')) button.addEventListener('click', () => {language = button.dataset.language; update();});
$('ack').addEventListener('change', update);
$('backup-ack').addEventListener('change', update);
for (const event of ['online', 'offline']) addEventListener(event, () => {$('ack').checked = false; update();});
$('generate').addEventListener('click', () => {
  if (!local || !capable() || !$('ack').checked || wallet) return;
  try {wallet = generateWallet(); statusKey = 'generated';}
  catch {wallet = null; statusKey = 'failed'; $('ack').checked = false;}
  revealed = false;
  $('backup-ack').checked = false;
  update();
  if (wallet) $('result-title').focus();
});
$('reveal').addEventListener('click', () => {if (wallet) {revealed = !revealed; update();}});
$('backup').addEventListener('click', () => {
  if (!wallet || !$('backup-ack').checked) return;
  const content = 'ZCLASSIC MAINNET / RED PRINCIPAL ZCLASSIC\n'
    + 'UNENCRYPTED PRIVATE BACKUP / COPIA PRIVADA SIN CIFRAR\n\n'
    + `Address / Dirección: ${wallet.address}\nCompressed WIF / WIF comprimida: ${wallet.wif}\n\n`
    + 'Keep the WIF private. Anyone with it can spend these funds.\n'
    + 'Mantén la WIF en privado. Cualquiera con ella puede gastar estos fondos.\n'
    + 'Use only with Zclassic (ZCL). Verify recovery before funding.\n'
    + 'Úsala solo con Zclassic (ZCL). Verifica la recuperación antes de depositar.\n';
  const url = URL.createObjectURL(new Blob([content], {type:'text/plain;charset=utf-8'}));
  const link = document.createElement('a');
  link.href = url; link.download = 'zcl-private-backup.txt';
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  statusKey = 'backupStarted'; update();
});
$('clear').addEventListener('click', () => {
  if (!wallet || !confirm(messages[language].clearConfirm)) return;
  wallet = null; revealed = false; statusKey = 'cleared';
  $('ack').checked = false; $('backup-ack').checked = false; update();
});
// Never restore keys from browser storage or automatically create a wallet.
$('ack').checked = false; $('backup-ack').checked = false;
update();
