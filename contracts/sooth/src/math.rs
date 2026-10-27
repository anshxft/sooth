//! Integer math from docs/interface.md §5. Must stay identical to mock/make_mock.py.

/// Smoothed accuracy (correct + 1) / (answered + 2), in basis points.
pub fn accuracy_bps(answered: u32, correct: u32) -> u16 {
    ((u64::from(correct) + 1) * 10_000 / (u64::from(answered) + 2)) as u16
}

/// Reputation multiplier 0.5x..=2.0x in basis points. New agents and coin-flippers sit at 0.5x.
pub fn rep_bps(answered: u32, correct: u32) -> u16 {
    let den = u64::from(answered) + 2;
    let excess = (2 * (u64::from(correct) + 1)).saturating_sub(den);
    (5_000 + 15_000 * excess / den) as u16
}

/// Vote weight in "weighted yoctoNEAR": stake × reputation × confidence.
/// Fits u128 for any realistic stake (1e27 yocto × 2e4 × 99 ≈ 2e33 < 3.4e38).
pub fn weight(stake_yocto: u128, rep_bps: u16, confidence: u8) -> u128 {
    stake_yocto * u128::from(rep_bps) * u128::from(confidence) / (10_000 * 100)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn weight_matches_python_reference() {
        let near = 10u128.pow(24);
        assert_eq!(weight(near, 15_000, 88), 1_320_000_000_000_000_000_000_000); // 1.32 NEAR
        assert_eq!(weight(near / 2, 9_000, 62), 279_000_000_000_000_000_000_000); // 0.279 NEAR
    }

    #[test]
    fn new_agent_starts_at_half() {
        assert_eq!(rep_bps(0, 0), 5_000);
        assert_eq!(accuracy_bps(0, 0), 5_000);
    }

    #[test]
    fn coin_flip_or_worse_is_floored() {
        assert_eq!(rep_bps(8, 3), 5_000);
    }

    #[test]
    fn matches_python_reference_agents() {
        // Same stats as AGENTS in mock/make_mock.py.
        assert_eq!(rep_bps(10, 9), 15_000);
        assert_eq!(rep_bps(8, 7), 14_000);
        assert_eq!(rep_bps(28, 22), 13_000);
        assert_eq!(rep_bps(28, 18), 9_000);
        assert_eq!(accuracy_bps(10, 9), 8_333);
    }

    #[test]
    fn perfect_record_approaches_two() {
        let rep = rep_bps(1_000_000, 1_000_000);
        assert!(rep > 19_990 && rep < 20_000);
    }
}
