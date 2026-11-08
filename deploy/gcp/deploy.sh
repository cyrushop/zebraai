#!/usr/bin/env bash
# Deploy (or redeploy) the Zebra Sales Hub to Cloud Run behind Identity-Aware Proxy.
# Run setup_project.sh once first. Then, as the hub-deployer service account or a project owner:
#   PROJECT=my-project USERS="user:a@example.com" ./deploy.sh BUNDLE_DIR
# BUNDLE_DIR comes from make_bundle.sh. USERS (user:, group: or domain:, comma-separated) may open the hub.
set -euo pipefail
: "${PROJECT:?set PROJECT to the Google Cloud project id}"
REGION=${REGION:-asia-east2}
SERVICE=${SERVICE:-zebra-sales-hub}
src=${1:?usage: PROJECT=… USERS=… ./deploy.sh BUNDLE_DIR}
gcloud config set project "$PROJECT" >/dev/null

echo "· Cloud Run service $SERVICE in $REGION (sign-in by IAP, no public access)"
gcloud run deploy "$SERVICE" --source "$src" --region "$REGION" \
  --no-allow-unauthenticated --iap --memory 512Mi --max-instances 2 --quiet

IFS=',' read -ra who <<< "${USERS:-}"
for m in "${who[@]}"; do
  gcloud iap web add-iam-policy-binding --resource-type=cloud-run --service "$SERVICE" --region "$REGION" \
    --member "$m" --role roles/iap.httpsResourceAccessor --quiet >/dev/null
  echo "· can open: $m"
done
echo "· done: $(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"
