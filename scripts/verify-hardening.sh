#!/bin/sh
# Verifies the FLX-112 hardening pass against a running instance.
# Usage: FLUXION_API_KEY=... sh scripts/verify-hardening.sh [baseUrl]
BASE="${1:-http://localhost:3002}"
KEY="${FLUXION_API_KEY:?FLUXION_API_KEY must be set}"
fails=0

check() { # label expected actual
  if [ "$2" = "$3" ]; then echo "  [PASS] $1"; else echo "  [FAIL] $1 (expected $2, got $3)"; fails=$((fails+1)); fi
}

echo "1. Unauthenticated mutations are rejected"
check "POST /api/products no key -> 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/products" -H 'Content-Type: application/json' -d '{"name":"x","slug":"XX"}')"
check "PUT /api/products/:id no key -> 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$BASE/api/products/anything" -H 'Content-Type: application/json' -d '{"name":"x"}')"
check "DELETE /api/products/:id no key -> 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE/api/products/anything")"
check "POST /api/webhooks/cicd no key -> 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/webhooks/cicd" -H 'Content-Type: application/json' -d '{"status":"failure"}')"
check "POST /api/webhooks/telemetry no key -> 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/webhooks/telemetry" -H 'Content-Type: application/json' -d '{"type":"activity","payload":{}}')"
check "POST /api/products/trail-sync/sync no key -> 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/products/trail-sync/sync" -H 'Content-Type: application/json' -d '{"batchKey":"x","deltas":[]}')"
check "POST /api/mcp no key -> 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/mcp" -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')"

echo "2. Authenticated requests succeed"
check "GET /api/products (open read) -> 200" 200 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/products")"
check "POST /api/mcp tools/list with key -> 200" 200 "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/mcp" -H 'Content-Type: application/json' -H "x-api-key: $KEY" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')"
check "Dashboard renders -> 200" 200 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/")"

echo "3. Runtime is production"
hdr=$(curl -s -I "$BASE/" | tr -d '\r' | grep -i '^x-powered-by' || true)
echo "  info: ${hdr:-no x-powered-by header}"

if [ "$fails" -eq 0 ]; then echo "ALL HARDENING CHECKS PASSED"; else echo "$fails CHECK(S) FAILED"; exit 1; fi
