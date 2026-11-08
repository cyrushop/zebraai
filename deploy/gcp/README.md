# Zebra Sales Hub on Google Cloud

Runs the hub on **Cloud Run** (region `asia-east2`, Hong Kong) behind **Identity-Aware Proxy**: only the
Google accounts you list can open it. The hub's shared data (forecast tracker, weekly snapshots, sales-in
targets) lives in **Firestore**; uploaded reports stay in each browser, as on claude.ai.

| File | What it does |
|---|---|
| `server.js` | Serves the hub files and `/api/db/{forecast,weekly,targets}` (Firestore; `STORE=memory` for local tests) |
| `claude-shim.js` | Gives the hub page the `window.claude.use('db')` API it uses on claude.ai, backed by `/api/db` |
| `make_bundle.sh` | Builds the Cloud Run source folder from a built hub folder (adds the shim to `index.html`) |
| `deploy.sh` | Enables the APIs, creates Firestore, deploys with IAP, grants access; safe to re-run |

The built hub files contain customer data. **Never put a bundle in this repo** — `make_bundle.sh` refuses to
write inside it.

## Deploy

Needs a Google Cloud project with billing, and `gcloud` signed in as someone who can enable APIs and deploy.

```sh
./make_bundle.sh /path/to/built-hub /tmp/hub-bundle
PROJECT=your-project USERS="user:you@example.com" ./deploy.sh /tmp/hub-bundle
```

`USERS` takes `user:`, `group:` or `domain:` members, comma-separated. To add someone later, run the
`gcloud iap web add-iam-policy-binding` line from `deploy.sh` for them.

In a project that is not in a Google Workspace / Cloud organization, the first IAP setup may have to be done
once in the Cloud Console (Security → Identity-Aware Proxy).

## Local test

```sh
./make_bundle.sh /path/to/built-hub /tmp/hub-bundle
cd /tmp/hub-bundle && STORE=memory PORT=8090 node server.js
```
