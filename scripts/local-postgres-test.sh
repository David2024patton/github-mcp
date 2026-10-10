#!/usr/bin/env bash
# Adapted from Robinson-AI-Systems/stripe-mcp scripts/local-postgres-test.sh @ e2f90e8 (Appliance Desk pattern).
# Runs the database suite against a disposable PostgreSQL: CI's throwaway service when TEST_DATABASE_URL is set
# (localhost only — the tests refuse any other host), otherwise a temporary cluster started from local binaries and
# deleted afterwards. Never a remote or Neon database.
# Usage: npm run test:db [-- tests/db/<file>.test.js ...]
set -euo pipefail
export CI=1
if [[ -n "${TEST_DATABASE_URL:-}" ]]; then
  exec npx --no-install vitest run --config vitest.db.config.js "$@"
fi
# Debian/Ubuntu keep server binaries outside PATH.
if ! command -v initdb >/dev/null 2>&1; then
  for dir in /usr/lib/postgresql/*/bin; do [[ -x "$dir/initdb" ]] && PATH="$dir:$PATH"; done
fi
for binary in initdb pg_ctl; do
  if ! command -v "$binary" >/dev/null 2>&1; then
    echo "Local PostgreSQL not installed ($binary missing). The CI 'db' job runs this suite on a throwaway service." >&2
    exit 2
  fi
done
tmp="$(mktemp -d)"
port="$((20000 + RANDOM % 10000))"
# PostgreSQL refuses to run as root; use the postgres (or nobody) account for the throwaway cluster.
run=()
if [[ "$(id -u)" == 0 ]]; then
  pg_user=postgres; id "$pg_user" >/dev/null 2>&1 || pg_user=nobody
  chown "$pg_user" "$tmp"
  run=(runuser -u "$pg_user" --)
fi
cleanup() { "${run[@]}" pg_ctl -D "$tmp/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$tmp"; }
trap cleanup EXIT
"${run[@]}" initdb -D "$tmp/data" -A trust -U postgres --no-instructions >/dev/null
"${run[@]}" pg_ctl -D "$tmp/data" -o "-p $port -k $tmp -c listen_addresses=localhost" -l "$tmp/pg.log" -w start >/dev/null
export TEST_DATABASE_URL="postgresql://postgres@localhost:$port/postgres"
npx --no-install vitest run --config vitest.db.config.js "$@"
