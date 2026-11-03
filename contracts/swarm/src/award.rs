//! Pure bid and settlement math, shared by the contract and the market simulation.

const BPS: u128 = 10_000;

/// Same smoothed reputation as the SOOTH contract: 0.5x..=2.0x in basis points, new workers at 0.5x.
pub fn rep_bps(jobs: u32, successful: u32) -> u16 {
    let den = u64::from(jobs) + 2;
    let excess = (2 * (u64::from(successful) + 1)).saturating_sub(den);
    (5_000 + 15_000 * excess / den) as u16
}

pub struct Candidate {
    pub price: u128,
    pub rep_bps: u16,
}

/// A reputation-discounted reverse auction: the lowest `price / rep` wins, the earliest commit on a tie.
/// `candidates` must be in commit order and already within the job's maximum price.
pub fn pick_winner(candidates: &[Candidate]) -> Option<usize> {
    candidates
        .iter()
        .enumerate()
        .min_by_key(|(index, c)| (c.price * BPS / u128::from(c.rep_bps), *index))
        .map(|(index, _)| index)
}

/// An `INVALID` ruling splits the payment; an odd yocto stays with the task.
pub fn worker_share_of_split(price: u128) -> u128 {
    price / 2
}

#[cfg(test)]
mod tests {
    use super::*;

    const NEAR: u128 = 10u128.pow(24);

    fn bid(price: u128, rep_bps: u16) -> Candidate {
        Candidate { price, rep_bps }
    }

    #[test]
    fn new_worker_starts_at_half_and_good_history_raises_rep() {
        assert_eq!(rep_bps(0, 0), 5_000);
        assert_eq!(rep_bps(10, 9), 15_000);
    }

    #[test]
    fn repeated_failure_floors_rep() {
        assert_eq!(rep_bps(8, 3), 5_000);
    }

    #[test]
    fn no_bids_means_no_winner() {
        assert_eq!(pick_winner(&[]), None);
    }

    #[test]
    fn lowest_price_wins_at_equal_rep() {
        assert_eq!(pick_winner(&[bid(2 * NEAR, 10_000), bid(NEAR, 10_000)]), Some(1));
    }

    #[test]
    fn reputation_can_beat_a_cheaper_newcomer() {
        // Newcomer: 1 / 0.5 = 2.0. Trusted worker: 1.5 / 1.5 = 1.0.
        assert_eq!(pick_winner(&[bid(NEAR, 5_000), bid(NEAR * 3 / 2, 15_000)]), Some(1));
    }

    #[test]
    fn a_low_enough_bid_still_beats_reputation() {
        // Demo case. Cheater: 0.2 / 0.5 = 0.4. Honest worker: 1.0 / 1.4 = 0.71.
        assert_eq!(pick_winner(&[bid(NEAR, 14_000), bid(NEAR / 5, 5_000)]), Some(1));
    }

    #[test]
    fn tie_goes_to_the_earliest_commit() {
        assert_eq!(pick_winner(&[bid(NEAR, 10_000), bid(NEAR, 10_000)]), Some(0));
    }

    #[test]
    fn split_never_creates_money() {
        assert_eq!(worker_share_of_split(101), 50);
    }
}
