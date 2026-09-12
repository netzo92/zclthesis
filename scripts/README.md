# Reproducing the transparent rich list

The website publishes a historical snapshot, not a current-balance feed. The
initial export covers block **3,126,937, May 27, 2026 at 17:31:18 UTC**.
`data/provenance.json` records the published artifact hash, counts and trust model.
All tooling here runs offline/from a maintenance machine; none is in the runtime
Docker image. No wallet, private key, node RPC credentials or account is needed.

## Retrieve and verify

```bash
python3 scripts/fetch-chainstate.py /tmp/zcl-chain-snapshot
npm --prefix scripts ci --ignore-scripts --no-audit --no-fund
node scripts/export-state.mjs /tmp/zcl-chain-snapshot /tmp/zcl-verified
node scripts/build-richlist.mjs /tmp/zcl-verified data/richlist.json
node --test tests/*.test.mjs
```

Use fresh output directories. The exporter copies the downloaded LevelDB before
opening it, so the original downloaded files are preserved. `classic-level` is a
pinned maintenance-only dependency with a lockfile; supported platforms use its
bundled native binding. A platform without that binding may require a local build.
The download is about 407 MB. Only `chainstate/` files are needed; downloading a
full node's historical blocks and block index is unnecessary for block-age filters.

The downloader checks every file against its manifest SHA-256. The exporter then
independently decodes the entire chainstate and recomputes `hash_chainstate_full`,
matching the value pinned in `richlist-data.mjs` from **v2.1.2-beta6**:

- Anchor block hash: `00000663e40f1fe0bc32a7e7282fac25de5fe8ecefd9c627e2fd948d388f7053`
- Commitment: `4efb67005d842e9d5bab21831fef8905a7fcb89e7264e43bd1aa00623f5a585f`

The parser was checked against the exact release's `coins.h`, `compressor.cpp`,
`serialize.h`, `txdb.cpp`, and `chainparams.cpp`; tests include documented CCoins
fixtures and edge cases. The official block explorer independently reported the
anchor timestamp through `/api/block/<anchor-hash>` during generation. It is pinned
as metadata, not inferred by converting heights into calendar dates.

## Meaning and limitations

Matching the release commitment authenticates its ordered output values, scripts,
and per-record creation-height metadata. It is **not** replaying consensus from
genesis. The upstream commitment omits transaction-ID keys and hashes shielded
anchor/nullifier keys rather than all stored shielded value blobs. This exporter
does not claim to audit or fix those upstream commitment properties. The website
uses aggregated balances and output creation heights, not individual outpoint IDs.

Amounts are integer zatoshis throughout and serialize as decimal strings.
Standard P2PKH/P2SH outputs map to their transparent address; valid P2PK outputs map
to the corresponding public-key-hash address. Other scripts are counted in total
transparent value and disclosed as unattributed, rather than assigned an owner.
Only positive-value outputs contribute to address balances, address UTXO counts
and age filters. The global UTXO count includes zero-value and unattributed outputs.

Dormancy filters count exact blocks between each output's creation height and the
snapshot height: 100,000 / 500,000 / 1,000,000. An address matches only if all of its
positive balance meets that threshold. These are exploratory cutoffs, not years,
last-spend timestamps, probabilities of lost keys, or an estimate of lost supply.
Shielded holdings cannot be ranked. Address ownership is not clustered or inferred.

A new current snapshot requires a separately verified newer chainstate and a
reviewed update to the pinned anchor and corresponding metadata. There is no
scheduled refresh of this historical artifact. Do not change its date to make it
appear current. After regeneration, update provenance, verify the bilingual page
and deploy the artifact with the app.
