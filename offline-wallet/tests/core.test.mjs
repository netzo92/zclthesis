import test from 'node:test';
import assert from 'node:assert/strict';
import {createECDH, createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {walletFromSecret, generateWallet} from '../core.mjs';

// Public, deliberately insecure vectors. Never fund these addresses.
const vectors = [
  {key:1, address:'t1UYsZVJkLPeMjxEtACvSxfWuNmddpWfxzs', wif:'KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73sVHnoWn'},
  {key:2, address:'t1JUxhMSGFmzKY5BTp1PsQwG4Ceq642SmnB', wif:'KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU74NMTptX4'},
];
const secretFor = n => {const b = new Uint8Array(32); b[31] = n; return b;};
// Independent OpenSSL-backed curve and hash operations, with a test-only radix encoder.
const sha = data => createHash('sha256').update(data).digest();
function nativeBase58check(payload) {
  const data = Buffer.concat([payload, sha(sha(payload)).subarray(0, 4)]);
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let value = BigInt('0x' + data.toString('hex')), text = '';
  while (value) {text = alphabet[Number(value % 58n)] + text; value /= 58n;}
  for (const b of data) {if (b) break; text = '1' + text;}
  return text;
}
test('public known keys match ZCL addresses and compressed WIF, crosschecked using native OpenSSL', () => {
  for (const vector of vectors) {
    const secret = secretFor(vector.key);
    const wallet = walletFromSecret(secret);
    assert.deepEqual(wallet, {address:vector.address, wif:vector.wif});
    const curve = createECDH('secp256k1'); curve.setPrivateKey(secret);
    const pub = curve.getPublicKey(undefined, 'compressed');
    assert.equal(pub.length, 33);
    const pubHash = createHash('ripemd160').update(sha(pub)).digest();
    assert.equal(wallet.address, nativeBase58check(Buffer.concat([Buffer.from([0x1c,0xb8]),pubHash])));
    assert.equal(wallet.wif, nativeBase58check(Buffer.concat([Buffer.from([0x80]),secret,Buffer.from([1])])));
    assert.deepEqual(secret, secretFor(vector.key), 'encoding does not mutate caller secret');
  }
});
test('invalid secret boundaries fail; highest valid key agrees with native secp256k1', () => {
  const order = Buffer.from('fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141','hex');
  for (const key of [new Uint8Array(32), order, new Uint8Array(32).fill(255), new Uint8Array(31), '1']) assert.throws(() => walletFromSecret(key));
  const key = Buffer.from(order); key[31]--;
  const curve = createECDH('secp256k1'); curve.setPrivateKey(key);
  const digest = createHash('ripemd160').update(sha(curve.getPublicKey(undefined,'compressed'))).digest();
  assert.equal(walletFromSecret(key).address, nativeBase58check(Buffer.concat([Buffer.from([0x1c,0xb8]),digest])));
});
test('CSPRNG is mandatory and failures produce no wallet or weaker fallback', () => {
  for (const crypto of [null, {}, {getRandomValues:123}, {getRandomValues(){throw new Error('denied');}}]) assert.throws(() => generateWallet(crypto));
  let calls = 0, drawn;
  assert.throws(() => generateWallet({getRandomValues(bytes){calls++; drawn = bytes; bytes.fill(0); return bytes;}}), /randomness failed/);
  assert.equal(calls,128);
  assert.ok(drawn.every(byte => byte === 0));
});
test('rejection sampling uses another CSPRNG sample and erases the owned secret buffer', () => {
  let calls = 0, drawn;
  const crypto = {getRandomValues(bytes){calls++; drawn=bytes; bytes.fill(0); if(calls===2)bytes[31]=1; return bytes;}};
  assert.deepEqual(generateWallet(crypto), {address:vectors[0].address, wif:vectors[0].wif});
  assert.equal(calls,2);
  assert.ok(drawn.every(byte => byte === 0));
});
test('bundled file pins its inline script/style hashes and disallows external resources', async () => {
  const html = await readFile(new URL('../../public/offline-wallet.html', import.meta.url),'utf8');
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const style = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  for (const [directive, content] of [['script-src',script],['style-src',style]]) assert.ok(csp.includes(`${directive} 'sha256-${createHash('sha256').update(content).digest('base64')}'`));
  assert.ok(csp.includes("default-src 'none'"));
  assert.ok(csp.includes("connect-src 'none'"));
  assert.doesNotMatch(html, /<(?:script|img|iframe|link)\b[^>]+(?:src|href)=/i);
  assert.doesNotMatch(script, /Math\.random\(|\beval\(|new Function\(|localStorage|sessionStorage|\.cookie\s*=/);
  assert.equal((html.match(/<script>/g)||[]).length,1);
  assert.equal((html.match(/<style>/g)||[]).length,1);
  const checksum = await readFile(new URL('../../public/offline-wallet.sha256', import.meta.url),'utf8');
  assert.equal(checksum, `${createHash('sha256').update(html).digest('hex')}  zcl-offline-wallet.html\n`);
});
