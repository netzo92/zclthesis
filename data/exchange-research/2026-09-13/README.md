# September 13 public exchange research

The [report](../../exchange-research-2026-09-13.json) distinguishes observed chain
data, exchange-published labels, cryptographic address attestations and inferred
historical purpose. The September 12 record is preserved, with its incomplete
negative check explicitly superseded.

`nonkyc-published-rows.json` retains all 27 exact-ticker ZCL rows from the public
reserve API, including signatures and exact message. Unrelated assets are omitted.
These signatures use the correctly length-prefixed `Zcash Signed Message:\n`,
where `\n` represents one newline byte, followed by the correctly length-prefixed
30-byte message `NonKYC Cryptocurrency Exchange`. The double-SHA256 digest is
`0f7b9cdb313a091645909cb958bb14457e41e37ae4cf037f482666774a78e649`.

Reproduce compact public-key recovery locally, without a network connection:

```sh
python3 verify-public-signatures.py
```

The script checks five documented conventions. Only the Zcash convention matches
all 27 ZCL address payloads. It validates the compact signature, curve point,
ECDSA equation, address checksum, and HASH160 of the recovered compressed public
key. This script is a research verifier for these public fixtures, not wallet
software. It handles no private keys and signs or sends nothing.

`openssl-signature-verification.json` records a separate ECDSA check using
OpenSSL, with all 27 changed digests rejected. The independent review repeats
digest, address, public-key encoding and OpenSSL checks against the original API
strings. `signature-verification.json` preserves all 27 unsuccessful native
Zclassic checks: its `Zclassic Signed Message:\n` convention differs. This
failure is a format mismatch, not evidence of forged signatures.

The signed message contains no date, balance, liabilities or wallet role. Official
publication supplies the organizational association; neither that publication nor
the valid static signature proves exclusive current control, complete reserves,
customer identity or a historical transaction's exact purpose.

`target.json`, `companion.json`, `later-spend.json`, `remainder-spend.json` and
`parents/` retain public explorer records. The parent manifest records URLs,
retrieval times and raw-response hashes. `parent-trace.json` records all 52 exact
previous-output checks and integer-zatoshi calculations. Every parent balances;
51 involve shielded transfers and none is a direct coinbase reward. Hidden
source identities are not identified. The 50 recurring receipts do not establish
50 customers or an exchange withdrawal fee.

`own-node-observations.jsonl` contains read-only target transaction, canonical
block-hash and one parent-sample observations. The node uses an anchored fast-sync
bootstrap; these checks are not a replay of all history from genesis. They match
all target input outpoints and output scripts/amounts to the explorer.

The archive contains public records and checks only. No wallet backups, secrets,
account data or private analytics are included. `manifest.json` hashes archived
artifacts; the report's source observations retain their own times and coverage.
