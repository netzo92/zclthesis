#!/bin/zsh
# Opens the existing private dashboard; this does not create cloud credentials.
set -euo pipefail

analytics_gcloud=/Users/metehanozten/google-cloud-sdk/bin/gcloud
if [[ ! -x "$analytics_gcloud" ]]; then
  analytics_gcloud=$(command -v gcloud || true)
fi
if [[ -z "$analytics_gcloud" ]]; then
  print -u2 'Google Cloud CLI is required. Use the existing authorized account and SSH key.'
  exit 1
fi

analytics_project=${ZCL_ANALYTICS_PROJECT:-myzclthesis-20260912}
analytics_vm=${ZCL_ANALYTICS_VM:-zcl-pool}
analytics_zone=${ZCL_ANALYTICS_ZONE:-us-central1-a}
analytics_local_port=18091
analytics_url="http://127.0.0.1:$analytics_local_port"
if /usr/sbin/lsof -nP -iTCP:$analytics_local_port -sTCP:LISTEN >/dev/null 2>&1; then
  print -u2 "Local port $analytics_local_port is already in use. Close the existing tunnel and try again."
  exit 1
fi

analytics_key_options=()
if [[ -f /private/tmp/zcl-pool-gcp-ssh ]]; then
  analytics_key_options+=(--ssh-key-file=/private/tmp/zcl-pool-gcp-ssh)
elif [[ -f "$HOME/.ssh/google_compute_engine" ]]; then
  analytics_key_options+=("--ssh-key-file=$HOME/.ssh/google_compute_engine")
else
  print -u2 'The existing SSH key is missing. Restore the authorized key before opening this dashboard.'
  exit 1
fi

analytics_tunnel_pid=''
analytics_cleanup() {
  if [[ -n "$analytics_tunnel_pid" ]]; then
    # gcloud runs ssh as a child. Close it as well as the CLI wrapper so the
    # local listener cannot survive this terminal's exit.
    /usr/bin/pkill -TERM -P "$analytics_tunnel_pid" 2>/dev/null || true
    kill "$analytics_tunnel_pid" 2>/dev/null || true
    wait "$analytics_tunnel_pid" 2>/dev/null || true
    analytics_tunnel_pid=''
  fi
}
trap analytics_cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

print 'Opening the private analytics tunnel with the existing Google Cloud account…'
"$analytics_gcloud" compute ssh "$analytics_vm" --project="$analytics_project" \
  --zone="$analytics_zone" --tunnel-through-iap "${analytics_key_options[@]}" -- \
  -N -L "127.0.0.1:$analytics_local_port:127.0.0.1:8091" \
  -o ExitOnForwardFailure=yes -o BatchMode=yes \
  -o ServerAliveInterval=30 -o ServerAliveCountMax=3 &
analytics_tunnel_pid=$!

for analytics_attempt in {1..60}; do
  if ! kill -0 "$analytics_tunnel_pid" 2>/dev/null; then
    print -u2 'The IAP tunnel did not start. Check your existing Google Cloud login and SSH access.'
    exit 1
  fi
  if /usr/bin/curl --noproxy '*' --silent --fail --max-time 1 "$analytics_url/health" >/dev/null; then
    /usr/bin/open "$analytics_url/"
    print 'Private analytics is open. Keep this window open; Ctrl+C closes the tunnel.'
    wait "$analytics_tunnel_pid"
    exit 0
  fi
  sleep 1
done
print -u2 'The private dashboard did not become ready within the connection timeout.'
exit 1
