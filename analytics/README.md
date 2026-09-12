# Private website analytics

The website submits events; only the operator's authenticated IAP SSH tunnel can
read totals. This service shares the existing pool VM, runs as `zcl-analytics`,
and has no access to the pool database, wallet, RPC or mining processes.

## Runtime boundaries

- Public Cloud Run: `POST /api/analytics/event`, no analytics read routes.
- Public pool Caddy: exact POST route proxies to `127.0.0.1:8792/event`.
- Collector: requires the private relay bearer credential plus an allowlisted
  website origin. Public visitors cannot read events or summaries.
- Private dashboard: `127.0.0.1:8091`, exposed on the operator's Mac at
  `http://127.0.0.1:18091/` only while the IAP SSH tunnel is open.
- State: `/var/lib/zcl-analytics/analytics.sqlite3` and SQLite WAL files, private
  directory 0700/files 0600. Never copy these into a repository or image.
- Secret: `/etc/zcl-analytics/collector.env`, root-owned 0600, and the dedicated
  GCP Secret Manager secret `zclthesis-analytics-relay`, version 1.
- Code: `/opt/zcl-analytics`, root-owned, installed from this repository.

The GCP website runtime identity has `roles/secretmanager.secretAccessor` on this
one secret, with no additional project-wide role. Cloud Run exposes its value
as `ANALYTICS_RELAY_TOKEN`; the VM uses `ZCL_ANALYTICS_RELAY_TOKEN`. The browser
never receives this credential. Generate or rotate it privately; never put a
real value in shell history, logs, documentation, tests or public source.

`collector.env` must contain the matching 64-character hexadecimal relay token
and `ZCL_ANALYTICS_DB=/var/lib/zcl-analytics/analytics.sqlite3`. Create it securely
before running `sudo bash analytics/install.sh` on the VM. The installer preserves
existing secrets and event history and requires a healthy dashboard before success.
Caddy's route is maintained in the separate pool repository at
`deploy/zcl/Caddyfile`; validate its configuration before reloading Caddy.

Cloud Run deployments must retain the existing secret binding. For an initial
binding (the secret and narrow IAM grant must already exist), add:

```bash
--update-secrets=ANALYTICS_RELAY_TOKEN=zclthesis-analytics-relay:1
```

The public site's Docker image intentionally excludes the collector, dashboard,
tests, runtime database and operational credentials. `ANALYTICS_ENABLED=0` pauses
website forwarding without affecting page rendering or outbound links.

## Open the dashboard

Run `open-analytics.command` on the operator's Mac using the already authorized
Google Cloud CLI account and SSH key. Keep the Terminal window open. Ctrl+C closes
the tunnel; no new public admin port or password is created. The launcher checks
that port 18091 is unused and that the tunneled private health endpoint is ready.
The existing Google Cloud project/VM administrators remain trusted. For the IAP
access model, see [Google's SSH tunneling documentation](https://docs.cloud.google.com/compute/docs/connect/ssh-using-iap).

The dashboard supports today and 7/30/90 UTC days, offers an opt-in refresh every
minute while visible, and includes page/source breakdowns and selectable daily bars.
A failed fetch retains an explicitly stale prior result, or dashes if there is none.
The date recording began is displayed. There are no fabricated historic figures.

Visitors are approximate distinct random browser identifiers, not identified people.
A first-party localStorage identifier expires after 30 days. SessionStorage holds a
session identifier renewed after 30 minutes without a measured event; tabs can be
separate visits. Each server event gets a UTC timestamp and deduplicated event ID.
Storage hashes browser/session IDs and records only allowlisted event types, paths
and coarse source categories. Source categories come from the first measured
referrer in a session; full referrer URLs are discarded in the browser. A referral
click counts an outbound NonKYC link action, never a registration, deposit or trade.

Only the English/Spanish thesis and network pages are measured. The privacy pages
and downloadable offline wallet have no tracker. Do Not Track, Global Privacy
Control, the browser opt-out, storage failures and obvious automated browsers
suppress collection. Infrastructure logs are separate; these are approximate
client-reported counts and cannot eliminate all bot/spoofed activity.

## Durability and resource limits

SQLite WAL, per-operation connections, transactional limits and stable event IDs
support concurrent writes, deduplication and restarts. Events from the current UTC
day and preceding 89 days are retained. Maintenance checks every minute and prunes
once per new UTC day. The VM disk persists across process/Cloud Run restarts; this
is not an off-VM backup against disk loss. No visitor data backup is published.

Limits are 50,000 events/day overall, 300/browser/day and 30 referral clicks/browser/day.
Bodies are at most 2,048 bytes. The collector/admin each allow 32 concurrent connections
with 5-second socket timeouts; systemd caps memory 128 MiB, CPU 20% of one core and 96 tasks.
The relay allows 32 in-flight requests and 1,200/minute per Cloud Run instance; it times
out failed upstream requests. A backend failure returns 503, not invented zero totals.
These counts start at deployment, and intentional QA events must be removed by their
exact event IDs so they do not inflate the operator's visitor/click history.

Useful private checks:

```bash
sudo systemctl status zcl-analytics.service
sudo journalctl -u zcl-analytics.service --since '10 minutes ago'
curl --fail http://127.0.0.1:8091/health
```

## Validation

```bash
node --test tests/*.test.mjs
python3 -m unittest discover -s tests -p 'test_analytics.py'
CHROME_BIN=/path/to/trusted/chromium node analytics/dashboard.browser.test.mjs
```

Tests cover strict event validation and privacy exclusions, authorization and
cross-origin/Host rejection, transactional deduplication/caps/concurrency, retention,
durability and summary totals. The browser regression uses an isolated profile,
synthetic local summaries and strict CSP, with no production event writes. It checks
responsive layouts, chart interaction, date ranges, stale/error/empty states, unsafe
stored strings and request races. Public/private live route checks are still needed
after publication. Never expose `/api/summary` or dashboard files through Caddy.
