#!/usr/bin/env bash
set -euo pipefail
: "${GCP_PROJECT:?Set GCP_PROJECT to the destination project ID}"
app_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
gcloud run deploy myzclthesis \
  --project="$GCP_PROJECT" --region="${GCP_REGION:-us-central1}" \
  --source="$app_dir" --allow-unauthenticated \
  --port=8080 --cpu=1 --memory=256Mi --min-instances=0 --max-instances=2
