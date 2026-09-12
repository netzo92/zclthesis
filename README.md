# myzclthesis

Standalone, responsive editorial site about the ZCL counterweight thesis.
The content distinguishes Braun's ZEC argument from the owner's ZCL interpretation.
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
as a non-root user and exposes only an explicit static-asset allowlist and `/api/live`. Minimum instances is
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
address. A custom domain and automatic deployment from GitHub are not configured.
Source deployments use the existing default build account permissions.


Live validation passed: desktop and 390px mobile layouts, no horizontal overflow,
anchor targets, expandable objections, HTTP method guard, and private-file 404s.
The browser reported no JavaScript or console errors.

The Where to buy section links to the owner-provided NonKYC.io referral URL.
The button opens a new tab and is labeled with a possible commission disclosure.

## Live data and rich-list research

`live-data.mjs` fetches fixed, public HTTPS endpoints server-side. `/api/live`
returns independent chain/market status and timestamps. Each instance caches
successful results for 60 seconds, coalesces concurrent refreshes and throttles
failed retries. Requests time out after 8 seconds with a 256 KiB response limit.
No credentials or user-selected upstream URLs are accepted. Memory-only caches
are lost on cold starts; no historical observations are persisted.

Sources:
- https://explorer.zcl.zelcore.io/api/blocks?limit=1
- https://api.nonkyc.io/api/v2/market/getbysymbol/ZCL_USDT

The price is in USDT, not USD, and comes from one exchange's last trade.
Source block/trade times and server fetch times are displayed separately.
Block timestamps older than 30 minutes, trade timestamps older than one hour,
paused markets, fetch failures, or cached fetches older than three minutes are
marked stale. These are display thresholds, not judgments of consensus validity.
The browser polls once per minute while visible and retains labeled stale values
when a refresh fails. No-JavaScript visitors can follow the source links.

The rich-list section describes a proposed transparent-address/UTXO index; it
contains no fabricated ranks, owner identities, loss probabilities, or supply
adjustments. Inactivity is an exploratory signal, not proof of lost keys.
A complete index with spend history and a stated snapshot height is still needed;
shielded balances cannot be ranked by public address. The tested Zelcore
`/api/richlist` endpoint returned 404 on September 12, 2026.

Validate with `node --test tests/*.test.mjs` and browser checks of `/api/live`,
mobile layout, referral links and failure/stale states after each publication.
