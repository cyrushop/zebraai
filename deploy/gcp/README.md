# Zebra Sales Hub on Google Cloud

Runs the hub on **Cloud Run** (region `asia-east2`, Hong Kong) behind **Identity-Aware Proxy**: only the
Google accounts you list can open it. The hub's shared data (forecast tracker, weekly snapshots, sales-in
targets) lives in **Firestore**; uploaded reports stay in each browser, as on claude.ai.

| File | What it does |
|---|---|
| `server.js` | Serves the hub files and `/api/db/{forecast,weekly,targets}` (Firestore; `STORE=memory` for local tests) |
| `claude-shim.js` | Gives the hub page the `window.claude.use('db')` API it uses on claude.ai, backed by `/api/db` |
| `make_bundle.sh` | Builds the Cloud Run source folder from a built hub folder (adds the shim to `index.html`) |
| `setup_project.sh` | Once, by a project owner in Cloud Shell: APIs, Firestore, build / runtime / IAP grants, and the `hub-deployer` service account |
| `deploy.sh` | Deploys (or redeploys) with IAP in `asia-east2` and grants access; runs as `hub-deployer` |

The built hub files contain customer data. **Never put a bundle in this repo** — `make_bundle.sh` refuses to
write inside it.

## Deploy

Needs a Google Cloud project with billing.

1. Once, as a project owner in Cloud Shell (clone this repo there):
   ```sh
   PROJECT=your-project deploy/gcp/setup_project.sh
   ```
   It creates the `hub-deployer` service account and, if the organization allows it, a key for it.
2. Every deploy, as `hub-deployer` (or an owner):
   ```sh
   ./make_bundle.sh /path/to/built-hub /tmp/hub-bundle
   PROJECT=your-project USERS="user:you@example.com" ./deploy.sh /tmp/hub-bundle
   ```

`USERS` takes `user:`, `group:` or `domain:` members, comma-separated. If the organization blocks service
account keys (`iam.disableServiceAccountKeyCreation`, on by default for organizations created since May 2024),
an admin can exempt the project, or an owner runs `deploy.sh` in Cloud Shell.

## Local test

```sh
./make_bundle.sh /path/to/built-hub /tmp/hub-bundle
cd /tmp/hub-bundle && STORE=memory PORT=8090 node server.js
```
