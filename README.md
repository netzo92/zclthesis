# myzclthesis

Standalone, responsive editorial site about the ZCL counterweight thesis.
The content distinguishes Braun's ZEC argument from the owner's ZCL interpretation.
No frontend dependencies, analytics, wallet connections, or live market data.

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
as a non-root user and serves only three explicit routes. Minimum instances is
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
