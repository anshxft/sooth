# SOOTH: notes for AI agents and reviewers

SOOTH is a yes/no oracle on NEAR testnet: several AI agents stake NEAR on sealed answers, and the
contract pays the ones that were right out of the stakes of the ones that were wrong. Swarm
Contractor, built on it, is a sealed-bid job market for AI workers whose disputes go to the SOOTH jury.
The human-facing overview is [README.md](README.md).

## Verify in two minutes (no install, no keys, read-only)

```bash
node scripts/verify.mjs
```

Node 18+. It reads `sooth.testnet`, `sooth-swarm.testnet` and https://sooth-wine.vercel.app and prints
✓ or ✗ for each README claim: the bribed juror slashed, evidence hashes matching the chain, the
cheating worker losing its dispute and being banned, the DAO fallback, the honest agents never wrong,
a question from an outside account settled by the agents, and every page of the site serving.

Single claims by hand, with [near-cli-rs](https://github.com/near/near-cli-rs):

```bash
near contract call-function as-read-only sooth.testnet get_question json-args '{"question_id":5}' network-config testnet now
near contract call-function as-read-only sooth-swarm.testnet get_job json-args '{"job_id":3}' network-config testnet now
near contract call-function as-read-only sooth.testnet list_agents json-args '{"from_index":0,"limit":10}' network-config testnet now
```

## Build and test

CI runs all of this on every push: [actions/workflows/ci.yml](https://github.com/anshxft/sooth/actions/workflows/ci.yml) (all green as of 14 Nov 2026: 53 + 55 unit tests, 2 sandbox tests, simulation, web, claims).

| What | Command | Needs |
| --- | --- | --- |
| Oracle contract: 53 unit tests + a sandbox round | `cd contracts/sooth && cargo test` | Linux or WSL, Rust 1.93 (`rust-toolchain.toml`), cargo-near |
| Job-market contract: 55 unit tests + a sandbox dispute | `cd contracts/swarm && cargo test` | same |
| Market simulation (600 jobs, the contract's own award code) | `cd contracts/swarm && cargo run --example market` | same |
| Web app: typecheck, lint, build | `cd web && npm ci && npx tsc -b && npm run lint && npm run build` | Node 20+ |
| Agents: one jury pass | `cd agents && npm ci && npm run once` | Node 24, keys in `agents/.env` (see `.env.example`) |

## Where things are

| Path | What |
| --- | --- |
| `contracts/sooth/src/lib.rs` | Oracle: `ask_question`, `commit`, `reveal`, `tally`, `finalize`, `dao_resolve`, views |
| `contracts/sooth/src/payout.rs`, `math.rs` | Settlement math: integer only, money conserved (`payout::conserved`) |
| `contracts/swarm/src/lib.rs` | Job market: `create_task`, `open_job`, sealed bids, `submit`, `accept`, `dispute`, `on_sooth_resolved`, `settle` |
| `contracts/swarm/src/award.rs` | Winner = lowest price ÷ reputation |
| `docs/interface.md` | Frozen interface: types, methods, events, errors, payout formulas |
| `agents/run.mts`, `agents/swarm.mts` | The jury and the swarm (contractor + workers); `agents/lib.mts` is shared |
| `.github/workflows/agents.yml` | Runs the agents around the clock on GitHub Actions; each run starts the next |
| `web/src/pages/` | Arena, Question, Agents, Swarm/Task, Ask, Hire, Build, Benchmark |
| `web/public/d/` | Evidence, briefs and deliverables, named by their sha256 (the hash is on chain) |
| `benchmark/` | Dispute benchmark (run, 11/12) and a pre-registered benchmark (not run, and the README says so) |

## Things to know before judging

- Testnet only and not externally audited. All agents are run by this team today.
- The jurors use three open-weight models from one provider (Groq), so their errors can correlate.
- The README's numbers are dated, and agent stats grow as new questions settle. `verify.mjs` checks the
  invariants (honest agents never wrong, `mallory` never right) rather than fixed counts.
- Bot keys are NEAR function-call keys: they can call only the bot's own methods and cannot move NEAR.
- Secrets are never committed (`.gitignore`); the agents get them from GitHub Actions secrets.
