//! Types for the SOOTH Swarm contract. JSON names are the interface for agents and the web app.
use near_sdk::json_types::U64;
use near_sdk::{AccountId, NearToken, near};

pub const ZERO: NearToken = NearToken::from_yoctonear(0);

/// Same shape as `Timings` in the SOOTH contract.
#[near(serializers = [json, borsh])]
#[derive(Clone, Copy)]
pub struct JuryTimings {
    pub commit_secs: u32,
    pub reveal_secs: u32,
    pub challenge_secs: u32,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Config {
    pub owner: AccountId,
    pub sooth: AccountId,
    pub worker_storage: NearToken,
    pub worker_bond: NearToken,
    /// Taken from the worker's free balance on each bid (no deposit, so function-call keys work).
    pub bid_storage: NearToken,
    pub task_storage: NearToken,
    pub job_storage: NearToken,
    /// Attached to `ask_question`: the jury fee plus SOOTH's question storage.
    pub dispute_deposit: NearToken,
    pub jury_min_stake: NearToken,
    pub jury_timings: JuryTimings,
    pub dispute_timeout_secs: u32,
    pub max_bids: u8,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct WorkerStats {
    pub jobs: u32,
    pub successful: u32,
    pub failed: u32,
    pub no_reveal: u32,
    pub earned: NearToken,
    pub slashed: NearToken,
}

#[near(serializers = [borsh])]
pub struct Worker {
    pub name: String,
    pub registered_at: u64,
    pub free_balance: NearToken,
    pub locked_balance: NearToken,
    pub stats: WorkerStats,
}

#[near(serializers = [json])]
pub struct WorkerView {
    pub account_id: AccountId,
    pub name: String,
    pub registered_at: U64,
    pub free_balance: NearToken,
    pub locked_balance: NearToken,
    pub rep_bps: u16,
    pub stats: WorkerStats,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum TaskStatus {
    Open,
    Closed,
}

/// `available = budget - paid - reserved - costs`.
#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Task {
    pub id: u64,
    pub owner: AccountId,
    pub contractor: AccountId,
    pub brief_uri: String,
    pub brief_hash: String,
    pub budget: NearToken,
    pub paid: NearToken,
    pub reserved: NearToken,
    pub costs: NearToken,
    pub active_jobs: u32,
    pub status: TaskStatus,
    pub created_at: U64,
}

impl Task {
    pub fn available(&self) -> NearToken {
        self.budget.saturating_sub(self.paid).saturating_sub(self.reserved).saturating_sub(self.costs)
    }
}

#[near(serializers = [json])]
pub struct TaskView {
    #[serde(flatten)]
    pub task: Task,
    pub available: NearToken,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy)]
pub struct JobTimings {
    pub commit_secs: u32,
    pub reveal_secs: u32,
    /// Longest delivery window; a bid's `eta_secs` can only shorten it.
    pub delivery_secs: u32,
    pub review_secs: u32,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Bid {
    pub account_id: AccountId,
    pub hash: String,
    pub committed_at: U64,
    pub price: Option<NearToken>,
    pub eta_secs: Option<u32>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum JobStatus {
    Bidding,
    Awarded,
    Delivered,
    Disputed,
    Closed,
}

#[near(serializers = [json])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum JobPhase {
    BidCommit,
    BidReveal,
    AwaitingAward,
    Delivering,
    DeliveryMissed,
    Review,
    Claimable,
    Disputed,
    Closed,
}

#[near(serializers = [json, borsh])]
#[serde(rename_all = "snake_case")]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum JobResult {
    NoBids,
    Accepted,
    Claimed,
    /// The jury ruled the work matches the brief.
    WonDispute,
    /// The jury ruled against the work.
    LostDispute,
    /// The jury called it `INVALID`, or the dispute timed out.
    Split,
    MissedDelivery,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Job {
    pub id: u64,
    pub task_id: u64,
    pub brief_uri: String,
    pub brief_hash: String,
    pub max_price: NearToken,
    pub timings: JobTimings,
    pub status: JobStatus,
    pub created_at: U64,
    pub commit_end: U64,
    pub reveal_end: U64,
    pub bids: Vec<Bid>,
    pub winner: Option<AccountId>,
    pub price: Option<NearToken>,
    /// What this job currently holds in the task's `reserved`.
    pub reserved: NearToken,
    pub delivery_end: Option<U64>,
    pub deliverable_uri: Option<String>,
    pub deliverable_hash: Option<String>,
    pub review_end: Option<U64>,
    pub question_id: Option<u64>,
    pub dispute_deadline: Option<U64>,
    pub result: Option<JobResult>,
    pub closed_at: Option<U64>,
}

impl Job {
    /// Derived from the stored status and block time, like `phase` in the SOOTH contract.
    pub fn phase(&self, now: u64) -> JobPhase {
        let before = |end: Option<U64>| end.is_some_and(|e| now < e.0);
        match self.status {
            JobStatus::Bidding if now < self.commit_end.0 => JobPhase::BidCommit,
            JobStatus::Bidding if now < self.reveal_end.0 => JobPhase::BidReveal,
            JobStatus::Bidding => JobPhase::AwaitingAward,
            JobStatus::Awarded if before(self.delivery_end) => JobPhase::Delivering,
            JobStatus::Awarded => JobPhase::DeliveryMissed,
            JobStatus::Delivered if before(self.review_end) => JobPhase::Review,
            JobStatus::Delivered => JobPhase::Claimable,
            JobStatus::Disputed => JobPhase::Disputed,
            JobStatus::Closed => JobPhase::Closed,
        }
    }
}

#[near(serializers = [json])]
pub struct JobView {
    #[serde(flatten)]
    pub job: Job,
    pub phase: JobPhase,
}

/// `Answer` from the SOOTH contract, same JSON.
#[near(serializers = [json])]
#[serde(rename_all = "UPPERCASE")]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Answer {
    Yes,
    No,
    Invalid,
}

/// The part of SOOTH's `ResultView` this contract reads; other fields are ignored.
#[near(serializers = [json])]
#[derive(Clone)]
pub struct SoothResult {
    pub answer: Answer,
}
