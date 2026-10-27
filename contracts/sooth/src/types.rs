//! Types from docs/interface.md §3. JSON names and shapes must match it exactly.
//! The full question shape (outcome, payouts, ...) is defined up front so the stored layout
//! does not change when tally/finalize land.
use near_sdk::json_types::{I128, U64, U128};
use near_sdk::{AccountId, NearToken, near};

pub const ZERO: NearToken = NearToken::from_yoctonear(0);

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy)]
pub struct Timings {
    pub commit_secs: u32,
    pub reveal_secs: u32,
    pub challenge_secs: u32,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Config {
    pub owner: AccountId,
    pub dao_account: AccountId,
    pub treasury: AccountId,
    pub protocol_fee_bps: u16,
    pub min_agents: u8,
    pub max_commits: u8,
    pub auto_share_bps: u16,
    pub auto_conf_bps: u16,
    pub default_timings: Timings,
    pub min_fee: NearToken,
    pub question_storage: NearToken,
    pub agent_storage: NearToken,
    /// Taken from the agent's free balance on each commit (no deposit, so function-call keys work).
    pub commit_storage: NearToken,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct AgentStats {
    pub answered: u32,
    pub correct: u32,
    pub wrong: u32,
    pub no_reveal: u32,
    pub earned: NearToken,
    pub slashed: NearToken,
}

#[near(serializers = [borsh])]
pub struct Agent {
    pub name: String,
    pub model: String,
    pub registered_at: u64,
    pub free_balance: NearToken,
    pub locked_balance: NearToken,
    pub stats: AgentStats,
}

#[near(serializers = [json])]
pub struct AgentView {
    pub account_id: AccountId,
    pub name: String,
    pub model: String,
    pub registered_at: U64,
    pub free_balance: NearToken,
    pub locked_balance: NearToken,
    pub rep_bps: u16,
    pub accuracy_bps: u16,
    pub stats: AgentStats,
}

#[near(serializers = [json, borsh])]
#[serde(rename_all = "UPPERCASE")]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Answer {
    Yes,
    No,
    Invalid,
}

impl Answer {
    /// The exact token used in the commit preimage (docs/interface.md §6).
    pub fn as_str(self) -> &'static str {
        match self {
            Answer::Yes => "YES",
            Answer::No => "NO",
            Answer::Invalid => "INVALID",
        }
    }
}

#[near(serializers = [json, borsh])]
#[serde(rename_all = "lowercase")]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Category {
    Crypto,
    Weather,
    Sports,
    News,
}

#[near(serializers = [json, borsh])]
#[serde(rename_all = "snake_case")]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Template {
    CryptoPrice,
    WeatherRain,
    FreeText,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Status {
    Open,
    Provisional,
    Escalated,
    Finalized,
    Refunded,
}

#[near(serializers = [json])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Phase {
    Scheduled,
    Commit,
    Reveal,
    AwaitingTally,
    Challenge,
    AwaitingFinalize,
    Dao,
    Finalized,
    Refunded,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct CommitRecord {
    pub account_id: AccountId,
    pub hash: String,
    pub stake: NearToken,
    pub committed_at: U64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct RevealRecord {
    pub account_id: AccountId,
    pub answer: Answer,
    pub confidence: u8,
    pub evidence_hash: String,
    pub evidence_uri: String,
    pub rep_bps: u16,
    pub weight: U128,
    pub revealed_at: U64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Weights {
    #[serde(rename = "YES")]
    pub yes: U128,
    #[serde(rename = "NO")]
    pub no: U128,
    #[serde(rename = "INVALID")]
    pub invalid: U128,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Tally {
    pub weights: Weights,
    pub winner: Option<Answer>,
    pub share_bps: u16,
    pub avg_conf_bps: u16,
    pub revealed: u8,
    pub confident: bool,
    pub tallied_at: U64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Round {
    pub round: u8,
    pub min_stake: NearToken,
    pub commit_start: U64,
    pub commit_end: U64,
    pub reveal_end: U64,
    pub commits: Vec<CommitRecord>,
    pub reveals: Vec<RevealRecord>,
    pub tally: Option<Tally>,
}

#[near(serializers = [json, borsh])]
#[serde(rename_all = "snake_case")]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ResolvedBy {
    Auto,
    Round2,
    Dao,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Outcome {
    pub answer: Answer,
    pub share_bps: u16,
    pub avg_conf_bps: u16,
    pub resolved_by: ResolvedBy,
}

#[near(serializers = [json, borsh])]
#[serde(rename_all = "snake_case")]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum PayoutReason {
    Correct,
    Wrong,
    NoReveal,
    ChallengeWon,
    ChallengeLost,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Payout {
    pub account_id: AccountId,
    pub round: u8,
    pub stake: NearToken,
    /// Signed yoctoNEAR.
    pub delta: I128,
    pub reason: PayoutReason,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Challenger {
    pub account_id: AccountId,
    pub bond: NearToken,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Callback {
    pub contract_id: AccountId,
    pub method: String,
}

#[near(serializers = [borsh])]
pub struct Question {
    pub asker: AccountId,
    pub text: String,
    pub category: Category,
    pub template: Template,
    pub params: String,
    pub fee: NearToken,
    pub created_at: u64,
    pub resolve_after: u64,
    pub timings: Timings,
    pub status: Status,
    pub rounds: Vec<Round>,
    pub challenge_end: Option<u64>,
    pub challenger: Option<Challenger>,
    pub outcome: Option<Outcome>,
    pub payouts: Vec<Payout>,
    pub protocol_fee: Option<NearToken>,
    pub dust: Option<NearToken>,
    pub finalized_at: Option<u64>,
    pub callback: Option<Callback>,
}

impl Question {
    pub fn current_round(&self) -> &Round {
        self.rounds.last().expect("a question always has round 1")
    }

    pub fn current_round_mut(&mut self) -> &mut Round {
        self.rounds.last_mut().expect("a question always has round 1")
    }

    /// docs/interface.md §3: phase is derived from the stored status and block time.
    pub fn phase(&self, now: u64) -> Phase {
        match self.status {
            Status::Finalized => Phase::Finalized,
            Status::Refunded => Phase::Refunded,
            Status::Escalated => Phase::Dao,
            Status::Provisional => match self.challenge_end {
                Some(end) if now < end => Phase::Challenge,
                _ => Phase::AwaitingFinalize,
            },
            Status::Open => {
                let round = self.current_round();
                if now < round.commit_start.0 {
                    Phase::Scheduled
                } else if now < round.commit_end.0 {
                    Phase::Commit
                } else if now < round.reveal_end.0 {
                    Phase::Reveal
                } else {
                    Phase::AwaitingTally
                }
            }
        }
    }

    /// End of the current phase, for countdowns.
    pub fn phase_ends_at(&self, now: u64) -> Option<U64> {
        let round = self.current_round();
        match self.phase(now) {
            Phase::Scheduled => Some(round.commit_start),
            Phase::Commit => Some(round.commit_end),
            Phase::Reveal => Some(round.reveal_end),
            Phase::Challenge => self.challenge_end.map(U64),
            _ => None,
        }
    }
}

#[near(serializers = [json])]
pub struct QuestionView {
    pub id: u64,
    pub asker: AccountId,
    pub text: String,
    pub category: Category,
    pub template: Template,
    pub params: String,
    pub fee: NearToken,
    pub created_at: U64,
    pub resolve_after: U64,
    pub timings: Timings,
    pub status: Status,
    pub phase: Phase,
    pub round: u8,
    pub rounds: Vec<Round>,
    pub challenge_end: Option<U64>,
    pub challenger: Option<Challenger>,
    pub outcome: Option<Outcome>,
    pub payouts: Vec<Payout>,
    pub protocol_fee: Option<NearToken>,
    pub dust: Option<NearToken>,
    pub finalized_at: Option<U64>,
    pub callback: Option<Callback>,
}

#[near(serializers = [json])]
pub struct QuestionSummary {
    pub id: u64,
    pub text: String,
    pub category: Category,
    pub status: Status,
    pub phase: Phase,
    pub round: u8,
    pub fee: NearToken,
    pub resolve_after: U64,
    pub phase_ends_at: Option<U64>,
    pub commits: u32,
    pub reveals: u32,
    pub outcome: Option<Outcome>,
}

#[near(serializers = [json])]
pub struct ResultView {
    pub question_id: u64,
    pub answer: Answer,
    pub share_bps: u16,
    pub avg_conf_bps: u16,
    pub resolved_by: ResolvedBy,
    pub finalized_at: U64,
}
