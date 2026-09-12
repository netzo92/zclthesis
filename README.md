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
GCP_PROJECT=YOUR_PROJECT_ID bash deploy.sh
```

This builds only this app directory and creates/updates a public `myzclthesis`
Cloud Run service in `us-central1` (override `GCP_REGION`). The Docker image runs
as a non-root user and serves only three explicit routes. Minimum instances is
zero; maximum is two. Builds, image storage and requests can incur charges;
instance limits are not a spending cap. The deployment returns a managed HTTPS
URL. A custom domain needs separate domain ownership and DNS configuration.

Verify the returned URL, stylesheet, mobile layout, source links and expandable
objections after deployment. `/server.mjs` should return 404. No deployment is
recorded yet; do not assume the service exists merely because this guide does.
