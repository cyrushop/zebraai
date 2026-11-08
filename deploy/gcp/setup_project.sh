#!/usr/bin/env bash
# One-time project setup, run by a project owner in Cloud Shell:
#   PROJECT=my-project ./setup_project.sh
# Enables the APIs, creates Firestore, grants the build and runtime identities what they need, and creates
# the "hub-deployer" service account that deploy.sh runs as (it can deploy the hub and nothing more).
set -euo pipefail
: "${PROJECT:?set PROJECT to the Google Cloud project id}"
REGION=${REGION:-asia-east2}
gcloud config set project "$PROJECT" >/dev/null
num=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
compute="$num-compute@developer.gserviceaccount.com"
deployer="hub-deployer@$PROJECT.iam.gserviceaccount.com"
grant() { gcloud projects add-iam-policy-binding "$PROJECT" --member "$1" --role "$2" --condition=None --quiet >/dev/null; echo "  $2 → ${1#*:}"; }

echo "· APIs"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  firestore.googleapis.com iap.googleapis.com iam.googleapis.com --quiet

echo "· Firestore in $REGION"
gcloud firestore databases describe --database='(default)' >/dev/null 2>&1 ||
  gcloud firestore databases create --database='(default)' --location="$REGION" --quiet

echo "· build and runtime identity ($compute)"
grant "serviceAccount:$compute" roles/run.builder        # builds the source on deploy
grant "serviceAccount:$compute" roles/datastore.user     # the running hub reads and writes Firestore

echo "· IAP"
gcloud beta services identity create --service=iap.googleapis.com --quiet >/dev/null
grant "serviceAccount:service-$num@gcp-sa-iap.iam.gserviceaccount.com" roles/run.invoker   # IAP calls the service for signed-in users

echo "· deployer service account ($deployer)"
gcloud iam service-accounts describe "$deployer" >/dev/null 2>&1 ||
  gcloud iam service-accounts create hub-deployer --display-name "Zebra Sales Hub deployer" --quiet
for r in roles/run.sourceDeveloper roles/run.admin roles/iam.serviceAccountUser roles/serviceusage.serviceUsageConsumer roles/iap.admin roles/browser; do
  grant "serviceAccount:$deployer" "$r"
done

echo "· key for the deployer"
key="$HOME/hub-deployer-key.json"
if gcloud iam service-accounts keys create "$key" --iam-account "$deployer" --quiet 2>/tmp/keyerr; then
  echo "  saved to $key"
  echo "  Add its whole content to the Claude Code cloud environment as the environment variable GCP_SA_KEY,"
  echo "  then delete the file here:  rm $key"
else
  echo "  Key creation was refused:"; sed 's/^/    /' /tmp/keyerr
  echo "  (usually the iam.disableServiceAccountKeyCreation organization policy; an admin can exempt this project)"
fi
echo "· done"
