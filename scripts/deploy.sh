#!/usr/bin/env bash
# Fluxion production deploy: pull the canonical clone, rebuild the image
# (old container keeps serving), swap the container, then verify the
# dashboard and MCP handshake. Fails loudly between steps.
#
# Runs on the codejourney host. Only pushed commits reach production:
# the image builds from the canonical clone, never from a dev checkout.
#
# Usage: scripts/deploy.sh --reason "why"     (--reason is forwarded to orca)
set -euo pipefail

REPO=/opt/codejourney/repos/fluxion
DEPLOY=/opt/codejourney/services/fluxion
URL=http://localhost:3002

REASON=""
while [ $# -gt 0 ]; do
  case "$1" in
    --reason) REASON="${2:?--reason needs a value}"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; echo "usage: $0 --reason \"why\"" >&2; exit 2 ;;
  esac
done
[ -n "$REASON" ] || { echo "usage: $0 --reason \"why\"" >&2; exit 2; }

echo "==> pulling $REPO"
git -C "$REPO" pull --ff-only
SHA=$(git -C "$REPO" rev-parse --short HEAD)

echo "==> building image from clone at $SHA (old container keeps serving)"
cd "$DEPLOY"
orca build --reason "$REASON (deploy $SHA)"

echo "==> swapping container"
orca up --reason "$REASON (deploy $SHA)"

echo "==> verifying dashboard"
code=""
for _ in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$URL/" || true)
  [ "$code" = "200" ] && break
  sleep 1
done
[ "$code" = "200" ] || { echo "FAIL: dashboard returned '$code' after 30s" >&2; exit 1; }

echo "==> verifying MCP handshake"
# .env stores the key double-quoted; strip quotes (and any CR) before use
KEY=$(grep -oP '^FLUXION_API_KEY=\K.*' "$DEPLOY/.env" | tr -d '"\r')
RESP=$(curl -s "$URL/api/mcp" -H "x-api-key: $KEY" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"deploy-verify","version":"0"}}}')
echo "$RESP" | grep -q '"serverInfo"' || { echo "FAIL: MCP initialize response: $RESP" >&2; exit 1; }

echo "OK: deployed $SHA — dashboard 200, MCP handshake verified"
