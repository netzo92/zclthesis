import {build} from 'esbuild';
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const root = new URL('./', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const result = await build({
  entryPoints:[new URL('app.mjs', root).pathname], bundle:true, write:false,
  format:'iife', platform:'browser', target:['es2022'], minify:true,
  legalComments:'none', sourcemap:false, charset:'utf8',
});
const script = result.outputFiles[0].text.trim();
if (/<\/script/i.test(script)) throw new Error('Unexpected script end tag');
const style = (await read('style.css')).trim();
const hash = content => createHash('sha256').update(content).digest('base64');
const csp = `default-src 'none'; script-src 'sha256-${hash(script)}'; style-src 'sha256-${hash(style)}'; connect-src 'none'; img-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
const escape = text => text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const licenses = await Promise.all(['@noble/curves','@noble/hashes','@scure/base'].map(async name => `${name} 2.4.0\n${await read(`node_modules/${name}/LICENSE`)}`));
let html = await read('template.html');
for (const [key,value] of Object.entries({CSP:csp,STYLE:style,SCRIPT:script,LICENSES:escape(licenses.join('\n\n'))})) html = html.replace(`__${key}__`, () => value);
if (/__[A-Z]+__/.test(html)) throw new Error('Unresolved template field');
await writeFile(new URL('../public/offline-wallet.html', root), html);
const digest = createHash('sha256').update(html).digest('hex');
await writeFile(new URL('../public/offline-wallet.sha256', root), `${digest}  zcl-offline-wallet.html\n`);
console.log(`Built offline-wallet.html (${Buffer.byteLength(html)} bytes); SHA-256 ${digest}`);
