//! Tally and settlement math from docs/interface.md §5, as pure functions.
//! The reference is mock/make_mock.py; the tests compare against its output byte for byte.
use near_sdk::json_types::{I128, U64, U128};

use crate::types::{Answer, Payout, PayoutReason, Round, Tally, Weights};

pub struct Thresholds {
    pub auto_share_bps: u16,
    pub auto_conf_bps: u16,
    pub min_agents: u8,
}

/// Stake-weighted vote over one round's reveals.
pub fn tally(round: &Round, rules: &Thresholds, now: u64) -> Tally {
    let weight_of = |a: Answer| -> u128 {
        round.reveals.iter().filter(|r| r.answer == a).map(|r| r.weight.0).sum()
    };
    let (yes, no, invalid) = (weight_of(Answer::Yes), weight_of(Answer::No), weight_of(Answer::Invalid));
    let total = yes + no + invalid;
    let top = yes.max(no).max(invalid);
    let leaders: Vec<Answer> =
        [(Answer::Yes, yes), (Answer::No, no), (Answer::Invalid, invalid)].iter().filter(|(_, w)| *w == top).map(|(a, _)| *a).collect();
    let winner = (total > 0 && leaders.len() == 1).then(|| leaders[0]);

    let share_bps = if total > 0 { (top * 10_000 / total) as u16 } else { 0 };
    let avg_conf_bps = winner.map_or(0, |w| {
        let weighted: u128 = round.reveals.iter().filter(|r| r.answer == w).map(|r| r.weight.0 * u128::from(r.confidence)).sum();
        (weighted * 100 / top) as u16
    });
    let revealed = round.reveals.len() as u8;
    let confident = winner.is_some()
        && share_bps >= rules.auto_share_bps
        && avg_conf_bps >= rules.auto_conf_bps
        && revealed >= rules.min_agents;

    Tally {
        weights: Weights { yes: U128(yes), no: U128(no), invalid: U128(invalid) },
        winner,
        share_bps,
        avg_conf_bps,
        revealed,
        confident,
        tallied_at: U64(now),
    }
}

pub struct Settlement {
    pub payouts: Vec<Payout>,
    pub protocol_fee: u128,
    pub dust: u128,
    /// Non-zero only when nobody was right: the fee goes back to the asker.
    pub refund_to_asker: u128,
    /// Slashes that have no correct agent to go to (no-winner case).
    pub slashed_to_treasury: u128,
}

/// Payouts for every commit in every round, against the final answer.
/// Invariant: fee + Σslash = protocol_fee + Σreward + dust + refund + slashed_to_treasury.
pub fn settle(fee: u128, protocol_fee_bps: u16, rounds: &[Round], final_answer: Answer) -> Settlement {
    let mut payouts = Vec::new();
    let mut scores: Vec<(usize, u128)> = Vec::new();
    let mut total_slash: u128 = 0;

    for round in rounds {
        for commit in &round.commits {
            let stake = commit.stake.as_yoctonear();
            let reveal = round.reveals.iter().find(|r| r.account_id == commit.account_id);
            let (delta, reason) = match reveal {
                None => {
                    total_slash += stake;
                    (-(stake as i128), PayoutReason::NoReveal)
                }
                Some(r) if r.answer == final_answer => {
                    let miss = u128::from(100 - r.confidence);
                    scores.push((payouts.len(), stake * u128::from(r.rep_bps) * (10_000 - miss * miss)));
                    (0, PayoutReason::Correct)
                }
                Some(r) => {
                    let slash = stake * u128::from(r.confidence) / 100;
                    total_slash += slash;
                    (-(slash as i128), PayoutReason::Wrong)
                }
            };
            payouts.push(Payout {
                account_id: commit.account_id.clone(),
                round: round.round,
                stake: commit.stake,
                delta: I128(delta),
                reason,
            });
        }
    }

    let score_sum: u128 = scores.iter().map(|(_, s)| s).sum();
    if score_sum == 0 {
        return Settlement { payouts, protocol_fee: 0, dust: 0, refund_to_asker: fee, slashed_to_treasury: total_slash };
    }
    let protocol_fee = fee * u128::from(protocol_fee_bps) / 10_000;
    let pot = fee - protocol_fee + total_slash;
    let mut rewarded: u128 = 0;
    for (index, score) in scores {
        let reward = mul_div(pot, score, score_sum);
        rewarded += reward;
        payouts[index].delta = I128(reward as i128);
    }
    Settlement { payouts, protocol_fee, dust: pot - rewarded, refund_to_asker: 0, slashed_to_treasury: 0 }
}

/// floor(a × b / c) exactly, using a 256-bit intermediate. The result must fit in u128
/// (true here: a reward is never larger than the pot).
pub fn mul_div(a: u128, b: u128, c: u128) -> u128 {
    const MASK: u128 = u64::MAX as u128;
    let (a_hi, a_lo, b_hi, b_lo) = (a >> 64, a & MASK, b >> 64, b & MASK);
    let lo_lo = a_lo * b_lo;
    let hi_lo = a_hi * b_lo;
    let lo_hi = a_lo * b_hi;
    let cross = (lo_lo >> 64) + (hi_lo & MASK) + (lo_hi & MASK);
    let lo = (cross << 64) | (lo_lo & MASK);
    let hi = a_hi * b_hi + (hi_lo >> 64) + (lo_hi >> 64) + (cross >> 64);
    assert!(hi < c, "mul_div result overflows u128");

    // Restoring long division of (hi, lo) by c, one bit of `lo` at a time.
    let (mut rem, mut quotient) = (hi, 0u128);
    for bit in (0..128).rev() {
        let carry = rem >> 127;
        rem = (rem << 1) | ((lo >> bit) & 1);
        quotient <<= 1;
        if carry == 1 || rem >= c {
            rem = rem.wrapping_sub(c);
            quotient |= 1;
        }
    }
    quotient
}

/// The money invariant from docs/interface.md §5; checked in tests and before every payout.
pub fn conserved(fee: u128, s: &Settlement) -> bool {
    let slashed: u128 = s.payouts.iter().filter(|p| p.delta.0 < 0).map(|p| p.delta.0.unsigned_abs()).sum();
    let rewards: u128 = s.payouts.iter().filter(|p| p.delta.0 > 0).map(|p| p.delta.0 as u128).sum();
    fee + slashed == s.protocol_fee + rewards + s.dust + s.refund_to_asker + s.slashed_to_treasury
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::serde_json::{self, Value};

    const MOCK: &str = include_str!("../../../mock/questions.json");
    const RULES: Thresholds = Thresholds { auto_share_bps: 8_000, auto_conf_bps: 7_000, min_agents: 3 };

    fn mock_question(id: u64) -> Value {
        let all: Value = serde_json::from_str(MOCK).unwrap();
        all["questions"].as_array().unwrap().iter().find(|q| q["id"] == id).unwrap().clone()
    }

    fn round(q: &Value, index: usize) -> Round {
        serde_json::from_value(q["rounds"][index].clone()).expect("mock round matches the Rust Round type")
    }

    #[test]
    fn mul_div_is_exact_where_u128_would_overflow() {
        let (pot, score, sum) = (1_940_000_000_000_000_000_000_000u128, 147_840_000_000_000_000_000_000_000_000_000u128, 451_880_000_000_000_000_000_000_000_000_000u128);
        // pot × score does not fit in u128; expected value computed with Python's big ints.
        assert_eq!(mul_div(pot, score, sum), 634_703_018_500_486_854_917_234);
        assert_eq!(mul_div(u128::MAX, 3, 3), u128::MAX);
        assert_eq!(mul_div(7, 3, 2), 10);
        assert_eq!(mul_div(0, 5, 9), 0);
    }

    #[test]
    fn tally_matches_python_reference_q40_and_q41() {
        for (id, confident) in [(40, true), (41, false)] {
            let q = mock_question(id);
            let expected: Tally = serde_json::from_value(q["rounds"][0]["tally"].clone()).unwrap();
            let got = tally(&round(&q, 0), &RULES, expected.tallied_at.0);
            assert_eq!(got.winner, expected.winner, "q{id} winner");
            assert_eq!(got.share_bps, expected.share_bps, "q{id} share");
            assert_eq!(got.avg_conf_bps, expected.avg_conf_bps, "q{id} avg conf");
            assert_eq!(got.weights.yes.0, expected.weights.yes.0);
            assert_eq!(got.weights.no.0, expected.weights.no.0);
            assert_eq!(got.confident, confident);
        }
    }

    #[test]
    fn settle_matches_python_reference_q40_to_the_yocto() {
        let q = mock_question(40);
        let fee: u128 = q["fee"].as_str().unwrap().parse().unwrap();
        let s = settle(fee, 500, &[round(&q, 0)], Answer::Yes);
        let expected: Vec<Payout> = serde_json::from_value(q["payouts"].clone()).unwrap();
        assert_eq!(s.payouts.len(), expected.len());
        for (got, want) in s.payouts.iter().zip(&expected) {
            assert_eq!(got.account_id, want.account_id);
            assert_eq!(got.delta.0, want.delta.0, "{}", got.account_id);
            assert_eq!(got.reason, want.reason);
        }
        assert_eq!(s.protocol_fee.to_string(), q["protocol_fee"].as_str().unwrap());
        assert_eq!(s.dust.to_string(), q["dust"].as_str().unwrap());
        assert!(conserved(fee, &s));
    }

    #[test]
    fn nobody_right_refunds_the_asker() {
        let q = mock_question(40);
        let fee: u128 = q["fee"].as_str().unwrap().parse().unwrap();
        // Pretend the DAO ruled INVALID: every agent answered YES or NO, so every one is wrong.
        let s = settle(fee, 500, &[round(&q, 0)], Answer::Invalid);
        assert_eq!(s.refund_to_asker, fee);
        assert_eq!(s.protocol_fee, 0);
        assert!(s.payouts.iter().all(|p| p.reason == PayoutReason::Wrong && p.delta.0 < 0));
        assert!(conserved(fee, &s));
    }

    #[test]
    fn tie_has_no_winner() {
        let q = mock_question(40);
        let mut r = round(&q, 0);
        r.reveals.truncate(2); // atlas YES and nova YES
        r.reveals[1].answer = Answer::No;
        r.reveals[1].weight = r.reveals[0].weight;
        let t = tally(&r, &RULES, 0);
        assert_eq!(t.winner, None);
        assert!(!t.confident);
    }
}
