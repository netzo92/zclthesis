# Downloadable Zclassic key generator

`public/offline-wallet.html` is a complete offline webpage. The server serves it as
an attachment named `zcl-offline-wallet.html`; `public/offline-wallet.sha256` records
the whole-file SHA-256. Both languages and all cryptographic code and MIT license
notices are included in the file. Runtime requires no packages, fonts, analytics,
images, network APIs, or server. The website's guide links to both downloads.

This is a **transparent mainnet key-pair generator**, not a balance viewer, node,
shielded wallet, transaction signer, or spending application. It is a new integration
that has not had an independent security audit. A hash served beside the download
does not independently authenticate a compromised source.

## Reproduce the file

Use Node >=20.19 (tested with Node 25.6.1):

```sh
cd offline-wallet
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm test
```

For the offline Chromium test (Node must support the global WebSocket API):

```sh
CHROME_BIN=/path/to/chromium-or-headless-shell node tests/browser.mjs
```

It disables networking through the browser protocol and replaces all browser RNG
calls with public test bytes before loading the file. The library's initialization
probes and scalar blinding also use this test stub; only a 32-byte secret-key draw
counts as wallet generation. Optional `WALLET_SCREENSHOT_DIR` records only the page
before generation. No real wallet secrets appear in its output or screenshots.

Exact npm versions and package integrity hashes are in `package-lock.json`.
Runtime cryptography: `@noble/curves` 2.4.0, `@noble/hashes` 2.4.0,
`@scure/base` 2.4.0. Maintenance bundler: esbuild 0.28.2.
`npm audit signatures` verified registry signatures and provenance attestations for
all five installed packages at initial build; that verifies package provenance, not
the security of this integration.
The build is deterministic, has no timestamps, and does not use environment values.
Commit both generated files when changing source. Review dependency updates and
rerun vector, browser, offline, and CSP checks before publishing.

## Encoding and randomness

The only entropy source is the browser's `crypto.getRandomValues`, sampling 32 bytes
and using noble's secret-key validation to reject values outside `1 <= d < n`.
If the API is absent, throws, or fails to produce a valid key after 128 attempts,
generation fails closed. There is no custom RNG or time/mouse/password fallback.
This check cannot diagnose a compromised CSPRNG that returns predictable valid keys.

Noble derives a compressed secp256k1 public key. The transparent address is
Base58Check(`1c b8 || RIPEMD160(SHA256(compressed_public_key))`). Compressed WIF is
Base58Check(`80 || secret_32_bytes || 01`). Scure implements Base58Check; noble
implements the hashes. Mainnet prefixes follow
[Zclassic v2.1.2-beta6 chainparams.cpp](https://github.com/ZclassicCommunity/zclassic/blob/v2.1.2-beta6/src/chainparams.cpp),
and the compression marker follows
[key_io.cpp EncodeSecret](https://github.com/ZclassicCommunity/zclassic/blob/v2.1.2-beta6/src/key_io.cpp).
Zcash shares these encodings: an encoding alone does not identify the chain. The UI
identifies Zclassic and warns against cross-chain key reuse.

## Handling keys

Generation is disabled unless opened as a local `file:` URL and the user explicitly
acknowledges disconnection and backup preparation. `navigator.onLine` is displayed
only as a hint, not an isolation guarantee. Network changes reset acknowledgement.
The generated WIF stays hidden until explicitly revealed. Backups require a separate
acknowledgement and click, and are clearly identified as unencrypted text.
No automatic printing, clipboard writes, query-supplied seeds, imported secrets,
browser persistence, or restoration of generated keys is implemented.

The file has a meta CSP allowing only the exact bundled inline script and style
hashes. All resource and connection types are denied by default. The hosted download
also receives the server's more restrictive website CSP; use the saved file.

Owned temporary secret-byte buffers are zeroed after use, and Clear removes the
displayed wallet after confirmation. Immutable JavaScript strings, cryptographic
library temporaries, GC, disk swap, extensions, screenshots, OS backups, and device
compromise prevent guaranteed erasure or secrecy. The interface describes these
limits and recommends verifying recovery with a small test amount.

## Validation scope

Tests use only deliberately public secret scalars 1, 2, and n−1. **Never fund these
test addresses.** No test generates a real random wallet, sends coins, or imports
test keys into a user's node. Known address and compressed-WIF vectors are checked
against independent Node/OpenSSL secp256k1 and hash operations. Boundary values,
missing/throwing/broken RNGs, rejection sampling, owned-buffer clearing, complete-file
checksum, and CSP hashes are tested. Native interoperability here is an encoding
crosscheck, not a completed Zclassic funding/spending recovery test.
