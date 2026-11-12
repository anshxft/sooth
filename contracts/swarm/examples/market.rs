//! Market simulation (F26): 20 buyers, 5 sellers with scripted strategies, no LLM calls.
//! Winners come from the contract's own `award::pick_winner` and `award::rep_bps`, so the
//! auction here is the auction on chain. Run: `cargo run --example market` (writes ../../sim/market.csv).
use std::collections::HashSet;
use std::fmt::Write as _;
use swarm::award::{Candidate, pick_winner, rep_bps};

const JOBS: usize = 600;
const BUYERS: usize = 20;
const MAX_PRICE: f64 = 1.2;
const BOND: f64 = 0.5;
const WORK_COST: f64 = 0.4; // what honest work costs a seller to produce
const REVIEW_CATCHES: f64 = 0.9; // contractor disputes a fake delivery
const REVIEW_FALSE_ALARM: f64 = 0.03; // contractor disputes good work by mistake
// Measured: the jury ruled correctly on 11 of 12 labelled disputes (benchmark/DISPUTES.md).
const JURY_CORRECT: f64 = 0.92;
const FLAKY_MISS: f64 = 0.3;
const YOCTO: f64 = 1e24;
const CHART_EVERY: usize = 10; // jobs between points in web/src/data/market.json

#[derive(Clone, Copy, PartialEq)]
enum Strategy {
    Honest,
    Cheater,
    Flaky,
}

struct Seller {
    name: &'static str,
    price: f64,
    strategy: Strategy,
    jobs: u32,
    successful: u32,
    pnl: f64,
}

/// xorshift64: deterministic, so the chart in the README is reproducible.
struct Rng(u64);
impl Rng {
    fn chance(&mut self, p: f64) -> bool {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        (self.0 % 1_000_000) as f64 / 1_000_000.0 < p
    }
}

enum Outcome {
    Paid,
    Slashed,
}

fn settle(seller: &Seller, rng: &mut Rng) -> Outcome {
    let jury_rules_right = rng.chance(JURY_CORRECT);
    match seller.strategy {
        Strategy::Cheater if rng.chance(REVIEW_CATCHES) && jury_rules_right => Outcome::Slashed,
        Strategy::Cheater => Outcome::Paid,
        Strategy::Flaky if rng.chance(FLAKY_MISS) => Outcome::Slashed,
        // Good work: a mistaken dispute only costs the seller if the jury also gets it wrong.
        _ if rng.chance(REVIEW_FALSE_ALARM) && !jury_rules_right => Outcome::Slashed,
        _ => Outcome::Paid,
    }
}

fn main() {
    let mut sellers = vec![
        Seller { name: "honest-cheap", price: 0.6, strategy: Strategy::Honest, jobs: 0, successful: 0, pnl: 0.0 },
        Seller { name: "honest-premium", price: 0.8, strategy: Strategy::Honest, jobs: 0, successful: 0, pnl: 0.0 },
        Seller { name: "cheater", price: 0.15, strategy: Strategy::Cheater, jobs: 0, successful: 0, pnl: 0.0 },
        Seller { name: "overcharger", price: 1.5, strategy: Strategy::Honest, jobs: 0, successful: 0, pnl: 0.0 },
        Seller { name: "flaky", price: 0.5, strategy: Strategy::Flaky, jobs: 0, successful: 0, pnl: 0.0 },
    ];
    // Each buyer is one task: a seller who fails it is banned from that task, as in the contract.
    let mut banned: Vec<HashSet<usize>> = vec![HashSet::new(); BUYERS];
    let mut rng = Rng(0x5007_4b1d);
    let (mut delivered, mut spent) = (0u32, 0.0f64);
    let mut csv = String::from("job,seller,pnl_near,rep_bps\n");
    let mut points: Vec<String> = Vec::new();

    for job in 0..JOBS {
        let buyer = job % BUYERS;
        let eligible: Vec<usize> = (0..sellers.len()).filter(|&i| sellers[i].price <= MAX_PRICE && !banned[buyer].contains(&i)).collect();
        let candidates: Vec<Candidate> = eligible
            .iter()
            .map(|&i| Candidate { price: (sellers[i].price * YOCTO) as u128, rep_bps: rep_bps(sellers[i].jobs, sellers[i].successful) })
            .collect();
        if let Some(pick) = pick_winner(&candidates) {
            let winner = eligible[pick];
            let outcome = settle(&sellers[winner], &mut rng);
            let s = &mut sellers[winner];
            s.jobs += 1;
            match outcome {
                Outcome::Paid => {
                    s.successful += 1;
                    s.pnl += s.price - if s.strategy == Strategy::Cheater { 0.0 } else { WORK_COST };
                    spent += s.price;
                    if s.strategy != Strategy::Cheater {
                        delivered += 1;
                    }
                }
                Outcome::Slashed => {
                    // An honest seller wrongly ruled against also loses the work it put in.
                    s.pnl -= BOND + if s.strategy == Strategy::Honest { WORK_COST } else { 0.0 };
                    banned[buyer].insert(winner);
                }
            }
        }
        for s in &sellers {
            writeln!(csv, "{job},{},{:.3},{}", s.name, s.pnl, rep_bps(s.jobs, s.successful)).unwrap();
        }
        if (job + 1) % CHART_EVERY == 0 || job == 0 {
            let pnl: Vec<String> = sellers.iter().map(|s| format!("{:.2}", s.pnl)).collect();
            points.push(format!("{{\"job\":{},\"pnl\":[{}]}}", job + 1, pnl.join(",")));
        }
    }

    std::fs::create_dir_all("../../sim").unwrap();
    std::fs::write("../../sim/market.csv", csv).unwrap();
    // Sampled copy for the web app's /benchmark chart.
    let rows: Vec<String> = sellers
        .iter()
        .map(|s| format!("{{\"name\":\"{}\",\"price\":{},\"jobs\":{},\"rep\":{},\"pnl\":{:.2}}}", s.name, s.price, s.jobs, f64::from(rep_bps(s.jobs, s.successful)) / 1e4, s.pnl))
        .collect();
    let json = format!("{{\"jobs\":{JOBS},\"buyers\":{BUYERS},\"sellers\":[{}],\"points\":[{}]}}", rows.join(","), points.join(","));
    std::fs::write("../../web/src/data/market.json", json).unwrap();
    println!("{JOBS} jobs, {BUYERS} buyers. Real work delivered on {delivered} jobs; buyers spent {spent:.2} NEAR.\n");
    println!("{:<16} {:>6} {:>5} {:>6} {:>10}", "seller", "price", "jobs", "rep", "pnl NEAR");
    for s in &sellers {
        println!("{:<16} {:>6.2} {:>5} {:>5.2}x {:>10.2}", s.name, s.price, s.jobs, f64::from(rep_bps(s.jobs, s.successful)) / 1e4, s.pnl);
    }
}
