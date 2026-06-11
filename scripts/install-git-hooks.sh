#!/bin/sh
# Installs a post-commit hook that runs the local CI gates in the background
# and reports the build result to Fluxion telemetry. Opt-in by design — run
# this once per clone: sh scripts/install-git-hooks.sh
set -e
ROOT=$(git rev-parse --show-toplevel)
HOOK="$ROOT/.git/hooks/post-commit"

cat > "$HOOK" <<'EOF'
#!/bin/sh
# Fluxion local CI (FLX-116): non-blocking quality gates + build telemetry.
unset GIT_DIR
ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
nohup node --env-file=.env scripts/ci.mjs >> /tmp/fluxion-ci.log 2>&1 &
EOF

chmod +x "$HOOK"
echo "Installed post-commit CI hook -> $HOOK (logs: /tmp/fluxion-ci.log)"
