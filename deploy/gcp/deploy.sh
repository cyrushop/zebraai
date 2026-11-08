#!/usr/bin/env bash
# Deploy the Zebra Sales Hub to Cloud Run (Hong Kong region) behind Identity-Aware Proxy.
# Safe to run again: the first run also sets up the project, later runs just redeploy.
#   PROJECT=my-project USERS="user:a@example.com,domain:example.com" ./deploy.sh BUNDLE_DIR
# BUNDLE_DIR comes from make_bundle.sh. USERS are the people (or a whole domain / group) allowed to open the hub.
set -euo pipefail
: "${PROJECT:?set PROJECT to the Google Cloud project id}"
REGION=${REGION:-asia-east2}
SERVICE=${SERVICE:-zebra-sales-hub}
src=${1:?usage: PROJECT=… USERS=… ./deploy.sh BUNDLE_DIR}

gcloud config set project "$PROJECT" >/dev/null
num=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')

echo "· APIs"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  firestore.googleapis.com iap.googleapis.com --quiet

echo "· Firestore (shared forecast tracker, weekly snapshots, sales-in targets)"
gcloud firestore databases describe --database='(default)' >/dev/null 2>&1 ||
  gcloud firestore databases create --database='(default)' --location="$REGION" --quiet

echo "· Cloud Run service $SERVICE in $REGION (sign-in by IAP, no public access)"
gcloud run deploy "$SERVICE" --source "$src" --region "$REGION" \
  --no-allow-unauthenticated --iap --memory 512Mi --max-instances 2 --quiet

echo "· access"
# IAP calls the service on the signed-in user's behalf
gcloud run services add-iam-policy-binding "$SERVICE" --region "$REGION" \
  --member "serviceAccount:service-$num@gcp-sa-iap.iam.gserviceaccount.com" --role roles/run.invoker --quiet >/dev/null
IFS=',' read -ra who <<< "${USERS:-}"
for m in "${who[@]}"; do
  gcloud iap web add-iam-policy-binding --resource-type=cloud-run --service "$SERVICE" --region "$REGION" \
    --member "$m" --role roles/iap.httpsResourceAccessor --quiet >/dev/null
  echo "  can open: $m"
done
# the service's own account reads and writes Firestore
sa=$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(spec.template.spec.serviceAccountName)')
sa=${sa:-$num-compute@developer.gserviceaccount.com}
gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$sa" --role roles/datastore.user \
  --condition=None --quiet >/dev/null

echo "· done: $(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"
