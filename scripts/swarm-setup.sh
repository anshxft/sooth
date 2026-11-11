#!/usr/bin/env bash
# Create, fund and deploy SOOTH Swarm on testnet. Run inside WSL; safe to re-run.
#   CONTRACTOR_PK=ed25519:.. QUILL_PK=.. LEDGER_PK=.. SHADE_PK=.. bash scripts/swarm-setup.sh
#   bash scripts/swarm-setup.sh upgrade        code-only redeploy, keeps state
# The public keys come from `node agents/swarm.mts --new-key <bot>` (private halves stay in agents/.env).
# Signs with the full keys in ~/.near-credentials (legacy keychain); the bots only ever get function-call keys.
set -euo pipefail
cd "$(dirname "$0")/../contracts/swarm"
source ~/.cargo/env
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$HOME/.cache/sooth-target}"

C=sooth-swarm.testnet
SOOTH=sooth.testnet
NET=(network-config testnet sign-with-legacy-keychain send)
CONTRACTOR_METHODS='open_job, accept, dispute, award, cancel_job'
WORKER_METHODS='commit_bid, reveal_bid, submit, claim, award'

exists() { near account view-account-summary "$1" network-config testnet now >/dev/null 2>&1; }
call() { near contract call-function as-transaction "$C" "$2" json-args "$3" prepaid-gas '30.0 Tgas' attached-deposit "$4" sign-as "$1" "${NET[@]}"; }

if [ "${1:-}" = "upgrade" ]; then
  # Only safe while the stored layout is unchanged (src/types.rs).
  cargo near deploy build-non-reproducible-wasm "$C" without-init-call "${NET[@]}"
  exit 0
fi

: "${CONTRACTOR_PK:?}" "${QUILL_PK:?}" "${LEDGER_PK:?}" "${SHADE_PK:?}"
exists "$C" || near account create-account sponsor-by-faucet-service "$C" autogenerate-new-keypair save-to-legacy-keychain network-config testnet create

# Sub-accounts: every action on chain traces back to one named agent.
for spec in contractor:0.5 quill:1.5 ledger:1.5 shade:1.5; do
  name=${spec%%:*}
  exists "$name.$C" || near account create-account fund-myself "$name.$C" "${spec##*:} NEAR" autogenerate-new-keypair save-to-legacy-keychain sign-as "$C" "${NET[@]}"
done

if near contract call-function as-read-only "$C" get_config json-args '{}' network-config testnet now >/dev/null 2>&1; then
  echo "contract already initialised"
else
  cargo near deploy build-non-reproducible-wasm "$C" with-init-call new json-args "{\"owner\":\"$C\",\"sooth\":\"$SOOTH\"}" \
    prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' "${NET[@]}"
  # Demo juries run in minutes; real disputes would use hours.
  call "$C" set_jury_timings '{"timings":{"commit_secs":60,"reveal_secs":60,"challenge_secs":60}}' '1 yoctoNEAR'
  for name in quill ledger shade; do
    call "$name.$C" register_worker "{\"name\":\"$name\"}" '1.2 NEAR'
  done
fi

add_bot_key() {
  near account add-key "$1" grant-function-call-access --allowance '0.5 NEAR' --contract-account-id "$C" \
    --function-names "$2" use-manually-provided-public-key "$3" "${NET[@]}" || echo "key for $1 not added (already there?)"
}
add_bot_key "contractor.$C" "$CONTRACTOR_METHODS" "$CONTRACTOR_PK"
add_bot_key "quill.$C" "$WORKER_METHODS" "$QUILL_PK"
add_bot_key "ledger.$C" "$WORKER_METHODS" "$LEDGER_PK"
add_bot_key "shade.$C" "$WORKER_METHODS" "$SHADE_PK"

near contract call-function as-read-only "$C" list_workers json-args '{"limit":10}' network-config testnet now
