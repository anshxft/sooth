#!/usr/bin/env bash
# Build and deploy the SOOTH contract to testnet. Run inside WSL.
#   bash scripts/deploy.sh                       first deploy to sooth.testnet (calls new)
#   bash scripts/deploy.sh sooth.testnet upgrade code-only redeploy, keeps state
# Env: TREASURY (default soothdev.testnet). Signs with the key in ~/.near-credentials (legacy keychain).
set -euo pipefail
cd "$(dirname "$0")/../contracts/sooth"
source ~/.cargo/env
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$HOME/.cache/sooth-target}"

ACCOUNT="${1:-sooth.testnet}"
MODE="${2:-init}"
TREASURY="${TREASURY:-soothdev.testnet}"
NET=(network-config testnet sign-with-legacy-keychain send)

if [ "$MODE" = "init" ]; then
  INIT=$(printf '{"owner":"%s","dao_account":"%s","treasury":"%s"}' "$ACCOUNT" "$ACCOUNT" "$TREASURY")
  cargo near deploy build-non-reproducible-wasm "$ACCOUNT" \
    with-init-call new json-args "$INIT" prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' "${NET[@]}"
else
  # Only safe while the stored layout is unchanged (types.rs); otherwise deploy to a fresh account.
  cargo near deploy build-non-reproducible-wasm "$ACCOUNT" without-init-call "${NET[@]}"
fi

near contract call-function as-read-only "$ACCOUNT" get_config json-args '{}' network-config testnet now
