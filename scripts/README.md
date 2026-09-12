# Reproducing the transparent rich list

The bundled fallback covers block **3,126,937, May 27, 2026 at 17:31:18 UTC**.
`data/provenance.json` records the published artifact hash, counts and trust model.
Tooling runs on a maintenance machine or the pool's scheduled exporter; none is
in the website runtime Docker image. The historical rebuild needs no wallet,
private key, node RPC credentials or account. Current exports use local read-only
RPC metadata and a private consistent copy of chainstate.

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

## Scheduled exports from our node

The historical anchor remains immutable. Current node exports have a distinct
`own-node-snapshot` verification mode. The pool machine prepares a private atomic
filesystem snapshot, allowing the pool's live node to continue running. Open a
writable private copy of that snapshot for LevelDB recovery; never copy the live
database file by file. Official guidance explicitly permits a filesystem
snapshot: <https://github.com/ZclassicCommunity/zclassic/blob/v2.1.2-beta6/doc/bootstrap-snapshots.md>.

Capture a local `gettxoutsetinfo` result and the matching block header. The
node context file has this shape (replace values with actual node results):

```json
{
  "verification": "own-node-snapshot",
  "source": "https://pool.zclthesis.com",
  "height": 3247700,
  "hash": "<64 lowercase hexadecimal characters from bestblock>",
  "commitment": "<hash_chainstate_full>",
  "blockAt": "<matching block timestamp in ISO 8601 UTC>",
  "totalZatoshis": "<total_amount converted exactly to integer zatoshis>",
  "utxoCount": 1345131,
  "bootstrapValidation": "anchored-fast-sync"
}
```

`total_amount` must be converted with decimal arithmetic, not binary floating
point. The listed count and height above are illustrative, not live measurements.
Other recognized trust labels are `validated-from-genesis` and `unknown`; use
the former only after actual full historical validation.

```bash
node scripts/export-state.mjs /private/consistent-snapshot /private/verified-export /private/node-context.json
node scripts/build-richlist.mjs /private/verified-export /private/zcl.json
```

The recovered database's `B` best-block key must match the context block. The
exporter recomputes the full commitment and requires the RPC's exact output count
and total to match. If the node advanced between the RPC read and snapshot,
retry with a coherent pair; never rewrite the context to disguise a mismatch.
Check that the block remains canonical before publication. Publish only the
validated aggregate JSON atomically to `/api/richlist/zcl.json`, targeting every
two hours. Keep the previous valid artifact on failure.

The pool's whole-datadir CoW snapshot may contain a wallet; keep the snapshot and
working copy private, short-lived, and outside the web root. No raw snapshot,
wallet, configuration, RPC credentials, or private key belongs in published
artifacts. The website fetches only the aggregate JSON and displays its actual
block date and trust mode. Fast sync followed by forward validation is not a
claim that history was replayed from genesis.
