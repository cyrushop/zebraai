#!/usr/bin/env bash
# Build the offline PC Price Check page and deploy it to Cloud Run.
#
# Needs GCP_PROJECT. Signs in with GCP_SA_KEY_B64 (a service account JSON key,
# base64-encoded) when it is set, otherwise uses the current gcloud login.
# Optional: GCP_REGION (default asia-east2, Hong Kong), SERVICE (default pc-price-check).
#
# The page holds no customer data; the PC list is uploaded in the browser.
set -euo pipefail

: "${GCP_PROJECT:?set GCP_PROJECT to the Google Cloud project id}"
REGION="${GCP_REGION:-asia-east2}"
SERVICE="${SERVICE:-pc-price-check}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

src="$(mktemp -d)"
keydir="$(mktemp -d)"
trap 'rm -rf "$src" "$keydir"' EXIT

python3 -I "$ROOT/tools/build_pc_check.py" "$src/index.html"
cp "$ROOT/deploy/cloudrun/Dockerfile" "$ROOT/deploy/cloudrun/default.conf" "$src/"

GCLOUD=(gcloud)
if [ -n "${GCP_SA_KEY_B64:-}" ]; then
  # The key stays outside the uploaded source folder.
  printf '%s' "$GCP_SA_KEY_B64" | base64 -d > "$keydir/key.json"
  # A preset access token would override the key's login, so leave it out.
  GCLOUD=(env -u CLOUDSDK_AUTH_ACCESS_TOKEN gcloud)
  "${GCLOUD[@]}" auth activate-service-account --key-file="$keydir/key.json" --quiet
fi

"${GCLOUD[@]}" run deploy "$SERVICE" --source "$src" --project "$GCP_PROJECT" --region "$REGION" \
  --allow-unauthenticated --quiet
"${GCLOUD[@]}" run services describe "$SERVICE" --project "$GCP_PROJECT" --region "$REGION" --format='value(status.url)'
