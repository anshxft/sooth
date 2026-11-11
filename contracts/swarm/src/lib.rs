//! SOOTH Swarm: a contractor agent spends a budget on sealed-bid jobs, and the SOOTH jury rules
//! on disputed work. Design: SOOTH_SPEC.md §14.
mod award;
#[cfg(test)]
mod tests;
mod types;

pub use types::*;

use near_sdk::json_types::U64;
use near_sdk::serde_json::{Value, json};
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError, assert_one_yocto, env, near, require};

const MAX_PAGE: u32 = 50;
/// `list_jobs` looks at most this many ids back, so a filter cannot run out of gas.
const MAX_SCAN: usize = 200;
const NS_PER_SEC: u64 = 1_000_000_000;
const MIN_PHASE_SECS: u32 = 30;
const MAX_PHASE_SECS: u32 = 7 * 24 * 3600;
/// Keeps a dispute's params inside SOOTH's 500-char limit (test `worst_case_dispute_params_fit_sooth`).
const MAX_URI_LEN: usize = 120;
const CALLBACK_METHOD: &str = "on_sooth_resolved";
const ASK_GAS: Gas = Gas::from_tgas(30);
const READ_GAS: Gas = Gas::from_tgas(15);
const CALLBACK_GAS: Gas = Gas::from_tgas(20);

// Storage prefixes: b"w" workers, b"t" tasks, b"j" jobs, b"q" question to job.
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    config: Config,
    workers: IterableMap<AccountId, Worker>,
    tasks: LookupMap<u64, Task>,
    jobs: LookupMap<u64, Job>,
    question_jobs: LookupMap<u64, u64>,
    next_task_id: u64,
    next_job_id: u64,
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner: AccountId, sooth: AccountId) -> Self {
        Self {
            config: Config {
                owner,
                sooth,
                worker_storage: NearToken::from_millinear(50),
                worker_bond: NearToken::from_millinear(500),
                bid_storage: NearToken::from_millinear(5),
                task_storage: NearToken::from_millinear(50),
                job_storage: NearToken::from_millinear(50),
                dispute_deposit: NearToken::from_millinear(300),
                jury_min_stake: NearToken::from_millinear(500),
                jury_timings: JuryTimings { commit_secs: 180, reveal_secs: 120, challenge_secs: 180 },
                dispute_timeout_secs: 24 * 3600,
                max_bids: 30,
            },
            workers: IterableMap::new(b"w"),
            tasks: LookupMap::new(b"t"),
            jobs: LookupMap::new(b"j"),
            question_jobs: LookupMap::new(b"q"),
            next_task_id: 1,
            next_job_id: 1,
        }
    }

    // --------------------------------------------------------------- workers (F21)

    /// Attach at least `worker_storage`; anything above it becomes free balance for bonds.
    #[payable]
    pub fn register_worker(&mut self, name: String) {
        let account_id = env::predecessor_account_id();
        require!(!self.workers.contains_key(&account_id), "Already registered");
        require!(is_valid_name(&name), "Invalid worker name");
        let deposit = env::attached_deposit();
        require!(deposit >= self.config.worker_storage, "Attach at least the worker storage deposit");
        emit("worker_registered", json!({ "account_id": &account_id, "name": &name }));
        let stats = WorkerStats { jobs: 0, successful: 0, failed: 0, no_reveal: 0, earned: ZERO, slashed: ZERO };
        self.workers.insert(
            account_id,
            Worker {
                name,
                registered_at: env::block_timestamp(),
                free_balance: deposit.saturating_sub(self.config.worker_storage),
                locked_balance: ZERO,
                stats,
            },
        );
    }

    #[payable]
    pub fn deposit_bond(&mut self) {
        let amount = env::attached_deposit();
        require!(!amount.is_zero(), "Attach a deposit");
        let worker = self.worker_mut(&env::predecessor_account_id());
        worker.free_balance = worker.free_balance.saturating_add(amount);
    }

    /// Needs exactly 1 yoctoNEAR attached, which a function-call key cannot do.
    #[payable]
    pub fn withdraw_balance(&mut self, amount: NearToken) -> Promise {
        assert_one_yocto();
        require!(!amount.is_zero(), "Amount must be positive");
        let account_id = env::predecessor_account_id();
        let worker = self.worker_mut(&account_id);
        require!(amount <= worker.free_balance, "Insufficient free balance");
        worker.free_balance = worker.free_balance.saturating_sub(amount);
        emit("balance_withdrawn", json!({ "account_id": &account_id, "amount": amount }));
        Promise::new(account_id).transfer(amount.saturating_add(NearToken::from_yoctonear(1)))
    }

    // ----------------------------------------------------------------- tasks (F20)

    /// The attached deposit minus `task_storage` is the budget. `contractor` is the only account
    /// that can spend it, and only on jobs; just the owner can take the remainder back.
    #[payable]
    pub fn create_task(&mut self, contractor: AccountId, brief_uri: String, brief_hash: String) -> u64 {
        require_link(&brief_uri, &brief_hash);
        let deposit = env::attached_deposit();
        require!(deposit > self.config.task_storage, "Attach the budget plus task storage");
        let owner = env::predecessor_account_id();
        let id = self.next_task_id;
        self.next_task_id += 1;
        let budget = deposit.saturating_sub(self.config.task_storage);
        emit("task_created", json!({ "task_id": id, "owner": &owner, "contractor": &contractor, "budget": budget }));
        self.tasks.insert(
            id,
            Task {
                id,
                owner,
                contractor,
                brief_uri,
                brief_hash,
                budget,
                paid: ZERO,
                reserved: ZERO,
                costs: ZERO,
                active_jobs: 0,
                banned: vec![],
                status: TaskStatus::Open,
                created_at: U64(env::block_timestamp()),
            },
        );
        id
    }

    /// Needs exactly 1 yoctoNEAR, so a contractor's function-call key can never drain the budget.
    #[payable]
    pub fn close_task(&mut self, task_id: u64) -> Promise {
        assert_one_yocto();
        let task = self.task_mut(task_id);
        require!(env::predecessor_account_id() == task.owner, "Only the task owner can close it");
        require!(task.status == TaskStatus::Open, "Task is closed");
        require!(task.active_jobs == 0, "Task still has active jobs");
        let refund = task.available();
        task.status = TaskStatus::Closed;
        let owner = task.owner.clone();
        emit("task_closed", json!({ "task_id": task_id, "refund": refund }));
        Promise::new(owner).transfer(refund)
    }

    // ------------------------------------------------------------------ jobs (F21)

    /// Callable with the contractor's function-call key. Holds back `max_price` and the dispute
    /// deposit, so a job that fits the budget can always be paid and always be disputed.
    pub fn open_job(&mut self, task_id: u64, brief_uri: String, brief_hash: String, max_price: NearToken, timings: JobTimings) -> u64 {
        require_link(&brief_uri, &brief_hash);
        require!(!max_price.is_zero(), "Max price must be positive");
        require!(valid_timings(&timings), "Invalid timings");
        let (job_storage, dispute_deposit) = (self.config.job_storage, self.config.dispute_deposit);
        let id = self.next_job_id;
        let task = self.task_mut(task_id);
        require!(env::predecessor_account_id() == task.contractor, "Only the contractor can do this");
        require!(task.status == TaskStatus::Open, "Task is closed");
        let reserve = max_price.saturating_add(dispute_deposit);
        require!(reserve.saturating_add(job_storage) <= task.available(), "Over budget");
        task.reserved = task.reserved.saturating_add(reserve);
        task.costs = task.costs.saturating_add(job_storage);
        task.active_jobs += 1;
        self.next_job_id += 1;

        let now = env::block_timestamp();
        let commit_end = now + u64::from(timings.commit_secs) * NS_PER_SEC;
        let reveal_end = commit_end + u64::from(timings.reveal_secs) * NS_PER_SEC;
        emit("job_opened", json!({ "job_id": id, "task_id": task_id, "max_price": max_price }));
        self.jobs.insert(
            id,
            Job {
                id,
                task_id,
                brief_uri,
                brief_hash,
                max_price,
                timings,
                status: JobStatus::Bidding,
                created_at: U64(now),
                commit_end: U64(commit_end),
                reveal_end: U64(reveal_end),
                bids: vec![],
                winner: None,
                price: None,
                reserved: reserve,
                delivery_end: None,
                deliverable_uri: None,
                deliverable_hash: None,
                review_end: None,
                question_id: None,
                dispute_deadline: None,
                result: None,
                closed_at: None,
            },
        );
        id
    }

    /// Callable with the worker's function-call key: the bond and a storage charge come out of
    /// the worker's free balance. Task owners and contractors cannot bid on their own jobs.
    pub fn commit_bid(&mut self, job_id: u64, hash: String) {
        let account_id = env::predecessor_account_id();
        let now = env::block_timestamp();
        require!(is_hex_hash(&hash), "Hash must be 64 lowercase hex chars");
        let (bond, bid_storage, max_bids) = (self.config.worker_bond, self.config.bid_storage, usize::from(self.config.max_bids));
        let job = self.jobs.get(&job_id).unwrap_or_else(|| env::panic_str("Job not found"));
        require!(job.phase(now) == JobPhase::BidCommit, "Not in bid commit phase");
        require!(!job.bids.iter().any(|b| b.account_id == account_id), "Already bid on this job");
        require!(job.bids.len() < max_bids, "Job has too many bids");
        let task = self.tasks.get(&job.task_id).unwrap_or_else(|| env::panic_str("Task not found"));
        require!(account_id != task.owner && account_id != task.contractor, "Cannot bid on your own job");
        require!(!task.banned.contains(&account_id), "Banned from this task after a failed job");

        let worker = self.worker_mut(&account_id);
        let cost = bond.saturating_add(bid_storage);
        require!(worker.free_balance >= cost, "Insufficient free balance");
        worker.free_balance = worker.free_balance.saturating_sub(cost);
        worker.locked_balance = worker.locked_balance.saturating_add(bond);

        emit("bid_committed", json!({ "job_id": job_id, "account_id": &account_id }));
        self.job_mut(job_id).bids.push(Bid { account_id, hash, committed_at: U64(now), price: None, eta_secs: None });
    }

    /// Callable with the worker's function-call key.
    pub fn reveal_bid(&mut self, job_id: u64, price: NearToken, eta_secs: u32, salt: String) {
        let account_id = env::predecessor_account_id();
        let now = env::block_timestamp();
        let job = self.job_mut(job_id);
        require!(job.phase(now) == JobPhase::BidReveal, "Not in bid reveal phase");
        let bid = job.bids.iter_mut().find(|b| b.account_id == account_id).unwrap_or_else(|| env::panic_str("No bid found"));
        require!(bid.price.is_none(), "Already revealed");
        require!(!price.is_zero(), "Price must be positive");
        require!((MIN_PHASE_SECS..=MAX_PHASE_SECS).contains(&eta_secs), "Invalid eta");
        require!(hex_sha256(&bid_preimage(job_id, &account_id, price, eta_secs, &salt)) == bid.hash, "Hash mismatch");
        bid.price = Some(price);
        bid.eta_secs = Some(eta_secs);
        emit("bid_revealed", json!({ "job_id": job_id, "account_id": &account_id, "price": price, "eta_secs": eta_secs }));
    }

    /// Anyone can crank this once reveals have closed. Losing bonds return, silent bidders lose
    /// theirs to the task, and the winner's bond stays locked until the job closes.
    pub fn award(&mut self, job_id: u64) {
        let now = env::block_timestamp();
        let bond = self.config.worker_bond;
        let job = self.jobs.get(&job_id).unwrap_or_else(|| env::panic_str("Job not found"));
        require!(job.phase(now) == JobPhase::AwaitingAward, "Not ready to award");
        let (task_id, max_price, delivery_secs, reserved) = (job.task_id, job.max_price, job.timings.delivery_secs, job.reserved);

        // A bid above the maximum cannot win but was honestly revealed, so its bond comes back.
        let eligible: Vec<&Bid> = job.bids.iter().filter(|b| b.price.is_some_and(|p| p <= max_price)).collect();
        let candidates: Vec<award::Candidate> = eligible
            .iter()
            .map(|b| award::Candidate {
                price: b.price.map_or(0, |p| p.as_yoctonear()),
                rep_bps: self.workers.get(&b.account_id).map_or(5_000, |w| award::rep_bps(w.stats.jobs, w.stats.successful)),
            })
            .collect();
        let winner = award::pick_winner(&candidates).map(|i| eligible[i].clone());
        let bids = job.bids.clone();

        let mut slashed = ZERO;
        for bid in &bids {
            if winner.as_ref().is_some_and(|w| w.account_id == bid.account_id) {
                continue;
            }
            let worker = self.worker_mut(&bid.account_id);
            worker.locked_balance = worker.locked_balance.saturating_sub(bond);
            if bid.price.is_some() {
                worker.free_balance = worker.free_balance.saturating_add(bond);
            } else {
                worker.stats.no_reveal += 1;
                worker.stats.slashed = worker.stats.slashed.saturating_add(bond);
                slashed = slashed.saturating_add(bond);
            }
        }
        let task = self.task_mut(task_id);
        task.budget = task.budget.saturating_add(slashed);

        let Some(winner) = winner else {
            self.close_without_winner(job_id, now);
            return;
        };
        let price = winner.price.unwrap_or_else(|| env::panic_str("Winner has no price"));
        let saved = max_price.saturating_sub(price);
        task.reserved = task.reserved.saturating_sub(saved);

        let job = self.job_mut(job_id);
        let eta = winner.eta_secs.unwrap_or(delivery_secs).min(delivery_secs);
        job.status = JobStatus::Awarded;
        job.reserved = reserved.saturating_sub(saved);
        job.price = Some(price);
        job.delivery_end = Some(U64(now + u64::from(eta) * NS_PER_SEC));
        emit("job_awarded", json!({ "job_id": job_id, "winner": &winner.account_id, "price": price }));
        job.winner = Some(winner.account_id);
    }

    // -------------------------------------------------- delivery and payment (F22)

    /// Callable with the worker's function-call key.
    pub fn submit(&mut self, job_id: u64, deliverable_uri: String, deliverable_hash: String) {
        require_link(&deliverable_uri, &deliverable_hash);
        let now = env::block_timestamp();
        let job = self.job_mut(job_id);
        require!(job.phase(now) == JobPhase::Delivering, "Not in delivery phase");
        require!(job.winner.as_ref() == Some(&env::predecessor_account_id()), "Only the winner can deliver");
        job.status = JobStatus::Delivered;
        job.deliverable_uri = Some(deliverable_uri);
        job.deliverable_hash = Some(deliverable_hash);
        job.review_end = Some(U64(now + u64::from(job.timings.review_secs) * NS_PER_SEC));
        emit("job_delivered", json!({ "job_id": job_id, "uri": &job.deliverable_uri, "hash": &job.deliverable_hash }));
    }

    /// Callable with the contractor's function-call key.
    pub fn accept(&mut self, job_id: u64) {
        let now = env::block_timestamp();
        self.require_contractor(job_id);
        require!(self.job(job_id).phase(now) == JobPhase::Review, "Not in review phase");
        self.settle_job(job_id, JobResult::Accepted, now);
    }

    /// A contractor who stays silent past the review window cannot hold the payment hostage.
    pub fn claim(&mut self, job_id: u64) {
        let now = env::block_timestamp();
        require!(self.job(job_id).phase(now) == JobPhase::Claimable, "Not claimable");
        self.settle_job(job_id, JobResult::Claimed, now);
    }

    /// Anyone can crank this after a missed delivery: the payment returns and the bond is slashed.
    pub fn cancel_job(&mut self, job_id: u64) {
        let now = env::block_timestamp();
        require!(self.job(job_id).phase(now) == JobPhase::DeliveryMissed, "Delivery window still open");
        self.settle_job(job_id, JobResult::MissedDelivery, now);
    }

    // ---------------------------------------------------------------- disputes (F23)

    /// Callable with the contractor's function-call key: the jury fee comes out of the amount
    /// `open_job` held back, not from an attached deposit.
    pub fn dispute(&mut self, job_id: u64) -> Promise {
        let now = env::block_timestamp();
        self.require_contractor(job_id);
        let job = self.job(job_id);
        require!(job.phase(now) == JobPhase::Review, "Not in review phase");
        let (task_id, args) = (job.task_id, self.dispute_args(job));
        let deposit = self.config.dispute_deposit;
        let deadline = now + u64::from(self.config.dispute_timeout_secs) * NS_PER_SEC;

        let task = self.task_mut(task_id);
        task.reserved = task.reserved.saturating_sub(deposit);
        task.costs = task.costs.saturating_add(deposit);
        let job = self.job_mut(job_id);
        job.reserved = job.reserved.saturating_sub(deposit);
        job.status = JobStatus::Disputed;
        job.dispute_deadline = Some(U64(deadline));
        emit("job_disputed", json!({ "job_id": job_id }));

        Promise::new(self.config.sooth.clone())
            .function_call("ask_question".to_string(), args.to_string().into_bytes(), deposit, ASK_GAS)
            .then(Self::ext(env::current_account_id()).with_static_gas(CALLBACK_GAS).on_dispute_created(job_id))
    }

    /// Links the question to the job. If SOOTH refused it, the review continues as if nothing happened.
    #[private]
    pub fn on_dispute_created(&mut self, job_id: u64, #[callback_result] created: Result<u64, PromiseError>) {
        match created {
            Ok(question_id) => {
                self.question_jobs.insert(question_id, job_id);
                self.job_mut(job_id).question_id = Some(question_id);
                emit("dispute_opened", json!({ "job_id": job_id, "question_id": question_id }));
            }
            Err(_) => {
                let deposit = self.config.dispute_deposit;
                let job = self.job_mut(job_id);
                job.status = JobStatus::Delivered;
                job.dispute_deadline = None;
                job.reserved = job.reserved.saturating_add(deposit);
                let task_id = job.task_id;
                let task = self.task_mut(task_id);
                task.reserved = task.reserved.saturating_add(deposit);
                task.costs = task.costs.saturating_sub(deposit);
                emit("dispute_failed", json!({ "job_id": job_id }));
            }
        }
    }

    /// SOOTH calls this when it finalizes. Never panics: SOOTH's own settlement must not depend
    /// on it, and anything unexpected is simply ignored.
    pub fn on_sooth_resolved(&mut self, question_id: u64, answer: Answer) {
        if env::predecessor_account_id() != self.config.sooth {
            env::log_str("Ignored: caller is not the SOOTH contract");
            return;
        }
        let Some(job_id) = self.question_jobs.get(&question_id).copied() else {
            env::log_str("Ignored: question is not linked to a job");
            return;
        };
        if self.job(job_id).status == JobStatus::Disputed {
            self.settle_job(job_id, result_for(answer), env::block_timestamp());
        }
    }

    /// The fallback if the callback ran out of gas: anyone can make the contract read the ruling.
    pub fn settle(&mut self, job_id: u64) -> Promise {
        let job = self.job(job_id);
        require!(job.status == JobStatus::Disputed, "Job is not disputed");
        let question_id = job.question_id.unwrap_or_else(|| env::panic_str("Dispute has no question yet"));
        let args = json!({ "question_id": question_id }).to_string().into_bytes();
        Promise::new(self.config.sooth.clone())
            .function_call("get_result".to_string(), args, ZERO, READ_GAS)
            .then(Self::ext(env::current_account_id()).with_static_gas(CALLBACK_GAS).on_result_read(job_id))
    }

    /// No ruling by the deadline (an unresolved DAO escalation, a refunded question) splits the
    /// payment, so a dispute can never lock the money forever.
    #[private]
    pub fn on_result_read(&mut self, job_id: u64, #[callback_result] read: Result<Option<SoothResult>, PromiseError>) {
        let now = env::block_timestamp();
        let job = self.job(job_id);
        if job.status != JobStatus::Disputed {
            return;
        }
        let past_deadline = job.dispute_deadline.is_some_and(|d| now >= d.0);
        match read {
            Ok(Some(result)) => self.settle_job(job_id, result_for(result.answer), now),
            _ if past_deadline => self.settle_job(job_id, JobResult::Split, now),
            _ => env::log_str("No ruling yet"),
        }
    }

    /// Demo rounds run in minutes, real disputes in hours. Needs 1 yoctoNEAR, so only a full key can.
    #[payable]
    pub fn set_jury_timings(&mut self, timings: JuryTimings) {
        assert_one_yocto();
        require!(env::predecessor_account_id() == self.config.owner, "Only the owner can do this");
        self.config.jury_timings = timings;
    }

    // -------------------------------------------------------------------- views

    pub fn get_config(&self) -> Config {
        self.config.clone()
    }

    pub fn get_worker(&self, account_id: AccountId) -> Option<WorkerView> {
        self.workers.get(&account_id).map(|w| worker_view(&account_id, w))
    }

    /// ponytail: sorts every worker inside the view; fine for hundreds, needs an index beyond that.
    pub fn list_workers(&self, limit: u32) -> Vec<WorkerView> {
        let mut all: Vec<WorkerView> = self.workers.iter().map(|(id, w)| worker_view(id, w)).collect();
        all.sort_by(|a, b| b.rep_bps.cmp(&a.rep_bps));
        all.truncate(limit.min(MAX_PAGE) as usize);
        all
    }

    pub fn get_task(&self, task_id: u64) -> Option<TaskView> {
        self.tasks.get(&task_id).map(|t| TaskView { task: t.clone(), available: t.available() })
    }

    /// Newest first.
    pub fn list_tasks(&self, limit: u32, before_id: Option<u64>) -> Vec<TaskView> {
        let below = before_id.unwrap_or(self.next_task_id).min(self.next_task_id);
        (1..below)
            .rev()
            .take(limit.min(MAX_PAGE) as usize)
            .filter_map(|id| self.tasks.get(&id))
            .map(|t| TaskView { task: t.clone(), available: t.available() })
            .collect()
    }

    pub fn get_job(&self, job_id: u64) -> Option<JobView> {
        let now = env::block_timestamp();
        self.jobs.get(&job_id).map(|j| JobView { job: j.clone(), phase: j.phase(now) })
    }

    /// Newest first.
    pub fn list_jobs(&self, limit: u32, before_id: Option<u64>, task_id: Option<u64>) -> Vec<JobView> {
        let now = env::block_timestamp();
        let below = before_id.unwrap_or(self.next_job_id).min(self.next_job_id);
        (1..below)
            .rev()
            .take(MAX_SCAN)
            .filter_map(|id| self.jobs.get(&id))
            .filter(|j| task_id.is_none_or(|t| j.task_id == t))
            .take(limit.min(MAX_PAGE) as usize)
            .map(|j| JobView { job: j.clone(), phase: j.phase(now) })
            .collect()
    }
}

impl Contract {
    fn worker_mut(&mut self, account_id: &AccountId) -> &mut Worker {
        self.workers.get_mut(account_id).unwrap_or_else(|| env::panic_str("Worker not registered"))
    }

    fn task_mut(&mut self, task_id: u64) -> &mut Task {
        self.tasks.get_mut(&task_id).unwrap_or_else(|| env::panic_str("Task not found"))
    }

    fn job(&self, job_id: u64) -> &Job {
        self.jobs.get(&job_id).unwrap_or_else(|| env::panic_str("Job not found"))
    }

    fn job_mut(&mut self, job_id: u64) -> &mut Job {
        self.jobs.get_mut(&job_id).unwrap_or_else(|| env::panic_str("Job not found"))
    }

    fn require_contractor(&self, job_id: u64) {
        let task_id = self.job(job_id).task_id;
        let task = self.tasks.get(&task_id).unwrap_or_else(|| env::panic_str("Task not found"));
        require!(env::predecessor_account_id() == task.contractor, "Only the contractor can do this");
    }

    fn dispute_args(&self, job: &Job) -> Value {
        json!({
            "text": format!("Does the deliverable for job {} satisfy its brief? Both are linked and hashed in params.", job.id),
            "category": "news",
            "template": "free_text",
            "params": dispute_params(job),
            "resolve_after": "0",
            "min_stake": self.config.jury_min_stake,
            "timings": self.config.jury_timings,
            "callback": { "contract_id": env::current_account_id(), "method": CALLBACK_METHOD },
        })
    }

    fn close_without_winner(&mut self, job_id: u64, now: u64) {
        let job = self.job_mut(job_id);
        let (task_id, reserved) = (job.task_id, job.reserved);
        job.status = JobStatus::Closed;
        job.reserved = ZERO;
        job.result = Some(JobResult::NoBids);
        job.closed_at = Some(U64(now));
        let task = self.task_mut(task_id);
        task.reserved = task.reserved.saturating_sub(reserved);
        task.active_jobs -= 1;
        emit("job_closed", json!({ "job_id": job_id, "task_id": task_id, "result": JobResult::NoBids }));
    }

    /// The single place money leaves a job. Payments stay inside the contract as the worker's free
    /// balance; workers withdraw with a full key. Everything not paid returns to the task.
    fn settle_job(&mut self, job_id: u64, result: JobResult, now: u64) {
        let bond = self.config.worker_bond;
        let job = self.job_mut(job_id);
        let (task_id, reserved) = (job.task_id, job.reserved);
        let price = job.price.unwrap_or_else(|| env::panic_str("Job has no price"));
        let winner = job.winner.clone().unwrap_or_else(|| env::panic_str("Job has no winner"));
        job.status = JobStatus::Closed;
        job.reserved = ZERO;
        job.result = Some(result);
        job.closed_at = Some(U64(now));

        let to_worker = match result {
            JobResult::Accepted | JobResult::Claimed | JobResult::WonDispute => price,
            JobResult::Split => NearToken::from_yoctonear(award::worker_share_of_split(price.as_yoctonear())),
            JobResult::LostDispute | JobResult::MissedDelivery | JobResult::NoBids => ZERO,
        };
        let bond_slashed = matches!(result, JobResult::LostDispute | JobResult::MissedDelivery);

        let worker = self.worker_mut(&winner);
        worker.locked_balance = worker.locked_balance.saturating_sub(bond);
        worker.free_balance = worker.free_balance.saturating_add(to_worker);
        worker.stats.earned = worker.stats.earned.saturating_add(to_worker);
        match result {
            JobResult::Accepted | JobResult::Claimed | JobResult::WonDispute => {
                worker.stats.jobs += 1;
                worker.stats.successful += 1;
            }
            JobResult::LostDispute | JobResult::MissedDelivery => {
                worker.stats.jobs += 1;
                worker.stats.failed += 1;
            }
            JobResult::Split | JobResult::NoBids => {}
        }
        if bond_slashed {
            worker.stats.slashed = worker.stats.slashed.saturating_add(bond);
        } else {
            worker.free_balance = worker.free_balance.saturating_add(bond);
        }

        let task = self.task_mut(task_id);
        task.reserved = task.reserved.saturating_sub(reserved);
        task.paid = task.paid.saturating_add(to_worker);
        task.active_jobs -= 1;
        if bond_slashed {
            task.budget = task.budget.saturating_add(bond);
            if !task.banned.contains(&winner) {
                task.banned.push(winner.clone());
            }
        }
        // The receipt the web app and the contractor's report read.
        emit(
            "job_closed",
            json!({ "job_id": job_id, "task_id": task_id, "worker": &winner, "result": result, "paid": to_worker,
                    "bond_slashed": bond_slashed }),
        );
    }
}

fn result_for(answer: Answer) -> JobResult {
    match answer {
        Answer::Yes => JobResult::WonDispute,
        Answer::No => JobResult::LostDispute,
        Answer::Invalid => JobResult::Split,
    }
}

/// The JSON jurors read. A string, because SOOTH treats `params` as opaque.
fn dispute_params(job: &Job) -> String {
    json!({
        "kind": "job_review",
        "job_id": job.id,
        "brief_uri": job.brief_uri,
        "brief_hash": job.brief_hash,
        "deliverable_uri": job.deliverable_uri,
        "deliverable_hash": job.deliverable_hash,
    })
    .to_string()
}

fn valid_timings(t: &JobTimings) -> bool {
    [t.commit_secs, t.reveal_secs, t.delivery_secs, t.review_secs].iter().all(|s| (MIN_PHASE_SECS..=MAX_PHASE_SECS).contains(s))
}

fn require_link(uri: &str, hash: &str) {
    require!(!uri.is_empty() && uri.len() <= MAX_URI_LEN, "URI must be 1-120 chars");
    require!(is_hex_hash(hash), "Hash must be 64 lowercase hex chars");
}

/// Must match the worker runtime byte for byte. Binding the bidder stops one worker copying another's hash.
pub fn bid_preimage(job_id: u64, account_id: &AccountId, price: NearToken, eta_secs: u32, salt: &str) -> String {
    format!("{job_id}|{account_id}|{}|{eta_secs}|{salt}", price.as_yoctonear())
}

pub fn hex_sha256(text: &str) -> String {
    env::sha256(text.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

fn is_hex_hash(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn worker_view(account_id: &AccountId, w: &Worker) -> WorkerView {
    WorkerView {
        account_id: account_id.clone(),
        name: w.name.clone(),
        registered_at: U64(w.registered_at),
        free_balance: w.free_balance,
        locked_balance: w.locked_balance,
        rep_bps: award::rep_bps(w.stats.jobs, w.stats.successful),
        stats: w.stats.clone(),
    }
}

/// 2–32 chars of `[a-z0-9_-]`.
fn is_valid_name(name: &str) -> bool {
    (2..=32).contains(&name.len()) && name.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'-')
}

/// NEP-297 event: `EVENT_JSON:{"standard":"sooth_swarm","version":"1.0.0","event":..,"data":[..]}`.
fn emit(event: &str, data: Value) {
    let payload = json!({ "standard": "sooth_swarm", "version": "1.0.0", "event": event, "data": [data] });
    env::log_str(&format!("EVENT_JSON:{payload}"));
}
