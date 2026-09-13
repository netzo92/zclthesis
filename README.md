# myzclthesis

Standalone, responsive editorial site about the ZCL counterweight thesis.
The content distinguishes Braun's ZEC argument from the owner's ZCL interpretation,
and treats consensus, development funding, and issuance timing as separate choices.
No frontend dependencies or wallet connections. First-party analytics count
website visits and NonKYC referral clicks, with a private operator dashboard. A live strip reports
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
live-data, network, market-comparison, and rich-list API routes, plus a bounded write-only analytics event endpoint. Minimum instances is
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
- Latest revision: `myzclthesis-00020-f98` (100% traffic, September 13, 2026 UTC)
- Latest deployment source commit: `06ba1ce`
- Runtime identity: `myzclthesis-web@myzclthesis-20260912.iam.gserviceaccount.com`, with no project roles granted; it has access only to the dedicated analytics relay secret at the secret resource level.

Billing is connected. The service is public and uses the managed Cloud Run HTTPS
address. Custom domain setup is recorded below. Automatic deployment from GitHub is not configured.
Source deployments use the existing default build account permissions.


Live validation passed: desktop and 390px mobile layouts, no horizontal overflow,
anchor targets, expandable objections, HTTP method guard, and private-file 404s.
The browser reported no JavaScript or console errors.

The volume release adds bilingual since-launch totals and interactive hourly bars
near the top of the homepage. Both HTML pages and chart assets matched deployed
source byte-for-byte; `/api/volume` returned fresh, reconciled data. The website's
87 tests and the price/volume collectors' 31 tests passed. Browser checks covered
English/Spanish, 320–1440px layouts, exact-decimal details, keyboard and unit/range
controls, stale/partial/empty states, and the site's strict CSP.

Earlier deployments added the ZCL launch-reference market-cap banner and full
launch date/time in English and Spanish. It preserves private visitor/referral
analytics, bilingual privacy controls and the consensus/funding thesis sections. Both public HTML
documents matched the clean deployment source byte-for-byte. Guide validation
checked 14 identical command blocks, matching language-normalized links, new
section and source anchors, language switching, and ten layouts from 320 to 1,440
pixels without overflow or JavaScript errors. Pool admission remains controlled
by its current public readiness feed.

The Where to buy section links to the owner-provided NonKYC.io referral URL.
The button opens a new tab and retains sponsored-link metadata.

## Live data and rich-list research

`live-data.mjs` fetches fixed, public HTTPS endpoints server-side. `/api/live`
returns independent chain/market status and timestamps. Each instance caches
successful results for 60 seconds, coalesces concurrent refreshes and throttles
failed retries. The node probe times out after 2.5 seconds; external requests after 8 seconds, each with a 256 KiB response limit.
No credentials or user-selected upstream URLs are accepted. Website memory caches
are lost on cold starts. Separate VM recorders persist price observations and
actual trades, as described below.

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

## Observed market volume

The English and Spanish homepages show observed NonKYC ZCL/USDT volume near the
top: all collected trades since the site's September 12, 2026, 03:23:13.198605 UTC
launch, and hourly bars for the most recent 24 or 168 hours. Visitors can switch
between ZCL and USDT and inspect exact hourly quantities using pointer, touch, or
keyboard controls. The launch-hour bar starts at launch; the current hour is
in progress. Uncovered intervals are labeled as gaps, and stale values retain
their original timestamps. The since-launch total does not attribute trades to
this site or its referrals.

`volume-data.mjs` validates the fixed public VM export
`https://pool.zclthesis.com/api/prices/zcl-usdt-volume.json` and exposes a bounded,
allowlisted `/api/volume` response. Fetches time out after eight seconds, reject
redirects, and are limited to 128 KiB. Refreshes coalesce and retry at most once
per minute. Export or coverage timestamps older than three minutes are stale;
failed refreshes retain the last validated response without advancing its times.
First-load failures return null totals rather than invented zeros.

The pool repository's `deploy/zcl/record-volume.py` deduplicates actual public
`getTrades` executions by provider ID and sums exact quantities and price ×
quantity. It never adds overlapping ticker 24-hour volume snapshots. A pinned
800-trade launch backfill seeds its separate persistent SQLite database on the
existing VM. Every-minute polling fills the gap to the present and advances
coverage only after exhausting a fixed interval's pages. This is exchange-reported
activity from one market, not an independent audit of every execution; USDT is the
quote currency, not USD. The public chart is bounded to seven days while the
private database retains all collected trades and since-launch totals.

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

`#consensus` compares PoW resource expenditure with PoS collateral, using Ethereum
as the PoS example. It distinguishes validator block votes, slashable behavior,
and off-chain protocol governance. `#staking-incentives` explains the different
interests of passive holders, stakers, and fee-charging service providers with an
explicitly hypothetical dilution example; it does not predict unanimous support
for inflation or treat a nominal staking yield as a dollar profit.

`#ethereum-money` critiques the “ultrasound money” narrative through the separate
effects of Merge issuance reduction, EIP-1559 burning, and Dencun's blob market.
The return to net inflation is a dated observation from Glassnode/CME's May 29,
2025 report, not a live ETH metric or evidence of a coinholder ballot to increase
issuance. Primary sources and the authors' staking-economics analysis are linked
in both languages. Preserve these qualifications when updating the argument.

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
and its documented ZCL-only pool configuration. macOS has a wallet recipe, not
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

The English and Spanish homepages place a prominent mining-pool panel immediately
below the header, before market-cap and volume charts. It links directly to the
localized pool dashboard and browser GPU miner, with wallet and miner setup guides.
The panel shows the configured 0.8% fee and the specific comparison with a 1% fee;
visitors check current admission on the dashboard. The existing top-right pool
shortcut remains available. Private analytics and pool administration remain
accessible through their authenticated operator launchers, not public site links.

- Pool software: <https://github.com/netzo92/zclthesis-pool>
- Browser GPU miner: <https://github.com/netzo92/zclthesis-webminer>
- Pool status: <https://pool.zclthesis.com/>
- Miner interface: <https://pool.zclthesis.com/mine/>, Spanish `/mine/es/`

`#browser-mining` explains the experimental WebGPU path and its approximately
3.26 GiB memory requirement. A visitor supplies a public payout address and
explicitly chooses a timed session or “Until I stop”; hiding the tab or pressing
Stop ends it.
The separate bridge enforces current-node and pool-launch admission checks.
Linking the miner does not mean public mining has opened; the pool status
artifact is the current authority for readiness. The pool host coordinates
visitors' miners and does not run a cloud GPU miner.

The EN/ES native miniZ examples point to `pool.zclthesis.com:2192`, use
`c=ZCL`, and tell visitors to check the live readiness page before starting.
The site recommends this pool subject to that check, documents proportional
round rewards, and states the 0.05 ZCL payout minimum and operator-paid
transaction fees.

The fee is 0.8% of allocated block rewards, with the specific comparison
“20% lower than a 1% pool fee.” This is not a universal competitor claim.
Unpaid pool credits are distinct from a wallet's confirmed on-chain balance.
Pool/admin credentials and operator wallet material are outside all public repos.

## Private visitor and referral analytics

The public website posts bounded events to `/api/analytics/event`. `analytics-relay.mjs`
validates exact fields, canonical page/source categories, UUIDv4 identifiers, origin,
privacy signals, body size, and concurrency/request budgets before forwarding to the
fixed pool collector. It strips all browser headers and authenticates with a dedicated
relay credential supplied through GCP Secret Manager. No analytics read API or admin
HTML is exposed by Cloud Run. Referral links keep the owner's exact destination;
measurement does not delay navigation and cannot report exchange registrations or trades.

`analytics/collector.py` is a Python standard-library service on the existing pool VM.
A separate unprivileged account owns `/var/lib/zcl-analytics/analytics.sqlite3`, which
is outside every repository and Cloud Run image. SQLite WAL and transactions preserve
counts across service restarts and concurrent submissions. Duplicate event IDs are
idempotent; server UTC timestamps determine the reporting day. Runtime memory, CPU,
connections, event sizes and event volumes are bounded. Events are retained for the
current UTC day plus 89 preceding days; minute maintenance checks enforce daily pruning.
Only coarse allowlisted source/page categories and hashes of random browser/session IDs
are stored. No IP, user agent, arbitrary URL, wallet address or key enters this database.
Infrastructure request/security logs are separate from the analytics database.

Public Caddy exposes only the exact POST collector route to loopback port 8792.
The dashboard and summary API bind loopback port 8091 and are reached through an
IAP-authenticated SSH tunnel. No new public firewall port is required. Its Host/Origin
checks protect the localhost dashboard against DNS rebinding and cross-origin requests.
Google Cloud project/VM administrators are trusted. The website service identity can
submit events but has no dashboard or database access.

Run `analytics/open-analytics.command` on the operator's Mac while signed into the
existing authorized gcloud account. It opens `http://127.0.0.1:18091/`; keep the Terminal
window open while using the dashboard. Counts cover Today, 7, 30 or 90 UTC days and show
approximate distinct browser IDs, visits (tab sessions renewed after 30 minutes of
inactivity), pageviews, NonKYC clicks, daily activity, page/source breakdowns and the
percentage of visits with at least one referral click. Distinct visitors across a
range are not the sum of daily distinct counts. A browser identifier expires after
30 days, so longer ranges can count a returning browser more than once. No historical
traffic is backfilled or invented. Test events must not remain in production totals.

Only the English/Spanish thesis and network pages include `public/analytics.js`.
`/privacy/` and `/es/privacy/` explain collection and provide a browser opt-out.
Do Not Track, Global Privacy Control, unavailable storage and automated headless
browsers suppress collection. The offline wallet is unchanged and contains no tracker.
Counts are approximate: ad blockers, disabled JavaScript, automation and forged requests
can affect them. The source category is the session's first observed referrer category;
referrer URLs themselves are never sent. Clicking a link does not establish a trade.

See [analytics deployment instructions](analytics/README.md) for install, secrets,
access and checks. Validate with `node --test tests/*.test.mjs` and
`python3 -m unittest discover -s tests -p 'test_analytics.py'`.


Analytics deployment verified September 12, 2026: source `8efa6c8` is serving 100% of
Cloud Run traffic on `myzclthesis-00014-w2d`; the private VM service uses matching
collector/dashboard source, and the pool Caddy route is from `94008dc`. Validation
passed 49 Node tests, 20 Python tests, isolated dashboard/EN/ES privacy browser checks,
and 71 live integrity/access checks. A real isolated browser submitted a pageview
and referral click through the public relay and rendered their totals in the private
dashboard. Its synthetic events were then removed without touching other browsers.
The Mac launcher is installed in the operator's existing ZCLThesis analytics folder.


## ZCL market cap since website launch

The English and Spanish homepages show a banner above the existing block/price strip:
fixed launch-reference market cap, current market cap and percentage gain/loss. Both
values use CoinGecko USD market capitalization. The change is calculated from full
precision values as `(current / reference - 1) * 100`, independently verified by the
browser, and labeled as market-cap change. It is not a portfolio-return calculation.
The current value uses the same `/api/comparison` response as the ZCL/ZEC panel, so the
banner adds no independent market fetch. Refresh is every five minutes while visible;
failures or observations older than an hour are explicitly marked stale. Unavailable
measurements never become a zero return, and tiny changes that round to zero display
“Unchanged” rather than a misleading negative zero.

The immutable reference in `data/market-baseline.json` is **USD 3,086,200.138912376** at
**2026-09-12T03:20:00Z**. It is the latest actual provider observation at or before the
site's first successful public Cloud Run service readiness,
**2026-09-12T03:23:13.198605Z**. Public invocation was granted at 03:22:42.151778Z and the
first logged HTTP 200 occurred at 03:23:40.159548Z. The provider point is 193.198605 seconds
before launch; it is a reference near launch, not an exact launch-instant quotation.
No interpolation or current value was substituted. The actual source was retrieved
retrospectively at 22:19:45.115143Z on September 12, 2026.

`data/market-baseline-evidence.json` preserves the full public CoinGecko payload,
selected public deployment timestamps and source documentation. The reference file
contains its SHA-256. Tests require the pinned value to equal the last actual
`market_caps` point before the publicly accessible launch. The source's next 03:25
point is after launch and is deliberately excluded. These are historical observations,
not test fixtures. The compact reference is included in the Cloud Run image; it does
not reset on redeployment, cold starts or refreshed quotes. Preserve it when publishing.

CoinGecko's [one-day market-chart endpoint](https://docs.coingecko.com/demo/reference/coins-id-market-chart)
provides five-minute observations. Its historical date endpoint reports midnight UTC,
which was not used as a substitute for the intraday launch reference. The banner
labels the reference timestamp and prominently displays the full site launch date
and time (September 12, 2026 at 03:23:13 UTC), distinct from the 03:20 UTC source
observation, in both languages. The shared comparison script has a versioned asset
URL so returning visitors receive the banner update despite earlier browser caches.
`market-performance.mjs` validates the reference identity, source and chronology;
`public/performance.js` consumes the shared comparison event and derives the display.


Market-cap banner deployment: source `b7b3a8d` is serving 100% of Cloud Run traffic
on revision `myzclthesis-00017-cmg` (September 12, 2026 UTC). All 65 Node tests passed,
including reference provenance, gain/loss mathematics, refresh failures and browser
staleness; focused page/renderer checks passed again after adding the full timestamp
and versioned script URL. Local EN/ES layouts were checked from 320 to 1,440 pixels.
Live verification confirmed the actual API's pinned reference and raw percentage
calculation, matching rendered EN/ES values, one shared comparison fetch per load,
and no test analytics events. The banner's reference remains the 03:20 UTC market
observation; the full site launch timestamp is 03:23:13 UTC, displayed separately.

At widths up to 360px, the cap cells stack so complete numbers and currency labels
remain readable. The stylesheet URL is versioned, and final live HTML/CSS/JS bytes
matched the tested source after publication.

## Live transactions and exchange research

The bilingual `/network/#transactions` view consumes `/api/transactions`, a bounded,
allowlisted view of our existing ZCL node. The public exporter scans the latest 100
canonical blocks and returns at most 100 confirmed transactions, plus at most 50
local mempool entries. The browser polls every 30 seconds while visible and marks
observations older than 90 seconds stale. Mining rewards are hidden by default;
toggling them does not change the source window. Confirmations belong to the
reported tip and are replaced on refresh, including after a reorganization.

Amounts use integer zatoshis and eight-decimal display. Visible output totals include
change and exclude hidden values; they are not payment amounts. Output details are
bounded to 32 outputs and 8 addresses per output, with truncation disclosed. Mempool
entry times describe the current local admission and can reset on readmission. Missing observations never become zero.
The server fetches one fixed public JSON URL; it offers no arbitrary RPC proxy,
wallet methods, or URL/transaction lookup passthrough.

`data/exchange-research.json` preserves dated public research evidence. NonKYC's
ZCL reserve page reported balances but supplied empty signature/address data when
inspected. The linked consolidation transactions are unattributed research leads,
not verified NonKYC labels. Large balances, round amounts and common inputs are
insufficient attribution evidence. The research section is dated, not a live
reserve audit. The homepage price separately uses NonKYC's official ZCL/USDT API
and shows the last actual trade time; market-cap comparisons remain CoinGecko USD.

The transaction/nav/price update is deployed from `718663ac` on Cloud Run revision
`myzclthesis-00018-fxf`, serving 100% of traffic (September 13, 2026 UTC). All 81
Node tests passed. Live EN/ES browser checks at 320 and 1,440 pixels verified real
transaction data, reward filtering, output details, refresh with preserved focus,
and visible pool shortcuts. All eight changed public HTML/CSS/JS assets matched
source bytes. The live price source was the official NonKYC ZCL/USDT API, the pinned
launch market-cap reference remained intact, and private/RPC paths returned 404.
Headless/GPC checks generated no analytics events. The pool exporter is documented
in `netzo92/zclthesis-pool` commit `85450ca`; its implementation is `2167a45`.

## ZCL mined by our pool

The homepage mining-pool panel and public pool dashboard show total recorded ZCL,
the rolling last 24 hours, and the rolling last hour. These are gross coinbase
rewards including transaction fees, before the 0.8% pool fee. Mature and immature
rewards are displayed separately; they are not wallet balances or paid amounts.

`pool-mined-data.mjs` fetches only the fixed public pool-status URL and publishes
allowlisted aggregates at `/api/pool-mined`. The pool's read-only exporter matches
its block records to exact reward-journal amounts and checks current node headers.
Orphaned/rejected blocks, estimated shares and incoming deposits do not become
mined rewards. Windows use pool-recorded block times; total means retained pool
history, without an invented history start date.

Amounts remain integer zatoshi strings through the proxy and are formatted without
floating-point conversion. The proxy verifies maturity sums, block counts and
nested windows, caps the upstream body at 32 KiB, rejects redirects and coalesces
30-second refreshes. The existing VM exporter runs once a minute. Both language
versions refresh while visible every 30 seconds and mark observations older than
three minutes stale. Missing evidence is partial or unavailable; it never becomes
a verified zero. Partial positive totals are marked as known minima. A failed
browser refresh retains the last verified observation with its original timestamp.

Validation covers exact monetary reconciliation, window boundaries, maturity,
reorganizations, duplicates, incomplete history, staleness and bounded fetches.
All 92 Node tests passed. Browser fixtures passed on both languages and both pages
at desktop and mobile sizes. These checks used synthetic data and performed no
mining, payment or wallet operation.
