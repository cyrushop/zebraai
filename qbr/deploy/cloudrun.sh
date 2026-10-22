#!/usr/bin/env bash
# Deploy the QBR deck to Google Cloud Run (Hong Kong region), password-protected.
#
#   PROJECT_ID=zebraqbr ./deploy/cloudrun.sh
#
# First run: creates a random password in Secret Manager and prints it.
# Later runs: reuse the stored password (rotate with: ROTATE_PASSWORD=1).
set -euo pipefail
: "${PROJECT_ID:?set PROJECT_ID, e.g. PROJECT_ID=zebraqbr}"
REGION="${REGION:-asia-east2}"            # Hong Kong
SERVICE="${SERVICE:-zebra-hk-qbr}"
AUTH_USER="${AUTH_USER:-zebra}"
SECRET="${SERVICE}-password"

cd "$(dirname "$0")/.."
gcloud config set project "$PROJECT_ID" >/dev/null

if [ "$(gcloud billing projects describe "$PROJECT_ID" --format='value(billingEnabled)')" != "True" ]; then
  echo "Billing is not enabled for $PROJECT_ID."
  echo "Link a billing account: https://console.cloud.google.com/billing/linkedaccount?project=$PROJECT_ID"
  exit 1
fi

echo "==> Enabling APIs (first time takes a minute)"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com

echo "==> Password in Secret Manager"
NEW_PASSWORD=""
if ! gcloud secrets describe "$SECRET" >/dev/null 2>&1; then
  gcloud secrets create "$SECRET" --replication-policy=automatic
  ROTATE_PASSWORD=1
fi
if [ "${ROTATE_PASSWORD:-}" = "1" ]; then
  NEW_PASSWORD="$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | cut -c1-20)"
  printf '%s' "$NEW_PASSWORD" | gcloud secrets versions add "$SECRET" --data-file=-
fi

# Cloud Run's default runtime identity must be able to read the secret.
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
gcloud secrets add-iam-policy-binding "$SECRET" \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role=roles/secretmanager.secretAccessor >/dev/null

echo "==> Building with the Dockerfile and deploying (Cloud Run sets PORT=8080)"
gcloud run deploy "$SERVICE" --source . --region "$REGION" \
  --allow-unauthenticated \
  --set-env-vars "BASIC_AUTH_USER=${AUTH_USER}" \
  --set-secrets "BASIC_AUTH_PASS=${SECRET}:latest" \
  --memory 256Mi --cpu 1 --min-instances 0 --max-instances 3 --quiet

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"
echo
echo "Deployed: $URL"
echo "User:     $AUTH_USER"
if [ -n "$NEW_PASSWORD" ]; then
  echo "Password: $NEW_PASSWORD   (new; shown once, stored in Secret Manager as $SECRET)"
else
  echo "Password: unchanged. Show it with: gcloud secrets versions access latest --secret=$SECRET"
fi
