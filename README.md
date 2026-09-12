# myzclthesis

Standalone, responsive editorial site about the ZCL counterweight thesis.
The content distinguishes Braun's ZEC argument from the owner's ZCL interpretation,
and treats consensus, development funding, and issuance timing as separate choices.
No frontend dependencies, analytics, or wallet connections. A live strip reports
explorer block height and the NonKYC ZCL/USDT last trade.

Run from the repository root with Node 22+:

```bash
node server.mjs
```

Open http://localhost:8080. `PORT` overrides the listener port.
Edit `public/index.html` for copy and sources and `public/style.css` for design.
Restart the server after edits because assets are loaded at startup.

## GCP Cloud Run

Choose a billing-enabled project and authenticate gcloud. Source deployment needs
Cloud Run, Cloud Build and Artifact Registry APIs and the relevant deployer/build
permissions. The CLI will report any missing setup. See Google's
[source deployment documentation](https://docs.cloud.google.com/run/docs/deploying-source-code).

```bash
GCP_PROJECT=myzclthesis-20260912 \
GCP_RUNTIME_SERVICE_ACCOUNT=myzclthesis-web@myzclthesis-20260912.iam.gserviceaccount.com \
bash deploy.sh
```

This builds only this app directory and creates/updates a public `myzclthesis`
Cloud Run service in `us-central1` (override `GCP_REGION`). Set `GCP_RUNTIME_SERVICE_ACCOUNT` to select a dedicated runtime identity.
The Docker image runs
as a non-root user and exposes an explicit static-asset allowlist plus the bounded
live-data, network, market-comparison, and rich-list API routes. Minimum instances is
zero; maximum is two. Builds, image storage and requests can incur charges;
instance limits are not a spending cap. The deployment returns a managed HTTPS
URL. A custom domain needs separate domain ownership and DNS configuration.

Verify the returned URL, stylesheet, mobile layout, source links and expandable
objections after deployment. `/server.mjs` should return 404.

## Deployment record

Deployed September 12, 2026 (UTC):

- Site: https://myzclthesis-633108169526.us-central1.run.app
- Project: `myzclthesis-20260912`
- Region: `us-central1`
- Service: `myzclthesis`
- Initial revision: `myzclthesis-00001-5rv`
- Deployment source commit: `1ceca78`
- Runtime identity: `myzclthesis-web@myzclthesis-20260912.iam.gserviceaccount.com`, with no project roles granted.

Billing is connected. The service is public and uses the managed Cloud Run HTTPS
address. Custom domain setup is recorded below. Automatic deployment from GitHub is not configured.
Source deployments use the existing default build account permissions.


Live validation passed: desktop and 390px mobile layouts, no horizontal overflow,
anchor targets, expandable objections, HTTP method guard, and private-file 404s.
The browser reported no JavaScript or console errors.

The Where to buy section links to the owner-provided NonKYC.io referral URL.
The button opens a new tab and retains sponsored-link metadata.

## Live data and rich-list research

`live-data.mjs` fetches fixed, public HTTPS endpoints server-side. `/api/live`
returns independent chain/market status and timestamps. Each instance caches
successful results for 60 seconds, coalesces concurrent refreshes and throttles
failed retries. The node probe times out after 2.5 seconds; external requests after 8 seconds, each with a 256 KiB response limit.
No credentials or user-selected upstream URLs are accepted. Memory-only caches
are lost on cold starts; no historical observations are persisted.

Sources:
- https://pool.zclthesis.com/api/node.json
- https://explorer.zcl.zelcore.io/api/blocks?limit=1
- https://api.nonkyc.io/api/v2/market/getbysymbol/ZCL_USDT

The price is in USDT, not USD, and comes from one exchange's last trade.
Source block/trade times and server fetch times are displayed separately.
Block timestamps older than 30 minutes, trade timestamps older than one hour,
paused markets, fetch failures, or cached fetches older than three minutes are
marked stale. These are display thresholds, not judgments of consensus validity.
The browser polls once per minute while visible and retains labeled stale values
when a refresh fails. No-JavaScript visitors can follow the source links.

The rich list uses a complete, dated transparent-UTXO snapshot. See the
reproducible workflow in `scripts/README.md`. `/api/richlist` serves the current
validated node export when available, falling back to the bundled historical
`data/richlist.json`. Its block date is displayed separately from the export date.
A snapshot older than two hours or a failed refresh is marked stale.
Search and exact block-age filters run across all attributable positive-balance
addresses; the table and CSV show at most the top 100 matching addresses.

Block-age filters require every positive-value output in an address balance to
be at least 100,000, 500,000, or 1,000,000 blocks old relative to the snapshot.
They do not estimate calendar years, last outgoing spends, owner identities,
lost-key probabilities, or lost supply. Shielded balances cannot be ranked.

Validate with `node --test tests/*.test.mjs` and browser checks of `/api/live`,
mobile layout, referral links and failure/stale states after each publication.

## Custom domain

`zclthesis.com` was registered through Cloud Domains on September 12, 2026,
with automatic renewal and redacted public contact information. Registration
expires September 12, 2027 unless renewed. Registrant details are deliberately
excluded from this repository.

The `zclthesis-com` public Cloud DNS zone is in `myzclthesis-20260912`.
The apex A records are `216.239.32.21`, `216.239.34.21`, `216.239.36.21`,
and `216.239.38.21`. AAAA records are `2001:4860:4802:32::15`,
`2001:4860:4802:34::15`, `2001:4860:4802:36::15`, and
`2001:4860:4802:38::15`. The `www` CNAME is `ghs.googlehosted.com.`.
All records use a 300-second TTL and match Cloud Run's domain-mapping output.
Both names map to the existing `myzclthesis` service in `us-central1`.

At configuration time, registration was ACTIVE and apex public DNS resolved.
Apex HTTPS returned 200 with certificate verification enabled at 04:08 UTC on
September 12, 2026. The www certificate was still provisioning at that check.
The registrar reports ACTIVE with no outstanding issues, including no
unverified-email issue. The run.app URL continues to work. Inspect current status with:

```bash
gcloud beta run domain-mappings describe --domain=zclthesis.com \
  --region=us-central1 --project=myzclthesis-20260912
gcloud beta run domain-mappings describe --domain=www.zclthesis.com \
  --region=us-central1 --project=myzclthesis-20260912
```

## Funding and monetary-policy thesis

The editorial sections distinguish the owner's competition/incentive argument
from source descriptions. ZIP 214 documents different historical funding streams;
“foundation reward” is explicitly defined as broad shorthand, not a current claim
about ZF receiving all development funding. Allocation reductions are distinguished
from reductions in total issuance. ZIP 234 is described as Draft as reviewed on
September 12, 2026, with the stated cap and proponents' security rationale intact.
The owner's preference for unchanged issuance is an opinion with a stated burden
of proof and a counterargument. ZIP 233's deliberate removal mechanism is kept
separate from any lost-key or dormancy inference. Sources are linked on the page.

The Crosslink section presents the strongest affirmative case for hybrid finality,
separately from issuance smoothing and full PoS replacement. It distinguishes
proposed/testnet reward allocations from mainnet facts and cites both the January
2026 mechanism-design audit and May 2026 feature-net report. Safety of finalized
history is distinguished from progress of finality and recovery from stalls.

Only the Where to buy button uses the owner-provided referral URL. The visible
commission notice was removed at the owner’s request. The live price panel links to that section; the
backend continues to read the public market API for price data.

## English and Spanish

The complete English page is at `/` and Spanish at `/es/`. Keep
`public/index.html` and `public/es/index.html` synchronized when editing copy.
The header language links work without JavaScript. With JavaScript,
`public/language.js` preserves the section anchor and remembers an explicit
choice in localStorage (`zcl-language`); no preference leaves the browser.
An explicit `?lang=en` or `?lang=es` overrides the saved choice. Direct Spanish
visits select Spanish; root visits honor the saved preference. Storage failures
do not prevent navigation. `public/live.js` localizes status messages, numbers,
and dates using the document language. Both versions share the same data API
and owner-provided referral links.

## History, relative valuation, and miners

The bilingual history section links the official launch records: Zcash
October 28, 2016 and Zclassic November 6, 2016 (nine days apart). Age is
distinguished from present security and adoption. The owner's preference for
ZCL's miner reward model is explicitly a fairness judgment. The Crosslink
section links the PoS discussion to its proposed hybrid design and presents
the miner-concession precedent argument as a risk, not an inevitable outcome.

`market-comparison.mjs` fetches CoinGecko's ZCL/ZEC market data in one bounded
request, validates both identities and timestamps, and caches the pair for five
minutes. `/api/comparison` returns the same-source USD market caps and derived
ratio/percentage. A failed refresh retains the previous pair as stale; a first
failure reports unavailable. Source observations older than one hour are stale.
The frontend uses the page language and distinguishes market cap from invested
cash, guaranteed execution prices, or proof of undervaluation.

The rich-list payload is precompressed when loaded and fetched only when its
section approaches the viewport (or the visitor requests a refresh).

## Current node and rich-list comparison

`live-data.mjs` prefers `https://pool.zclthesis.com/api/node.json`, a public
read-only artifact from the pool node. It requires a synced ZCL mainnet node,
positive peer count, a recent block and an export no more than three minutes old.
An unavailable, unsynced or stale node falls back to the existing Zelcore feed.
The website never connects to wallet RPC. Prices retain their market source.

`richlist-feeds.mjs` checks `https://pool.zclthesis.com/api/richlist/zcl.json`
at most every five minutes per server instance. The pool exporter targets a
two-hour cadence. Each `own-node-snapshot` artifact must pass the same address,
integer amount, count, age and total reconciliation as the historical snapshot,
plus the expected source and bootstrap trust metadata. A failed refresh retains
the last valid artifact and marks it stale. The bundled May 27 snapshot remains
an explicitly dated fallback. A fresh HTTP response never changes a block date.

`/api/richlist-comparison` adds CipherScan's **top 100** Zcash transparent
addresses, requested hourly from its documented, keyless `/api/rich-list`.
Every row's exact `balanceZat` and the top-10/top-100 sums are validated; the
provider's total must equal addressed plus addressless value. Owner labels and
activity dates are discarded. Source: <https://cipherscan.app/docs>.

The ZEC response is a provider index, not an atomic full-node snapshot. Its
observed index-tip header and corresponding block time are shown separately from
fetch time. CipherScan's route caches for 60 seconds, can retain data for 600
seconds, and keys its cache by tip height; upstream responses explicitly marked
stale are rejected. A two-hour-old block or failed refresh marks saved data stale.
The provider's indexed total is not asserted to equal the node's value-pool total.
See <https://github.com/Kenbak/cipherscan/blob/main/server/api/routes/address.js>.

Both comparison denominators are **indexed transparent value**, including
unattributed/addressless amounts, never market-reported circulating supply.
Coverage and script resolution differ: ZCL resolves valid P2PK scripts to their
public-key-hash address; CipherScan includes direct P2PK/bare multisig in its
addressless denominator. ZCL supports full-index search and exact UTXO block-age
filters; the ZEC table is top 100 only and has no fabricated UTXO-age fields.
Neither table identifies owners, ranks shielded balances, or estimates lost keys.

On September 12, 2026, ShieldedScan's rich-list rows and distribution response
claimed the same height but disagreed on top-10/top-100 sums by 69.82468413 ZEC;
its reported total also failed same-height node-pool reconciliation. It was not
used. Blockchair's address dump was current only daily and its live stats returned
negative circulation. Neither is silently substituted for hourly ZEC index data.

## Wallet and mining guides

Both language pages contain `#wallet` and `#mine`. Maintain equivalent copy and
identical command blocks. The Apple Silicon Terminal recipe is open by default;
Linux and Windows bundles are expandable. Commands are pinned to the official
v2.1.2-beta6 release. The Mac archive SHA-256 and both Unix archive directory names
were verified against the release downloads. Wallet RPCs were checked in the
matching source: backupwallet requires an export directory and a filename, and
wallet encryption is experimental in this release. Native installation commands
were checked against release artifacts and source; browser solver tests are
documented separately in the webminer repository.

The mining example uses miniZ on Linux/Windows with Equihash 192,7 and ZcashPoW,
and its documented zpool ZCL-only configuration. macOS has a wallet recipe, not
a claimed native miniZ miner. Recheck upstream downloads and pool settings when
updating. The shared-development section distinguishes potential reuse of Zcash
research/code from automatic compatibility or adopting stake-based consensus.
The owner requested removal of the visible commission notice; the sole referral
URL per language remains in the Where to buy button with sponsored metadata.

miniZ's optional localhost telemetry and a Mac SSH tunnel provide a documented
web monitoring path. The guide does not provision GPU workers or pool services.
The pool FAQ notes legacy configuration incompatibilities. Dual-mining copy is
scoped to miniZ's documented NVIDIA support, distinguishes it from merged mining,
and links current removal notices so stale coin pairs are not recommended.

## Network page and offline wallet

`/network/` and `/es/network/` show our node's height, peer connections, reported
difficulty, estimated network solutions per second, synchronization estimate,
timestamps, and validation provenance. `network-data.mjs` allowlists the fixed
public pool feed into `/api/network`. Source export age and block age remain
distinct, including during initial sync. The browser refreshes every 30 seconds
while visible and marks exports older than three minutes stale. The market-cap
panel refreshes independently every five minutes. No private RPC is exposed.

`/offline-wallet.html` downloads a self-contained, bilingual key generator;
`/offline-wallet.sha256` supplies its build checksum. The generator works only
from a saved `file:` page after explicit offline acknowledgement. It uses the
browser CSPRNG and pinned, bundled cryptographic libraries, makes no network
requests, and never displays a private key until requested. Saving a file and
disconnecting do not protect against an already compromised device. Build,
dependency provenance, known-key vectors, and offline browser checks are in
`offline-wallet/`. This generates a key pair, not a synchronized wallet or a
transaction-signing application. No owner's private wallet exists in this repo.

## Separate pool and browser miner

- Pool software: <https://github.com/netzo92/zclthesis-pool>
- Browser GPU miner: <https://github.com/netzo92/zclthesis-webminer>
- Pool status: <https://pool.zclthesis.com/>
- Miner interface: <https://pool.zclthesis.com/mine/>, Spanish `/mine/es/`

`#browser-mining` explains the experimental WebGPU path and its approximately
3.26 GiB memory requirement. A visitor supplies a public payout address and
explicitly starts a bounded session; hiding the tab or pressing Stop ends it.
The separate bridge enforces current-node and pool-launch admission checks.
Linking the preview does not mean public mining has opened; the pool status
artifact is the current authority for readiness. The pool host coordinates
visitors' miners and does not run a cloud GPU miner.

The fee is 0.8% of allocated block rewards, with the specific comparison
“20% lower than a 1% pool fee.” This is not a universal competitor claim.
Unpaid pool credits are distinct from a wallet's confirmed on-chain balance.
Pool/admin credentials and operator wallet material are outside all public repos.
