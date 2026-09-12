#!/usr/bin/env bash
# Run on the pool VM after the operator separately creates collector.env.
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  printf '%s\n' 'Run this installer as root on the pool VM.' >&2
  exit 1
fi

analytics_source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
analytics_env=/etc/zcl-analytics/collector.env
analytics_state=/var/lib/zcl-analytics

# Check the existing secret file before making any installation changes. Never
# source it as shell code, print its contents, or overwrite it.
python3 - "$analytics_env" "$analytics_source_dir" <<'PY'
from pathlib import Path
import stat
import sys

env = Path(sys.argv[1])
source = Path(sys.argv[2])
try:
    info = env.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o600:
        raise ValueError('collector.env must be a regular root-owned file with mode 0600.')
    if not info.st_size:
        raise ValueError('collector.env must already contain the relay token and database path.')
    for directory in ('/etc/zcl-analytics', '/opt/zcl-analytics', '/var/lib/zcl-analytics'):
        path = Path(directory)
        if path.is_symlink() or path.exists() and not path.is_dir():
            raise ValueError('An analytics installation directory is not a regular directory.')
    for filename in ('collector.py', 'dashboard.html', 'dashboard.css', 'dashboard.js', 'zcl-analytics.service'):
        path = source / filename
        if path.is_symlink() or not path.is_file():
            raise ValueError('A required analytics source file is missing or is a symbolic link.')
    for filename in ('analytics.sqlite3', 'analytics.sqlite3-wal', 'analytics.sqlite3-shm'):
        path = Path('/var/lib/zcl-analytics') / filename
        if path.is_symlink() or path.exists() and not path.is_file():
            raise ValueError('An existing analytics database path is not a regular file.')
    compile((source / 'collector.py').read_bytes(), str(source / 'collector.py'), 'exec')
    import sqlite3  # The runtime uses only Python's standard library.
except (OSError, ValueError, SyntaxError, ImportError):
    sys.stderr.write('Analytics preflight failed. Check the root-owned 0600 collector.env, source files, and Python SQLite support.\n')
    sys.exit(1)
PY

if ! getent group zcl-analytics >/dev/null; then
  groupadd --system zcl-analytics
fi
if ! id -u zcl-analytics >/dev/null 2>&1; then
  useradd --system --gid zcl-analytics --home-dir "$analytics_state" \
    --no-create-home --shell /usr/sbin/nologin zcl-analytics
fi
if [[ $(id -u zcl-analytics) -eq 0 || $(id -gn zcl-analytics) != zcl-analytics ]]; then
  printf '%s\n' 'The existing analytics account must be unprivileged and use its dedicated group.' >&2
  exit 1
fi

install -d -o root -g root -m 0755 /opt/zcl-analytics
install -d -o zcl-analytics -g zcl-analytics -m 0700 "$analytics_state"
for analytics_asset in collector.py dashboard.html dashboard.css dashboard.js; do
  install -o root -g root -m 0644 "$analytics_source_dir/$analytics_asset" "/opt/zcl-analytics/$analytics_asset"
done
# Preserve existing event history and tighten only the database's known files.
for analytics_database in analytics.sqlite3 analytics.sqlite3-wal analytics.sqlite3-shm; do
  if [[ -f "$analytics_state/$analytics_database" ]]; then
    chown zcl-analytics:zcl-analytics "$analytics_state/$analytics_database"
    chmod 0600 "$analytics_state/$analytics_database"
  fi
done
install -o root -g root -m 0644 "$analytics_source_dir/zcl-analytics.service" \
  /etc/systemd/system/zcl-analytics.service

systemctl daemon-reload
systemctl enable zcl-analytics.service
systemctl restart zcl-analytics.service

# A successful restart alone does not establish database/dashboard readiness.
for analytics_attempt in {1..30}; do
  if python3 - <<'PY'
import json
import urllib.request

try:
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open('http://127.0.0.1:8091/health', timeout=1) as response:
        if response.status != 200 or json.load(response) != {'ok': True}:
            raise ValueError('Unexpected health response')
except Exception:
    raise SystemExit(1)
PY
  then
    printf '%s\n' 'Analytics is ready on loopback: collector 8792, private dashboard 8091.'
    printf '%s\n' 'The existing relay secret and Caddy configuration were not changed.'
    exit 0
  fi
  sleep 1
done
printf '%s\n' 'Analytics did not become healthy. Inspect: journalctl -u zcl-analytics.service' >&2
exit 1
