#!/usr/bin/env bash
# One-time Google Cloud setup so Claude can deploy the PC Price Check page to
# Cloud Run with tools/deploy_cloud_run.sh.
#
# Run it in Cloud Shell (console.cloud.google.com, the >_ icon at the top right):
#   bash gcp_setup_cloudshell.sh PROJECT_ID
#
# It enables the Cloud Run, Cloud Build and Artifact Registry APIs, creates the
# service account claude-deployer with the roles a source deploy needs, and
# prints GCP_PROJECT and GCP_SA_KEY_B64 to paste into the Claude environment
# settings. The key file is deleted afterwards; the printed text is the only copy.
set -euo pipefail

PROJECT="${1:-$(gcloud config get-value project 2>/dev/null || true)}"
if [ -z "$PROJECT" ]; then
  echo "usage: bash gcp_setup_cloudshell.sh PROJECT_ID" >&2
  exit 1
fi
gcloud config set project "$PROJECT" >/dev/null

gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com

SA="claude-deployer@$PROJECT.iam.gserviceaccount.com"
gcloud iam service-accounts describe "$SA" >/dev/null 2>&1 ||
  gcloud iam service-accounts create claude-deployer --display-name="Claude Cloud Run deployer"

grant() {
  if gcloud projects add-iam-policy-binding "$PROJECT" --member="$1" --role="$2" --condition=None --quiet >/dev/null; then
    echo "granted $2 to $1"
  else
    echo "WARNING: could not grant $2 to $1" >&2
  fi
}
# Source deploy (run.sourceDeveloper), public access on the service (run.admin),
# API use (serviceUsageConsumer) and acting as the runtime account (serviceAccountUser).
for role in roles/run.sourceDeveloper roles/run.admin roles/serviceusage.serviceUsageConsumer roles/iam.serviceAccountUser; do
  grant "serviceAccount:$SA" "$role"
done
# Cloud Build builds the image as the Compute Engine default service account.
NUM="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
grant "serviceAccount:$NUM-compute@developer.gserviceaccount.com" roles/run.builder

umask 077
KEY="$(mktemp)"
trap 'rm -f "$KEY"' EXIT
gcloud iam service-accounts keys create "$KEY" --iam-account="$SA" --quiet

echo
echo "Paste these two lines into the Claude environment settings (environment variables):"
echo "GCP_PROJECT=$PROJECT"
echo "GCP_SA_KEY_B64=$(base64 -w0 "$KEY")"
