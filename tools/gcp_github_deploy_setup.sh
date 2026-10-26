#!/usr/bin/env bash
# One-time Google Cloud setup so GitHub Actions in cyrushop/zebraai can deploy the
# PC Price Check page to Cloud Run without a service account key (Workload
# Identity Federation). Run gcp_setup_cloudshell.sh first: it creates
# claude-deployer and its roles (its key step may fail where keys are blocked;
# this replaces it).
#
# Run it in Cloud Shell:
#   bash gcp_github_deploy_setup.sh PROJECT_ID
set -euo pipefail

REPO="cyrushop/zebraai"
POOL="github"
PROVIDER="zebraai"

PROJECT="${1:-$(gcloud config get-value project 2>/dev/null || true)}"
if [ -z "$PROJECT" ]; then
  echo "usage: bash gcp_github_deploy_setup.sh PROJECT_ID" >&2
  exit 1
fi
PROJECT="$(gcloud projects describe "$PROJECT" --format='value(projectId)')"
NUM="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
SA="claude-deployer@$PROJECT.iam.gserviceaccount.com"
gcloud config set project "$PROJECT" >/dev/null
gcloud iam service-accounts describe "$SA" >/dev/null

gcloud services enable iamcredentials.googleapis.com sts.googleapis.com

gcloud iam workload-identity-pools describe "$POOL" --location=global >/dev/null 2>&1 ||
  gcloud iam workload-identity-pools create "$POOL" --location=global --display-name="GitHub Actions"

# Only tokens issued to this one repository are accepted.
gcloud iam workload-identity-pools providers describe "$PROVIDER" --location=global \
  --workload-identity-pool="$POOL" >/dev/null 2>&1 ||
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" --location=global \
    --workload-identity-pool="$POOL" --display-name="cyrushop/zebraai" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
    --attribute-condition="assertion.repository=='$REPO'"

gcloud iam service-accounts add-iam-policy-binding "$SA" --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$NUM/locations/global/workloadIdentityPools/$POOL/attribute.repository/$REPO" \
  --condition=None --quiet >/dev/null

echo
echo "Done. Tell Claude these two values (they are not secrets):"
echo "workload_identity_provider: projects/$NUM/locations/global/workloadIdentityPools/$POOL/providers/$PROVIDER"
echo "service_account: $SA"
