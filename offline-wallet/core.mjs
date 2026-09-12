import {secp256k1} from '@noble/curves/secp256k1.js';
import {sha256} from '@noble/hashes/sha2.js';
import {ripemd160} from '@noble/hashes/legacy.js';
import {createBase58check} from '@scure/base';

const base58check = createBase58check(sha256);

// Zclassic v2.1.2-beta6 src/chainparams.cpp and src/key_io.cpp, mainnet.
// Zcash shares these encodings. The user must select the ZCL network when spending.
export function walletFromSecret(secret) {
  if (!(secret instanceof Uint8Array) || secret.length !== 32 || !secp256k1.utils.isValidSecretKey(secret)) {
    throw new Error('Invalid secret key');
  }
  const publicKey = secp256k1.getPublicKey(secret, true);
  const addressPayload = new Uint8Array(22);
  addressPayload.set([0x1c, 0xb8]);
  addressPayload.set(ripemd160(sha256(publicKey)), 2);
  const privatePayload = new Uint8Array(34);
  privatePayload[0] = 0x80;
  privatePayload.set(secret, 1);
  privatePayload[33] = 1; // Compressed public key marker.
  try {
    return {address: base58check.encode(addressPayload), wif: base58check.encode(privatePayload)};
  } finally {
    privatePayload.fill(0);
  }
}

export function generateWallet(cryptoProvider = globalThis.crypto) {
  if (typeof cryptoProvider?.getRandomValues !== 'function') throw new Error('Secure randomness unavailable');
  const secret = new Uint8Array(32);
  try {
    // Uniform 256-bit CSPRNG samples, rejecting values outside the curve's secret-key range.
    // No timestamps, mouse movement, passwords, Math.random, or deterministic fallback.
    for (let attempt = 0; attempt < 128; attempt++) {
      cryptoProvider.getRandomValues(secret);
      if (secp256k1.utils.isValidSecretKey(secret)) return walletFromSecret(secret);
    }
    throw new Error('Secure randomness failed');
  } finally {
    secret.fill(0);
  }
}
