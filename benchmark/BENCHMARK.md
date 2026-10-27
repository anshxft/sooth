# SOOTH benchmark — pre-registered 27 Oct 2026

**Question:** does a staked, multi-agent vote (SOOTH) settle real questions more accurately than the best single AI agent, and does a bribed agent change any outcome?

This list, the resolution sources and the metrics were fixed on **27 Oct 2026**, before any agent saw any of these questions. On 7 Nov only the placeholders are filled, mechanically, by the rules in [`questions.json`](questions.json) (`fill_rules`). Nothing is added, dropped or reworded after that.

## The 20 questions

| Key | Question (placeholders filled on 7 Nov) | Resolves after (UTC) | Source | Known answer |
| --- | --- | --- | --- | --- |
| C1 | BTC above $P0×1.00 at 00:00 UTC, 9 Nov? | 9 Nov 01:00 | CoinGecko daily snapshot | — |
| C2 | BTC above $P0×1.03 at 00:00 UTC, 10 Nov? | 10 Nov 01:00 | CoinGecko | — |
| C3 | ETH above $P0×0.98 at 00:00 UTC, 9 Nov? | 9 Nov 01:00 | CoinGecko | — |
| C4 | ETH above $P0×1.00 at 00:00 UTC, 10 Nov? | 10 Nov 01:00 | CoinGecko | — |
| C5 | SOL above $P0×1.02 at 00:00 UTC, 9 Nov? | 9 Nov 01:00 | CoinGecko | — |
| C6 | NEAR above $P0×1.00 at 00:00 UTC, 10 Nov? | 10 Nov 01:00 | CoinGecko | — |
| W1 | ≥ 5 mm rain in Chennai, 8 Nov (local day)? | 8 Nov 20:30 | Open-Meteo `precipitation_sum` | — |
| W2 | ≥ 1 mm rain in Chennai, 9 Nov? | 9 Nov 20:30 | Open-Meteo | — |
| W3 | ≥ 1 mm rain in Mumbai, 9 Nov? | 9 Nov 20:30 | Open-Meteo | — |
| W4 | ≥ 2 mm rain in Bengaluru, 8 Nov? | 8 Nov 20:30 | Open-Meteo | — |
| W5 | ≥ 1 mm rain in New Delhi, 10 Nov? | 10 Nov 20:30 | Open-Meteo | — |
| W6 | ≥ 1 mm rain in Singapore, 8 Nov? | 8 Nov 18:00 | Open-Meteo | — |
| W7 | ≥ 5 mm rain in Jakarta, 9 Nov? | 9 Nov 19:00 | Open-Meteo | — |
| W8 | ≥ 1 mm rain in London, 9 Nov? | 10 Nov 02:00 | Open-Meteo | — |
| S1 | Football: did {team_a} beat {team_b}? (draw = NO) | kickoff + 4 h | Official competition site | — |
| S2 | Basketball: did {team_a} beat {team_b}? | tip-off + 4 h | Official league site | — |
| S3 | Cricket (or 2nd football): did {team_a} beat {team_b}? (tie / no result = NO) | end + 4 h | Official board site | — |
| N1 | One official, date-certain event, 8–10 Nov | event + 4 h | Named official source | — |
| A1 | "Was the weather nice in London on 9 Nov 2026?" | 10 Nov 02:00 | none | **INVALID** |
| A2 | "Did crypto go up on 9 Nov 2026?" | 10 Nov 02:00 | none | **INVALID** |

`P0` = CoinGecko price at 00:00 UTC on 7 Nov, rounded to the step in `questions.json`. Thresholds sit near the posting price on purpose, so the answer is unknown when the question is posted.

**What each group tests**

- **Crypto + weather (14):** templated, so the data tool gives a deterministic fact. Tests pipeline reliability, timezones (local day vs UTC) and thresholds that sit close to the real value.
- **Sports + news (4):** free text, web search only. This is where single models make mistakes.
- **Ambiguous (2):** the only correct answer is `INVALID`. Tests whether agents refuse to guess.

## Ground truth

For C/W: the value of the named source, fetched by script at `resolve_after` + 6 h and saved to `benchmark/ground_truth.json` with the fetch time. For S/N: the official result page, recorded with its URL. A1/A2: `INVALID`, fixed today. Ground truth never comes from agent answers.

## Metrics (fixed now)

1. **Single agent:** accuracy and mean Brier score of each honest agent (atlas, nova, sage, echo) over all 20.
2. **Majority vote:** unweighted vote of the 4 honest agents (ties count as wrong).
3. **SOOTH auto-resolve:** coverage (% of questions confident in round 1) and accuracy on that subset.
4. **SOOTH final:** accuracy over all 20 after round 2 / DAO.
5. **Bribe test:** `mallory` (always opposite, 99 % confidence) takes part in every SOOTH round. We report how many outcomes it flipped and its net PnL.

Headline for the README: *best single agent X % vs SOOTH auto-resolve Y % on Z % coverage; mallory flipped N outcomes and lost M NEAR.* If SOOTH does worse on something, that is reported too.

## Logistics

| Item | Value |
| --- | --- |
| Post | 7 Nov, from `sooth.testnet`, by script reading `questions.json` |
| Timings | commit 60 min, reveal 30 min, challenge 30 min (longer than the 3-min demo so agents can run on a schedule) |
| Fee / min stake | 0.2 NEAR / 0.1 NEAR per question |
| Testnet NEAR | asker 20 × (0.2 fee + 0.1 storage) = **6 NEAR**; each agent ≤ 20 × 0.1 = 2 NEAR locked + gas → keep **≥ 3 NEAR per agent** (5 agents = 15). Top up from the faucet daily from 1 Nov |
| Agent schedule | Windows open at odd hours (e.g. 01:00 UTC = 06:30 IST). Agents run **unattended every 15 min** (GitHub Actions cron or an always-on machine) and also call `tally` / `finalize` |

## Known risks

- **Source revisions:** Open-Meteo past-day values can be revised. Questions resolve on the value fetched after `resolve_after`; agents and ground truth use the same endpoint.
- **Fixture changes:** postponed or abandoned matches resolve NO by the question text.
- **Small sample:** 20 questions show a direction, not statistical proof. The README says so.
